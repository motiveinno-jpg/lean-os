-- 광고·소개 메일 직접 발송 (2026-09-16)
--   운영자 화면 「매출 › 메일 보내기」에서 주소 목록을 넣으면 엣지 함수 email-campaign-send 가
--   news.mo-tive.com 으로 보낸다. 수신거부(email_optouts)는 보내기 직전에 자동으로 뺀다.
--   반송·스팸신고는 resend-webhook 이 email_optouts 에 넣어 다음 발송에서 자동 제외된다.
--   두 표 모두 RLS 활성 + 정책 0개 → service_role 전용. 화면은 운영자 RPC 로만 읽는다(email_optouts 와 같은 구조).

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body_text text not null,
  from_email text not null default '오너뷰 <hello@news.mo-tive.com>',
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  total integer not null default 0,
  sent_count integer not null default 0,
  skipped_optout integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  email text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'skipped_optout', 'failed', 'delivered', 'bounced', 'complained', 'delayed')),
  resend_id text,
  error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists email_campaign_recipients_resend_idx on public.email_campaign_recipients (resend_id) where resend_id is not null;
create index if not exists email_campaign_recipients_campaign_idx on public.email_campaign_recipients (campaign_id);

alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;

-- 운영자 조회 — 발송 이력과 도착·반송·신고 집계
create or replace function public.operator_list_email_campaigns(p_limit integer default 100)
returns table (
  id uuid, subject text, from_email text, status text,
  total integer, sent_count integer, skipped_optout integer, failed_count integer,
  delivered bigint, bounced bigint, complained bigint,
  created_at timestamptz, sent_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  return query
    select c.id, c.subject, c.from_email, c.status, c.total, c.sent_count, c.skipped_optout, c.failed_count,
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.status = 'delivered'),
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.status = 'bounced'),
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.status = 'complained'),
      c.created_at, c.sent_at
    from email_campaigns c
    order by c.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;
revoke all on function public.operator_list_email_campaigns(integer) from public, anon;
grant execute on function public.operator_list_email_campaigns(integer) to authenticated;

-- 운영자 조회 — 한 캠페인의 수신자별 결과(실패 사유 확인용)
create or replace function public.operator_list_campaign_recipients(p_campaign uuid, p_limit integer default 2000)
returns table (email text, status text, error text, sent_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  return query
    select r.email, r.status, r.error, r.sent_at, r.updated_at
    from email_campaign_recipients r
    where r.campaign_id = p_campaign
    order by r.status, r.email
    limit greatest(1, least(coalesce(p_limit, 2000), 5000));
end;
$$;
revoke all on function public.operator_list_campaign_recipients(uuid, integer) from public, anon;
grant execute on function public.operator_list_campaign_recipients(uuid, integer) to authenticated;
