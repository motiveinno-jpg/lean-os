-- bank_tx_realtime_publication
--
-- Adds bank/card/transactions tables to the supabase_realtime publication so
-- that the client can subscribe to INSERT/UPDATE/DELETE events for real-time
-- balance and transaction list updates.
--
-- REPLICA IDENTITY is bumped to FULL on each table so that UPDATE/DELETE
-- payloads include the full OLD row (default identity only carries the
-- primary key, which is not enough for diff-based UI state).
--
-- Pre-conditions verified before authoring this migration:
--   * All 4 tables have RLS enabled
--   * All 4 tables enforce company isolation via company_id = get_my_company_id()
--     (publication respects RLS — clients only see rows for their company)
--
-- Idempotent:
--   * publication ADD is wrapped in an existence check (re-running is a no-op)
--   * REPLICA IDENTITY FULL is a no-op if already FULL

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'public.bank_transactions',
    'public.bank_accounts',
    'public.card_transactions',
    'public.transactions'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname || '.' || tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.bank_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.bank_accounts     REPLICA IDENTITY FULL;
ALTER TABLE public.card_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.transactions      REPLICA IDENTITY FULL;
