-- 세금계산서 거래처 대표자·이메일 저장 (2026-07-09)
--   홈택스 sync 가 CODEF 응답의 대표자명(resContractor/SupplierName)·이메일을 계산서에 저장 →
--   공급자/공급받는자 성명·이메일이 상세에 표시됨(업태/종목과 동일 방식). 기존 행은 재동기화 시 채워짐.
alter table public.tax_invoices add column if not exists counterparty_representative text;
alter table public.tax_invoices add column if not exists counterparty_email text;
