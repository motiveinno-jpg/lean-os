-- Migration: 직원별 비과세 금액 (식대 외 자가운전·기타 비과세 포함)
-- Version: 20260514180000

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS non_taxable_amount numeric;

COMMENT ON COLUMN public.employees.non_taxable_amount IS '월 비과세 합계 (식대 20만원 + 자가운전 + 기타). NULL 이면 meal_allowance_included 기준 자동 적용.';
