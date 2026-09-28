// Stripe 요금제 price 와 추가 좌석 계산 — 결제 시작(/api/stripe/checkout)과 매일 좌석 맞추기
//   (/api/stripe/sync-seats)가 같은 값을 쓰도록 한 곳에 둔다.
//
//   기본 좌석(5명) 초과분만 추가좌석 price 로 별도 line item. VAT 10% 별도.
//   연간 env 가 없으면 연간 선택은 400 으로 막는다(가격 미생성 상태에서 잘못 결제되는 것 방지).
//   2026-08-07 구 요금제(프로·울트라·엔터프라이즈) 제거 — 판매 요금제는 '오너뷰' 하나뿐이다.
//     기존 구독자는 subscriptions 에 남은 plan_id 로 계속 유지되고 한도도 그대로 적용된다.
//     여기서 빠지면 '새로 결제'만 막힌다(알 수 없는 플랜은 checkout 에서 400).

export type BillingCycle = 'monthly' | 'annual';

export const SEAT_PRICE_MAP: Record<string, Record<BillingCycle, { base?: string; extraSeat?: string }> & { includedSeats: number }> = {
  // 요금제 — 단일 유료 플랜(2026-08-11부터 월 39,000원 + 추가좌석 5,000원, VAT 별도).
  //   Stripe 대시보드에서 price 를 만든 뒤 Vercel env 에 아래 4개를 등록해야 결제가 열린다.
  //   env 가 비어 있으면 checkout 이 400 으로 막히므로 잘못 결제될 위험은 없다.
  standard: {
    monthly: {
      base: process.env.STRIPE_PRICE_STANDARD_MONTHLY,
      extraSeat: process.env.STRIPE_PRICE_STANDARD_EXTRA_SEAT_MONTHLY,
    },
    annual: {
      base: process.env.STRIPE_PRICE_STANDARD_ANNUAL,
      extraSeat: process.env.STRIPE_PRICE_STANDARD_EXTRA_SEAT_ANNUAL,
    },
    includedSeats: 5,
  },
};

/** 과금 좌석 = 재직 구성원(company_seat_count — 토스 월 청구와 같은 DB 함수), 추가좌석 = 좌석 − 기본 − 쿠폰 무료좌석.
 *  db 는 그 회사 소속 사용자 클라이언트이거나 service_role. 좌석 조회가 실패하면 null(호출부가 청구를 멈춘다). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function billableSeats(db: any, companyId: string, includedSeats: number): Promise<{ seats: number; extraSeats: number } | null> {
  const { data: seatRpc, error } = await db.rpc('company_seat_count', { p_company: companyId });
  if (error || seatRpc == null) return null;
  const seats = Math.max(1, Number(seatRpc) || 0);
  //   무료쿠폰좌석: 연간 결제 혜택 쿠폰(추가인원 12명 무료)을 사용(redeemed)한 회사는 그만큼 과금 제외
  let freeCouponSeats = 0;
  try {
    const { data: coupons } = await db.from('billing_seat_coupons').select('free_seats').eq('company_id', companyId).eq('status', 'redeemed');
    freeCouponSeats = ((coupons || []) as { free_seats: number | null }[]).reduce((s, c) => s + Number(c.free_seats || 0), 0);
  } catch { /* 쿠폰 조회 실패 시 무료좌석 0 으로(과소청구 방지) */ }
  return { seats, extraSeats: Math.max(0, seats - includedSeats - freeCouponSeats) };
}
