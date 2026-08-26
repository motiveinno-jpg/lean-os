-- 자재구성 기준 수량 (2026-08-26 사장님: "1개당 수량이 떨어지지 않는 경우가 있다 — 무조건 1개당은 별로")
--   소요량은 '완제품 base_qty 개당' 값. 실제 소비 = qty / base_qty × 완성 수량. 기존 줄은 1(=1개당)이라 그대로.
alter table public.product_boms add column if not exists base_qty numeric not null default 1 check (base_qty > 0);
comment on column public.product_boms.base_qty is '기준 수량 — 소요량(qty)은 완제품 base_qty 개당 값. 소비 = qty/base_qty × 완성 수량';
