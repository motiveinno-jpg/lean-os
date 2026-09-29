// 구독 한 건의 월 요금(VAT 별도) — 운영자 개요·수익·고객사 상세가 같이 쓴다.
//   식은 실제 청구(supabase/functions/toss-charge 갱신 청구)와 같다:
//   기본료 + (포함 인원을 넘는 좌석 + 저장공간 팩) × 좌석 단가. 연간은 할인 적용한 12개월치 ÷ 12.
//   예전엔 '좌석 단가 × 전체 좌석'으로 세어 포함 인원(5명)만큼 부풀었고, 토스 결제 구독은 MRR 에서 빠졌다.

type PlanLike = { base_price?: number | null; per_seat_price?: number | null; included_seats?: number | null; annual_discount?: number | null } | null | undefined;
type SubLike = {
  seat_count?: number | null; storage_pack_count?: number | null; billing_cycle?: string | null;
  stripe_subscription_id?: string | null; toss_billing_key?: string | null;
};

export function subscriptionMonthlyFee(sub: SubLike, plan: PlanLike): number {
  if (!plan) return 0;
  const perSeat = Number(plan.per_seat_price || 0);
  const extraSeats = Math.max(0, Number(sub.seat_count || 1) - Number(plan.included_seats || 0));
  const packs = Math.max(0, Number(sub.storage_pack_count || 0));
  const monthly = Number(plan.base_price || 0) + (extraSeats + packs) * perSeat;
  const annual = sub.billing_cycle === "annual" || sub.billing_cycle === "yearly";
  return Math.round(annual ? monthly * (1 - Number(plan.annual_discount || 0)) : monthly);
}

/** 실제로 돈이 빠져나가는 구독 — Stripe 구독이 있거나 토스 자동결제 키가 있는 것(내부 부여·수동 구독 제외) */
export function isBilledSubscription(sub: SubLike): boolean {
  return !!(sub.stripe_subscription_id || sub.toss_billing_key);
}
