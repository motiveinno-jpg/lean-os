-- 저장공간 한도의 좌석 수를 지금 재직 인원으로
--   요금제 화면 위쪽의 '추가 N명'은 재직 인원 기준인데 저장공간은 구독에 남은 결제 당시 좌석 수로 쳐서
--   인원이 늘어도 한도가 옛 인원만큼만 잡혔다. 갱신 청구(toss-charge)도 재직 인원으로 센다.
--   나머지(실효 유료 판정·팩)는 20260902110000 그대로.

CREATE OR REPLACE FUNCTION public.storage_quota_params(p_company uuid)
 RETURNS TABLE(included_bytes bigint, per_unit_bytes bigint, extra_seats integer, storage_packs integer, effective_paid boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s record;
  v_incl bigint; v_unit bigint; v_incl_seats int; v_paid boolean := false;
begin
  if not public.is_service_request() and p_company is distinct from public.get_my_company_id() then
    raise exception 'forbidden: company scope';
  end if;
  select sub.seat_count, sub.storage_pack_count, sub.status, sub.trial_ends_at, sub.current_period_end,
         p.included_seats, p.included_storage_bytes, p.storage_per_unit_bytes, p.slug
    into s
  from public.subscriptions sub
  join public.subscription_plans p on p.id = sub.plan_id
  where sub.company_id = p_company
  order by sub.created_at desc limit 1;

  if not found then
    included_bytes := 524288000; per_unit_bytes := 10737418240;
    extra_seats := 0; storage_packs := 0; effective_paid := false;
    return next; return;
  end if;

  v_incl := coalesce(s.included_storage_bytes, 524288000);
  v_unit := coalesce(s.storage_per_unit_bytes, 10737418240);
  v_incl_seats := coalesce(s.included_seats, 0);

  if coalesce(s.slug, 'free') = 'free' then
    v_paid := false;
  elsif s.status = 'trialing' then
    v_paid := s.trial_ends_at is not null and s.trial_ends_at > now();
  elsif s.status in ('active', 'past_due', 'paused') then
    v_paid := s.current_period_end is null or s.current_period_end + interval '3 days' > now();
  else
    v_paid := false;
  end if;

  included_bytes := v_incl; per_unit_bytes := v_unit; effective_paid := v_paid;
  if v_paid then
    -- 좌석 = 지금 재직 인원(company_seat_count, 샘플 제외) — 요금제 화면의 '추가 N명'·갱신 청구와 같은 수.
    --   예전엔 구독에 남은 결제 당시 좌석 수를 써서 인원이 늘어도 저장공간은 옛 인원만큼만 늘었다.
    extra_seats := greatest(0, coalesce(public.company_seat_count(p_company), s.seat_count, 1) - v_incl_seats);
    storage_packs := coalesce(s.storage_pack_count, 0);
  else
    -- 실효 무료: 좌석·팩 한도 없음. 파일은 남고 새 업로드만 막힌다(재결제 시 즉시 원복).
    extra_seats := 0; storage_packs := 0;
  end if;
  return next;
end $function$;
