-- 이커머스 세트·옵션 상품 → 구성품 차감 (2026-09-22 재고 점검 E, docs/20260922_PLAN_inventory_audit_v2.md)
--   채널 상품 하나가 SKU 여러 개로 나갈 때(세트·묶음), 상품 연결에 구성을 적어 두면 채널 주문 저장 때 구성품으로 출고된다.
--   [{"product_id": uuid, "qty": number}] · null/빈 배열이면 예전처럼 product_id 하나로 나간다.
--   생산 BOM(product_boms)과 섞지 않는다 — 세트는 채널 연결의 속성이고, BOM 은 생산의 속성이다.
alter table public.product_channel_codes add column if not exists components jsonb;
comment on column public.product_channel_codes.components is '세트 구성 [{product_id, qty}] — 있으면 채널 주문 저장 때 이 구성품으로 출고(대표 품목은 차감 안 함)';
