-- ── 재고 2단계 — 판매(주문 · 출고) (2026-08-25 사장님 지시) ──────────────────
--
--   무엇을 기준으로 판단하는가 —
--     이 화면의 중심은 **주문(약속)** 이고 출고(사실)는 그 뒤를 따른다.
--     그래서 새로 생기는 정보는 수량이 아니라 **판매가능수량 = 현재고 − 아직 안 나간 주문**이다.
--     "지금 이거 팔 수 있나"에 답하는 것이 2단계가 존재하는 이유다.
--
--   ★ 결정 5(1단계) 그대로 — **주문 없이도 출고가 선다.** 현장·온라인 판매가 그렇다.
--     그래서 stock_docs.sales_order_id 는 여전히 비어 있어도 된다. '바로 출고'는 예외가 아니라 1등 시민이다.
--   ★ 결정 12 — **출고 수량을 주문 줄에 적어 두지 않는다.** shipped_qty 같은 칸을 만들면
--     그 숫자가 왜 그렇게 됐는지 다시 설명할 수 없다(결정 3과 같은 이유).
--     대신 stock_moves 에 order_line_id 를 달아 **움직인 기록의 합**으로 낸다.
--   ★ 결정 13 — 주문은 지우지 않고 **취소**한다. 이미 나간 것이 있는 주문은 취소도 막는다
--     (물건은 나갔는데 약속만 사라지면 장부가 거짓말을 한다).

-- ── 판매 주문 (약속) ──────────────────────────────────────────────────────────
create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_no text not null,                        -- SO-260825-01
  order_date date not null default (now() at time zone 'Asia/Seoul')::date,
  due_date date,                                 -- 주기로 한 날
  partner_id uuid references public.partners(id) on delete set null,
  partner_name text,                             -- 거래처를 안 만들고 이름만 적는 경우(온라인 주문)
  warehouse_id uuid references public.warehouses(id) on delete set null,
  --   open = 아직 다 안 나감 · done = 다 나감 · cancelled = 취소
  status text not null default 'open' check (status in ('open','done','cancelled')),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, order_no)
);
create index if not exists idx_sales_orders_company_date on public.sales_orders(company_id, order_date desc);
create index if not exists idx_sales_orders_status on public.sales_orders(company_id, status);

create table if not exists public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric not null check (qty > 0),          -- 팔기로 한 수량. 되돌리는 것은 출고 쪽 음수로 한다(결정 8)
  unit_price numeric,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sol_order on public.sales_order_lines(order_id);
create index if not exists idx_sol_product on public.sales_order_lines(company_id, product_id);

-- ── 출고를 주문 줄에 붙인다 (결정 12) ─────────────────────────────────────────
alter table public.stock_moves add column if not exists order_line_id uuid
  references public.sales_order_lines(id) on delete set null;
create index if not exists idx_stock_moves_orderline on public.stock_moves(order_line_id)
  where order_line_id is not null;

-- ── 주문 줄별 나간 수량 = 붙은 움직임의 합 ────────────────────────────────────
--   출고는 음수로 쌓이므로 부호를 뒤집어 '나간 수량'으로 읽는다.
--   반품(음수 출고 = 양수 움직임)이 붙으면 나간 수량이 도로 줄어든다 — 그게 맞다.
create or replace view public.v_sales_line_shipped as
select l.company_id, l.order_id, l.id as order_line_id, l.product_id,
       l.qty as ordered_qty,
       coalesce(-sum(m.qty), 0)::numeric as shipped_qty
from public.sales_order_lines l
left join public.stock_moves m on m.order_line_id = l.id
group by l.company_id, l.order_id, l.id, l.product_id, l.qty;
alter view public.v_sales_line_shipped set (security_invoker = on);

-- ── 판매가능수량 = 현재고 − 아직 안 나간 주문 ─────────────────────────────────
--   ★ 이 뷰가 2단계의 결론이다. "재고는 100인데 90이 이미 팔렸다"를 여기서 본다.
--   취소된 주문은 빠진다. 다 나간 줄도 남은 수량이 0 이라 저절로 빠진다.
create or replace view public.v_stock_available as
with reserved as (
  select l.company_id, l.product_id, o.warehouse_id,
         sum(greatest(s.ordered_qty - s.shipped_qty, 0))::numeric as reserved_qty
  from public.sales_order_lines l
  join public.sales_orders o on o.id = l.order_id
  join public.v_sales_line_shipped s on s.order_line_id = l.id
  where o.status <> 'cancelled'
  group by l.company_id, l.product_id, o.warehouse_id
)
select coalesce(h.company_id, r.company_id) as company_id,
       coalesce(h.product_id, r.product_id) as product_id,
       coalesce(h.warehouse_id, r.warehouse_id) as warehouse_id,
       coalesce(h.qty, 0)::numeric as onhand_qty,
       coalesce(r.reserved_qty, 0)::numeric as reserved_qty,
       (coalesce(h.qty, 0) - coalesce(r.reserved_qty, 0))::numeric as available_qty
from public.v_stock_onhand h
full outer join reserved r
  on r.company_id = h.company_id and r.product_id = h.product_id
 and r.warehouse_id is not distinct from h.warehouse_id;
alter view public.v_stock_available set (security_invoker = on);

-- ── RLS — 1단계 형제 표와 같은 짝 ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['sales_orders','sales_order_lines'] loop
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

comment on table public.sales_orders is '판매 주문(약속). 주문 없이도 출고가 선다 — 이 표는 필수가 아니다 (재고 2단계)';
comment on view public.v_stock_available is '판매가능수량 = 현재고 − 아직 안 나간 주문. 2단계가 주는 새 정보';
comment on column public.stock_moves.order_line_id is '이 움직임이 어느 주문 줄을 채웠는가. 나간 수량을 주문에 적어 두지 않고 여기 합으로 낸다(결정 12)';
