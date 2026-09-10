-- 웹훅: 청구서/구독/감사 이벤트/알림을 한 트랜잭션에서 반영한다.
-- 외부 결제 상태는 Edge에서 토스 조회 API로 검증한 뒤 service_role만 전달한다.
begin;
create or replace function public.apply_toss_payment_void(
  p_order_id text, p_payment_key text, p_status text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_invoice public.invoices%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'server only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('CANCELED', 'PARTIAL_CANCELED', 'EXPIRED', 'ABORTED')
     or coalesce(p_order_id, '') = '' or coalesce(p_payment_key, '') = '' then
    raise exception 'invalid payment void request' using errcode = '22023';
  end if;
  select * into v_invoice from public.invoices where toss_order_id = p_order_id for update;
  if not found then raise exception 'invoice not ready' using errcode = 'P0002'; end if;
  if v_invoice.toss_payment_key is not null and v_invoice.toss_payment_key <> p_payment_key then
    raise exception 'payment key mismatch' using errcode = '22023';
  end if;
  -- 행 잠금으로 동시 재전송도 직렬화. 완료된 같은 취소를 다시 처리하지 않는다.
  if v_invoice.status = 'canceled' then
    return jsonb_build_object('handled', true, 'duplicate', true);
  end if;
  update public.invoices set status = 'canceled' where id = v_invoice.id;
  if v_invoice.subscription_id is not null then
    update public.subscriptions set status = 'past_due',
      last_payment_error = '토스 결제 ' || p_status, updated_at = now()
      where id = v_invoice.subscription_id and company_id = v_invoice.company_id;
    if not found then raise exception 'subscription not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.billing_events(company_id, event_type, metadata)
    values (v_invoice.company_id, 'refund', jsonb_build_object('provider', 'toss',
      'orderId', p_order_id, 'paymentKey', p_payment_key, 'status', p_status,
      'amount', v_invoice.total_amount));
  insert into public.notifications(company_id, user_id, type, title, message, link)
    select v_invoice.company_id, u.id, 'billing', '결제가 취소되었습니다',
      v_invoice.total_amount::text || '원 결제가 취소(' || p_status || ')되었습니다. 결제 상태를 확인해 주세요.', '/billing'
    from public.users u where u.company_id = v_invoice.company_id and u.is_master = true;
  return jsonb_build_object('handled', true, 'duplicate', false);
end;
$$;
revoke all on function public.apply_toss_payment_void(text, text, text) from public, anon, authenticated;
grant execute on function public.apply_toss_payment_void(text, text, text) to service_role;
commit;
