-- 웹 푸시 구독 저장 (2026-07-09) — 백그라운드 브라우저 푸시(탭 닫아도 알림).
--   PushManager.subscribe() 결과(endpoint + p256dh/auth 키)를 사용자별로 저장.
--   edge(send-web-push, service_role)가 이 표를 읽어 발송. 클라이언트는 본인 것만 관리(RLS).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_sub_select on public.push_subscriptions;
create policy push_sub_select on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_sub_insert on public.push_subscriptions;
create policy push_sub_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_delete on public.push_subscriptions for delete using (user_id = auth.uid());

create index if not exists idx_push_sub_user on public.push_subscriptions(user_id);
create index if not exists idx_push_sub_company on public.push_subscriptions(company_id);
