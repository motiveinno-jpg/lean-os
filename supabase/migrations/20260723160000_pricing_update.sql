-- 가격 정책 개편 (2026-07-23) — 프로/울트라 정상가·할인가·기본좌석 도입.
--   ⚠️ subscription_plans(설정 테이블) 값 변경. 고객 구독 데이터는 변경 안 함.
--   기존 활성 Stripe 구독의 실제 청구가는 소급 변경하지 않는다(Stripe Price 기준). 이 표는 표시·신규 checkout 계산용.
--   신규 구독부터 새 Stripe Price 사용. 코드·랜딩·Stripe Price·Vercel env 와 함께 배포.

-- 정상가(취소선 표시용) + 기본 포함 좌석 컬럼
alter table public.subscription_plans add column if not exists list_price numeric;
alter table public.subscription_plans add column if not exists included_seats integer;

-- 프로(basic slug 유지 — 표시명만 '프로'). VAT 별도, 부가세 10% 별도 청구.
update public.subscription_plans
  set name = '프로', list_price = 158900, base_price = 79500,
      per_seat_price = 10000, included_seats = 5, is_active = true
  where slug = 'basic';

-- 울트라
update public.subscription_plans
  set name = '울트라', list_price = 220000, base_price = 110000,
      per_seat_price = 10000, included_seats = 5, is_active = true
  where slug = 'ultra';
