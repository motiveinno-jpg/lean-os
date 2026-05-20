-- v4 B2: 투표 기한.
--   poll_deadline NULL → 무제한, 값 있으면 그 시점 이후 투표 차단.
--   기한 도과 후 결과는 표시(클라이언트 비교: now() > poll_deadline → vote disabled).
--
-- 사전조사: board_posts 에 poll_question/poll_options/poll_multi/poll_anonymous 이미 존재 (V8).
--   poll_deadline 미존재 확인 → 신규 컬럼만 추가.
--
-- 차단 위치: 클라이언트 UI 가 1차. 서버측 board_poll_votes WITH CHECK 보강은 본 마이그에서는 보류
--   (회사격리 정책 변경 시 회귀 위험, B1 과 함께 묶음 푸시 안전성 우선).

ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS poll_deadline timestamptz;

COMMENT ON COLUMN public.board_posts.poll_deadline IS 'v4 B2: 투표 마감 시각. NULL=무제한. 클라이언트가 now()와 비교해 투표 비활성. 결과는 마감 후에도 표시.';
