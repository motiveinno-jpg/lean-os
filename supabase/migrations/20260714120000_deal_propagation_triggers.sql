-- ① 입금에 계산서가 붙는 순간 → 그 계산서의 프로젝트를 입금에 복사 (BEFORE, 재귀 없음)
CREATE OR REPLACE FUNCTION propagate_deal_from_invoice()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deal_id uuid;
BEGIN
  IF NEW.tax_invoice_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.tax_invoice_id IS DISTINCT FROM OLD.tax_invoice_id) THEN
    SELECT deal_id INTO v_deal_id FROM tax_invoices WHERE id = NEW.tax_invoice_id;
    IF v_deal_id IS NOT NULL THEN
      NEW.deal_id := v_deal_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_bank_tx_deal_from_invoice ON bank_transactions;
CREATE TRIGGER trg_bank_tx_deal_from_invoice
BEFORE INSERT OR UPDATE OF tax_invoice_id ON bank_transactions
FOR EACH ROW EXECUTE FUNCTION propagate_deal_from_invoice();

-- ② 계산서에 프로젝트를 걸/바꾸면 → 이미 매칭된 입금들에 소급 전파
CREATE OR REPLACE FUNCTION propagate_deal_to_matched_tx()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deal_id IS DISTINCT FROM OLD.deal_id AND NEW.deal_id IS NOT NULL THEN
    UPDATE bank_transactions SET deal_id = NEW.deal_id
     WHERE tax_invoice_id = NEW.id AND deal_id IS DISTINCT FROM NEW.deal_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_invoice_deal_to_tx ON tax_invoices;
CREATE TRIGGER trg_invoice_deal_to_tx
AFTER UPDATE OF deal_id ON tax_invoices
FOR EACH ROW EXECUTE FUNCTION propagate_deal_to_matched_tx();

-- ③ 기존 매칭분 1회 백필
UPDATE bank_transactions bt SET deal_id = ti.deal_id
  FROM tax_invoices ti
 WHERE bt.tax_invoice_id = ti.id AND ti.deal_id IS NOT NULL
   AND bt.deal_id IS DISTINCT FROM ti.deal_id;
