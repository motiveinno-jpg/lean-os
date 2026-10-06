-- 매일 마감 알림(run_due_notifications)이 세금 마감 1·7일 전에만 실패하던 것
--   지역 변수 이름이 notifications 의 칸 이름과 같아(title) "x.title = title" 이 어느 쪽인지 몰라
--   column reference "title" is ambiguous 로 함수 전체가 멈췄다 — 그날은 모든 회사의 결제·납부·세금 알림이 안 나갔다.
--   (마감이 1·7일 앞인 날에만 그 줄이 실행돼 다른 날은 '성공'으로 보였다. 2026-10-02 실패 기록.)
--   변수를 v_title·v_key 로 바꾼다. 쓰지 않던 link 변수는 뺀다. 나머지 동작은 그대로.

CREATE OR REPLACE FUNCTION public.run_due_notifications()
 RETURNS TABLE(company_id uuid, inserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_tom date := ((now() at time zone 'Asia/Seoul')::date + 1);
  v_tom_last int := extract(day from (date_trunc('month', v_tom) + interval '1 month - 1 day'))::int;
  c record; r record; u record; n int;
  d date; v_key text; v_title text;
begin
  for c in select distinct f.company_id as cid from public.feature_rollout f where f.feature = 'due_notifications' and f.company_id is not null
           union select co.id from public.companies co where exists (select 1 from public.feature_rollout f where f.feature = 'due_notifications' and f.company_id is null)
  loop
    n := 0;
    for u in select id from public.users where users.company_id = c.cid and coalesce(is_master, false) loop
      for r in select id, name, amount from public.recurring_payments p
               where p.company_id = c.cid and coalesce(p.is_active, true)
                 and least(coalesce(p.day_of_month, 0), v_tom_last) = extract(day from v_tom)::int
      loop
        v_title := format('내일 결제 예정 · %s', r.name);
        if not exists (select 1 from public.notifications x where x.company_id = c.cid and x.user_id = u.id and x.type = 'payment_due' and x.entity_id = r.id and x.created_at > now() - interval '20 days') then
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, link)
          values (c.cid, u.id, 'payment_due', v_title, format('%s %s원이 %s 결제될 예정입니다. 통장 잔액을 확인하세요.', r.name, to_char(coalesce(r.amount, 0), 'FM999,999,999,999'), to_char(v_tom, 'MM/DD')), 'recurring_payment', r.id, false, '/payments');
          n := n + 1;
        end if;
      end loop;
      for r in select id, name, amount from public.fixed_costs f
               where f.company_id = c.cid and coalesce(f.is_recurring, true)
                 and (f.end_date is null or f.end_date >= v_tom) and (f.start_date is null or f.start_date <= v_tom)
                 and least(coalesce(f.payment_day, 0), v_tom_last) = extract(day from v_tom)::int
      loop
        v_title := format('내일 납부 예정 · %s', r.name);
        if not exists (select 1 from public.notifications x where x.company_id = c.cid and x.user_id = u.id and x.type = 'payment_due' and x.entity_id = r.id and x.created_at > now() - interval '20 days') then
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, link)
          values (c.cid, u.id, 'payment_due', v_title, format('고정비 %s %s원의 납부일이 %s입니다.', r.name, to_char(coalesce(r.amount, 0), 'FM999,999,999,999'), to_char(v_tom, 'MM/DD')), 'fixed_cost', r.id, false, '/payments');
          n := n + 1;
        end if;
      end loop;
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
        d := r.due; v_key := r.prefix || to_char(d, 'YYYY-MM-DD'); v_title := format('%s %s · %s', case when d - v_today = 1 then '내일' else '7일 뒤' end, r.ttl, to_char(d, 'MM/DD'));
        if exists (select 1 from public.tax_deadline_checks t where t.company_id = c.cid and t.deadline_id = v_key) then continue; end if;
        if not exists (select 1 from public.notifications x where x.company_id = c.cid and x.user_id = u.id and x.type = 'tax_due' and x.title = v_title and x.created_at > now() - interval '20 days') then
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, link)
          values (c.cid, u.id, 'tax_due', v_title, format('%s 기한이 %s입니다. 재무 › 세무 신고에서 준비 상태를 확인하세요. 이미 마쳤다면 대시보드 세금 일정에서 완료 체크하면 더 알리지 않습니다.', r.ttl, to_char(d, 'YYYY-MM-DD')), 'tax_deadline', null, false, r.lnk);
          n := n + 1;
        end if;
      end loop;
    end loop;
    company_id := c.cid; inserted := n; return next;
  end loop;
end $function$;
