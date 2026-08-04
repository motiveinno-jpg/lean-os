-- 문의 AI 자동 진단 결과 (2026-08-04 사장님: 첨부 스크린샷을 AI가 읽어 에러를 잡아내게)
-- 형식: { summary, probable_cause, matched_errors[], severity, suggested_reply, needs_dev, model, analyzed_at }
-- 작성 주체는 support-ticket-analyze 엣지(service role) — RLS 변경 없음.
alter table public.support_tickets add column if not exists ai_analysis jsonb;
