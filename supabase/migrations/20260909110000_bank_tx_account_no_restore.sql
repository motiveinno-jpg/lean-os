-- 통장 거래의 raw_data.accountNo 를 원래 계좌번호로 되돌린다.
--   20260907120000 에서 개인정보 마스킹으로 이 값을 '**********4017' 로 바꿨는데, 이 값은 표시용이 아니라
--   거래를 통장에 잇는 열쇠였다(자동 연결 트리거 bank_tx_autolink, 통장 탭의 통장 목록·건수·잔액, 거래 화면의 계좌 필터).
--   그래서 9/7 이후 수집된 거래가 어느 통장에도 붙지 않고, 통장 탭에 별표 이름의 통장이 따로 생겼다.
--   external_id 의 두 번째 조각이 수집 당시의 실제 계좌번호라 그것으로 복원한다. counterAccount(상대 계좌)는 마스킹을 유지한다.
update public.bank_transactions
   set raw_data = raw_data || jsonb_build_object('accountNo', split_part(external_id, '|', 2))
 where source = 'codef_bank'
   and raw_data->>'accountNo' like '**%'
   and split_part(external_id, '|', 2) ~ '^[0-9]{6,}$';

-- 연결이 끊긴 거래를 통장에 다시 잇는다(트리거와 같은 규칙).
update public.bank_transactions t
   set bank_account_id = a.id
  from public.bank_accounts a
 where t.bank_account_id is null
   and t.source = 'codef_bank'
   and a.company_id = t.company_id
   and a.account_number = t.raw_data->>'accountNo';
