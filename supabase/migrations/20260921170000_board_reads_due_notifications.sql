-- 소소 5건 중 DB 가 필요한 둘 (2026-09-21, 랜딩 문구 대조 🟡)
--   ① 게시판 「읽음 현황 확인」 — 누가 읽었는지 남기는 표. 글을 펼치면 본인 행이 한 번 생긴다(첫 열람만).
--   ② 알림 「세금 일정 사전 안내」·정기 지출 「다음 결제일 알림」 — 지금은 대시보드 일정에만 뜨고 알림함엔 안 온다.
--      매일 08:00 KST 에 DB 함수가 내일 결제 예정(정기 지출·고정비)과 D-7/D-1 세금 마감을 회사 마스터 알림함에 넣는다.
--      회사 데이터를 만드는 자동화 → feature_rollout 'due_notifications' 로 모티브 먼저.

-- ── ① 게시판 읽음 ──────────────────────────────────────────────────────────
create table if not exists public.board_post_reads (
  post_id uuid not null references public.board_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
comment on table public.board_post_reads is '게시글 읽음 기록 — 펼쳐 본 첫 시각. 읽음 현황(N/M명·누가)에 쓴다.';
create index if not exists board_post_reads_company_idx on public.board_post_reads (company_id, post_id);
alter table public.board_post_reads enable row level security;
drop policy if exists board_post_reads_select on public.board_post_reads;
create policy board_post_reads_select on public.board_post_reads for select
  using (company_id = (select public.get_my_company_id()));
drop policy if exists board_post_reads_insert_self on public.board_post_reads;
create policy board_post_reads_insert_self on public.board_post_reads for insert
  with check (company_id = (select public.get_my_company_id()) and user_id = (select public.current_app_user_id()));

-- ── ② 결제 예정·세금 마감 알림 ───────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'deal_update','expense_request','contract_expiry','signature_request','payment_due','system','document','approval','chat',
  'overtime_auto_clockout','project_checkin_due','overtime_request','overtime_approved','overtime_rejected','company_join_request',
  'approval_request','approval_approved','approval_rejected','approval_reference','billing','board_post','contract_renewal',
  'hr_contract_package','leave_request','inventory','dormant_deal','dormant_partner','tax_due'
]));

create or replace function public.run_due_notifications()
returns table (company_id uuid, inserted int) language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_tom date := ((now() at time zone 'Asia/Seoul')::date + 1);
  v_tom_last int := extract(day from (date_trunc('month', v_tom) + interval '1 month - 1 day'))::int;
  c record; r record; u record; n int;
  d date; key text; title text; link text;
begin
  for c in select distinct f.company_id as cid from public.feature_rollout f where f.feature = 'due_notifications' and f.company_id is not null
           union select co.id from public.companies co where exists (select 1 from public.feature_rollout f where f.feature = 'due_notifications' and f.company_id is null)
  loop
    n := 0;
    for u in select id from public.users where users.company_id = c.cid and coalesce(is_master, false) loop
      -- 정기 지출 — 내일이 결제일(말일 넘는 날짜는 그 달 말일로)
      for r in select id, name, amount from public.recurring_payments p
               where p.company_id = c.cid and coalesce(p.is_active, true)
                 and least(coalesce(p.day_of_month, 0), v_tom_last) = extract(day from v_tom)::int
      loop
        title := format('내일 결제 예정 · %s', r.name);
        if not exists (select 1 from public.notifications x where x.company_id = c.cid and x.user_id = u.id and x.type = 'payment_due' and x.entity_id = r.id and x.created_at > now() - interval '20 days') then
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, link)
          values (c.cid, u.id, 'payment_due', title, format('%s %s원이 %s 결제될 예정입니다. 통장 잔액을 확인하세요.', r.name, to_char(coalesce(r.amount, 0), 'FM999,999,999,999'), to_char(v_tom, 'MM/DD')), 'recurring_payment', r.id, false, '/payments');
          n := n + 1;
        end if;
      end loop;
      -- 고정비 — 내일이 납부일
      for r in select id, name, amount from public.fixed_costs f
               where f.company_id = c.cid and coalesce(f.is_recurring, true)
                 and (f.end_date is null or f.end_date >= v_tom) and (f.start_date is null or f.start_date <= v_tom)
                 and least(coalesce(f.payment_day, 0), v_tom_last) = extract(day from v_tom)::int
      loop
        title := format('내일 납부 예정 · %s', r.name);
        if not exists (select 1 from public.notifications x where x.company_id = c.cid and x.user_id = u.id and x.type = 'payment_due' and x.entity_id = r.id and x.created_at > now() - interval '20 days') then
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, link)
          values (c.cid, u.id, 'payment_due', title, format('고정비 %s %s원의 납부일이 %s입니다.', r.name, to_char(coalesce(r.amount, 0), 'FM999,999,999,999'), to_char(v_tom, 'MM/DD')), 'fixed_cost', r.id, false, '/payments');
          n := n + 1;
        end if;
      end loop;
      -- 세금 마감 — D-7 · D-1 (대시보드 일정과 같은 달력: 부가세 1·4·7·10월 25일 · 원천세 매월 10일 · 법인세 3/31 · 지방소득세 4/30 · 중간예납 8/31 · 간이지급명세서 1/31·7/31)
      for r in
        select * from (values
          ('vat',        'vat-',  (case when extract(month from v_today) in (1,4,7,10) then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 25) else null end), '부가세 신고·납부', '/finance/tax-filing?tab=vat'),
          ('vat-next',   'vat-',  (case when extract(month from v_today) in (12,3,6,9) then make_date(extract(year from (v_today + interval '1 month'))::int, extract(month from (v_today + interval '1 month'))::int, 25) else null end), '부가세 신고·납부', '/finance/tax-filing?tab=vat'),
          ('wht',        'wht-',  make_date(extract(year from v_today)::int, extract(month from v_today)::int, 10), '원천세 신고·납부', '/finance/tax-filing?tab=wht'),
          ('wht-next',   'wht-',  make_date(extract(year from (v_today + interval '1 month'))::int, extract(month from (v_today + interval '1 month'))::int, 10), '원천세 신고·납부', '/finance/tax-filing?tab=wht'),
          ('cit',        'cit-',  make_date(extract(year from v_today)::int, 3, 31), '법인세 신고·납부 (12월 결산)', '/finance/tax-filing?tab=cit'),
          ('cit-local',  'cit-local-', make_date(extract(year from v_today)::int, 4, 30), '법인지방소득세 신고·납부', '/finance/tax-filing?tab=cit'),
          ('cit-interim','cit-interim-', make_date(extract(year from v_today)::int, 8, 31), '법인세 중간예납', '/finance/tax-filing?tab=cit'),
          ('sps-h2',     'sps-h2-', make_date(extract(year from v_today)::int, 1, 31), '근로 간이지급명세서 제출 (하반기분)', '/finance/tax-filing?tab=stmt'),
          ('sps-h1',     'sps-h1-', make_date(extract(year from v_today)::int, 7, 31), '근로 간이지급명세서 제출 (상반기분)', '/finance/tax-filing?tab=stmt')
        ) as t(k, prefix, due, ttl, lnk)
        where due is not null and (due - v_today) in (1, 7)
      loop
        d := r.due; key := r.prefix || to_char(d, 'YYYY-MM-DD'); title := format('%s %s · %s', case when d - v_today = 1 then '내일' else '7일 뒤' end, r.ttl, to_char(d, 'MM/DD'));
        if exists (select 1 from public.tax_deadline_checks t where t.company_id = c.cid and t.deadline_id = key) then continue; end if;
        if not exists (select 1 from public.notifications x where x.company_id = c.cid and x.user_id = u.id and x.type = 'tax_due' and x.title = title and x.created_at > now() - interval '20 days') then
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, link)
          values (c.cid, u.id, 'tax_due', title, format('%s 기한이 %s입니다. 재무 › 세무 신고에서 준비 상태를 확인하세요. 이미 마쳤다면 대시보드 세금 일정에서 완료 체크하면 더 알리지 않습니다.', r.ttl, to_char(d, 'YYYY-MM-DD')), 'tax_deadline', null, false, r.lnk);
          n := n + 1;
        end if;
      end loop;
    end loop;
    company_id := c.cid; inserted := n; return next;
  end loop;
end $$;
revoke all on function public.run_due_notifications() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'due-notifications-daily';
  perform cron.schedule('due-notifications-daily', '0 23 * * *', 'select public.run_due_notifications()');   -- 08:00 KST
end $$;

insert into public.feature_rollout (feature, company_id)
select 'due_notifications', 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
where not exists (select 1 from public.feature_rollout where feature = 'due_notifications');
