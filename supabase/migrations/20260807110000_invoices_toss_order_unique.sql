-- 같은 토스 주문번호로 청구서가 두 줄 생기는 것 차단 (2026-08-07 실결제 검증에서 발견).
--   토스는 멱등키 재요청에 "원래 결제 응답"을 그대로 돌려준다 — 돈은 한 번만 빠지지만
--   코드가 그대로 insert 하면 청구서만 중복돼 매출이 2배로 보인다.
--   코드에서도 사전 확인하지만, 동시 실행까지 막으려면 DB 제약이 최종 방어선이다.
--   (부분 인덱스 — Stripe 행은 toss_order_id 가 NULL 이라 대상에서 빠진다)
create unique index if not exists idx_invoices_toss_order_id_uniq
  on public.invoices (toss_order_id)
  where toss_order_id is not null;
