-- ── 재고 — 주문서를 하나로 모으고, 양식을 회사가 만든다 (2026-08-25 사장님 지시) ──
--
--   사장님 지시 —
--     ① 주문(견적)을 판매와 **다른 메뉴**로 가른다. 메뉴 차례는 주문 · 판매 · 구매 · 생산.
--     ② 주문에서 친 전표를 **판매·구매·생산에서 각각 불러와** 바로 저장한다.
--     ③ **주문에서 친 것은 재고수량에 반영되지 않는다.**
--     ④ 회사마다 쓰는 양식이 달라 **칸을 자유롭게 켜고 끄고 만들 수 있어야** 한다
--        (주문서 전체에 쓰는 비고 / 품목마다 쓰는 비고가 따로 있다).
--     ⑤ 칸 설정은 **회사 하나에 하나**. 직접 만든 칸의 값은 **나중에 찾을 수 있게** 저장한다.
--
--   ★ 결정 20 — 주문서는 **표가 하나**여야 한다.
--     셋이 같은 문서를 불러가는데 표가 둘(sales_orders·purchase_orders)이면 같은 일을 두 곳에서 고치게 된다.
--     그래서 둘을 `orders` 로 합친다. **id 를 그대로 옮겨** 이미 붙어 있는 재고 기록이 안 끊어지게 한다.
--   ★ 결정 21 — 주문은 **재고에 아무 영향이 없다**(지시 ③). 현재고도, 판매가능수량도.
--     그래서 예약·입고예정을 세던 뷰(v_stock_available · v_stock_incoming)를 걷어낸다.
--     재고가 움직이는 것은 판매·구매·생산에서 **불러와 저장할 때**뿐이다.
--   ★ 결정 22 — 직접 만든 칸은 `custom` jsonb 에 **칸 열쇠(field_id)별로** 담고 GIN 을 건다.
--     이름을 바꿔도 값이 안 흔들리고("현장" → "현장명"), `custom->>'f_ab12' = '...'` 로 찾을 수 있다.
--   ★ 결정 23 — 공급가액·부가세를 **줄에 저장한다.** 지금까지 재고는 단가×수량뿐이라
--     계산서·전표와 이을 수가 없었다. 매입매출전표와 같은 뼈대를 여기서 갖춘다.

-- ── 주문서 ────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_no text not null,                        -- SO-260825-01
  order_date date not null default (now() at time zone 'Asia/Seoul')::date,
  due_date date,
  partner_id uuid references public.partners(id) on delete set null,
  partner_name text,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  --   open = 아직 다 안 쓴 것 · closed = 다 쓴 것 · cancelled = 접은 것
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  note text,
  --   결정 22 — 회사가 만든 머리 칸의 값
  custom jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, order_no)
);
create index if not exists idx_orders_company_date on public.orders(company_id, order_date desc);
create index if not exists idx_orders_status on public.orders(company_id, status);
create index if not exists idx_orders_custom on public.orders using gin (custom);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric not null check (qty > 0),
  unit_price numeric,
  --   결정 23 — 전표와 같은 뼈대. 합계는 저장하지 않는다(둘의 합이라 셀 수 있다).
  supply_amount numeric not null default 0,
  vat_amount numeric not null default 0,
  note text,
  custom jsonb not null default '{}'::jsonb,
  sort_no int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_ol_order on public.order_lines(order_id);
create index if not exists idx_ol_product on public.order_lines(company_id, product_id);
create index if not exists idx_ol_custom on public.order_lines using gin (custom);

-- ── 양식 — 회사 하나에 하나 (지시 ⑤) ──────────────────────────────────────────
--   행이 없으면 코드의 기본 양식을 쓴다. 사람이 손대면 그때 행이 생긴다.
create table if not exists public.form_layouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  form_key text not null check (form_key in ('order','sale','buy','make')),
  section text not null check (section in ('head','line')),
  field_id text not null,                        -- 기본 칸은 'partner' 같은 이름, 만든 칸은 'f_xxx'
  name text not null,                            -- ★ 이름 없이는 만들 수 없다
  sort_no int not null default 0,
  is_on boolean not null default true,
  is_custom boolean not null default false,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (company_id, form_key, section, field_id)
);
create index if not exists idx_form_layouts on public.form_layouts(company_id, form_key, section, sort_no);

-- ── 재고 기록에 부가세와 주문 줄 연결 ─────────────────────────────────────────
alter table public.stock_moves add column if not exists vat_amount numeric;
alter table public.stock_docs add column if not exists order_id uuid;

-- ── 옛 표에서 옮긴다 — **id 를 그대로** 써서 붙어 있는 기록이 안 끊어지게 ────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='sales_orders') then
    insert into public.orders (id, company_id, order_no, order_date, due_date, partner_id, partner_name,
                               warehouse_id, status, note, created_by, created_at, updated_at)
    select o.id, o.company_id, o.order_no, o.order_date, o.due_date, o.partner_id, o.partner_name,
           o.warehouse_id,
           case o.status when 'done' then 'closed' when 'cancelled' then 'cancelled' else 'open' end,
           o.note, o.created_by, o.created_at, o.updated_at
    from public.sales_orders o
    on conflict (id) do nothing;

    insert into public.order_lines (id, company_id, order_id, product_id, qty, unit_price,
                                    supply_amount, vat_amount, note, created_at)
    select l.id, l.company_id, l.order_id, l.product_id, l.qty, l.unit_price,
           coalesce(l.qty * l.unit_price, 0), round(coalesce(l.qty * l.unit_price, 0) * 0.1),
           l.note, l.created_at
    from public.sales_order_lines l
    on conflict (id) do nothing;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='purchase_orders') then
    insert into public.orders (id, company_id, order_no, order_date, due_date, partner_id, partner_name,
                               warehouse_id, status, note, created_by, created_at, updated_at)
    select o.id, o.company_id, o.po_no, o.order_date, o.due_date, o.partner_id, o.partner_name,
           o.warehouse_id,
           case o.status when 'done' then 'closed' when 'cancelled' then 'cancelled' else 'open' end,
           o.note, o.created_by, o.created_at, o.updated_at
    from public.purchase_orders o
    on conflict (id) do nothing;

    insert into public.order_lines (id, company_id, order_id, product_id, qty, unit_price,
                                    supply_amount, vat_amount, note, created_at)
    select l.id, l.company_id, l.order_id, l.product_id, l.qty, l.unit_price,
           coalesce(l.qty * l.unit_price, 0), round(coalesce(l.qty * l.unit_price, 0) * 0.1),
           l.note, l.created_at
    from public.purchase_order_lines l
    on conflict (id) do nothing;
  end if;
end $$;

--   ★ 옮기기 전에 **옛 FK 를 먼저 뗀다.** 안 그러면 발주 줄 id 를 order_line_id 에 넣는 순간
--     "그 id 가 sales_order_lines 에 없다"고 막힌다 — 실제로 한 번 막혔다.
alter table public.stock_moves drop constraint if exists stock_moves_order_line_id_fkey;
alter table public.stock_moves drop constraint if exists stock_moves_po_line_id_fkey;

--   발주 줄을 가리키던 칸을 하나로 모은다 — '어느 주문 줄을 채웠나'는 한 가지 뜻이다
update public.stock_moves set order_line_id = po_line_id
 where po_line_id is not null and order_line_id is null;
update public.stock_docs set order_id = coalesce(sales_order_id, purchase_order_id)
 where order_id is null and (sales_order_id is not null or purchase_order_id is not null);

-- ── 옛 뷰·제약·표를 걷어낸다 ──────────────────────────────────────────────────
--   ★ 결정 21 — 주문은 재고에 영향이 없으므로 예약·입고예정 뷰가 설 자리가 없다.
drop view if exists public.v_stock_available;
drop view if exists public.v_stock_incoming;
drop view if exists public.v_sales_line_shipped;
drop view if exists public.v_purchase_line_received;

alter table public.stock_moves drop column if exists po_line_id;
alter table public.stock_moves
  add constraint stock_moves_order_line_id_fkey
  foreign key (order_line_id) references public.order_lines(id) on delete set null;

alter table public.stock_docs drop constraint if exists stock_docs_sales_order_id_fkey;
alter table public.stock_docs drop constraint if exists stock_docs_purchase_order_id_fkey;
alter table public.stock_docs drop column if exists sales_order_id;
alter table public.stock_docs drop column if exists purchase_order_id;
alter table public.stock_docs
  add constraint stock_docs_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete set null;
create index if not exists idx_stock_docs_order on public.stock_docs(order_id) where order_id is not null;

drop table if exists public.sales_order_lines;
drop table if exists public.sales_orders;
drop table if exists public.purchase_order_lines;
drop table if exists public.purchase_orders;

-- ── 주문 줄이 얼마나 쓰였나 — 붙은 재고 기록의 합 (결정 12 그대로) ───────────
--   판매는 음수(나감), 구매·생산은 양수(들어옴)로 쌓이므로 **절대값**으로 읽는다.
--   주문 하나가 판매로도 구매로도 갈 수 있어 부호를 미리 정할 수 없다.
create or replace view public.v_order_line_used as
select l.company_id, l.order_id, l.id as order_line_id, l.product_id,
       l.qty as ordered_qty,
       coalesce(sum(abs(m.qty)), 0)::numeric as used_qty
from public.order_lines l
left join public.stock_moves m on m.order_line_id = l.id
group by l.company_id, l.order_id, l.id, l.product_id, l.qty;
alter view public.v_order_line_used set (security_invoker = on);

-- ── RLS — 형제 표와 같은 짝 ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['orders','order_lines','form_layouts'] loop
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

comment on table public.orders is '주문서(견적). 판매·구매·생산이 함께 불러가는 씨앗 문서 — 재고에는 아무 영향이 없다(결정 21)';
comment on column public.orders.custom is '회사가 만든 머리 칸의 값. 칸 열쇠(field_id)를 키로 담아 이름을 바꿔도 값이 안 흔들린다(결정 22)';
comment on table public.form_layouts is '입력 양식 — 회사 하나에 하나. 행이 없으면 코드의 기본 양식을 쓴다 (2026-08-25 사장님 지시)';
comment on view public.v_order_line_used is '주문 줄이 얼마나 쓰였나 — 붙은 재고 기록의 절대값 합';
