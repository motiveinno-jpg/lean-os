-- 이커머스 주문 가져오기·상품 연결·송장 양식 쓰기를 「입력·수정」 권한자로 — 2026-10-06 사장님 "1번 진행해줘"
--   (20261006120000 클레임·정산에 이어 같은 구조 3개 표)
--
-- 왜: *_company(ALL, TO public) 가 회사 소속만 봤다. 화면은 canWrite(마스터 | /inventory/channels:write)일 때만
--     주문 가져오기·되돌리기·발송 처리·상품 연결을 열지만, API 로는 보기 권한자도 주문을 지우거나 송장번호를 바꿀 수 있었다.
--
-- 쓰기 경로 전수(src·supabase/functions·pg_proc): 전부 src/lib/inventory-channels.ts, 호출은 전부 이커머스 화면 canWrite 안 —
--   upsertChannelCode·deleteChannelCode(상품 연결) / importChannelDoc(주문 가져오기) / revertImport(되돌리기) /
--   updateShipping(발송·배송 완료·발송 취소) / saveSheetLayout·deleteSheetLayout(송장 양식).
--   예외 하나: 송장 파일 팝업은 보기 권한자에게도 열려 있고 그 안에서 내 양식을 만들고·고치고·지울 수 있었다 →
--   같은 커밋에서 그 세 버튼을 canWrite 일 때만 보이게 했다(내려받기는 누구나 그대로).
--   DB 함수·트리거가 이 표를 쓰는 곳 없음. 다른 메뉴(판매 문서 삭제 등)에서 오는 FK 연쇄는 RLS 를 거치지 않아 영향 없음.
--
-- 규칙: 읽기 = 같은 회사 전원(현황·매출 보드·클레임·정산이 읽는다) / 쓰기 = 같은 회사 AND (마스터 OR /inventory/channels:write).
-- 기존 데이터: 변경 없음. 운영 행 = 모티브(주문 19·연결 6·양식 1, 쓰기 권한자 4)·QA 시드(주문 12·연결 5, 쓰기 1).

set lock_timeout = '5s';

do $$
declare t text;
begin
  foreach t in array array['channel_order_imports', 'product_channel_codes', 'shipping_sheet_layouts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_company', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_my_company_id()))', t || '_select', t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using (company_id = (select public.get_my_company_id()) and ((select public.is_company_admin()) or (select public.has_perm('/inventory/channels:write'))))
      with check (company_id = (select public.get_my_company_id()) and ((select public.is_company_admin()) or (select public.has_perm('/inventory/channels:write'))))$f$, t || '_write', t);
  end loop;
end $$;
