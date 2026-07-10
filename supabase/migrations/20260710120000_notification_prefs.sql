-- 알림 채널 설정 저장 (2026-07-10) — 설정>알림의 채널/이벤트별 토글.
--   기존 NotificationsTab 이 best-effort 로 upsert 하던 테이블이 실제로는 없어서
--   이벤트별 토글이 localStorage 에만 남고 서버(웹푸시 발송 엣지)가 읽을 수 없었음.
--   send-web-push 엣지가 이 표를 읽어 push.enabled / 이벤트별 on-off / 방해금지 시간을 존중.
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists notif_prefs_select on public.notification_prefs;
create policy notif_prefs_select on public.notification_prefs for select using (user_id = auth.uid());
drop policy if exists notif_prefs_upsert on public.notification_prefs;
create policy notif_prefs_upsert on public.notification_prefs for insert with check (user_id = auth.uid());
drop policy if exists notif_prefs_update on public.notification_prefs;
create policy notif_prefs_update on public.notification_prefs for update using (user_id = auth.uid());
