-- 급여명세 스냅샷에 장기요양보험료 칸 추가 (2026-08-21 감사)
--   공제 합계(deductions_total)는 국민연금+건강보험+**장기요양**+고용보험+소득세+지방소득세 인데,
--   스냅샷에는 장기요양 칸이 없어 마이페이지 명세서가 5개 항목만 나열했다.
--   → 항목을 다 더해도 합계와 안 맞고, 차액의 출처가 화면 어디에도 없었다.
--   (메일로 나가는 PDF 는 실시간 계산값으로 '장기요양' 을 정상 표시해, 두 화면이 서로 다른 명세를 보여줬다)
ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS long_term_care_insurance numeric DEFAULT 0;

COMMENT ON COLUMN public.payroll_items.long_term_care_insurance IS
  '장기요양보험료(직원 부담분) — 건강보험과 별도 항목. 2026-08-21 추가.';
