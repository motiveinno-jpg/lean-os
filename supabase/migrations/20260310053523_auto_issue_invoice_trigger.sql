-- Migration: auto_issue_invoice_trigger
-- Version: 20260310053523
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 매출 스케줄이 due(발행 예정)이 되면 자동으로 큐에 추가
CREATE OR REPLACE FUNCTION fn_queue_invoice_on_revenue_due()
RETURNS trigger AS $$
BEGIN
  -- revenue_schedule status가 'scheduled' → 'due' 또는 'received'로 변경될 때
  IF (OLD.status = 'scheduled' AND NEW.status IN ('due', 'received')) THEN
    -- 이미 해당 schedule에 대한 세금계산서가 없을 때만
    IF NOT EXISTS (
      SELECT 1 FROM tax_invoices
      WHERE revenue_schedule_id = NEW.id
    ) THEN
      INSERT INTO tax_invoice_queue (company_id, deal_id, revenue_schedule_id, action, payload)
      SELECT
        d.company_id,
        d.id,
        NEW.id,
        'issue',
        jsonb_build_object(
          'type', 'sales',
          'deal_name', d.name,
          'deal_number', d.deal_number,
          'counterparty_name', COALESCE(p.company_name, d.name),
          'counterparty_bizno', p.business_number,
          'supply_amount', NEW.amount,
          'tax_amount', round(NEW.amount * 0.1),
          'total_amount', round(NEW.amount * 1.1),
          'issue_date', COALESCE(NEW.scheduled_date, CURRENT_DATE),
          'source', 'auto_deal'
        )
      FROM deals d
      LEFT JOIN partners p ON p.id = d.partner_id
      WHERE d.id = NEW.deal_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_queue_invoice_on_revenue_due ON deal_revenue_schedule;
CREATE TRIGGER trg_queue_invoice_on_revenue_due
  AFTER UPDATE ON deal_revenue_schedule
  FOR EACH ROW
  EXECUTE FUNCTION fn_queue_invoice_on_revenue_due();

-- 큐 처리: pending → 자동발행 (사람 승인 불필요한 건)
CREATE OR REPLACE FUNCTION fn_process_invoice_queue()
RETURNS int AS $$
DECLARE
  rec RECORD;
  cnt int := 0;
  new_invoice_id uuid;
BEGIN
  FOR rec IN
    SELECT * FROM tax_invoice_queue
    WHERE status = 'pending' AND action = 'issue'
    ORDER BY created_at
    LIMIT 50
  LOOP
    BEGIN
      -- 큐 상태 → processing
      UPDATE tax_invoice_queue SET status = 'processing' WHERE id = rec.id;

      -- 세금계산서 생성
      INSERT INTO tax_invoices (
        company_id, deal_id, revenue_schedule_id, type,
        counterparty_name, counterparty_bizno,
        supply_amount, tax_amount, total_amount,
        issue_date, status, source, auto_issued, label
      ) VALUES (
        rec.company_id,
        rec.deal_id,
        rec.revenue_schedule_id,
        (rec.payload->>'type'),
        (rec.payload->>'counterparty_name'),
        (rec.payload->>'counterparty_bizno'),
        (rec.payload->>'supply_amount')::numeric,
        (rec.payload->>'tax_amount')::numeric,
        (rec.payload->>'total_amount')::numeric,
        (rec.payload->>'issue_date')::date,
        'issued',
        'auto_deal',
        true,
        (rec.payload->>'deal_number')
      ) RETURNING id INTO new_invoice_id;

      -- 큐 완료
      UPDATE tax_invoice_queue
      SET status = 'completed', processed_at = now()
      WHERE id = rec.id;

      cnt := cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE tax_invoice_queue
      SET status = 'failed', error_message = SQLERRM, processed_at = now()
      WHERE id = rec.id;
    END;
  END LOOP;
  RETURN cnt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
