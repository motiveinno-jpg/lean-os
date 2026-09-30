-- 운영자 '활동 가입사'에서 시스템이 남긴 기록을 활동으로 치지 않기
--   마지막 활동 = 로그인·변경 이력·화면 방문 중 가장 늦은 것인데, 변경 이력에는 사람이 아니라 예약 작업이
--   만든 줄(user_id 없음, 예: 매월 1일 06:00 자동 전표)도 섞여 있다. 그래서 한 달 넘게 아무도 로그인하지 않은
--   회사도 1일마다 '최근 활동'으로 잡혔다. 사람이 한 변경(user_id 있음)만 센다. 나머지는 20260929140000 그대로.

CREATE OR REPLACE FUNCTION public.platform_company_activity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare result jsonb;
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id',   c.id,
    'company',      c.name,
    'last_login',   l.last_login,
    'last_activity', greatest(l.last_login, a.last_audit, v.last_view),
    'last_inquiry', q.last_inquiry
  ) order by greatest(l.last_login, a.last_audit, v.last_view) nulls last), '[]'::jsonb)
  into result
  from public.companies c
  left join lateral (select max(au.last_sign_in_at) as last_login
      from public.users u join auth.users au on au.id=u.auth_id where u.company_id=c.id) l on true
  left join lateral (select max(created_at) as last_audit
      from public.audit_logs where company_id=c.id and user_id is not null) a on true
  left join lateral (select max(created_at) as last_view
      from public.page_views where company_id=c.id) v on true
  left join lateral (select max(pi.created_at) as last_inquiry
      from public.partnership_inquiries pi
      join public.users u2 on lower(u2.email)=lower(pi.email)
     where u2.company_id=c.id) q on true
  where not c.is_test;

  return result;
end;
$function$;
