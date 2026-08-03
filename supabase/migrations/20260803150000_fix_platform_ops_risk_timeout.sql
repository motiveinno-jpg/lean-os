-- platform_ops_risk: dormant_companies 조인 폭발(users×audit_logs×page_views 카티전 곱)로
-- statement timeout 나던 것을 상관 서브쿼리로 재작성 (2026-08-03, 운영자 화면 DB 500 32건)
create or replace function public.platform_ops_risk()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  if not public.is_platform_operator() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'stale_join_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company', c.name,
        'email', r.requester_email,
        'days', extract(day from now() - r.created_at)::int,
        'created_at', r.created_at
      ) order by r.created_at)
      from public.company_join_requests r
      join public.companies c on c.id = r.company_id
      where r.status = 'pending'
        and (r.expires_at is null or r.expires_at > now())
    ), '[]'::jsonb),
    'dormant_companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', d.name, 'plan', d.plan, 'last_seen', d.last_seen
      ) order by d.last_seen nulls first)
      from (
        select c.name,
               coalesce(sp.name, s.status) as plan,
               greatest(
                 (select max(au.last_sign_in_at) from public.users u join auth.users au on au.id = u.auth_id where u.company_id = c.id),
                 (select max(al.created_at) from public.audit_logs al where al.company_id = c.id),
                 (select max(pv.created_at) from public.page_views pv where pv.company_id = c.id)
               ) as last_seen
        from public.subscriptions s
        join public.companies c on c.id = s.company_id
        left join public.subscription_plans sp on sp.id = s.plan_id
        where s.status in ('active', 'trialing')
      ) d
      where coalesce(d.last_seen, 'epoch'::timestamptz) < now() - interval '7 days'
    ), '[]'::jsonb),
    'email_failures', jsonb_build_object(
      'join_requests', (select count(*) from public.company_join_requests
                        where delivery_status = 'failed' and created_at > now() - interval '30 days'),
      'billing', (select count(*) from public.billing_email_deliveries
                  where status = 'failed' and created_at > now() - interval '30 days')
    ),
    'sales_codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', sc.code, 'owner', sc.owner_name, 'bonus_days', sc.bonus_trial_days,
        'active', sc.is_active,
        'redemptions', (select count(*) from public.sales_code_redemptions r where r.sales_code_id = sc.id),
        'conversions', (select count(*) from public.sales_code_redemptions r where r.sales_code_id = sc.id and r.converted_at is not null)
      ) order by sc.created_at desc)
      from public.sales_codes sc
    ), '[]'::jsonb),
    'deletions', jsonb_build_object(
      'd7', (select count(*) from public.account_deletions where created_at > now() - interval '7 days'),
      'd30', (select count(*) from public.account_deletions where created_at > now() - interval '30 days')
    )
  ) into v_result;

  return v_result;
end;
$function$;
