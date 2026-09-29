-- 외부 서비스 화면: 메일(Resend)·전자서명 발송은 판정 근거 없이 늘 "정상"으로 떴다.
--   실제로 남는 발송 결과 기록을 같이 돌려줘 화면이 그걸로 판정하게 한다.
--   · mail — 발송 결과를 행으로 남기는 흐름만 센다: 소개 메일(email_campaign_recipients),
--            구독 결제 고객 메일(billing_customer_emails), Stripe 청구 알림(billing_email_deliveries).
--            그 밖의 메일(초대·명세서 등)은 결과를 남기지 않아 여기 안 잡힌다 — 화면에 그렇게 적는다.
--   · signatures.send_failures_24h — 서명 요청 메일 발송 실패(signature_send_failures, 재발송 안 된 것)
--            signatures.requests_sent_24h — 24시간 안에 발송된 서명 요청
--   기존 키(supabase·codef·stripe·signatures.approvals_24h 등)는 그대로 둔다.

create or replace function public.operator_dependencies_health()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_24h timestamptz := now() - interval '24 hours';
  v_1h  timestamptz := now() - interval '1 hour';
begin
  if not public.is_platform_operator() then
    raise exception 'platform operator only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'supabase', jsonb_build_object(
      'errors_24h', (select count(*) from error_logs where created_at >= v_24h and resolved = false),
      'errors_1h', (select count(*) from error_logs where created_at >= v_1h and resolved = false),
      'sample_query_ok', true
    ),
    'codef', jsonb_build_object(
      'bank_tx_24h', (select count(*) from bank_transactions where created_at >= v_24h),
      'card_tx_24h', (select count(*) from card_transactions where created_at >= v_24h),
      'note', 'BLOCKED: 홈택스/CODEF 일부 분기 (project_hometax_blocked)'
    ),
    'stripe', jsonb_build_object(
      'paid_invoices_24h', (select count(*) from invoices where status='paid' and created_at >= v_24h),
      'failed_invoices_24h', (select count(*) from invoices where status in ('failed','past_due') and created_at >= v_24h)
    ),
    'signatures', jsonb_build_object(
      'approvals_24h', (select count(*) from quote_approvals where created_at >= v_24h),
      'fully_signed_24h', (select count(*) from quote_approvals where status='fully_signed' and created_at >= v_24h),
      'requests_sent_24h', (select count(*) from signature_requests where sent_at >= v_24h),
      'send_failures_24h', (select count(*) from signature_send_failures where failed_at >= v_24h and not coalesce(retried, false))
    ),
    'mail', jsonb_build_object(
      'sent_24h',
        (select count(*) from email_campaign_recipients
          where status in ('sent','delivered','bounced','complained','delayed') and coalesce(sent_at, updated_at) >= v_24h)
        + (select count(*) from billing_customer_emails where status = 'sent' and coalesce(sent_at, created_at) >= v_24h)
        + (select count(*) from billing_email_deliveries where status = 'sent' and coalesce(sent_at, updated_at) >= v_24h),
      'failed_24h',
        (select count(*) from email_campaign_recipients where status = 'failed' and coalesce(sent_at, updated_at) >= v_24h)
        + (select count(*) from billing_customer_emails where status = 'failed' and created_at >= v_24h)
        + (select count(*) from billing_email_deliveries where status = 'failed' and updated_at >= v_24h)
    ),
    'at', now()
  ) into v;

  return v;
end;
$function$;

revoke execute on function public.operator_dependencies_health() from public, anon;
grant execute on function public.operator_dependencies_health() to authenticated, service_role;
