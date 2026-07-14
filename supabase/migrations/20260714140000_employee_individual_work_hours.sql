-- 직원별 개별 출퇴근 시간 설정
-- 회사 기본값(company_settings.work_start_time/work_end_time)을 먼저 적용하고,
-- 직원별로 값이 있으면 개인 설정으로 override 한다.
-- 'HH:MM' 형식 텍스트. NULL = 회사 기본값 사용.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS work_start_time text,
  ADD COLUMN IF NOT EXISTS work_end_time text;

COMMENT ON COLUMN public.employees.work_start_time IS
  'NULL이면 company_settings의 회사 기본 출퇴근시간을 따름. 값이 있으면 이 직원 개인 설정으로 override.';

COMMENT ON COLUMN public.employees.work_end_time IS
  'NULL이면 company_settings의 회사 기본 출퇴근시간을 따름. 값이 있으면 이 직원 개인 설정으로 override.';
