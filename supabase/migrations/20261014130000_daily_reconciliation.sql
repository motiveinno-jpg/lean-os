-- 매일 숫자 대조 — 통장 잔액·빠진 거래·중복 거래·카드 중복 결제를 찾아 사람에게 알린다.
--
--   수집이 '성공'이어도 숫자가 틀릴 수 있다: 은행이 같은 거래를 다르게 다시 주면 두 번 들어가고
--   (2026-10 모티브 193쌍), 수집이 하루 빠지면 거래가 비고, 카드도 같은 승인이 두 번 잡힐 수 있다.
--   화면에서 사람이 눈으로 맞춰 보기 전에는 아무도 모른다 — 매일 아침 장부끼리 맞춰 본다.
--
--   무엇을 기준으로 보나
--   ① 잔액: 통장(bank_accounts.balance) = 그 통장 마지막 거래의 거래 후 잔액.
--      '마지막' 은 날짜+시각(external_id 4칸) 순서 — 넣은 순서(created_at)는 재수집 때 뒤섞인다.
--      같은 초에 여러 건이면 그중 다른 건의 '거래 전 잔액'이 아닌 것이 마지막이다.
--      잔액은 수집 시점이 거래와 조금 어긋날 수 있어 이틀 연속 다를 때만 알린다.
--   ② 빠진 거래(최근 60일): 거래 전 잔액(거래 후 잔액 ∓ 금액)과 같은 거래 후 잔액을 가진 거래가 그 통장에 없으면
--      그 앞에 빠진 거래가 있다. 순서와 무관하게 판정된다(같은 초 여러 건도). 통장의 첫 거래는 뺀다.
--   ③ 통장 중복: 같은 순간 키(bank_tx_moment_key)가 둘 이상. 넣을 때 막지만(20261014120000) 사람이 확인해야 해서
--      남겨 둔 쌍과, 막기 전에 들어온 것을 알린다.
--   ④ 카드 중복: 같은 카드·같은 승인번호·같은 날·같은 금액이 둘 이상.
--
--   결과는 reconciliation_findings 에 한 건씩(회사·종류·대상당 하나). 다음 날 안 보이면 해결로 돌린다.
--   알림은 새로 생긴 건이 있을 때만 — 대표(마스터)와 은행연동 권한(/settings:bank)을 가진 사람에게.
--   회사 데이터를 만드는 자동화라 feature_rollout('daily_reconciliation') 으로 모티브부터.

create table if not exists public.reconciliation_findings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  kind          text not null check (kind in ('bank_balance_mismatch', 'bank_balance_gap', 'bank_duplicate', 'card_duplicate')),
  subject_key   text not null,
  title         text not null,
  detail        jsonb not null default '{}'::jsonb,
  seen_count    int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  notified_at   timestamptz,
  resolved_at   timestamptz,
  unique (company_id, kind, subject_key)
);
comment on table public.reconciliation_findings is '매일 숫자 대조 결과 — 통장 잔액 불일치·빠진 거래·중복 거래·카드 중복. run_daily_reconciliation 만 쓴다';

alter table public.reconciliation_findings enable row level security;
drop policy if exists reconciliation_findings_select on public.reconciliation_findings;
create policy reconciliation_findings_select on public.reconciliation_findings
  for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.has_perm('/settings:bank')));
revoke insert, update, delete on public.reconciliation_findings from anon, authenticated;

create index if not exists idx_reconciliation_findings_open
  on public.reconciliation_findings (company_id) where resolved_at is null;

create or replace function public.run_daily_reconciliation()
returns table (company_id uuid, findings int, new_findings int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  c record; v_found int; v_new int; v_lines text; v_open int;
  v_run timestamptz := now();
  --   이 함수가 맡는 종류 — 같은 표에 국세청 확인(run 은 nts-status-check)도 쌓이므로 해결·알림은 이 종류만
  v_kinds text[] := array['bank_balance_mismatch', 'bank_balance_gap', 'bank_duplicate', 'card_duplicate'];
begin
  for c in
    select co.id cid from public.companies co
     where public.feature_on('daily_reconciliation', co.id)
       and (exists (select 1 from public.bank_accounts a where a.company_id = co.id)
            or exists (select 1 from public.card_transactions ct where ct.company_id = co.id))
  loop
    create temp table if not exists _recon (kind text, subject_key text, title text, detail jsonb) on commit drop;
    truncate _recon;

    -- 거래 목록(이 회사 CODEF 통장 거래) — 시각은 external_id 4칸
    insert into _recon
    with tx as (
      select b.id, b.bank_account_id, b.transaction_date d, split_part(b.external_id, '|', 4) tm,
             b.amount, b.type, b.balance_after bal,
             b.balance_after - case when b.type = 'income' then b.amount else -b.amount end pre
        from public.bank_transactions b
       where b.company_id = c.cid and b.source = 'codef_bank'
         and b.bank_account_id is not null and b.balance_after is not null
    ), acct as (
      select a.id, a.bank_name, right(a.account_number, 4) tail, a.balance
        from public.bank_accounts a
       where a.company_id = c.cid and not coalesce(a.is_hidden, false)
         and exists (select 1 from tx where tx.bank_account_id = a.id)
    ), last_moment as (
      select distinct on (bank_account_id) bank_account_id, d, tm from tx order by bank_account_id, d desc, tm desc
    ), closing as (
      select distinct on (t.bank_account_id) t.bank_account_id, t.bal, t.d, t.tm
        from tx t join last_moment m on m.bank_account_id = t.bank_account_id and m.d = t.d and m.tm = t.tm
       order by t.bank_account_id,
                exists (select 1 from tx o where o.bank_account_id = t.bank_account_id and o.d = t.d and o.tm = t.tm
                                              and o.id <> t.id and o.pre = t.bal),
                t.id
    )
    select 'bank_balance_mismatch', a.id::text,
           a.bank_name || ' ***' || a.tail || ' 잔액이 다릅니다 — 통장 ' || to_char(a.balance, 'FM999,999,999,990') ||
           '원, 마지막 거래(' || to_char(cl.d, 'MM/DD') || ' ' || substr(cl.tm, 1, 2) || ':' || substr(cl.tm, 3, 2) || ') 후 ' ||
           to_char(cl.bal, 'FM999,999,999,990') || '원',
           jsonb_build_object('bank_account_id', a.id, 'balance', a.balance, 'closing', cl.bal, 'date', cl.d, 'time', cl.tm)
      from acct a join closing cl on cl.bank_account_id = a.id
     where a.balance is distinct from cl.bal
    union all
    select 'bank_balance_gap', t.id::text,
           a.bank_name || ' ***' || a.tail || ' ' || to_char(t.d, 'MM/DD') || ' ' || substr(t.tm, 1, 2) || ':' || substr(t.tm, 3, 2) || ' ' ||
           case when t.type = 'income' then '입금 ' else '출금 ' end || to_char(t.amount, 'FM999,999,999,990') ||
           '원 앞에 빠진 거래가 있습니다(거래 전 잔액 ' || to_char(t.pre, 'FM999,999,999,990') || '원인 거래가 없음)',
           jsonb_build_object('bank_account_id', a.id, 'bank_transaction_id', t.id, 'date', t.d, 'time', t.tm, 'pre_balance', t.pre)
      from tx t join acct a on a.id = t.bank_account_id
     where t.d >= current_date - 60
       and t.id <> (select f.id from tx f where f.bank_account_id = t.bank_account_id order by f.d, f.tm, f.id limit 1)
       and not exists (select 1 from tx p where p.bank_account_id = t.bank_account_id and p.bal = t.pre and p.id <> t.id);

    -- 통장 중복
    insert into _recon
    select 'bank_duplicate', g.k,
           coalesce(a.bank_name, '통장') || ' ***' || right(split_part(g.k, '|', 2), 4) || ' ' ||
           to_char(g.d, 'MM/DD') || ' ' || substr(split_part(g.k, '|', 4), 1, 2) || ':' || substr(split_part(g.k, '|', 4), 3, 2) || ' ' ||
           case when split_part(g.k, '|', 6) = 'income' then '입금 ' else '출금 ' end ||
           to_char(split_part(g.k, '|', 5)::numeric, 'FM999,999,999,990') || '원이 ' || g.n || '번 들어와 있습니다',
           jsonb_build_object('bank_transaction_ids', g.ids)
      from (
        select public.bank_tx_moment_key(b.external_id) k, min(b.transaction_date) d, count(*) n,
               jsonb_agg(b.id order by b.created_at) ids, (array_agg(b.bank_account_id))[1] acct_id
          from public.bank_transactions b
         where b.company_id = c.cid and b.source = 'codef_bank' and b.external_id is not null
           and split_part(b.external_id, '|', 4) <> ''
         group by 1 having count(*) > 1
      ) g left join public.bank_accounts a on a.id = g.acct_id;

    -- 카드 중복
    insert into _recon
    select 'card_duplicate', g.card_key,
           coalesce(nullif(g.card_name, ''), '카드') || ' ' || to_char(g.d, 'MM/DD') || ' ' || coalesce(nullif(g.merchant, ''), '가맹점') || ' ' ||
           to_char(g.amount, 'FM999,999,999,990') || '원(승인 ' || g.approval || ')이 ' || g.n || '번 들어와 있습니다',
           jsonb_build_object('card_transaction_ids', g.ids)
      from (
        select coalesce(ct.card_id::text, ct.card_name, '') || '|' || ct.approval_number || '|' || ct.transaction_date || '|' || ct.amount card_key,
               max(ct.card_name) card_name, ct.transaction_date d, max(ct.merchant_name) merchant, ct.amount, ct.approval_number approval,
               count(*) n, jsonb_agg(ct.id order by ct.created_at) ids
          from public.card_transactions ct
         where ct.company_id = c.cid and coalesce(ct.approval_number, '') <> ''
         group by coalesce(ct.card_id::text, ct.card_name, ''), ct.approval_number, ct.transaction_date, ct.amount
        having count(*) > 1
      ) g;

    -- 기록 — 이미 있으면 다시 본 것으로, 해결됐던 것이 다시 나오면 새로 생긴 것으로
    insert into public.reconciliation_findings as f (company_id, kind, subject_key, title, detail, last_seen_at, first_seen_at)
    select c.cid, r.kind, r.subject_key, r.title, r.detail, v_run, v_run from _recon r
    on conflict (company_id, kind, subject_key) do update
      set title = excluded.title, detail = excluded.detail, last_seen_at = v_run,
          seen_count = case when f.resolved_at is null then f.seen_count + 1 else 1 end,
          first_seen_at = case when f.resolved_at is null then f.first_seen_at else v_run end,
          notified_at = case when f.resolved_at is null then f.notified_at else null end,
          resolved_at = null;

    update public.reconciliation_findings f set resolved_at = v_run
     where f.company_id = c.cid and f.kind = any (v_kinds) and f.resolved_at is null and f.last_seen_at < v_run;

    select count(*) into v_found from _recon;

    -- 알릴 것: 아직 안 알린 열린 건(잔액은 이틀째부터)
    select count(*), string_agg('· ' || x.title, E'\n' order by x.kind, x.first_seen_at) filter (where x.rn <= 5)
      into v_new, v_lines
      from (select f.*, row_number() over (order by f.kind, f.first_seen_at) rn
              from public.reconciliation_findings f
             where f.company_id = c.cid and f.kind = any (v_kinds) and f.resolved_at is null and f.notified_at is null
               and (f.kind <> 'bank_balance_mismatch' or f.seen_count >= 2)) x;

    if v_new > 0 then
      select count(*) into v_open from public.reconciliation_findings f where f.company_id = c.cid and f.kind = any (v_kinds) and f.resolved_at is null;
      insert into public.notifications (company_id, user_id, type, title, message, link)
      select c.cid, u.id, 'system', '통장·카드 숫자 대조에서 확인할 곳이 있습니다',
             '새로 ' || v_new || '건' || case when v_open > v_new then ' (전체 ' || v_open || '건)' else '' end || E'\n' || v_lines ||
             case when v_new > 5 then E'\n… 외 ' || (v_new - 5) || '건' else '' end,
             '/bank'
        from public.users u
       where u.company_id = c.cid
         and (u.is_master or exists (select 1 from public.member_permissions mp
                                      where mp.user_id = u.id and mp.company_id = c.cid and mp.perm_key = '/settings:bank'));
      update public.reconciliation_findings f set notified_at = v_run
       where f.company_id = c.cid and f.kind = any (v_kinds) and f.resolved_at is null and f.notified_at is null
         and (f.kind <> 'bank_balance_mismatch' or f.seen_count >= 2);
    end if;

    company_id := c.cid; findings := v_found; new_findings := v_new; return next;
  end loop;
end $$;
revoke all on function public.run_daily_reconciliation() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'daily-reconciliation';
  perform cron.schedule('daily-reconciliation', '30 22 * * *', 'select public.run_daily_reconciliation()');   -- 07:30 KST (새벽 수집 뒤)
end $$;

insert into public.feature_rollout (feature, company_id, note)
select 'daily_reconciliation', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '매일 숫자 대조 — 모티브 먼저'
where not exists (select 1 from public.feature_rollout where feature = 'daily_reconciliation');
