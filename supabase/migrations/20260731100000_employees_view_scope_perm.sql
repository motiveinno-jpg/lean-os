-- Migration: employees_view_scope_perm
-- 구성원 열람 범위를 별도 권한(/employees:all)으로 분리 (2026-07-31 사장님:
--   "구성원 탭 권한을 주면 전 직원 내용이 보인다 — 몇몇만 전 직원, 대부분은 본인 것만 보이게").
--
--   기존: /employees(또는 그 하위 탭) 권한이 하나라도 있으면 has_menu_perm('/employees') 가 참이 되어
--         회사 전 직원 행이 열렸다. 인력관리 화면을 쓰려면 무조건 전 직원 정보가 딸려왔다.
--   변경: 행 단위 열람은 '/employees:all' 키를 가진 사람(+ 마스터·owner/admin)만.
--         그 키가 없으면 자기 행(user_id 또는 email 일치)만 보인다 — 화면 권한은 그대로 두고
--         데이터 범위만 좁히는 방식이라 UI 수정 없이 즉시 적용된다.
--
--   ⚠️ 기존에 /employees 권한을 받은 구성원에게 '/employees:all' 을 자동 부여하지 않는다.
--      (자동 부여하면 지금과 똑같이 전원이 전 직원을 보게 되어 요청 취지에 어긋남)
--      전 직원 열람이 필요한 사람에게만 권한 화면에서 새 항목을 체크하면 된다.

-- 행 단위 게이트(RESTRICTIVE) — 관리자/마스터, 전 직원 열람 권한자, 본인 행
ALTER POLICY "employees_select_role_or_self" ON employees
  USING (
    is_company_admin()
    OR has_perm('/employees:all')
    OR user_id = current_app_user_id()
    OR email = current_app_user_email()
  );

-- 권한 기반 가산 정책(PERMISSIVE)도 같은 기준으로 — 메뉴 보유(has_menu_perm)만으로 전 직원이 열리지 않게
ALTER POLICY "p4_employees_perm" ON employees
  USING (company_id = get_my_company_id() AND has_perm('/employees:all'));
