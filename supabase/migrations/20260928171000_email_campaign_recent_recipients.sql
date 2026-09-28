-- 메일 보내기 중복 제외용: 주어진 주소 중 p_since 이후 광고 메일을 받은 주소.
--   배열 하나로 돌려준다 — 행 집합이면 PostgREST 1,000행 상한에 잘린다(한 번에 2,000명까지 보냄).
create or replace function public.email_campaign_recent_recipients(p_emails text[], p_since timestamptz)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct r.email), '{}')
  from email_campaign_recipients r
  where r.email = any (p_emails)
    and r.sent_at >= p_since
    and r.status in ('sent', 'delivered', 'delayed', 'complained');
$$;

revoke all on function public.email_campaign_recent_recipients(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.email_campaign_recent_recipients(text[], timestamptz) to service_role;
