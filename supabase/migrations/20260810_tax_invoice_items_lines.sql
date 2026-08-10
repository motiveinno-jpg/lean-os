-- 계산서 한 장에 품목 여러 줄 (2026-08-10 사장님 지시).
--   줄 = {name, spec, qty, unitCost, supplyAmount}. 합계(supply_amount·tax_amount·total_amount)는
--   그대로 두어 목록·손익·부가세 화면을 건드리지 않는다. 비어 있으면 예전처럼 item_name 한 줄로 본다.
alter table public.tax_invoices
  add column if not exists items jsonb not null default '[]'::jsonb;

comment on column public.tax_invoices.items is
  '품목 줄 배열 [{name, spec, qty, unitCost, supplyAmount}] — 비면 item_name 한 줄로 취급';
