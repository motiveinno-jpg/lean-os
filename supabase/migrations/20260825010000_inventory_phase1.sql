-- ── 재고 1단계 — 품목 · 재고 (2026-08-25 사장님 지시) ──────────────────────────
--   기획: https://claude.ai/code/artifact/afc625ae-c5b5-4b7b-9b51-fdcf3e93165a
--
--   결정 3 — **재고 수량을 저장하지 않는다.** 움직인 기록(stock_moves)만 쌓고 현재고는 그 합이다.
--     수량 칸을 직접 고치면 "왜 이 숫자가 됐는지" 아무도 설명할 수 없다. 오너뷰가 장부를 다루는 방식과 같다
--     (잔액을 고치지 않고 전표를 쌓는다).
--   결정 5 — **약속과 사실을 가른다.** 주문·발주(약속) 없이도 입·출고(사실)가 선다 →
--     stock_docs 의 sales_order_id / purchase_order_id 는 **비워 둘 수 있다**.
--   결정 6-④ — products.track_stock: 수량을 세는 품목인가. 서비스·용역은 꺼서 재고에 안 잡히게 한다.
--   결정 8 — 지우지 않고 부호로 남긴다. 반품·정정은 original_doc_id 로 원본을 가리키는 **새 문서**다.
--   구멍 ① (이커머스) — product_channel_codes 는 **표만** 미리 만든다(화면은 5단계).
--     나중에 만들려면 품목표를 갈아엎어야 한다.

-- ── 품목 ───────────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null,
  name text not null,
  category text,
  spec text,                                    -- 규격·옵션 (블랙 / M)
  unit text not null default 'EA',
  barcode text,
  --   결정 6-④ — 끄면 재고에 잡히지 않는다(설치비·배송비·용역·구독). 주문·계산서에는 그대로 오른다.
  track_stock boolean not null default true,
  sale_price numeric,
  cost_price numeric,
  safety_stock numeric,                         -- 이 아래로 내려가면 '부족'
  is_active boolean not null default true,
  memo text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sku)
);
create index if not exists idx_products_company on public.products(company_id);
create index if not exists idx_products_barcode on public.products(company_id, barcode) where barcode is not null;

-- ── 창고 ───────────────────────────────────────────────────────────────────────
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  memo text,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists idx_warehouses_company on public.warehouses(company_id);

-- ── 움직임 문서 (입고·출고·조정·이동 한 건) ───────────────────────────────────
create table if not exists public.stock_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc_no text not null,                         -- IN-260825-01 · OUT-… · ADJ-… · MOV-…
  kind text not null check (kind in ('in','out','adjust','move')),
  --   사유 — 나가는 것이 다 판매는 아니다(결정 5). 없으면 매출원가와 손실이 뒤섞인다.
  reason text not null check (reason in (
    'purchase','sale','sample','gift','disposal','move','return_in','return_out','opening','count','fix'
  )),
  doc_date date not null default (now() at time zone 'Asia/Seoul')::date,
  partner_id uuid references public.partners(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  to_warehouse_id uuid references public.warehouses(id) on delete set null,   -- 창고 이동 대상
  --   결정 8 — 반품·정정이 가리키는 원본. 원본은 **지우지 않는다.**
  original_doc_id uuid references public.stock_docs(id) on delete set null,
  --   결정 5 — 약속 없이도 사실이 선다. 2·3단계에서 주문·발주가 생기면 채워진다(그때도 필수 아님).
  sales_order_id uuid,
  purchase_order_id uuid,
  --   돈 쪽은 이미 있는 것을 가리킨다 — 재고 표에 금액·거래처를 베껴 두지 않는다.
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  tax_invoice_id uuid references public.tax_invoices(id) on delete set null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, doc_no)
);
create index if not exists idx_stock_docs_company_date on public.stock_docs(company_id, doc_date desc);
create index if not exists idx_stock_docs_original on public.stock_docs(original_doc_id) where original_doc_id is not null;

-- ── 움직인 기록 (그 문서의 품목 줄) ────────────────────────────────────────────
create table if not exists public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc_id uuid not null references public.stock_docs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  --   ★ 부호가 있다: 입고 +, 출고 −. 결정 8에 따라 사람이 음수를 직접 넣을 수도 있다.
  qty numeric not null check (qty <> 0),
  unit_price numeric,
  amount numeric,
  moved_at date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_moves_company_product on public.stock_moves(company_id, product_id);
create index if not exists idx_stock_moves_doc on public.stock_moves(doc_id);
create index if not exists idx_stock_moves_moved_at on public.stock_moves(company_id, moved_at desc);

-- ── 현재고 = 움직인 기록의 합 (결정 3) ────────────────────────────────────────
create or replace view public.v_stock_onhand as
select company_id, product_id, warehouse_id, sum(qty)::numeric as qty
from public.stock_moves
group by company_id, product_id, warehouse_id;
--   ★ 뷰는 기본이 '뷰 주인 권한'이라 밑 표의 RLS 를 **우회한다**(회사 격리가 뚫린다).
--     security_invoker 를 켜서 stock_moves 의 RLS 를 그대로 따르게 한다. 뷰 만들 때마다 확인할 것.
alter view public.v_stock_onhand set (security_invoker = on);

-- ── 재고조사(실사) ─────────────────────────────────────────────────────────────
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  count_date date not null default (now() at time zone 'Asia/Seoul')::date,
  status text not null default 'draft' check (status in ('draft','done')),
  --   실사를 반영하면 '조정' 문서가 하나 선다 — 차이를 지우지 않고 기록으로 남긴다(결정 3)
  adjust_doc_id uuid references public.stock_docs(id) on delete set null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stock_counts_company on public.stock_counts(company_id, count_date desc);

create table if not exists public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  system_qty numeric not null default 0,        -- 조사 시점 장부 수량
  counted_qty numeric,                          -- 실제로 센 수량
  created_at timestamptz not null default now(),
  unique (count_id, product_id)
);
create index if not exists idx_stock_count_lines_count on public.stock_count_lines(count_id);

-- ── 채널 상품코드 (구멍 ① — 표만, 화면은 5단계) ───────────────────────────────
create table if not exists public.product_channel_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  channel text not null,                        -- smartstore · coupang · cafe24 …
  channel_product_id text not null,
  channel_sku text,
  created_at timestamptz not null default now(),
  unique (company_id, channel, channel_product_id)
);
create index if not exists idx_pcc_product on public.product_channel_codes(product_id);

-- ── RLS — 형제 표(recurring_payments 등)와 같은 정책 짝: 회사 격리 + 세무사 세션 읽기 전용 ──
do $$
declare t text;
begin
  foreach t in array array[
    'products','warehouses','stock_docs','stock_moves','stock_counts','stock_count_lines','product_channel_codes'
  ] loop
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

comment on table public.products is '재고 품목(SKU). track_stock=false 면 재고에 안 잡힌다(서비스·용역) — 2026-08-25 재고 1단계';
comment on table public.stock_moves is '재고 움직인 기록(부호 있음). 현재고는 v_stock_onhand 로 이 합을 낸다 — 수량을 따로 저장하지 않는다';
comment on table public.stock_docs is '재고 움직임 문서(입고·출고·조정·이동). 주문·발주 없이도 선다(결정 5), 반품·정정은 original_doc_id 로 원본을 가리킨다(결정 8)';
