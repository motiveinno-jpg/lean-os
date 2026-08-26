-- 출고 처리 · 송장 (2026-08-26 사장님 지시 ② — "이커머스는 출고 처리를 해야 한다")
--   상태: pending(출고 대기) → shipped(발송) → done(배송 완료). 취소는 전표 취소가 맡는다.
alter table public.channel_order_imports
  add column if not exists ship_status text not null default 'pending' check (ship_status in ('pending','shipped','done')),
  add column if not exists carrier text,
  add column if not exists tracking_no text,
  add column if not exists shipped_at timestamptz,
  add column if not exists shipped_by uuid references public.users(id) on delete set null,
  add column if not exists delivered_at timestamptz;
create index if not exists idx_channel_order_imports_ship on public.channel_order_imports(company_id, ship_status);
comment on column public.channel_order_imports.ship_status is '출고 상태 — pending 출고 대기 · shipped 발송(송장 있음) · done 배송 완료';
