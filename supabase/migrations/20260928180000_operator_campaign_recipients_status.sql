-- 발송 이력에서 반송·스팸 신고·중복 제외 건수를 누르면 그 주소 목록을 본다.
--   상태로 서버에서 거른다 — 캠페인 전체(최대 2,000행)를 받아 화면에서 거르면 PostgREST 1,000행 상한에 잘린다.
drop function if exists public.operator_list_campaign_recipients(uuid, integer);
create function public.operator_list_campaign_recipients(p_campaign uuid, p_limit integer default 1000, p_status text default null)
returns table(email text, status text, error text, sent_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  return query
    select r.email, r.status, r.error, r.sent_at, r.updated_at
    from email_campaign_recipients r
    where r.campaign_id = p_campaign
      and (p_status is null or r.status = p_status)
    order by r.status, r.email
    limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end;
$function$;

revoke all on function public.operator_list_campaign_recipients(uuid, integer, text) from public, anon;
grant execute on function public.operator_list_campaign_recipients(uuid, integer, text) to authenticated;
