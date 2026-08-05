-- 전자계약 목록의 정렬·기간 필터·페이지 크기를 계정별로 기억 (2026-08-05 사장님 요청)
--   "필터, 정렬기능 / 마지막값 기억(계정별로 다르게)" — 브라우저가 아니라 계정에 붙어야
--   다른 PC 에서 로그인해도 같은 보기가 유지된다(대시보드 위젯과 같은 규약).
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS signature_list_prefs jsonb;
