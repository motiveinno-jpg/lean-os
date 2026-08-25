-- ── 재고 5단계 — 채널(온라인 판매처) 연동 (2026-08-25 사장님 지시) ────────────
--
--   무엇을 기준으로 판단하는가 —
--     채널 연동에서 가장 무서운 것은 API 가 없는 것이 아니라 **같은 주문을 두 번 넣는 것**이다.
--     두 번 넣으면 재고가 두 번 빠지고, 그 사실을 아무도 모른다.
--     그래서 이 단계의 뼈대는 '무엇을 이미 가져왔는가'를 적어 두는 표 하나다.
--
--   ★ 결정 17 — **채널 주문번호로 막는다.** 한 번 가져온 주문번호는 다시 안 들어온다(unique).
--     엑셀을 통째로 다시 붙여도 새 줄만 들어가고 나머지는 '이미 가져옴'으로 건너뛴다.
--   ★ 결정 18 — **API 키가 없어도 오늘 쓸 수 있어야 한다.** 스마트스토어·쿠팡 모두 주문 엑셀을 내려받을 수 있다.
--     엑셀 붙여넣기를 1등 시민으로 두고, API 자동 수집은 키가 들어오면 같은 자리에 붙인다.
--     (네이버 커머스API·쿠팡 윙 API 키는 판매자 본인이 신청해야 해서 우리가 대신 못 만든다.)
--   ★ 결정 19 — 채널 상품코드 ↔ 우리 SKU 는 **사람이 한 번 이어 준다**(product_channel_codes, 1단계에 미리 만든 표).
--     이름으로 알아서 맞히면 비슷한 이름끼리 잘못 붙고, 그 잘못이 재고로 바로 간다.

-- ── 무엇을 이미 가져왔는가 ────────────────────────────────────────────────────
create table if not exists public.channel_order_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null,                          -- smartstore · coupang · eleven · own · etc
  channel_order_no text not null,                 -- 채널이 준 주문번호
  order_date date,
  buyer_name text,
  amount numeric,
  --   이 주문이 어느 출고 문서로 들어갔는가. 문서를 지워도 '가져왔다'는 사실은 남는다.
  doc_id uuid references public.stock_docs(id) on delete set null,
  imported_by uuid references public.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  --   ★ 결정 17 — 두 번 넣는 것을 여기서 막는다
  unique (company_id, channel, channel_order_no)
);
create index if not exists idx_coi_company on public.channel_order_imports(company_id, imported_at desc);
create index if not exists idx_coi_doc on public.channel_order_imports(doc_id) where doc_id is not null;

-- ── 채널 상품코드에 쓰기 편한 칸을 더한다 (표는 1단계에 있음) ──────────────────
alter table public.product_channel_codes add column if not exists channel_product_name text;
alter table public.product_channel_codes add column if not exists is_active boolean not null default true;
alter table public.product_channel_codes add column if not exists updated_at timestamptz not null default now();

--   채널 상품코드로 SKU 를 찾을 때 쓰는 길
create index if not exists idx_pcc_lookup
  on public.product_channel_codes(company_id, channel, channel_product_id);

-- ── RLS — 형제 표와 같은 짝 ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['channel_order_imports'] loop
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

comment on table public.channel_order_imports is '채널에서 이미 가져온 주문. 같은 주문번호를 두 번 넣지 못하게 막는 것이 이 표의 목적이다(결정 17) — 재고 5단계';
comment on column public.product_channel_codes.channel_product_name is '채널에 걸린 상품 이름 — 사람이 눈으로 맞는지 확인하는 용도. 이름으로 자동 연결하지는 않는다(결정 19)';
