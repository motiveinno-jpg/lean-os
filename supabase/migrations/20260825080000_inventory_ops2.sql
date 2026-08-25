-- ── 재고 2순위 — 전표 취소 흔적 · 거래처별 단가 · 이동평균 원가 (2026-08-25 사장님 지시) ──
--
--   ★ 결정 25 — 재고 전표는 **지우지 않고 취소한다.** 지우면 재고는 되돌아가지만 누가 언제 왜 지웠는지 안 남는다.
--     status='cancelled' 로 두고 줄(stock_moves)은 그대로 둔다. 현재고를 내는 뷰가 취소 전표를 빼고 센다.
--     (1단계 결정 8 "지우지 않고 부호로 남긴다"와 같은 원칙 — 삭제는 장부에 없다)
--   ★ 결정 26 — 거래처별 단가는 **따로 관리 화면을 두지 않는다.** 판매·구매를 저장할 때 그 거래처·품목의
--     마지막 단가가 저절로 남고, 다음에 그 거래처를 고르면 그 단가가 먼저 채워진다(채워만 주고 정하는 것은 사람).
--   ★ 결정 27 — 원가는 **이동평균**으로 낸다. 품목의 매입가 하나로 고정하면 단가가 바뀌는 회사는 마진이 틀어진다.
--     매입·기초 입고 줄의 (수량×단가)합 ÷ 수량합. 단가 없는 줄은 셈에서 뺀다. 없으면 품목 매입가로 돌아간다.

-- ── 전표 취소 ─────────────────────────────────────────────────────────────────
alter table public.stock_docs add column if not exists status text not null default 'active'
  check (status in ('active','cancelled'));
alter table public.stock_docs add column if not exists cancelled_at timestamptz;
alter table public.stock_docs add column if not exists cancelled_by uuid references public.users(id) on delete set null;
alter table public.stock_docs add column if not exists cancel_reason text;
create index if not exists idx_stock_docs_status on public.stock_docs(company_id, status);

--   현재고 = **살아 있는** 전표의 줄 합 (결정 3 + 결정 25)
create or replace view public.v_stock_onhand as
select m.company_id, m.product_id, m.warehouse_id, sum(m.qty)::numeric as qty
from public.stock_moves m
join public.stock_docs d on d.id = m.doc_id and d.status = 'active'
group by m.company_id, m.product_id, m.warehouse_id;
alter view public.v_stock_onhand set (security_invoker = on);

create or replace view public.v_order_line_used as
select l.company_id, l.order_id, l.id as order_line_id, l.product_id,
       l.qty as ordered_qty,
       coalesce(sum(abs(m.qty)), 0)::numeric as used_qty
from public.order_lines l
left join public.stock_moves m on m.order_line_id = l.id
left join public.stock_docs d on d.id = m.doc_id
where d.id is null or d.status = 'active'
group by l.company_id, l.order_id, l.id, l.product_id, l.qty;
alter view public.v_order_line_used set (security_invoker = on);

-- ── 이동평균 원가 (결정 27) ────────────────────────────────────────────────────
create or replace view public.v_stock_avg_cost as
select m.company_id, m.product_id,
       (sum(m.qty * m.unit_price) / nullif(sum(m.qty), 0))::numeric as avg_cost,
       sum(m.qty)::numeric as priced_qty
from public.stock_moves m
join public.stock_docs d on d.id = m.doc_id and d.status = 'active'
where d.reason in ('purchase', 'opening', 'produce') and m.qty > 0 and m.unit_price is not null and m.unit_price > 0
group by m.company_id, m.product_id;
alter view public.v_stock_avg_cost set (security_invoker = on);

-- ── 거래처별 단가 (결정 26) ────────────────────────────────────────────────────
create table if not exists public.partner_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  side text not null check (side in ('sale','buy')),
  unit_price numeric not null,
  last_doc_id uuid references public.stock_docs(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (company_id, partner_id, product_id, side)
);
create index if not exists idx_partner_prices_lookup on public.partner_prices(company_id, partner_id, side);

do $$
declare t text;
begin
  foreach t in array array['partner_prices'] loop
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

comment on column public.stock_docs.status is '취소 전표는 줄을 남긴 채 status=cancelled — 현재고 뷰가 빼고 센다(결정 25)';
comment on table public.partner_prices is '거래처별 마지막 거래 단가 — 판매·구매 저장 때 저절로 남고, 다음 입력에 먼저 채워진다(결정 26)';
comment on view public.v_stock_avg_cost is '이동평균 원가 — 매입·기초·생산 입고 줄의 (수량×단가)합 ÷ 수량합(결정 27)';
