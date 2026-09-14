-- 탭 투어 스텝별 '다시 보지 않기' — 숨긴 스텝 href 배열
alter table public.user_preferences
  add column if not exists app_tour_hidden_steps jsonb not null default '[]'::jsonb;
