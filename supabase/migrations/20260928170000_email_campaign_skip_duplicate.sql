-- 메일 보내기: 이전 발송과 겹치는 주소 제외
--   목록을 나눠 여러 번 보낼 때 같은 사람이 같은 광고를 두 번 받지 않게 한다.
--   제외한 주소도 수신자 행으로 남겨(status=skipped_duplicate) 이력에서 확인할 수 있게 한다.

alter table public.email_campaigns
  add column if not exists skipped_duplicate integer not null default 0,
  add column if not exists dedupe_days integer;

alter table public.email_campaign_recipients drop constraint if exists email_campaign_recipients_status_check;
alter table public.email_campaign_recipients add constraint email_campaign_recipients_status_check
  check (status = any (array['queued','sent','skipped_optout','skipped_duplicate','failed','delivered','bounced','complained','delayed']));

-- 주소로 과거 발송을 찾는다
create index if not exists email_campaign_recipients_email_idx
  on public.email_campaign_recipients (email, sent_at);

drop function if exists public.operator_list_email_campaigns(integer);
create function public.operator_list_email_campaigns(p_limit integer default 100)
returns table(id uuid, subject text, from_email text, status text, total integer, sent_count integer, skipped_optout integer,
              skipped_duplicate integer, failed_count integer, delivered bigint, bounced bigint, complained bigint,
              created_at timestamptz, sent_at timestamptz)
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
      c.created_at, c.sent_at
    from email_campaigns c
    order by c.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$;

revoke all on function public.operator_list_email_campaigns(integer) from public, anon;
grant execute on function public.operator_list_email_campaigns(integer) to authenticated;
