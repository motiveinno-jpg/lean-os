-- 현금영수증 매출 sync 지원 — 기존 hometax_sync_jobs 인프라(lock/retry/chain) 재사용.

-- 1) hometax_sync_jobs.job_type — 'tax_invoice' (default, 기존) / 'cash_receipt' 분기.
ALTER TABLE public.hometax_sync_jobs
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'tax_invoice'
  CHECK (job_type IN ('tax_invoice', 'cash_receipt'));

COMMENT ON COLUMN public.hometax_sync_jobs.job_type IS
  '동기화 대상 — tax_invoice: 전자세금계산서 통합(0002), cash_receipt: 현금영수증 매출(0003)';

CREATE INDEX IF NOT EXISTS hometax_sync_jobs_company_type_status_idx
  ON public.hometax_sync_jobs(company_id, job_type, status, created_at DESC);

-- 2) company_settings.last_cashreceipt_sync_at — incremental sync 기준.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS last_cashreceipt_sync_at timestamptz;

COMMENT ON COLUMN public.company_settings.last_cashreceipt_sync_at IS
  'Incremental cash receipt sync 기준 — 마지막 sync 성공 시각.';

-- 3) cash_receipts 멱등 upsert 키 — (company_id, approval_number, type) UNIQUE.
--    sync 반복 호출시 중복 INSERT 방지. approval_number 가 NULL 인 수동 등록은 제외.
CREATE UNIQUE INDEX IF NOT EXISTS cash_receipts_company_approval_type_uidx
  ON public.cash_receipts(company_id, approval_number, type)
  WHERE approval_number IS NOT NULL;
