-- 연장근무: 하루 1건만 허용하던 부분 unique 인덱스 제거 → 같은 날 추가 신청 허용.
--   (request_overtime RPC 의 unique_violation 핸들러는 더 이상 발화하지 않음 — 그대로 둬도 무해)
DROP INDEX IF EXISTS public.overtime_requests_one_active_per_day;
