-- 전자계산서(면세) 수집 지원 (2026-08-10)
-- ① tax_invoices.doc_kind — 'tax'(세금계산서, 기존 전부) / 'exempt'(전자계산서·면세)
alter table public.tax_invoices
  add column if not exists doc_kind text not null default 'tax'
  constraint tax_invoices_doc_kind_check check (doc_kind in ('tax','exempt'));

-- ② hometax_sync_jobs.job_type 에 'exempt_invoice' 허용 (CHECK 확장)
alter table public.hometax_sync_jobs
  drop constraint hometax_sync_jobs_job_type_check;
alter table public.hometax_sync_jobs
  add constraint hometax_sync_jobs_job_type_check
  check (job_type = any (array['tax_invoice'::text, 'cash_receipt'::text, 'exempt_invoice'::text]));
