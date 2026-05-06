-- 홈택스 sync 의 nts_confirm_no(국세청 승인번호) 기반 upsert 가 onConflict 로 동작하려면
-- (company_id, nts_confirm_no) 에 unique 제약 필요. 없어서 sync 가 매번 0건 처리되던 문제.
-- nts_confirm_no NULL 행은 unique 검사에서 제외 (Postgres 기본 동작 — NULL != NULL).
ALTER TABLE public.tax_invoices
  ADD CONSTRAINT tax_invoices_company_nts_confirm_no_unique
  UNIQUE (company_id, nts_confirm_no);
