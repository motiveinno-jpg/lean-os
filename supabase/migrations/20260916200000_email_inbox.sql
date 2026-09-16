-- 받은 메일함 (2026-09-16) — 광고 메일(hello@owner-view.com)에 온 회신을 운영자 화면에서 본다.
--   Resend Receiving: owner-view.com 의 MX 를 Resend 로 두면 그 도메인 모든 주소의 메일을 Resend 가 받고
--   email.received 웹훅을 보낸다 → resend-webhook 이 본문을 API 로 받아 여기 저장한다.
--   RLS 활성 + 정책 0개 → service_role 전용. 화면은 운영자 RPC 로만 읽는다(email_optouts 와 같은 구조).

create table if not exists public.email_inbox (
  id uuid primary key default gen_random_uuid(),
  resend_id text not null unique,
  message_id text,
  from_email text not null,
  from_name text,
  to_emails text[] not null default '{}',
  subject text,
  text_body text,
  html_body text,
  attachments jsonb not null default '[]'::jsonb,
  received_at timestamptz not null,
  read_at timestamptz,
  --   어느 캠페인에 대한 회신인지(그 주소로 보낸 가장 최근 캠페인). 없으면 일반 수신.
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists email_inbox_received_idx on public.email_inbox (received_at desc);
create index if not exists email_inbox_unread_idx on public.email_inbox (read_at) where read_at is null;
alter table public.email_inbox enable row level security;

-- 목록 — 본문은 미리보기만(200자). 수신거부 등록 여부를 같이 준다.
create or replace function public.operator_list_email_inbox(p_limit integer default 200, p_unread_only boolean default false)
returns table (
  id uuid, from_email text, from_name text, to_emails text[], subject text, preview text,
  has_html boolean, attachment_count integer, received_at timestamptz, read_at timestamptz,
  campaign_id uuid, campaign_subject text, opted_out boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_operator() then raise exception 'not authorized'; end if;
  return query
    select i.id, i.from_email, i.from_name, i.to_emails, i.subject,
      left(regexp_replace(coalesce(i.text_body, ''), '\s+', ' ', 'g'), 200),
      i.html_body is not null,
      coalesce(jsonb_array_length(i.attachments), 0)::integer,
      i.received_at, i.read_at, i.campaign_id, c.subject,
      exists (select 1 from email_optouts o where o.email = lower(i.from_email))
    from email_inbox i
    left join email_campaigns c on c.id = i.campaign_id
    where (not p_unread_only) or i.read_at is null
    order by i.received_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
revoke all on function public.operator_list_email_inbox(integer, boolean) from public, anon;
grant execute on function public.operator_list_email_inbox(integer, boolean) to authenticated;

-- 한 통 열기 — 본문 전체를 주고 읽음 처리
create or replace function public.operator_open_email_inbox(p_id uuid)
returns table (
  id uuid, from_email text, from_name text, to_emails text[], subject text,
  text_body text, html_body text, attachments jsonb, received_at timestamptz, read_at timestamptz, message_id text
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_operator() then raise exception 'not authorized'; end if;
  update email_inbox set read_at = coalesce(read_at, now()) where email_inbox.id = p_id;
  return query
    select i.id, i.from_email, i.from_name, i.to_emails, i.subject, i.text_body, i.html_body, i.attachments, i.received_at, i.read_at, i.message_id
    from email_inbox i where i.id = p_id;
end;
$$;
revoke all on function public.operator_open_email_inbox(uuid) from public, anon;
grant execute on function public.operator_open_email_inbox(uuid) to authenticated;

-- 안 읽음으로 되돌리기 / 지우기
create or replace function public.operator_set_email_inbox(p_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_operator() then raise exception 'not authorized'; end if;
  if p_action = 'unread' then update email_inbox set read_at = null where id = p_id;
  elsif p_action = 'delete' then delete from email_inbox where id = p_id;
  else raise exception 'invalid action'; end if;
  return true;
end;
$$;
revoke all on function public.operator_set_email_inbox(uuid, text) from public, anon;
grant execute on function public.operator_set_email_inbox(uuid, text) to authenticated;
