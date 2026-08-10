-- 첫 가입 튜토리얼(탭 투어) 완료 기록 (2026-08-10 사장님 지시 — 온보딩 개편).
--   기기별 localStorage 가 아니라 계정별 저장(결재 확인·공지 읽음과 같은 기조).
alter table public.user_preferences
  add column if not exists app_tour_done_at timestamptz;
