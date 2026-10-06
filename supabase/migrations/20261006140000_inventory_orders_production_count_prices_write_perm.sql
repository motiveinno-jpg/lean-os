-- 재고 쓰기 권한을 DB 에서도 — 1차: 주문·생산(자재구성·작업지시)·재고 실사·거래처 단가 (2026-10-06 사장님 "1번부터 진행해줘")
--
-- 왜: 재고 표는 *_company(ALL, TO public)로 회사 소속만 봤다. 화면은 메뉴별 「입력·수정」 키(:write / stock:adjust)로
--     보기·쓰기를 가르지만(2026-08-26 대표 "권한 세분화"), API 로는 보기 권한자도 주문서를 지우거나 자재구성을 바꿀 수 있었다.
--
-- 이번 범위 = 쓰는 화면과 키가 하나로 맞는 표만(쓰기 경로 전수: src·supabase/functions·pg_proc, DB 함수·트리거 쓰기 0):
--   orders·order_lines        → /inventory/orders:write      (lib/inventory-orders.ts — 주문 화면 DocScreen canWrite)
--   product_boms·work_orders  → /inventory/production:write  (bom-editor — 품목 화면에서 열림. work_orders 는 앱 쓰기 없음)
--   stock_counts·stock_count_lines → /inventory/stock:adjust (count.tsx — 창고관리 canMove)
--   partner_prices            → side 'sale' = /inventory/sales:write, 'buy' = /inventory/purchase:write
--                                (판매·구매 저장 때 rememberPartnerPrices 가 기억한다)
--   같은 커밋 화면 수정: 주문 마감 버튼(보기 권한자에게도 보였음) · 자재구성 저장(품목 메뉴만 있으면 누구나 됐음) → 같은 키일 때만.
-- 다음(따로): stock_docs·stock_moves(판매·구매·생산·조정·이커머스·이익관리 6개 키가 문서 종류별로 섞임)·products·warehouses
--   (여러 화면이 자동 생성) — 경로가 많아 종류별 판정 설계 뒤.
--
-- 규칙: 읽기 = 같은 회사 전원 / 쓰기 = 같은 회사 AND (마스터 OR 그 키). 데이터 변경 없음.
--   운영 행: 모티브(주문 8·자재구성 7·실사 2·단가 6, 키 보유 4)·오너뷰 시험 회사(주문 6·자재구성 7·작업지시 2, 키 보유 1).

set lock_timeout = '5s';

do $$
declare r record;
begin
  for r in select * from (values
    ('orders',            '/inventory/orders:write'),
    ('order_lines',       '/inventory/orders:write'),
    ('product_boms',      '/inventory/production:write'),
    ('work_orders',       '/inventory/production:write'),
    ('stock_counts',      '/inventory/stock:adjust'),
    ('stock_count_lines', '/inventory/stock:adjust')
  ) v(t, k) loop
    execute format('drop policy if exists %I on public.%I', r.t || '_company', r.t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_my_company_id()))', r.t || '_select', r.t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using (company_id = (select public.get_my_company_id()) and ((select public.is_company_admin()) or (select public.has_perm(%L))))
      with check (company_id = (select public.get_my_company_id()) and ((select public.is_company_admin()) or (select public.has_perm(%L))))$f$,
      r.t || '_write', r.t, r.k, r.k);
  end loop;
end $$;

drop policy if exists partner_prices_company on public.partner_prices;
create policy partner_prices_select on public.partner_prices
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy partner_prices_write on public.partner_prices
  for all to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_admin())
              or (side = 'sale' and (select public.has_perm('/inventory/sales:write')))
              or (side = 'buy'  and (select public.has_perm('/inventory/purchase:write')))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_admin())
              or (side = 'sale' and (select public.has_perm('/inventory/sales:write')))
              or (side = 'buy'  and (select public.has_perm('/inventory/purchase:write')))));
