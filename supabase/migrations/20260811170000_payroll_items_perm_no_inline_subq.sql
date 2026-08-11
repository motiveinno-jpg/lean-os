-- RLS 게이트 위반 해소 (2026-08-11): p4_payroll_items_perm 이 정책 본문에 인라인
--   `FROM employees` 서브쿼리를 사용 — 20260518 504 재귀 사고 시그니처라 rls-smoke 게이트가 차단.
--   payroll_items 는 company_id 컬럼을 직접 가지므로(형제 정책 2개도 그 방식) employees 를
--   경유할 필요가 없다. 의미 동일성 실데이터 검증: company_id ≠ 직원 소속 불일치 0건.
--   (프로덕션 적용: 2026-08-11 MCP apply_migration 'payroll_items_perm_no_inline_subq')
drop policy if exists p4_payroll_items_perm on public.payroll_items;
create policy p4_payroll_items_perm on public.payroll_items
  for select to authenticated
  using (has_perm('/employees:salary') and company_id = get_my_company_id());
