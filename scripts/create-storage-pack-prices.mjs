#!/usr/bin/env node
/**
 * OwnerView — 저장공간 팩(+10GB) Stripe Price 생성 (2026-09-02 스토리지 팩 애드온)
 *
 * 팩 1개 = 좌석과 동일 단가. 「OwnerView 오너뷰」(standard) 상품에 반복 가격 2개를 붙인다.
 *   월간  5,000원/월   (STRIPE_PRICE_STORAGE_PACK_MONTHLY)
 *   연간 54,000원/년   (5,000 × 12 × 0.9 — 좌석 연간과 동일)  (STRIPE_PRICE_STORAGE_PACK_ANNUAL)
 *
 * 실행:
 *   STRIPE_SECRET_KEY_LIVE=sk_live_xxx node scripts/create-storage-pack-prices.mjs           # 미리보기
 *   STRIPE_SECRET_KEY_LIVE=sk_live_xxx node scripts/create-storage-pack-prices.mjs --apply   # 실제 생성
 *   (테스트 모드 확인은 sk_test_ 키. STRIPE_SECRET_KEY 도 읽는다.)
 *
 * 안전장치(scripts/create-annual-prices.mjs 와 동일 패턴):
 *   · 상품은 "기존 좌석 월간 Price 의 product" 로 찾는다(STRIPE_PRICE_STANDARD_EXTRA_SEAT_MONTHLY 환경변수가
 *     있으면 그것, 없으면 이름 'OwnerView 오너뷰'/'오너뷰'/'standard' 로 검색). 라이브/테스트는 상품 ID 가 다르다.
 *   · lookup_key(ownerview_storage_pack_monthly / _annual) 로 중복 생성을 막는다 — 두 번 실행해도 건너뛴다.
 *   · --apply 없이는 만들지 않는다.
 * 생성 후: 출력된 price_… 를 Vercel(production) 환경변수에 넣고 재배포해야 /api/billing/storage-pack 이 400 을 멈춘다.
 */
import Stripe from 'stripe';

const KEY = process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY;
const APPLY = process.argv.includes('--apply');
if (!KEY || !/^sk_(live|test)_[A-Za-z0-9]+$/.test(KEY)) {
  console.error('❌ STRIPE_SECRET_KEY_LIVE(또는 STRIPE_SECRET_KEY) 가 필요합니다. 예: STRIPE_SECRET_KEY_LIVE=sk_live_xxx node scripts/create-storage-pack-prices.mjs --apply');
  process.exit(1);
}
const MODE = KEY.startsWith('sk_live') ? 'LIVE(실결제)' : 'TEST';
const stripe = new Stripe(KEY, { apiVersion: '2025-02-24.acacia' });

const PRICES = [
  { env: 'STRIPE_PRICE_STORAGE_PACK_MONTHLY', lookupKey: 'ownerview_storage_pack_monthly', amount: 5000,  interval: 'month', nickname: '저장공간 팩(+10GB) 월간 5,000' },
  { env: 'STRIPE_PRICE_STORAGE_PACK_ANNUAL',  lookupKey: 'ownerview_storage_pack_annual',  amount: 54000, interval: 'year',  nickname: '저장공간 팩(+10GB) 연간 54,000(10% 할인)' },
];

async function findProduct() {
  const seatPriceId = process.env.STRIPE_PRICE_STANDARD_EXTRA_SEAT_MONTHLY;
  if (seatPriceId) {
    try {
      const p = await stripe.prices.retrieve(seatPriceId);
      const prod = typeof p.product === 'string' ? await stripe.products.retrieve(p.product) : p.product;
      if (prod && !prod.deleted) return { product: prod, via: `좌석 Price ${seatPriceId} 의 상품` };
    } catch { /* 이름 검색으로 폴백 */ }
  }
  const names = ['OwnerView 오너뷰', '오너뷰', 'OwnerView Standard', 'standard'];
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (names.some((n) => p.name === n || p.name.toLowerCase().includes(n.toLowerCase()))) return { product: p, via: `이름 '${p.name}'` };
  }
  return null;
}

const won = (n) => n.toLocaleString('ko-KR');
console.log(`모드: ${MODE}  ${APPLY ? '— 실제 생성' : '— 미리보기(--apply 없음)'}\n`);
const found = await findProduct();
if (!found) { console.error('❌ 오너뷰(standard) 상품을 찾지 못했습니다. STRIPE_PRICE_STANDARD_EXTRA_SEAT_MONTHLY 를 함께 넘기세요.'); process.exit(1); }
console.log(`상품: ${found.product.name} (${found.product.id}) ← ${found.via}\n`);

const out = [];
for (const spec of PRICES) {
  const existing = (await stripe.prices.list({ lookup_keys: [spec.lookupKey], limit: 1 })).data[0];
  if (existing) {
    console.log(`= 이미 있음  ${spec.env}=${existing.id}  (${won(existing.unit_amount)}원/${existing.recurring?.interval})`);
    out.push([spec.env, existing.id]); continue;
  }
  console.log(`+ 만들 것    ${spec.nickname}  ${won(spec.amount)}원/${spec.interval}  lookup_key=${spec.lookupKey}`);
  if (!APPLY) continue;
  const price = await stripe.prices.create({
    product: found.product.id, currency: 'krw', unit_amount: spec.amount,
    recurring: { interval: spec.interval }, nickname: spec.nickname, lookup_key: spec.lookupKey,
    tax_behavior: 'unspecified',
    metadata: { ownerview_addon: 'storage_pack', per_unit_gb: '10' },
  });
  console.log(`  ✓ 생성  ${spec.env}=${price.id}`);
  out.push([spec.env, price.id]);
}
if (out.length) {
  console.log('\nVercel(production) 에 넣을 값:');
  for (const [k, v] of out) console.log(`  ${k}=${v}`);
}
