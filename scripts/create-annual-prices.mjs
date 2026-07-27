#!/usr/bin/env node
/**
 * OwnerView — 연간 결제 price 생성 (2026-07-27 가격정책)
 *
 * 월가 대비 10% 할인. 기존 「OwnerView 프로 / 울트라」 상품에 연간 가격을 추가한다.
 *   프로        858,600원/년      (79,500 × 12 × 0.9)
 *   프로 추가좌석 108,000원/년      (10,000 × 12 × 0.9)
 *   울트라      1,188,000원/년     (110,000 × 12 × 0.9)
 *   울트라 추가좌석 108,000원/년
 *
 * 실행:
 *   STRIPE_SECRET_KEY_LIVE=sk_live_xxx node scripts/create-annual-prices.mjs
 *   (테스트 모드로 확인만 하려면 sk_test_ 키를 넣으면 된다)
 *
 * 안전장치:
 *   · 상품 ID 를 하드코딩하지 않고 "이름"으로 찾는다 — 라이브/테스트는 상품 ID 가 서로 다르다.
 *   · lookup_key 로 중복 생성을 막는다. 두 번 실행해도 이미 있으면 건너뛴다.
 *   · --apply 를 붙이기 전까지는 무엇을 만들지 보여주기만 하고 실제로 만들지 않는다.
 */
import Stripe from 'stripe';

const KEY = process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY;
const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('❌ STRIPE_SECRET_KEY_LIVE (또는 STRIPE_SECRET_KEY) 환경변수가 필요합니다.');
  console.error('   예: STRIPE_SECRET_KEY_LIVE=sk_live_xxx node scripts/create-annual-prices.mjs --apply');
  process.exit(1);
}

const MODE = KEY.startsWith('sk_live') ? 'LIVE(실결제)' : 'TEST';
const stripe = new Stripe(KEY, { apiVersion: '2025-02-24.acacia' });

// 상품 이름 → 만들 연간 가격들
const PLAN = [
  {
    productName: 'OwnerView 프로',
    prices: [
      { env: 'STRIPE_PRICE_BASIC_ANNUAL', lookupKey: 'ownerview_basic_annual', amount: 858600, nickname: 'OwnerView 프로 연간(10% 할인)' },
      { env: 'STRIPE_PRICE_BASIC_EXTRA_SEAT_ANNUAL', lookupKey: 'ownerview_basic_extra_seat_annual', amount: 108000, nickname: 'OwnerView 프로 추가좌석 연간(10% 할인)' },
    ],
  },
  {
    productName: 'OwnerView 울트라',
    prices: [
      { env: 'STRIPE_PRICE_ULTRA_ANNUAL', lookupKey: 'ownerview_ultra_annual', amount: 1188000, nickname: 'OwnerView 울트라 연간(10% 할인)' },
      { env: 'STRIPE_PRICE_ULTRA_EXTRA_SEAT_ANNUAL', lookupKey: 'ownerview_ultra_extra_seat_annual', amount: 108000, nickname: 'OwnerView 울트라 추가좌석 연간(10% 할인)' },
    ],
  },
];

async function findProductByName(name) {
  // 이름은 정확 일치 우선, 없으면 부분 일치. 활성 상품만.
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.name === name) return p;
  }
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.name.includes(name.replace('OwnerView ', ''))) return p;
  }
  return null;
}

async function findExistingPrice(lookupKey) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  return found.data[0] || null;
}

const won = (n) => n.toLocaleString('ko-KR');

(async () => {
  console.log(`\n▶ Stripe 모드: ${MODE}`);
  console.log(APPLY ? '▶ 실제로 생성합니다 (--apply)\n' : '▶ 미리보기만 합니다. 실제 생성하려면 --apply 를 붙이세요.\n');

  const envLines = [];
  let created = 0;
  let skipped = 0;

  for (const group of PLAN) {
    const product = await findProductByName(group.productName);
    if (!product) {
      console.error(`❌ 상품을 찾지 못했습니다: ${group.productName}`);
      console.error('   Stripe 대시보드에서 상품 이름을 확인해 주세요(모드가 맞는지도 확인).');
      process.exit(1);
    }
    console.log(`■ ${product.name}  (${product.id})`);

    for (const spec of group.prices) {
      const existing = await findExistingPrice(spec.lookupKey);
      if (existing) {
        console.log(`   · 이미 있음 → ${spec.env} = ${existing.id}  (${won(existing.unit_amount)}원/년)`);
        envLines.push(`${spec.env}=${existing.id}`);
        skipped++;
        continue;
      }
      if (!APPLY) {
        console.log(`   · 생성 예정 → ${spec.nickname}  ${won(spec.amount)}원/년`);
        continue;
      }
      const price = await stripe.prices.create({
        product: product.id,
        currency: 'krw',
        unit_amount: spec.amount,
        recurring: { interval: 'year' },
        nickname: spec.nickname,
        lookup_key: spec.lookupKey,
        metadata: { plan_cycle: 'annual', discount: '0.10', created_by: 'ownerview-pricing-20260727' },
      });
      console.log(`   ✔ 생성 → ${spec.env} = ${price.id}  (${won(spec.amount)}원/년)`);
      envLines.push(`${spec.env}=${price.id}`);
      created++;
    }
  }

  if (envLines.length > 0) {
    console.log('\n──────── Vercel 환경변수에 넣을 값 ────────');
    envLines.forEach((l) => console.log(l));
    console.log('───────────────────────────────────────────');
  }
  console.log(`\n완료: 생성 ${created}건 · 기존 재사용 ${skipped}건${APPLY ? '' : ' (미리보기였습니다)'}\n`);
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
