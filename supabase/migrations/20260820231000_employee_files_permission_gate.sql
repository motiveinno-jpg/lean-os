-- 인사 서류를 '직원 권한자 + 본인' 에게만 (2026-08-20 사장님 선택)
--
-- AS_IS — employee_files 정책이 `FOR ALL (employee_id IN (같은 회사 직원))` 하나뿐이라
--   **회사 구성원 누구나 남의 통장사본·근로계약서·주민등록등본을 열람하고 삭제**할 수 있었다.
--   권한 0 계정으로 실측: 열람 🔓보임 / 삭제 🔓삭제됨.
--   더 나쁜 건 권한 설계와 모순이라는 점 — employees 테이블은 p4_employees_perm 이
--   has_perm('/employees:all') 을 요구해 **직원 목록조차 못 보는 사람이 그 직원의 서류는 볼 수 있었다.**
--
-- TO_BE — has_perm('/employees:all') 보유자(=마스터 포함) 또는 그 서류의 주인 본인만.
--   사장님 선택: "직원 권한자 + 본인". 인사 담당이 마스터가 아니어도 업무가 막히지 않는다.
--
-- ⚠️ 함께 고치는 것 — 기존 self 정책의 잘못된 ID 비교
--   employee_files_self_read / _self_insert 는 `employees.user_id = auth.uid()` 로 비교하는데,
--   employees.user_id 에는 **users.id** 가 들어간다(운영 19건 전건 확인).
--   운영 21명 중 19명은 users.id = auth_id 라 우연히 맞고, **2명은 안 맞아 본인 서류가 안 보였다.**
--   → current_app_user_id() (= users.id) 로 교체한다. 이 계정들은 이제 자기 서류가 보인다(정상화).
--
-- 되돌리기: 이 파일의 정책을 지우고 employee_files_company_admin 을
--   `FOR ALL USING (employee_id IN (select id from employees where company_id = get_my_company_id()))` 로 복원.

-- 회사 격리 + 권한/본인 — 한 정책으로 정리(중복 PERMISSIVE 가 OR 로 새는 것 방지)
drop policy if exists employee_files_company_admin on public.employee_files;
drop policy if exists employee_files_self_read on public.employee_files;
drop policy if exists employee_files_self_insert on public.employee_files;

create policy employee_files_perm_or_self on public.employee_files
  for all to authenticated
  using (
    employee_id in (
      select e.id from public.employees e
      where e.company_id = (select public.get_my_company_id())
        and ((select public.has_perm('/employees:all'))
             or e.user_id = (select public.current_app_user_id()))
    )
  )
  with check (
    employee_id in (
      select e.id from public.employees e
      where e.company_id = (select public.get_my_company_id())
        and ((select public.has_perm('/employees:all'))
             or e.user_id = (select public.current_app_user_id()))
    )
  );

-- 같은 오비교를 쓰던 나머지 정책들 — 그 2명에게만 조용히 안 먹던 것들.
--   접근을 넓히는 게 아니라, 원래 의도대로 '본인'이 판정되게 고치는 것이다.
drop policy if exists contract_archives_company on public.contract_archives;
create policy contract_archives_company on public.contract_archives
  for all to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists doc_notifications_company on public.document_notifications;
create policy doc_notifications_company on public.document_notifications
  for all to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists onboarding_self on public.onboarding_checklist_items;
create policy onboarding_self on public.onboarding_checklist_items
  for all to authenticated
  using (employee_id in (select e.id from public.employees e
                         where e.company_id = (select public.get_my_company_id())
                           and ((select public.has_perm('/employees:all'))
                                or e.user_id = (select public.current_app_user_id()))))
  with check (employee_id in (select e.id from public.employees e
                              where e.company_id = (select public.get_my_company_id())
                                and ((select public.has_perm('/employees:all'))
                                     or e.user_id = (select public.current_app_user_id()))));

-- push_subscriptions.user_id 도 users.id 가 들어간다(운영 실데이터로 확인) — auth.uid() 비교는 틀렸다.
--   그 2명은 자기 기기 구독을 못 보고 못 지우던 상태.
drop policy if exists push_sub_select on public.push_subscriptions;
drop policy if exists push_sub_insert on public.push_subscriptions;
drop policy if exists push_sub_update on public.push_subscriptions;
drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select public.current_app_user_id()))
  with check (user_id = (select public.current_app_user_id()));
