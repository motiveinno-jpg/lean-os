-- Migration: platform_ops_risk_rpc (2026-07-28)
-- 운영자 대시보드 "위험 신호·성장 신호" 데이터 공급.
--   ④ 합류요청 방치  ⑤ 휴면 위험 고객  ⑥ 메일 발송 실패  ⑦ 영업코드 실적  ⑨ 탈퇴 추이
--   (①체험만료임박 ②해지예약 ③결제실패는 subscriptions 를 클라이언트가 직접 읽음)
--
-- 게이트: is_platform_operator() — platform_usage_stats 등 기존 OP RPC 패턴 재사용.

-- 1) 탈퇴 기록 — 탈퇴는 users 익명화 + auth 삭제라 시점 기록이 없으면 추이를 못 센다.
--    PII 없음(집계용 시점·역할만). 쓰기는 service_role(delete-account API), 읽기는 RPC.
create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  role text,
  created_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
-- 정책 없음 = 클라이언트 접근 전면 차단 (service_role·definer 함수만)

-- 2) 운영 위험·성장 신호 RPC
create or replace function public.platform_ops_risk()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_operator() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'as_of', now(),

    -- ④ 승인 대기 중인 합류요청 (만료 전) — 오래된 순, 방치 일수 포함
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

    -- ⑤ 휴면 위험 — 유료/체험 구독 회사인데 구성원 전원이 7일간 로그인 없음
    'dormant_companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', d.name, 'plan', d.plan, 'last_seen', d.last_seen
      ) order by d.last_seen nulls first)
      from (
        select c.name,
               coalesce(sp.name, s.status) as plan,
               max(au.last_sign_in_at) as last_seen
        from public.subscriptions s
        join public.companies c on c.id = s.company_id
        left join public.subscription_plans sp on sp.id = s.plan_id
        left join public.users u on u.company_id = c.id
        left join auth.users au on au.id = u.auth_id
        where s.status in ('active', 'trialing')
        group by c.id, c.name, sp.name, s.status
        having coalesce(max(au.last_sign_in_at), 'epoch'::timestamptz) < now() - interval '7 days'
      ) d
    ), '[]'::jsonb),

    -- ⑥ 메일 발송 실패 (최근 30일)
    'email_failures', jsonb_build_object(
      'join_requests', (select count(*) from public.company_join_requests
                        where delivery_status = 'failed' and created_at > now() - interval '30 days'),
      'billing', (select count(*) from public.billing_email_deliveries
                  where status = 'failed' and created_at > now() - interval '30 days')
    ),

    -- ⑦ 영업코드 실적 — 코드별 사용·전환
    'sales_codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', sc.code, 'owner', sc.owner_name, 'bonus_days', sc.bonus_trial_days,
        'active', sc.is_active,
        'redemptions', (select count(*) from public.sales_code_redemptions r where r.sales_code_id = sc.id),
        'conversions', (select count(*) from public.sales_code_redemptions r where r.sales_code_id = sc.id and r.converted_at is not null)
      ) order by sc.created_at desc)
      from public.sales_codes sc
    ), '[]'::jsonb),

    -- ⑨ 탈퇴 추이
    'deletions', jsonb_build_object(
      'd7', (select count(*) from public.account_deletions where created_at > now() - interval '7 days'),
      'd30', (select count(*) from public.account_deletions where created_at > now() - interval '30 days')
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.platform_ops_risk() from public, anon;
grant execute on function public.platform_ops_risk() to authenticated, service_role;
