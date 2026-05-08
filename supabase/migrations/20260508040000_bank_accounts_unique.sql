-- bank_accounts (company_id, account_number) UNIQUE — codef-sync 가 upsert 할 수 있게.
-- partial index: account_number 가 비어있는 수동 등록은 제외 (사용자가 임의 등록한 거 충돌 안 남).
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_company_account_uniq
  ON public.bank_accounts(company_id, account_number)
  WHERE account_number IS NOT NULL;
