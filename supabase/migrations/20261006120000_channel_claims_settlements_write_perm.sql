-- 이커머스 클레임·정산 쓰기를 「입력·수정」 권한자로 좁힘 — 2026-10-06 사장님 "진행해줘" (backlog 보안 W4)
--
-- 왜: channel_order_claims·channel_settlements 의 *_company(ALL) 가 회사 소속만 봤다. 화면은 canWrite
--     (마스터 | /inventory/channels:write)일 때만 등록·고치기·지우기·붙여넣기를 열지만, API 로는 보기 권한자(이커머스 전체만)도
--     클레임을 만들거나 정산 줄을 지울 수 있었다. 클레임은 환불액·반품 입고로 매출·재고 숫자에 바로 닿는다.
--
-- 규칙: 읽기 = 같은 회사 전원(현황·매출 보드가 읽는다) / 쓰기 = 같은 회사 AND (마스터 OR /inventory/channels:write).
--   세무대리인 쓰기 금지(advisor_ro_* RESTRICTIVE)는 그대로.
--   통장 입금 대조(linkSettlementBankTx)는 이 표가 아니라 linkTransactionToEntry 서버 함수라 영향 없음.
--   정산 전표 초안 RPC(make_my_channel_settlement_voucher, SECURITY DEFINER)는 이미 같은 권한을 본다(20260928131000).
-- 기존 데이터: 변경 없음. 운영 행은 QA 시드 회사뿐(클레임 1·정산 3). 이커머스 메뉴가 있는 7개 회사 모두 쓰기 권한자 1명 이상.
-- 남은 같은 구조(이번엔 안 함): channel_order_imports·product_channel_codes·shipping_sheet_layouts — 주문 가져오기·출고가
--   여러 경로(되돌리기 등)에서 쓰여 경로 전수 확인 뒤 따로.

drop policy if exists channel_order_claims_company on public.channel_order_claims;
create policy channel_order_claims_select on public.channel_order_claims
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy channel_order_claims_write on public.channel_order_claims
  for all to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_admin()) or (select public.has_perm('/inventory/channels:write'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_admin()) or (select public.has_perm('/inventory/channels:write'))));

drop policy if exists channel_settlements_company on public.channel_settlements;
create policy channel_settlements_select on public.channel_settlements
  for select to authenticated using (company_id = (select public.get_my_company_id()));
create policy channel_settlements_write on public.channel_settlements
  for all to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_admin()) or (select public.has_perm('/inventory/channels:write'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_admin()) or (select public.has_perm('/inventory/channels:write'))));
