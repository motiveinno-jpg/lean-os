-- L 근태 자동화: company_settings 에 회사별 근무시간·휴일·가산수당 분기 컬럼.
--   F2 가 JSONB 키로 저장하던 work_start_time/late_threshold_minutes 도 본 컬럼으로
--   본격 분리 (JSONB 키는 마이그레이션 데이터 보존 후 호환 — UI 가 새 컬럼 사용).

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS work_start_time time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS work_end_time time DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS lunch_minutes int DEFAULT 60,
  ADD COLUMN IF NOT EXISTS late_grace_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_start_time time DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS night_end_time time DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS weekly_work_hours int DEFAULT 40,
  ADD COLUMN IF NOT EXISTS is_under_5_employees boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_inclusive_wage boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_standard_hours int DEFAULT 209,
  ADD COLUMN IF NOT EXISTS on_duty_pay_per_shift int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workdays_mask smallint DEFAULT 31;  -- 월~금 (1+2+4+8+16=31)

-- 데이터 보존 — F2 JSONB 키 값이 있는 회사는 컬럼으로 백필
UPDATE public.company_settings
SET work_start_time = COALESCE(
      (settings->>'work_start_time')::time,
      work_start_time
    ),
    late_grace_minutes = COALESCE(
      (settings->>'late_threshold_minutes')::int,
      late_grace_minutes
    )
WHERE settings ? 'work_start_time' OR settings ? 'late_threshold_minutes';

COMMENT ON COLUMN public.company_settings.work_start_time IS 'L 근태: 회사 출근 기준시각 (KST). F2 JSONB 백필.';
COMMENT ON COLUMN public.company_settings.late_grace_minutes IS 'L 근태: 지각 유예(분). F2 late_threshold_minutes 백필.';
COMMENT ON COLUMN public.company_settings.night_start_time IS '법정 야간근로 시작 (기본 22:00).';
COMMENT ON COLUMN public.company_settings.night_end_time IS '법정 야간근로 종료 (기본 06:00).';
COMMENT ON COLUMN public.company_settings.is_under_5_employees IS '5인 미만 사업장 → 가산수당 면제(통상시급만).';
COMMENT ON COLUMN public.company_settings.is_inclusive_wage IS '포괄임금제 → 약정 범위 내 추가 미지급(엔진이 0 + 메모).';
COMMENT ON COLUMN public.company_settings.monthly_standard_hours IS '통상시급 산출 분모 (월 209h default).';
COMMENT ON COLUMN public.company_settings.on_duty_pay_per_shift IS '당직 1회 단가(원). 0이면 미적용.';
COMMENT ON COLUMN public.company_settings.workdays_mask IS '비트마스크: 월=1,화=2,수=4,목=8,금=16,토=32,일=64. 기본 31=월~금.';
