-- 자산/구독 재설계 PR1 — 스키마 보강 (기존 데이터 보존, RLS 무변경).
--   vault_assets: 감가상각 입력값 (장부가는 조회 시 산출, 컬럼 저장 안 함)
--   vault_accounts: 구독 통합 화면용 카테고리·결제주기

ALTER TABLE public.vault_assets
  ADD COLUMN IF NOT EXISTS useful_life_months integer,
  ADD COLUMN IF NOT EXISTS depreciation_method text DEFAULT 'straight_line';

ALTER TABLE public.vault_accounts
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly';  -- 'monthly' | 'yearly'

COMMENT ON COLUMN public.vault_assets.useful_life_months IS '내용연수(개월). NULL 이면 감가 미설정 — 취득가 유지.';
COMMENT ON COLUMN public.vault_assets.depreciation_method IS '감가상각 방법 (현재 straight_line 정액법만).';
COMMENT ON COLUMN public.vault_accounts.category IS '구독 카테고리 (ai/design/infra/collab/other).';
COMMENT ON COLUMN public.vault_accounts.billing_cycle IS '결제주기 monthly|yearly. monthly_cost 는 항상 월 환산액으로 저장.';

NOTIFY pgrst, 'reload schema';
