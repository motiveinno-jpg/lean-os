-- 증빙 '전표처리' 버튼이 만드는 전표에도 부가세 유형을 남긴다 (2026-08-11).
--   버튼 겉모습은 그대로 두고 안쪽만 매입매출전표로 바꾼다 — 쓰던 사람은 달라진 걸 못 느낀다.
--
-- ⚠️ 같이 잡는 오류: 부가세대급금을 코드 '136' 으로 찾고 있었다. 표준 계정과목표에서 136 은
--    **선납세금**이고 부가세대급금은 **135** 다. 그동안 매입 계산서·현금영수증 전표의 부가세가
--    선납세금 계정에 쌓였고, 그러면 부가세 신고에서 매입세액으로 잡히지 않는다.
--    코드로 먼저 찾고 못 찾으면 이름으로 찾는다 — 회사마다 코드가 다를 수 있어서다.
--
-- prod 적용본: supabase_migrations.schema_migrations version 20260811005240
--   (post_invoice_voucher · post_card_voucher · post_cash_voucher 전문 포함)

create or replace function public.find_account(p_company uuid, p_code text, p_name text)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from chart_of_accounts
  where company_id = p_company and (code = p_code or name = p_name)
  order by (code = p_code) desc limit 1;
$$;

-- 세 함수의 공통 변경점
--   1) journal_entries 에 entry_kind='sale_purchase' · vat_type · supply_amount · vat_amount 기록
--   2) reference_type/reference_id 로 증빙과 묶어 중복 기장 차단
--   3) 부가세대급금을 find_account(…, '135', '부가세대급금') 로 조회 (기존 '136' 오류 수정)
--   4) 유형 판정 — 계산서: 매출 11/12/13, 매입 51/53, 계정이 접대비면 54
--                 카드: 접대비면 54, 아니면 57(공급가/세액 1.1 분리) · 대변은 미지급금(253)
--                 현금영수증: 매출 22, 매입 61(접대비면 54)
--   5) 부가세 계정이 없는 회사는 예전처럼 2줄로 폴백 — 어떤 회사에서도 저장이 깨지지 않게
--
-- 함수 전문은 길어 이 파일에 옮겨 적지 않는다. 다시 적용해야 하면 아래로 받는다:
--   npx supabase db pull --project-ref njbvdkuvtdtkxyylwngn
