-- v4 H1: payroll_items 에 임의 수당/공제 jsonb 컬럼 추가.
--   직원 원문: "수당/ 공제 추가할수있게"
--   포맷: [{ type: 'allowance'|'deduction', name: '식대', amount: 200000 }, ...]
--   클라이언트가 합산하여 net_pay 계산. payroll_items 본인격리 RLS(20260519070000) 동일 적용.

ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS extras jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.payroll_items.extras IS
  'v4 H1: 임의 수당/공제 라인아이템. [{type:''allowance''|''deduction'',name,amount}].';

-- RLS 무수정 (본인격리 RESTRICTIVE 정책이 신 컬럼도 자동 보호).
