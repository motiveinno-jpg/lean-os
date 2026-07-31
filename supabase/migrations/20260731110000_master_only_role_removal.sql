-- Migration: master_only_role_removal
-- 역할(owner/admin) 우회 폐지 — 접근 권한의 단일 출처를 "마스터 + 부여된 권한" 으로 (2026-07-31 사장님:
--   "어드민 같은 역할은 없앨 거야. 마스터 하나뿐이고 그 마스터가 권한을 준다. 권한 받은 사람이
--    모든 직원 것 보고, 아닌 사람은 본인 것만").
--
--   ① is_company_admin() 을 마스터 전용으로 축소 (users.role 참조 제거)
--   ② 지금까지 역할로만 열려 있던 정책 25개에 OR has_perm('<메뉴/탭 키>') 를 추가
--      — 역할이 사라져도 권한 보유자는 그대로 쓰도록. 원래 조건은 보존(회사 범위·본인 조건 등).
--   ③ 남아 있던 전 직원 노출 3곳(휴가 잔여·휴가 신청·근로계약)과 구성원 쓰기 게이트 신설
--
--   기존 admin 3명(회계담당자·이경원·연준호)은 이미 59개 권한을 보유해 ②로 기능이 유지된다.
--   다만 '전 직원 정보 열람'(/employees:all)은 아무도 안 가진 상태이므로, 필요한 사람에게
--   마스터가 직접 부여해야 한다 — 이게 이번 개편의 요지.

-- ── ① 마스터 전용으로 축소 ──
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists(
    select 1 from public.users u
    where u.id = public.current_app_user_id()
      and u.is_master
  );
$$;

-- ── ② 역할로만 열려 있던 정책에 권한 OR 추가 ──

-- AI 참모 이력
ALTER POLICY ai_copilot_history_select ON ai_copilot_history
  USING (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/copilot')));
ALTER POLICY ai_copilot_history_insert ON ai_copilot_history
  WITH CHECK (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/copilot')));

-- 가산수당 (근태·가산수당 설정 / 급여 담당)
ALTER POLICY allowance_entries_select_self_or_admin ON allowance_entries
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/settings:attendance') OR has_perm('/employees:salary')
              OR employee_id = current_employee_id()));
ALTER POLICY allowance_entries_admin_insert ON allowance_entries
  WITH CHECK (company_id = (SELECT get_my_company_id())
              AND (is_company_admin() OR has_perm('/settings:attendance') OR has_perm('/employees:salary')));
ALTER POLICY allowance_entries_admin_update ON allowance_entries
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/settings:attendance') OR has_perm('/employees:salary')))
  WITH CHECK (company_id = (SELECT get_my_company_id())
              AND (is_company_admin() OR has_perm('/settings:attendance') OR has_perm('/employees:salary')));
ALTER POLICY allowance_entries_admin_delete ON allowance_entries
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/settings:attendance') OR has_perm('/employees:salary')));
ALTER POLICY allowance_types_admin_write ON allowance_types
  USING (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/settings:attendance')))
  WITH CHECK (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/settings:attendance')));

-- 공지사항 작성·수정 — 메뉴 자체는 전원 기본 제공이라 별도 관리 키(/announcements:manage)로 분리
ALTER POLICY announcements_insert_admin ON announcements
  WITH CHECK (((company_id IS NULL) AND (SELECT is_platform_operator()))
              OR ((company_id = (SELECT get_my_company_id()))
                  AND (is_company_admin() OR has_perm('/announcements:manage'))));
ALTER POLICY announcements_update_admin ON announcements
  USING (((company_id IS NULL) AND (SELECT is_platform_operator()))
         OR ((company_id = (SELECT get_my_company_id()))
             AND (is_company_admin() OR has_perm('/announcements:manage'))))
  WITH CHECK (((company_id IS NULL) AND (SELECT is_platform_operator()))
              OR ((company_id = (SELECT get_my_company_id()))
                  AND (is_company_admin() OR has_perm('/announcements:manage'))));
ALTER POLICY announcements_delete_admin ON announcements
  USING (((company_id IS NULL) AND (SELECT is_platform_operator()))
         OR ((company_id = (SELECT get_my_company_id()))
             AND (is_company_admin() OR has_perm('/announcements:manage'))));

-- 결재 양식 관리
ALTER POLICY approval_forms_write ON approval_forms
  USING (company_id = get_my_company_id() AND (is_company_admin() OR has_perm('/approvals:forms')))
  WITH CHECK (company_id = get_my_company_id() AND (is_company_admin() OR has_perm('/approvals:forms')));

-- 근태 수정요청
ALTER POLICY aer_select ON attendance_edit_requests
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/attendance:records') OR requested_by = current_app_user_id()));
ALTER POLICY aer_update_admin ON attendance_edit_requests
  USING ((is_company_admin() OR has_perm('/attendance:records')) AND company_id = (SELECT get_my_company_id()))
  WITH CHECK ((is_company_admin() OR has_perm('/attendance:records')) AND company_id = (SELECT get_my_company_id()));

-- 합류 요청 (팀·권한 설정)
ALTER POLICY cjr_admin_select ON company_join_requests
  USING ((is_company_admin() OR has_perm('/settings:team')) AND company_id = get_my_company_id());
ALTER POLICY cjr_admin_update ON company_join_requests
  USING ((is_company_admin() OR has_perm('/settings:team')) AND company_id = get_my_company_id());

-- 근로계약 서식
ALTER POLICY contract_templates_admin_insert ON contract_templates
  WITH CHECK (is_system = false AND company_id = (SELECT get_my_company_id())
              AND (is_company_admin() OR has_perm('/hr-templates')));
ALTER POLICY contract_templates_admin_update ON contract_templates
  USING (is_system = false AND company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/hr-templates')))
  WITH CHECK (is_system = false AND company_id = (SELECT get_my_company_id())
              AND (is_company_admin() OR has_perm('/hr-templates')));
ALTER POLICY contract_templates_admin_delete ON contract_templates
  USING (is_system = false AND company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/hr-templates')));

-- 휴일 설정
ALTER POLICY holidays_write_admin ON holidays
  USING ((is_company_admin() OR has_perm('/settings:attendance')) AND company_id = (SELECT get_my_company_id()))
  WITH CHECK ((is_company_admin() OR has_perm('/settings:attendance')) AND company_id = (SELECT get_my_company_id()));

-- 전표 감사로그
ALTER POLICY journal_entry_audits_select ON journal_entry_audits
  USING (company_id = get_my_company_id()
         AND (is_company_admin() OR has_perm('/reports') OR has_perm('/partners/reconciliation/voucher-entry')));

-- 연장근로 신청
ALTER POLICY overtime_requests_select ON overtime_requests
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/attendance:records') OR employee_id = current_app_employee_id()));
ALTER POLICY overtime_requests_update ON overtime_requests
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/attendance:records') OR employee_id = current_app_employee_id()))
  WITH CHECK (company_id = (SELECT get_my_company_id())
              AND (is_company_admin() OR has_perm('/attendance:records')
                   OR (employee_id = current_app_employee_id() AND status = 'cancelled')));
ALTER POLICY overtime_requests_delete ON overtime_requests
  USING (company_id = (SELECT get_my_company_id())
         AND (is_company_admin() OR has_perm('/attendance:records')));

-- 서명 발송 실패 로그
ALTER POLICY ssf_select_company_admin ON signature_send_failures
  USING (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/signatures')));
ALTER POLICY ssf_update_company_admin ON signature_send_failures
  USING (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/signatures')))
  WITH CHECK (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/signatures')));

-- 탭 접근 설정(레거시)
ALTER POLICY uta_write ON user_tab_access
  USING (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/settings:team')))
  WITH CHECK (company_id = (SELECT get_my_company_id()) AND (is_company_admin() OR has_perm('/settings:team')));

-- ── ③ 남은 전 직원 노출 차단 ──

-- 휴가 잔여 — 본인 것만. 휴가 관리/전직원열람/워크보드 권한자는 전체.
DROP POLICY IF EXISTS leave_balances_scope ON leave_balances;
CREATE POLICY leave_balances_scope ON leave_balances AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    is_company_admin()
    OR has_perm('/employees:all') OR has_perm('/employees:leave') OR has_perm('/attendance:board')
    OR employee_id = current_employee_id()
  );

-- 휴가 신청 — 본인 것 + 내가 결재자/참조자인 건. 관리 권한자는 전체.
DROP POLICY IF EXISTS leave_requests_scope ON leave_requests;
CREATE POLICY leave_requests_scope ON leave_requests AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    is_company_admin()
    OR has_perm('/employees:all') OR has_perm('/employees:leave') OR has_perm('/attendance:board')
    OR employee_id = current_employee_id()
    OR requested_approver_id = current_app_user_id()
    OR second_approver_id = current_app_user_id()
    OR current_app_user_id() = ANY(COALESCE(cc_user_ids, ARRAY[]::uuid[]))
  );

-- 근로계약 — 본인 계약만. 인력관리/서식/전직원열람 권한자는 전체.
DROP POLICY IF EXISTS employee_contracts_scope ON employee_contracts;
CREATE POLICY employee_contracts_scope ON employee_contracts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    is_company_admin()
    OR has_perm('/employees:all') OR has_perm('/employees:employees') OR has_perm('/hr-templates')
    OR employee_id = current_employee_id()
  );

-- 구성원 쓰기 — 읽기만 막혀 있고 수정·삭제는 회사 구성원이면 통과하던 구멍
DROP POLICY IF EXISTS employees_write_scope ON employees;
CREATE POLICY employees_write_scope ON employees AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (is_company_admin() OR has_perm('/employees:employees') OR user_id = current_app_user_id())
  WITH CHECK (is_company_admin() OR has_perm('/employees:employees') OR user_id = current_app_user_id());

DROP POLICY IF EXISTS employees_delete_scope ON employees;
CREATE POLICY employees_delete_scope ON employees AS RESTRICTIVE FOR DELETE TO authenticated
  USING (is_company_admin() OR has_perm('/employees:employees'));

DROP POLICY IF EXISTS employees_insert_scope ON employees;
CREATE POLICY employees_insert_scope ON employees AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (is_company_admin() OR has_perm('/employees:employees'));
