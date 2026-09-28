-- 메일 보내기: 링크 클릭·가입/상담 전환 추적 (우리 쪽에서 직접 센다)
--   발송 함수가 owner-view.com 링크마다 ?ec=<수신자 토큰> 을 붙이고, 사이트가 그 토큰으로 record_email_click 을 부른다.
--   · 토큰은 수신자 행마다 무작위 16자 — 주소를 담지 않는다.
--   · 클릭은 브라우저에서 JS 로 적는다 → 메일 보안 스캐너가 링크를 미리 열어 보는 것은 잘 안 잡힌다(HTML 만 받음).

alter table public.email_campaign_recipients
  add column if not exists click_token text default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  add column if not exists clicked_at timestamptz,
  add column if not exists click_count integer not null default 0,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_kind text;

update public.email_campaign_recipients set click_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) where click_token is null;
alter table public.email_campaign_recipients alter column click_token set not null;
create unique index if not exists email_campaign_recipients_click_token_key on public.email_campaign_recipients (click_token);

alter table public.email_campaign_recipients drop constraint if exists email_campaign_recipients_converted_kind_check;
alter table public.email_campaign_recipients add constraint email_campaign_recipients_converted_kind_check
  check (converted_kind is null or converted_kind = any (array['signup', 'contact']));

-- 누를 때마다 한 줄 — 어느 링크(경로)를 눌렀는지
create table if not exists public.email_campaign_clicks (
  id bigserial primary key,
  recipient_id uuid not null references public.email_campaign_recipients(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  kind text not null default 'click' check (kind = any (array['click', 'signup', 'contact'])),
  path text,
  created_at timestamptz not null default now()
);
create index if not exists email_campaign_clicks_campaign_idx on public.email_campaign_clicks (campaign_id, created_at);
create index if not exists email_campaign_clicks_recipient_idx on public.email_campaign_clicks (recipient_id);
alter table public.email_campaign_clicks enable row level security;   -- 정책 0 — 아래 RPC 로만 쓴다

-- 사이트(익명 방문자)가 부른다. 없는 토큰은 조용히 무시.
create or replace function public.record_email_click(p_token text, p_path text default null, p_kind text default 'click')
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_campaign uuid;
  v_kind text := case when p_kind in ('signup', 'contact') then p_kind else 'click' end;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{16}$' then return; end if;
  select id, campaign_id into v_id, v_campaign from email_campaign_recipients where click_token = p_token;
  if v_id is null then return; end if;

  if v_kind = 'click' then
    -- 새로고침·뒤로가기로 같은 링크가 연달아 적히는 것은 한 번으로
    if exists (select 1 from email_campaign_clicks where recipient_id = v_id and kind = 'click'
               and path is not distinct from left(p_path, 300) and created_at > now() - interval '30 seconds') then
      return;
    end if;
    update email_campaign_recipients
      set clicked_at = coalesce(clicked_at, now()), click_count = click_count + 1
      where id = v_id;
  else
    update email_campaign_recipients
      set converted_at = coalesce(converted_at, now()), converted_kind = coalesce(converted_kind, v_kind),
          clicked_at = coalesce(clicked_at, now())
      where id = v_id;
  end if;
  insert into email_campaign_clicks (recipient_id, campaign_id, kind, path) values (v_id, v_campaign, v_kind, left(p_path, 300));
end;
$function$;

revoke all on function public.record_email_click(text, text, text) from public;
grant execute on function public.record_email_click(text, text, text) to anon, authenticated;

-- 이력 표: 클릭한 사람 수·가입/상담 수
drop function if exists public.operator_list_email_campaigns(integer);
create function public.operator_list_email_campaigns(p_limit integer default 100)
returns table(id uuid, subject text, from_email text, status text, total integer, sent_count integer, skipped_optout integer,
              skipped_duplicate integer, failed_count integer, delivered bigint, bounced bigint, complained bigint,
              clicked bigint, converted bigint, created_at timestamptz, sent_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  return query
    select c.id, c.subject, c.from_email, c.status, c.total, c.sent_count, c.skipped_optout, c.skipped_duplicate, c.failed_count,
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.status = 'delivered'),
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.status = 'bounced'),
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.status = 'complained'),
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.clicked_at is not null),
      (select count(*) from email_campaign_recipients r where r.campaign_id = c.id and r.converted_at is not null),
      c.created_at, c.sent_at
    from email_campaigns c
    order by c.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;
revoke all on function public.operator_list_email_campaigns(integer) from public, anon;
grant execute on function public.operator_list_email_campaigns(integer) to authenticated;

-- 주소 목록: p_filter = 'clicked' | 'converted' 면 상태 대신 클릭·전환으로 거른다
drop function if exists public.operator_list_email_recipients(text[], uuid, integer, integer);
create function public.operator_list_email_recipients(
  p_statuses text[], p_campaign uuid default null, p_limit integer default 1000, p_offset integer default 0, p_filter text default null)
returns table(email text, status text, error text, sent_at timestamptz, updated_at timestamptz,
              campaign_id uuid, campaign_subject text, campaign_sent_at timestamptz,
              clicked_at timestamptz, click_count integer, converted_at timestamptz, converted_kind text, total bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  return query
    select r.email, r.status, r.error, r.sent_at, r.updated_at,
           c.id, c.subject, coalesce(c.sent_at, c.created_at),
           r.clicked_at, r.click_count, r.converted_at, r.converted_kind, count(*) over ()
    from email_campaign_recipients r
    join email_campaigns c on c.id = r.campaign_id
    where case p_filter
            when 'clicked' then r.clicked_at is not null
            when 'converted' then r.converted_at is not null
            else r.status = any (p_statuses)
          end
      and (p_campaign is null or r.campaign_id = p_campaign)
    order by case when p_filter in ('clicked', 'converted') then coalesce(r.converted_at, r.clicked_at) end desc nulls last,
             coalesce(r.updated_at, r.sent_at) desc nulls last, r.email
    limit greatest(1, least(coalesce(p_limit, 1000), 1000))
    offset greatest(0, coalesce(p_offset, 0));
end;
$function$;
revoke all on function public.operator_list_email_recipients(text[], uuid, integer, integer, text) from public, anon;
grant execute on function public.operator_list_email_recipients(text[], uuid, integer, integer, text) to authenticated;
