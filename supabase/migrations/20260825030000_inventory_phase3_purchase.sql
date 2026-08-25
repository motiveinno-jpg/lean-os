-- ── 재고 3단계 — 구매(발주 · 입고) (2026-08-25 사장님 지시) ──────────────────
--
--   판매(2단계)의 거울상이지만 **두 가지가 다르다.**
--     ① 판매는 '팔 수 있는 양'을 빼지만, 구매는 '들어올 것'을 더한다.
--        들어올 것은 아직 없는 물건이라 **판매가능수량에는 넣지 않는다** — 넣으면 없는 걸 판다.
--        따로 보여 주는 이유는 하나, **또 발주하는 것을 막기 위해서**다.
--     ② 그래서 '부족한 품목 채우기'가 발주 화면에만 있다 — 모자란 만큼을 세어 줄로 깔아 준다.
--        그때 모자란 양은 (안전재고 − 현재고 − 들어올 것)이다. 이미 시킨 것을 빼지 않으면 두 번 시킨다.
--
--   ★ 결정 5 그대로 — **발주 없이도 입고가 선다.** 시장에서 사 온 것은 발주서가 없다.
--   ★ 결정 12 그대로 — 받은 수량을 발주 줄에 적어 두지 않는다. stock_moves.po_line_id 의 합으로 읽는다.
--   ★ 결정 13 그대로 — 발주는 지우지 않고 취소한다. 이미 받은 것이 있으면 취소도 막는다.

-- ── 발주 (약속) ───────────────────────────────────────────────────────────────
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  po_no text not null,                           -- PO-260825-01
  order_date date not null default (now() at time zone 'Asia/Seoul')::date,
  due_date date,                                 -- 받기로 한 날
  partner_id uuid references public.partners(id) on delete set null,
  partner_name text,                             -- 거래처를 안 만들고 이름만 적는 경우
  warehouse_id uuid references public.warehouses(id) on delete set null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, po_no)
);
create index if not exists idx_po_company_date on public.purchase_orders(company_id, order_date desc);
create index if not exists idx_po_status on public.purchase_orders(company_id, status);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric not null check (qty > 0),
  unit_price numeric,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pol_order on public.purchase_order_lines(order_id);
create index if not exists idx_pol_product on public.purchase_order_lines(company_id, product_id);

-- ── 입고를 발주 줄에 붙인다 (결정 12) ─────────────────────────────────────────
alter table public.stock_moves add column if not exists po_line_id uuid
  references public.purchase_order_lines(id) on delete set null;
create index if not exists idx_stock_moves_poline on public.stock_moves(po_line_id)
  where po_line_id is not null;

-- ── 발주 줄별 받은 수량 = 붙은 움직임의 합 ────────────────────────────────────
--   입고는 양수로 쌓이므로 그대로 읽는다. 반품 출고(음수)가 붙으면 받은 수량이 도로 줄어든다.
create or replace view public.v_purchase_line_received as
select l.company_id, l.order_id, l.id as po_line_id, l.product_id,
       l.qty as ordered_qty,
       coalesce(sum(m.qty), 0)::numeric as received_qty
from public.purchase_order_lines l
left join public.stock_moves m on m.po_line_id = l.id
group by l.company_id, l.order_id, l.id, l.product_id, l.qty;
alter view public.v_purchase_line_received set (security_invoker = on);

-- ── 들어올 것 = 발주했는데 아직 안 받은 것 ────────────────────────────────────
--   ★ 판매가능수량과 **합치지 않는다.** 아직 창고에 없는 물건이다.
--     이 숫자의 쓸모는 하나 — 부족한 품목을 채울 때 **이미 시킨 것을 빼는 것**이다.
create or replace view public.v_stock_incoming as
select l.company_id, l.product_id, o.warehouse_id,
       sum(greatest(r.ordered_qty - r.received_qty, 0))::numeric as incoming_qty
from public.purchase_order_lines l
join public.purchase_orders o on o.id = l.order_id
join public.v_purchase_line_received r on r.po_line_id = l.id
where o.status <> 'cancelled'
group by l.company_id, l.product_id, o.warehouse_id;
alter view public.v_stock_incoming set (security_invoker = on);

-- ── RLS — 형제 표와 같은 짝 ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_lines'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_company', t);
    execute format($f$create policy %I on public.%I for all
      using (company_id = (select public.get_my_company_id()))
      with check (company_id = (select public.get_my_company_id()))$f$, t || '_company', t);

    execute format('drop policy if exists advisor_ro_ins on public.%I', t);
    execute format('create policy advisor_ro_ins on public.%I for insert with check (not (select public.is_advisor_session()))', t);

    execute format('drop policy if exists advisor_ro_upd on public.%I', t);
    execute format('create policy advisor_ro_upd on public.%I for update using (not (select public.is_advisor_session()))', t);

    execute format('drop policy if exists advisor_ro_del on public.%I', t);
    execute format('create policy advisor_ro_del on public.%I for delete using (not (select public.is_advisor_session()))', t);
  end loop;
end $$;

comment on table public.purchase_orders is '발주(약속). 발주 없이도 입고가 선다 — 이 표는 필수가 아니다 (재고 3단계)';
comment on view public.v_stock_incoming is '들어올 것 = 발주했는데 아직 안 받은 것. 판매가능수량에는 넣지 않는다(아직 없는 물건이다)';
comment on column public.stock_moves.po_line_id is '이 움직임이 어느 발주 줄을 채웠는가. 받은 수량을 발주에 적어 두지 않고 여기 합으로 낸다(결정 12)';
