-- 운영자 › 수익 「결제 실패·미납」 — 토스 결제 실패는 billing_events 에만 쌓이고 운영자 화면 어디에도 안 보였다.
--   billing_events 는 운영자 SELECT 정책이 없어(회사 본인·service_role 만) 운영자 전용 RPC 로 모아 준다.
--   · payment_failed      — 결제 실패 한 건(토스 회차·Stripe 이벤트)
--   · past_due            — 지금 미납 상태인 구독(재시도 소진 포함)
--   · customer_email      — 고객 결제 메일 발송 실패(billing_customer_emails.status=failed)
create or replace function public.operator_billing_issues(p_days integer default 90)
returns table(kind text, company_id uuid, company_name text, at timestamptz, amount bigint, provider text, detail text, attempt integer, exhausted boolean)
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
    select 'payment_failed'::text, e.company_id, c.name, e.created_at,
           coalesce((e.metadata->>'amount')::numeric, (e.metadata->>'amountDue')::numeric)::bigint,
           coalesce(e.metadata->>'provider', case when e.metadata ? 'stripeInvoiceId' then 'stripe' else null end),
           nullif(trim(coalesce(e.metadata->>'code', '') || ' ' || coalesce(e.metadata->>'message', e.metadata->>'reason', '')), ''),
           coalesce((e.metadata->>'attempt')::int, (e.metadata->>'attemptCount')::int),
           coalesce((e.metadata->>'exhausted')::boolean, false)
      from billing_events e left join companies c on c.id = e.company_id
     where e.event_type = 'payment_failed' and e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
    union all
    select 'past_due', s.company_id, c.name, s.updated_at, null::bigint,
           coalesce(s.payment_provider, case when s.stripe_subscription_id is not null then 'stripe' end),
           s.last_payment_error, s.payment_retry_count, s.payment_retry_count >= 3
      from subscriptions s left join companies c on c.id = s.company_id
     where s.status = 'past_due'
    union all
    select 'customer_email', m.company_id, c.name, m.created_at, null::bigint, null::text,
           m.kind || ' · ' || coalesce(m.last_error, ''), null::int, null::boolean
      from billing_customer_emails m left join companies c on c.id = m.company_id
     where m.status = 'failed' and m.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
    order by 4 desc
    limit 500;
end;
$function$;

revoke all on function public.operator_billing_issues(integer) from public, anon;
grant execute on function public.operator_billing_issues(integer) to authenticated;
