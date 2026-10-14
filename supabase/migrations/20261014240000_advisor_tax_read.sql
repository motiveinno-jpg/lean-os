-- 세무대리인 열람 — 세무 신고 자료 (2026-10-14, 사장님 "세무대리인이 입력값을 봐도 됨")
--
--   History: 세무대리인(advisor) 세션은 회사가 부여한 메뉴 권한(advisor_permissions, 구성원과 같은 카탈로그)으로 화면을 연다.
--   그런데 표의 읽기 정책이 쓰는 has_perm() 은 users·member_permissions 만 본다 → 세무대리인은 '세무 신고' 권한을 받아도
--   신고본(tax_returns)·부속서류 입력값·지급 기록·급여 명세·퇴직·일용·연말정산이 전부 빈 화면이었다.
--   (장부는 can_read_ledger(), 세금계산서는 can_read_invoices() 가 이미 advisor_my_permissions() 를 본다 — 같은 길로 맞춘다.)
--
--   결정: 같은 메뉴 권한을 가진 '구성원'과 똑같이 읽히게 한다 — 기준 키도 구성원 정책과 같다.
--     · '/finance/tax-filing' → tax_returns · tax_schedule_inputs · income_payments
--     · '/employees:salary'   → payroll_items · retirement_payments · daily_work_logs · year_end_settlements
--     · '/employees:all'      → employees (급여 명세의 이름 조인 — 구성원도 이 키가 있어야 보인다)
--   읽기 정책만 '추가'한다(기존 정책 무변경). 쓰기는 advisor_ro_ins/upd/del(RESTRICTIVE)이 그대로 막는다.
--   지금 세무대리인 연결 0건(2026-10-14 실측) — 기존 데이터·사용자 영향 없음.
--   되돌리기: drop policy advisor_read_* (아래 7+1개) · drop function advisor_has_perm.

create or replace function public.advisor_has_perm(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_advisor_session()
     and exists (select 1 from public.advisor_my_permissions() k where k = p_key);
$$;
revoke all on function public.advisor_has_perm(text) from public, anon;
grant execute on function public.advisor_has_perm(text) to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('tax_returns', '/finance/tax-filing'),
    ('tax_schedule_inputs', '/finance/tax-filing'),
    ('income_payments', '/finance/tax-filing'),
    ('payroll_items', '/employees:salary'),
    ('retirement_payments', '/employees:salary'),
    ('daily_work_logs', '/employees:salary'),
    ('year_end_settlements', '/employees:salary'),
    ('employees', '/employees:all')
  ) as t(tbl, perm)
  loop
    execute format('drop policy if exists advisor_read on public.%I', r.tbl);
    execute format(
      'create policy advisor_read on public.%I for select to authenticated using (company_id = (select public.get_my_company_id()) and (select public.advisor_has_perm(%L)))',
      r.tbl, r.perm);
  end loop;
end $$;
