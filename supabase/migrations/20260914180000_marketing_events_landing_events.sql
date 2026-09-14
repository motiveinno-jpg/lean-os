-- 랜딩 전환 계측 이벤트 허용 (2026-09-14)
--   왜: 공개 페이지(랜딩) 전환 흐름을 재기 위해 이벤트 4개를 추가한다.
--     signup_click   — 공개 페이지의 가입(무료로 시작) 버튼 클릭
--     consult_click  — 공개 페이지의 상담 버튼 클릭
--     signup_view    — 회원가입 탭 진입
--     contact_submit — 상담 신청 접수
--   /api/track 화이트리스트에는 먼저 들어갔지만 이 CHECK 제약이 막아 insert 가 조용히 실패했다
--   (운영에서 page_view 는 적재, signup_click 은 미적재 확인).
--   ⚠ 이벤트 목록은 src/app/api/track/route.ts 의 ALLOWED 와 반드시 같이 고친다 —
--     한쪽만 고치면 라우트는 204 를 돌려주고 DB 는 행을 버려 아무도 모르게 빠진다.
--   RLS·정책·권한은 그대로(20260813150000_marketing_events.sql).
ALTER TABLE public.marketing_events DROP CONSTRAINT IF EXISTS marketing_events_event_check;
ALTER TABLE public.marketing_events ADD CONSTRAINT marketing_events_event_check
  CHECK (event = ANY (ARRAY['page_view','tool_calculate','sign_up','bank_connect','checkout_start','signup_click','consult_click','signup_view','contact_submit']));
