-- 현금영수증 매입세액 공제 여부 — 국세청이 준 공제/불공제 구분을 메모 문자열에만 넣고 있어 '매입세액 공제' 숫자가 불공제까지 합산했다.
begin;
alter table public.cash_receipts add column if not exists is_deductible boolean;
comment on column public.cash_receipts.is_deductible is '국세청 공제 구분(true 공제 / false 불공제 / null 미상). 매입 현금영수증만 의미 있음';
update public.cash_receipts set is_deductible = case when memo like '%불공제%' then false when memo like '%공제%' then true end
 where is_deductible is null and source = 'hometax_sync' and type = 'expense' and memo is not null;
commit;
