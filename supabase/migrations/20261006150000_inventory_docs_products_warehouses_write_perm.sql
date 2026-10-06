-- 재고 쓰기 권한 2차: 재고 문서·재고 줄·품목·창고 (2026-10-06 사장님 "1번부터 진행" + 품목 결정 "A로 진행해줘")
--
-- 왜: 이 4개 표는 *_company(ALL, TO public)로 회사 소속만 봤다. 화면은 메뉴별 키로 쓰기를 가르지만 API 로는 보기 권한자도
--     재고 문서를 만들거나 지울 수 있었다(재고 수량·원가·매출 숫자에 바로 닿는다). 1차(20261006140000)에서 뺀 나머지.
--
-- 결정 1 — 재고 문서·재고 줄은 문서 종류(stock_docs.reason)로 판정:
--   창고관리 「입·출고와 조정」(/inventory/stock:adjust) = 모든 종류 — 창고관리 입·출고 창에서 판매·구매·생산을 포함한 종류를
--     고를 수 있다(opening·count 만 빠짐). 기획 단계 표에선 조정류만 줬는데 실제 화면을 확인하고 넓혔다(지금 동작 보존).
--   + 판매 출고·반품(sale·return_in) = 판매 :write 또는 이커머스 :write (주문 가져오기·클레임 반품 입고가 만든다)
--   + 구매 입고·반품(purchase·return_out) = 구매 :write
--   + 생산 완성·자재 투입·폐기(produce·consume·disposal) = 생산 :write (생산 화면 불량 폐기 포함)
--   + 창고 이동(move) 중 **불량 보류 창고(code 'DEFECT')에서 나가는 것** = 생산 :write — 생산 화면 「재작업 → 양품 전환」.
--     security-reviewer 가 찾은 회귀(재작업이 막힘). 버튼 숨기기(기능 삭제)·이동 전체 허용(범위 과다) 대신 불량 창고 출발만 연다.
--   재고 줄은 자기 문서의 종류를 따른다(doc_id 없는 줄 0건). 회계 연결(전표 번호 붙이기 등) DB 함수는 전부 SECURITY DEFINER 라 무관.
-- 결정 2 — 창고 = 마스터 | stock:adjust | 설정 재고 기준(/settings:inventory·closing — 설정 화면 OR 규칙과 같게) | 생산 :write(불량 창고 자동 생성).
-- 결정 3(사장님 A) — 품목 = 재고 쓰기 키 하나라도(판매·구매·주문·생산 :write, stock:adjust, 이커머스 :write). 새 키 없음·백필 없음.
--   영향: 모티브 품목 메뉴 14명 중 11명은 쓰기 키가 없어 보기만 하게 된다(같은 커밋에서 품목 화면도 같은 기준으로 버튼을 숨김).
--
-- 읽기 = 같은 회사 전원(현황·이익관리·매출 보드·수불부). 데이터 변경 없음.

set lock_timeout = '5s';

create or replace function public.inv_doc_writable(p_reason text, p_warehouse_id uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select public.is_company_admin()
      or public.has_perm('/inventory/stock:adjust')
      or case
           when p_reason in ('sale', 'return_in')            then public.has_perm('/inventory/sales:write') or public.has_perm('/inventory/channels:write')
           when p_reason in ('purchase', 'return_out')       then public.has_perm('/inventory/purchase:write')
           when p_reason in ('produce', 'consume', 'disposal') then public.has_perm('/inventory/production:write')
           when p_reason = 'move' then public.has_perm('/inventory/production:write')
                and exists (select 1 from public.warehouses w where w.id = p_warehouse_id and w.code = 'DEFECT'
                              and w.company_id = public.get_my_company_id())
           else false
         end;
$$;

--   재고 줄용 — 줄이 속한 문서의 종류로 판정. 같은 회사 문서만 본다(SECURITY DEFINER 라 회사 조건을 직접 건다).
create or replace function public.inv_move_writable(p_doc_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select public.inv_doc_writable(d.reason, d.warehouse_id) from public.stock_docs d
                    where d.id = p_doc_id and d.company_id = public.get_my_company_id()), false);
$$;

revoke all on function public.inv_doc_writable(text, uuid) from public, anon;
revoke all on function public.inv_move_writable(uuid) from public, anon;
grant execute on function public.inv_doc_writable(text, uuid) to authenticated;
grant execute on function public.inv_move_writable(uuid) to authenticated;

-- 재고 문서
drop policy if exists stock_docs_company on public.stock_docs;
create policy stock_docs_select on public.stock_docs
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy stock_docs_write on public.stock_docs
  for all to authenticated
  using (company_id = (select public.get_my_company_id()) and public.inv_doc_writable(reason, warehouse_id))
  with check (company_id = (select public.get_my_company_id()) and public.inv_doc_writable(reason, warehouse_id));

-- 재고 줄
drop policy if exists stock_moves_company on public.stock_moves;
create policy stock_moves_select on public.stock_moves
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy stock_moves_write on public.stock_moves
  for all to authenticated
  using (company_id = (select public.get_my_company_id()) and public.inv_move_writable(doc_id))
  with check (company_id = (select public.get_my_company_id()) and public.inv_move_writable(doc_id));

-- 품목
drop policy if exists products_company on public.products;
create policy products_select on public.products
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy products_write on public.products
  for all to authenticated
  using (company_id = (select public.get_my_company_id()) and (
    (select public.is_company_admin())
    or (select public.has_perm('/inventory/sales:write')) or (select public.has_perm('/inventory/purchase:write'))
    or (select public.has_perm('/inventory/orders:write')) or (select public.has_perm('/inventory/production:write'))
    or (select public.has_perm('/inventory/stock:adjust')) or (select public.has_perm('/inventory/channels:write'))))
  with check (company_id = (select public.get_my_company_id()) and (
    (select public.is_company_admin())
    or (select public.has_perm('/inventory/sales:write')) or (select public.has_perm('/inventory/purchase:write'))
    or (select public.has_perm('/inventory/orders:write')) or (select public.has_perm('/inventory/production:write'))
    or (select public.has_perm('/inventory/stock:adjust')) or (select public.has_perm('/inventory/channels:write'))));

-- 창고
drop policy if exists warehouses_company on public.warehouses;
create policy warehouses_select on public.warehouses
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy warehouses_write on public.warehouses
  for all to authenticated
  using (company_id = (select public.get_my_company_id()) and (
    (select public.is_company_admin()) or (select public.has_perm('/inventory/stock:adjust'))
    or (select public.has_perm('/settings:inventory')) or (select public.has_perm('/settings:closing'))
    or (select public.has_perm('/inventory/production:write'))))
  with check (company_id = (select public.get_my_company_id()) and (
    (select public.is_company_admin()) or (select public.has_perm('/inventory/stock:adjust'))
    or (select public.has_perm('/settings:inventory')) or (select public.has_perm('/settings:closing'))
    or (select public.has_perm('/inventory/production:write'))));
