-- 이커머스 출고에 필요한 배송 정보 (2026-08-26 사장님 지시 — "배송 요청사항, 주문자 정보(연락처, 주소) 등을 가져와야 의미가 있다")
alter table public.channel_order_imports
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists address text,
  add column if not exists shipping_note text;
comment on column public.channel_order_imports.address is '수취인 주소 — 출고(송장) 처리용. 개인정보라 회사 RLS 안에서만 읽힌다';
