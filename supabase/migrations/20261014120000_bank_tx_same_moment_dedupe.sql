-- 통장 거래 중복 — 같은 계좌·같은 초·같은 금액·같은 거래 후 잔액이면 같은 거래다.
--
--   codef-sync 의 중복 판별 키(external_id)는 [회사|계좌|날짜|시각|금액|입출|잔액|예금주] 다.
--   은행이 같은 거래의 예금주 칸(resAccountDesc1)을 다시 받을 때 다르게 내려 주는 일이 있어
--   (모티브 기업은행: 7/7 에 "체크" 로 받은 OpenAI 결제를 8/11 재수집 때 "카카오T택시_가승인" 으로),
--   마지막 칸만 다른 행이 새 거래로 들어갔다 — 193쌍(386행, 2026-01~07 거래).
--   잔액이 같은 초에 같은 금액으로 두 번 나올 수는 없으므로 앞 7칸이 같으면 같은 거래로 본다.
--
--   1) 앞으로: 넣기 전에 앞 7칸이 같은 행이 있으면 넣지 않는다(트리거). 같은 순간 두 번 수집돼도
--      advisory lock 으로 한 줄로 세운다. codef-sync 는 upsert ignoreDuplicates 라 '건너뜀' 으로 처리된다.
--   2) 지금 있는 중복: 사람이 손댄 쪽(확정·거절한 대금 맞춤, 전표·대출·카드·현금영수증 연결, 분류·메모·태그)을
--      남기고, 지울 쪽의 내용이 남길 쪽에 모두 들어 있을 때만 지운다. 아니면 남겨 두고 매일 대조가 사람에게 알린다.
--      거래처(partner_id)는 비교에서 뺀다 — 둘 다 예금주 글자로 자동으로 붙은 값이고 지울 쪽 값이 틀린 글자에서 나왔다.

create or replace function public.bank_tx_moment_key(p_external_id text)
returns text language sql immutable parallel safe as $$
  select split_part(p_external_id, '|', 1) || '|' || split_part(p_external_id, '|', 2) || '|' ||
         split_part(p_external_id, '|', 3) || '|' || split_part(p_external_id, '|', 4) || '|' ||
         split_part(p_external_id, '|', 5) || '|' || split_part(p_external_id, '|', 6) || '|' ||
         split_part(p_external_id, '|', 7)
$$;
comment on function public.bank_tx_moment_key(text) is
  '통장 거래의 같은 순간 키 — external_id 앞 7칸(회사|계좌|날짜|시각|금액|입출|잔액). 예금주 칸은 은행이 다르게 줄 때가 있어 뺀다';

create index if not exists idx_bank_tx_moment_key
  on public.bank_transactions (public.bank_tx_moment_key(external_id))
  where source = 'codef_bank' and external_id is not null;

create or replace function public.bank_tx_skip_same_moment()
returns trigger language plpgsql set search_path = public as $$
declare v_key text;
begin
  if new.source is distinct from 'codef_bank' or new.external_id is null
     or split_part(new.external_id, '|', 4) = '' then   -- 시각이 없으면 같은 순간인지 모른다
    return new;
  end if;
  v_key := public.bank_tx_moment_key(new.external_id);
  perform pg_advisory_xact_lock(hashtextextended('bank_tx_moment:' || v_key, 0));
  if exists (select 1 from public.bank_transactions b
              where b.source = 'codef_bank' and b.external_id is not null
                and public.bank_tx_moment_key(b.external_id) = v_key) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists trg_bank_tx_skip_same_moment on public.bank_transactions;
create trigger trg_bank_tx_skip_same_moment
  before insert on public.bank_transactions
  for each row execute function public.bank_tx_skip_same_moment();

-- 2) 지금 있는 중복 정리 ----------------------------------------------------
do $$
declare v_pairs int; v_ok int; v_deleted int;
begin
  create temp table _bank_dup_pairs on commit drop as
  with t as (
    select b.*, public.bank_tx_moment_key(b.external_id) k
      from public.bank_transactions b
     where b.source = 'codef_bank' and b.external_id is not null and split_part(b.external_id, '|', 4) <> ''
  ), d as (select k from t group by k having count(*) = 2),
  r as (
    select t.id, t.k, t.created_at,
      exists (select 1 from public.invoice_settlements x where x.bank_transaction_id = t.id and x.status <> 'suggested') human_settle,
      (exists (select 1 from public.loan_payments x where x.bank_transaction_id = t.id)
        or exists (select 1 from public.journal_entries x where x.linked_bank_tx_id = t.id)
        or exists (select 1 from public.cash_receipts x where x.bank_transaction_id = t.id)
        or exists (select 1 from public.card_transactions x where x.bank_transaction_id = t.id)) other_refs,
      coalesce((select array_agg(distinct x.tax_invoice_id) from public.invoice_settlements x where x.bank_transaction_id = t.id), '{}') sugg,
      jsonb_strip_nulls(jsonb_build_object(
        'memo', nullif(t.memo, ''), 'deal', t.deal_id, 'cls', t.classification, 'cat', t.category,
        'fixed', nullif(coalesce(t.is_fixed_cost, false), false), 'map', nullif(t.mapping_status, 'unmapped'),
        'ti', t.tax_invoice_id, 'ct', t.card_transaction_id, 'settled', nullif(coalesce(t.settled_amount, 0), 0),
        'je', t.journal_entry_id, 'tags', case when coalesce(array_length(t.tags, 1), 0) > 0 then to_jsonb(t.tags) end,
        'emp', t.used_by_employee_id, 'excl', t.ledger_excluded_reason,
        'auto', nullif(coalesce(t.is_auto_transfer, false), false), 'acct', t.bank_account_id)) u
    from t join d using (k)
  ), ranked as (
    select r.*, row_number() over (partition by k order by human_settle desc, other_refs desc,
                                   (select count(*) from jsonb_object_keys(u)) desc, created_at asc, id) rn
      from r
  )
  select a.k, a.id keep_id, b.id drop_id,
         (not b.human_settle and not b.other_refs and a.u @> b.u and a.sugg @> b.sugg) ok
    from ranked a join ranked b on a.k = b.k and a.rn = 1 and b.rn = 2;

  select count(*), count(*) filter (where ok) into v_pairs, v_ok from _bank_dup_pairs;
  raise notice 'bank dup pairs=% deletable=%', v_pairs, v_ok;
  --   조사한 그대로인지 — 다르면(그 사이 수집·손질이 있었으면) 아무것도 지우지 않고 멈춘다
  if v_pairs > 193 or v_ok > 191 then
    raise exception 'bank dup cleanup: unexpected counts pairs=% ok=% (expected ≤193/≤191)', v_pairs, v_ok;
  end if;

  delete from public.bank_transactions b
   using _bank_dup_pairs p
   where p.ok and b.id = p.drop_id
     and b.company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c';
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_ok then
    raise exception 'bank dup cleanup: deleted % but expected %', v_deleted, v_ok;
  end if;
  raise notice 'bank dup deleted=%', v_deleted;
end $$;
