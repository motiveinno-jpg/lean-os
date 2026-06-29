-- 급여명세서 공제액 수동 수정 (2026-06-29)
--   payslip_overrides 에 deduction_overrides jsonb 추가. 관리자가 편집모드에서 직접 수정한
--   공제 항목만 sparse 저장(국민연금/건강보험/장기요양/고용보험/소득세/지방소득세).
--   미편집 항목은 기존대로 엔진 자동계산. 기존 RLS(payslip_overrides) 그대로.
alter table public.payslip_overrides
  add column if not exists deduction_overrides jsonb;
