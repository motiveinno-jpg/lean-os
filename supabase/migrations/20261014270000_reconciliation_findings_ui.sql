-- 숫자 대조·국세청 확인 결과를 사람이 보고 처리할 수 있게 — 알림을 누르면 무엇이 걸렸는지 보이는 창(화면: reconciliation-findings-dialog).
--
--   알림은 '/bank' 로만 보냈고 결과(reconciliation_findings)를 보여 주는 화면이 없어, 눌러도 무엇을 봐야 하는지 몰랐다.
--   ① 알림 주소에 ?findings=bank|nts 를 붙여 앱 어디서든 결과 창이 열린다(app-shell 에 한 번 둔다).
--   ② '문제 없음' 표시(dismissed_at) — 사람이 보고 괜찮다고 한 건은 다시 알리지 않는다. 해결됐다가 다시 나오면 새 건이라 표시를 지운다.
--   ③ 창에서 고친 뒤(중복 한 줄 지우기 등) '다시 대조' — 그 회사만 지금 다시 돌려 바로 결과에 반영한다(알림은 보내지 않는다).
--   매일 대조 본문은 회사 하나를 대조하는 reconcile_company 로 옮기고, 크론(run_daily_reconciliation)은 회사마다 그것을 부른다.

alter table public.reconciliation_findings add column if not exists dismissed_at timestamptz;
alter table public.reconciliation_findings add column if not exists dismissed_by uuid references public.users(id) on delete set null;
comment on column public.reconciliation_findings.dismissed_at is '사람이 확인하고 문제 없다고 표시한 때 — 열려 있어도 다시 알리지 않는다';

create or replace function public.reconcile_company(p_company uuid, p_notify boolean default true)
returns table (findings int, new_findings int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_found int; v_new int; v_lines text; v_open int;
  v_run timestamptz := clock_timestamp();
  --   이 함수가 맡는 종류 — 같은 표에 국세청 확인(record_nts_findings)도 쌓이므로 해결·알림은 이 종류만
  v_kinds text[] := array['bank_balance_mismatch', 'bank_balance_gap', 'bank_duplicate', 'card_duplicate'];
begin
  perform pg_advisory_xact_lock(hashtextextended('reconcile:' || p_company::text, 0));
  create temp table if not exists _recon (kind text, subject_key text, title text, detail jsonb) on commit drop;
  truncate _recon;

  -- 거래 목록(이 회사 CODEF 통장 거래) — 시각은 external_id 4칸
  insert into _recon
  with tx as (
    select b.id, b.bank_account_id, b.transaction_date d, split_part(b.external_id, '|', 4) tm,
           b.amount, b.type, b.balance_after bal,
           b.balance_after - case when b.type = 'income' then b.amount else -b.amount end pre
      from public.bank_transactions b
     where b.company_id = p_company and b.source = 'codef_bank'
       and b.bank_account_id is not null and b.balance_after is not null
  ), acct as (
    select a.id, a.bank_name, right(a.account_number, 4) tail, a.balance
      from public.bank_accounts a
     where a.company_id = p_company and not coalesce(a.is_hidden, false)
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
       where b.company_id = p_company and b.source = 'codef_bank' and b.external_id is not null
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
       where ct.company_id = p_company and coalesce(ct.approval_number, '') <> ''
       group by coalesce(ct.card_id::text, ct.card_name, ''), ct.approval_number, ct.transaction_date, ct.amount
      having count(*) > 1
    ) g;

  -- 기록 — 이미 있으면 다시 본 것으로, 해결됐던 것이 다시 나오면 새로 생긴 것으로
  insert into public.reconciliation_findings as f (company_id, kind, subject_key, title, detail, last_seen_at, first_seen_at)
  select p_company, r.kind, r.subject_key, r.title, r.detail, v_run, v_run from _recon r
  on conflict (company_id, kind, subject_key) do update
    set title = excluded.title, detail = excluded.detail, last_seen_at = v_run,
        seen_count = case when f.resolved_at is null then f.seen_count + 1 else 1 end,
        first_seen_at = case when f.resolved_at is null then f.first_seen_at else v_run end,
        notified_at = case when f.resolved_at is null then f.notified_at else null end,
        --   사람이 '문제 없음'으로 둔 건은 그대로 두고, 해결됐다가 다시 나온 건은 새 건으로(표시를 지운다)
        dismissed_at = case when f.resolved_at is null then f.dismissed_at else null end,
        dismissed_by = case when f.resolved_at is null then f.dismissed_by else null end,
        resolved_at = null;

  update public.reconciliation_findings f set resolved_at = v_run
   where f.company_id = p_company and f.kind = any (v_kinds) and f.resolved_at is null and f.last_seen_at < v_run;

  select count(*) into v_found from _recon;

  -- 알릴 것: 아직 안 알린 열린 건(잔액은 이틀째부터)
  select count(*), string_agg('· ' || x.title, E'\n' order by x.kind, x.first_seen_at) filter (where x.rn <= 5)
    into v_new, v_lines
    from (select f.*, row_number() over (order by f.kind, f.first_seen_at) rn
            from public.reconciliation_findings f
           where f.company_id = p_company and f.kind = any (v_kinds) and f.resolved_at is null and f.dismissed_at is null and f.notified_at is null
             and (f.kind <> 'bank_balance_mismatch' or f.seen_count >= 2)) x;

  if p_notify and v_new > 0 then
    select count(*) into v_open from public.reconciliation_findings f where f.company_id = p_company and f.kind = any (v_kinds) and f.resolved_at is null and f.dismissed_at is null;
    insert into public.notifications (company_id, user_id, type, title, message, link)
    select p_company, u.id, 'system', '통장·카드 숫자 대조에서 확인할 곳이 있습니다',
           '새로 ' || v_new || '건' || case when v_open > v_new then ' (전체 ' || v_open || '건)' else '' end || E'\n' || v_lines ||
           case when v_new > 5 then E'\n… 외 ' || (v_new - 5) || '건' else '' end,
           '/bank?findings=bank'
      from public.users u
     where u.company_id = p_company
       and (u.is_master or exists (select 1 from public.member_permissions mp
                                    where mp.user_id = u.id and mp.company_id = p_company and mp.perm_key = '/settings:bank'));
    update public.reconciliation_findings f set notified_at = v_run
     where f.company_id = p_company and f.kind = any (v_kinds) and f.resolved_at is null and f.dismissed_at is null and f.notified_at is null
       and (f.kind <> 'bank_balance_mismatch' or f.seen_count >= 2);
  end if;


  findings := v_found; new_findings := coalesce(v_new, 0); return next;
end $$;
revoke all on function public.reconcile_company(uuid, boolean) from public, anon, authenticated;

create or replace function public.run_daily_reconciliation()
returns table (company_id uuid, findings int, new_findings int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare c record; r record;
begin
  for c in
    select co.id cid from public.companies co
     where public.feature_on('daily_reconciliation', co.id)
       and (exists (select 1 from public.bank_accounts a where a.company_id = co.id)
            or exists (select 1 from public.card_transactions ct where ct.company_id = co.id))
  loop
    select * into r from public.reconcile_company(c.cid, true);
    company_id := c.cid; findings := r.findings; new_findings := r.new_findings; return next;
  end loop;
end $$;
revoke all on function public.run_daily_reconciliation() from public, anon, authenticated;

create or replace function public.record_nts_findings(p_company uuid, p_kinds text[], p_findings jsonb)
returns int language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_run timestamptz := now(); v_new int; v_lines text; v_partner_only boolean;
begin
  if p_kinds is null or cardinality(p_kinds) = 0 then return 0; end if;
  --   같은 회사 기록이 겹쳐 돌면(수동 실행 + 크론) 같은 건을 두 번 알린다 — 회사 단위로 한 줄로 세운다
  perform pg_advisory_xact_lock(hashtextextended('nts_findings:' || p_company::text, 0));
  if exists (select 1 from unnest(p_kinds) k where k not in ('company_business_status', 'company_profile_mismatch', 'partner_business_status')) then
    raise exception 'record_nts_findings: unknown kind in %', p_kinds;
  end if;

  insert into public.reconciliation_findings as f (company_id, kind, subject_key, title, detail, last_seen_at, first_seen_at)
  select p_company, x->>'kind', x->>'subject_key', x->>'title', coalesce(x->'detail', '{}'::jsonb), v_run, v_run
    from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) x
   where x->>'kind' = any (p_kinds)
  on conflict (company_id, kind, subject_key) do update
    set title = excluded.title, detail = excluded.detail, last_seen_at = v_run,
        seen_count = case when f.resolved_at is null then f.seen_count + 1 else 1 end,
        first_seen_at = case when f.resolved_at is null then f.first_seen_at else v_run end,
        notified_at = case when f.resolved_at is null then f.notified_at else null end,
        dismissed_at = case when f.resolved_at is null then f.dismissed_at else null end,
        dismissed_by = case when f.resolved_at is null then f.dismissed_by else null end,
        resolved_at = null;

  update public.reconciliation_findings f set resolved_at = v_run
   where f.company_id = p_company and f.kind = any (p_kinds) and f.resolved_at is null and f.last_seen_at < v_run;

  select count(*), string_agg('· ' || x.title, E'\n' order by x.kind, x.first_seen_at) filter (where x.rn <= 5),
         bool_and(x.kind = 'partner_business_status')
    into v_new, v_lines, v_partner_only
    from (select f.*, row_number() over (order by f.kind, f.first_seen_at) rn
            from public.reconciliation_findings f
           where f.company_id = p_company and f.kind = any (p_kinds) and f.resolved_at is null and f.dismissed_at is null and f.notified_at is null) x;

  if v_new > 0 then
    insert into public.notifications (company_id, user_id, type, title, message, link)
    select p_company, u.id, 'system', '국세청 기록 확인에서 확인할 곳이 있습니다',
           '새로 ' || v_new || '건' || E'\n' || v_lines || case when v_new > 5 then E'\n… 외 ' || (v_new - 5) || '건' else '' end,
           case when v_partner_only then '/partners?findings=nts' else '/settings/company?findings=nts' end
      from public.users u
     where u.company_id = p_company and u.is_master;
    update public.reconciliation_findings f set notified_at = v_run
     where f.company_id = p_company and f.kind = any (p_kinds) and f.resolved_at is null and f.dismissed_at is null and f.notified_at is null;
  end if;
  return v_new;
end $$;

-- 화면에서: 지금 다시 대조(내 회사, 알림 없이)
create or replace function public.recheck_my_reconciliation()
returns int language plpgsql security definer set search_path = public as $$
declare v_company uuid := (select public.get_my_company_id()); v_n int;
begin
  if v_company is null or not (select public.has_perm('/settings:bank')) then
    raise exception '은행연동 권한이 있는 사람만 다시 대조할 수 있습니다.' using errcode = '42501';
  end if;
  if not public.feature_on('daily_reconciliation', v_company) then return 0; end if;
  select findings into v_n from public.reconcile_company(v_company, false);
  return coalesce(v_n, 0);
end $$;
revoke all on function public.recheck_my_reconciliation() from public, anon;
grant execute on function public.recheck_my_reconciliation() to authenticated;

-- 화면에서: '문제 없음' 표시·되돌리기. 통장·카드 건은 은행연동 권한, 국세청 건은 대표(마스터)만
create or replace function public.dismiss_reconciliation_finding(p_id uuid, p_dismiss boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare f record; v_me uuid := (select public.current_app_user_id()); v_master boolean;
begin
  select * into f from public.reconciliation_findings where id = p_id;
  if not found or f.company_id is distinct from (select public.get_my_company_id()) then
    raise exception '대조 결과를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  select coalesce(u.is_master, false) into v_master from public.users u where u.id = v_me;
  if f.kind in ('company_business_status', 'company_profile_mismatch', 'partner_business_status') then
    if not coalesce(v_master, false) then raise exception '국세청 확인 결과는 대표만 표시할 수 있습니다.' using errcode = '42501'; end if;
  elsif not (select public.has_perm('/settings:bank')) then
    raise exception '은행연동 권한이 있는 사람만 표시할 수 있습니다.' using errcode = '42501';
  end if;
  update public.reconciliation_findings
     set dismissed_at = case when p_dismiss then now() end, dismissed_by = case when p_dismiss then v_me end
   where id = p_id;
end $$;
revoke all on function public.dismiss_reconciliation_finding(uuid, boolean) from public, anon;
grant execute on function public.dismiss_reconciliation_finding(uuid, boolean) to authenticated;

-- 이미 보낸 알림도 결과 창으로 열리게(이 두 제목의 시스템 알림만)
update public.notifications set link = '/bank?findings=bank'
 where type = 'system' and title = '통장·카드 숫자 대조에서 확인할 곳이 있습니다' and link = '/bank';
update public.notifications set link = link || '?findings=nts'
 where type = 'system' and title = '국세청 기록 확인에서 확인할 곳이 있습니다' and link in ('/partners', '/settings/company');
