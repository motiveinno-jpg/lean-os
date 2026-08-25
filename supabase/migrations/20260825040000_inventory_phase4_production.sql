-- ── 재고 4단계 — 생산(자재구성 · 작업지시) (2026-08-25 사장님 지시) ───────────
--
--   앞의 셋과 성격이 다르다 — **거래처도 계산서도 없다.** 안에서 일어나는 일이다.
--   무엇을 기준으로 판단하는가 —
--     생산 한 건은 '완제품이 느는 것'이 아니라 **자재가 빠지면서 완제품이 느는 것**이다.
--     둘 중 하나만 일어나면 그 순간 재고가 거짓말을 한다. 그래서 완성은 언제나 **두 문서를 같이** 세운다.
--
--   ★ 결정 14 — 완성 한 번에 **자재 출고(MTL) + 완제품 입고(PRD) 두 문서**를 세우고 작업지시로 묶는다.
--     한 문서에 +와 −를 섞지 않는 이유: 사유의 부호가 문서를 정하는 규칙(1단계)을 깨지 않기 위해서다.
--     이력에서도 "자재가 나갔다 / 완제품이 들어왔다"로 따로 읽혀 이해하기 쉽다.
--   ★ 결정 15 — **BOM 이 없으면 자재를 빼지 않는다.** 없는 걸 지어내지 않는다.
--     자재를 안 세는 회사(단순 조립·수제)는 완제품만 늘리면 된다 — 화면이 그렇게 적는다.
--   ★ 결정 16 — 자재가 모자라도 **막지 않는다**(결정 7과 같다). 이미 만든 것을 못 적게 하면 장부를 포기한다.
--     대신 만들기 전에 '모자란 자재'를 보여 주고, 만든 뒤에는 음수가 '맞춰야 할 것'으로 선다.

-- ── 사유 두 개를 더한다 ───────────────────────────────────────────────────────
alter table public.stock_docs drop constraint if exists stock_docs_reason_check;
alter table public.stock_docs add constraint stock_docs_reason_check check (reason in (
  'purchase','sale','sample','gift','disposal','move','return_in','return_out','opening','count','fix',
  'produce','consume'
));

-- ── 자재구성 (BOM) ────────────────────────────────────────────────────────────
--   머리 표를 따로 두지 않는다 — 줄이 하나라도 있으면 그 품목은 BOM 이 있는 것이다.
--   버전 관리도 넣지 않았다. 바뀌면 줄을 고친다(지난 생산 기록은 이미 움직임으로 남아 있어 안 흔들린다).
create table if not exists public.product_boms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,        -- 만들 것
  component_id uuid not null references public.products(id) on delete restrict,     -- 들어갈 것
  qty numeric not null check (qty > 0),          -- 완제품 1개에 드는 양
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, component_id),
  --   자기 자신을 자재로 넣으면 무한히 파고든다
  constraint bom_not_self check (product_id <> component_id)
);
create index if not exists idx_bom_product on public.product_boms(company_id, product_id);
create index if not exists idx_bom_component on public.product_boms(company_id, component_id);

-- ── 작업지시 ──────────────────────────────────────────────────────────────────
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  wo_no text not null,                           -- WO-260825-01
  product_id uuid not null references public.products(id) on delete restrict,
  planned_qty numeric not null check (planned_qty > 0),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  order_date date not null default (now() at time zone 'Asia/Seoul')::date,
  due_date date,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, wo_no)
);
create index if not exists idx_wo_company_date on public.work_orders(company_id, order_date desc);
create index if not exists idx_wo_status on public.work_orders(company_id, status);

-- ── 완성한 것을 작업지시에 묶는다 ─────────────────────────────────────────────
alter table public.stock_docs add column if not exists work_order_id uuid
  references public.work_orders(id) on delete set null;
create index if not exists idx_stock_docs_wo on public.stock_docs(work_order_id)
  where work_order_id is not null;

-- ── 지시별 완성 수량 = 그 지시로 들어온 완제품의 합 (결정 12와 같은 방식) ─────
--   완제품 줄만 센다 — 같은 지시에 자재 줄도 붙어 있기 때문이다.
create or replace view public.v_work_order_done as
select w.company_id, w.id as work_order_id, w.product_id, w.planned_qty,
       coalesce(sum(m.qty) filter (where m.product_id = w.product_id), 0)::numeric as done_qty
from public.work_orders w
left join public.stock_docs d on d.work_order_id = w.id and d.reason = 'produce'
left join public.stock_moves m on m.doc_id = d.id
group by w.company_id, w.id, w.product_id, w.planned_qty;
alter view public.v_work_order_done set (security_invoker = on);

-- ── RLS — 형제 표와 같은 짝 ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['product_boms','work_orders'] loop
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

comment on table public.product_boms is '자재구성(BOM) — 완제품 1개에 드는 자재의 양. 줄이 있으면 BOM 이 있는 것이다 (재고 4단계)';
comment on table public.work_orders is '작업지시. 완성하면 자재 출고(MTL)와 완제품 입고(PRD) 두 문서가 같이 선다(결정 14)';
comment on view public.v_work_order_done is '지시별 완성 수량 — 그 지시로 들어온 완제품 움직임의 합';
