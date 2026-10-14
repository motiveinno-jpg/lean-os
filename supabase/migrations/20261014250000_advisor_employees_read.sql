-- 세무대리인 열람 — 구성원 이름 (2026-10-14, 20261014240000 후속)
--   employees 에는 읽기를 좁히는 RESTRICTIVE 정책(employees_select_role_or_self)이 있어 advisor_read(PERMISSIVE)만으로는
--   안 열렸다(가짜 세무사 롤백 시험에서 0건 실측). 같은 키('/employees:all')를 받은 세무대리인만 통과하는 갈래를 더한다.
--   기존 갈래(마스터·/employees:all·본인)는 그대로. 쓰기는 advisor_ro_* 가 막는다.
alter policy employees_select_role_or_self on public.employees
  using (
    is_company_admin()
    or (select has_perm('/employees:all'::text))
    or (user_id = current_app_user_id())
    or (email = current_app_user_email())
    or (select public.advisor_has_perm('/employees:all'::text))
  );
