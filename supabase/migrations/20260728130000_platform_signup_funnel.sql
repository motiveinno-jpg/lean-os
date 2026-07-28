-- 가입 퍼널 + 회사 미등록 가입자 (2026-07-28)
--   기존 대시보드는 companies 기준으로만 세서, 계정만 만들고 회사 등록 전에
--   이탈한 사람이 통계 어디에도 안 잡혔다(2026-07-28 당일 4명 전원 이 상태였음).
--   auth.users 를 봐야 하므로 SECURITY DEFINER + 함수 내부 운영자 게이트.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

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
