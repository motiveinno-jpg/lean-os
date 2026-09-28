-- 메일 보내기 상단 「지금까지 발송·반송·스팸 신고」와 이력 표 건수를 누르면 주소 목록을 본다.
--   p_campaign 이 null 이면 모든 발송을 합쳐서. 1,000행씩 끊어 받는다(PostgREST 상한) — total 로 전체 건수를 함께 준다.
create or replace function public.operator_list_email_recipients(
  p_statuses text[], p_campaign uuid default null, p_limit integer default 1000, p_offset integer default 0)
returns table(email text, status text, error text, sent_at timestamptz, updated_at timestamptz,
              campaign_id uuid, campaign_subject text, campaign_sent_at timestamptz, total bigint)
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
           c.id, c.subject, coalesce(c.sent_at, c.created_at), count(*) over ()
    from email_campaign_recipients r
    join email_campaigns c on c.id = r.campaign_id
    where r.status = any (p_statuses)
      and (p_campaign is null or r.campaign_id = p_campaign)
    order by coalesce(r.updated_at, r.sent_at) desc nulls last, r.email
    limit greatest(1, least(coalesce(p_limit, 1000), 1000))
    offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.operator_list_email_recipients(text[], uuid, integer, integer) from public, anon;
grant execute on function public.operator_list_email_recipients(text[], uuid, integer, integer) to authenticated;
