-- 가입 퍼널 v2 (2026-07-28): 단계별 "누가"를 함께 반환 — 카드 클릭 시 명단 표시용.
--   today_detail 키 추가(기존 키는 그대로 — 클라이언트 하위호환).
--   accounts: 오늘 만들어진 계정 전부(로그인·회사 연결 여부 포함) / companies·trials: 오늘 생성분.

create or replace function public.platform_signup_funnel(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
  d integer := least(greatest(coalesce(p_days, 7), 1), 90);
  since timestamptz := now() - make_interval(days => d);
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'days', d,
    'today', jsonb_build_object(
      'accounts',  (select count(*) from auth.users
                     where (created_at at time zone 'Asia/Seoul')::date = today),
      'signed_in', (select count(*) from auth.users
                     where (created_at at time zone 'Asia/Seoul')::date = today
                       and last_sign_in_at is not null),
      'companies', (select count(*) from public.companies
                     where (created_at at time zone 'Asia/Seoul')::date = today),
      'trials',    (select count(*) from public.subscriptions
                     where (created_at at time zone 'Asia/Seoul')::date = today
                       and status in ('trialing','active'))
    ),
    'today_detail', jsonb_build_object(
      'accounts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'email',      au.email,
          'provider',   coalesce(au.raw_app_meta_data->>'provider', 'email'),
          'created_at', au.created_at,
          'signed_in',  au.last_sign_in_at is not null,
          'company',    c.name
        ) order by au.created_at desc), '[]'::jsonb)
        from auth.users au
        left join public.users u on u.auth_id = au.id
        left join public.companies c on c.id = u.company_id
        where (au.created_at at time zone 'Asia/Seoul')::date = today
      ),
      'companies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'created_at', c.created_at
        ) order by c.created_at desc), '[]'::jsonb)
        from public.companies c
        where (c.created_at at time zone 'Asia/Seoul')::date = today
      ),
      'trials', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'company_id', c.id, 'company', c.name, 'status', s.status, 'created_at', s.created_at
        ) order by s.created_at desc), '[]'::jsonb)
        from public.subscriptions s
        join public.companies c on c.id = s.company_id
        where (s.created_at at time zone 'Asia/Seoul')::date = today
          and s.status in ('trialing', 'active')
      )
    ),
    'period', jsonb_build_object(
      'accounts',  (select count(*) from auth.users where created_at > since),
      'signed_in', (select count(*) from auth.users where created_at > since and last_sign_in_at is not null),
      'companies', (select count(*) from public.companies where created_at > since),
      'trials',    (select count(*) from public.subscriptions
                     where created_at > since and status in ('trialing','active'))
    ),
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'email',        au.email,
        'created_at',   au.created_at,
        'last_sign_in', au.last_sign_in_at,
        'provider',     coalesce(au.raw_app_meta_data->>'provider', 'email'),
        'confirmed',    au.confirmed_at is not null
      ) order by au.created_at desc), '[]'::jsonb)
      from auth.users au
      left join public.users u on u.auth_id = au.id
      where (u.id is null or u.company_id is null)
        and au.created_at > now() - interval '30 days'
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.platform_signup_funnel(int) from public, anon;
grant execute on function public.platform_signup_funnel(int) to authenticated;
