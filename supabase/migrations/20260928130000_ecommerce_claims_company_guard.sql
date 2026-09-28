-- 20260928120000_ecommerce_claims_settlements.sql 후속 — security-reviewer 권고 W1·W5.
--
-- W1: 외래키는 id 만 보고 회사를 보지 않는다(참조 표 RLS 는 FK 검사에 안 걸린다).
--     그래서 남의 회사 channel_order_imports / stock_docs / journal_entries 의 id 만 알면
--     내 회사 클레임·정산 줄에 그 행을 매달 수 있었다. 트리거로 막는다.
--   - 버린 안: 참조 표에 UNIQUE(company_id, id) 를 더해 복합 FK 로 묶기 —
--     stock_docs·journal_entries 같은 큰 표의 구조를 건드린다.
--   - 기존 check_deal_company_match 는 deal_id 전용이라 재사용하지 않고 새 함수를 둔다.
--   - SECURITY DEFINER 가 아니다(호출자 권한). 그래서 RLS 로 안 보이는 행(= 다른 회사 행)은
--     "못 찾음" 으로 나오고, 못 찾음도 거부한다. 서비스 롤은 RLS 를 넘으므로 company_id 비교로 걸린다.
--   - UPDATE 는 값이 바뀐 칸만 본다(company_id 가 바뀌면 전부). 이미 붙은 전표를
--     can_read_ledger() 권한 없는 사람이 다른 칸만 고쳐도 막히지 않게 하려는 것.
--     참조 행 삭제로 ON DELETE SET NULL 이 도는 UPDATE 는 새 값이 null 이라 검사하지 않는다.
--
-- W5: channel_order_claims (import_id) 단독 인덱스(advisor unindexed_foreign_keys).

CREATE OR REPLACE FUNCTION public.channel_claims_settlements_check_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_all boolean := TG_OP = 'INSERT' OR NEW.company_id IS DISTINCT FROM OLD.company_id;
  v_company uuid;
BEGIN
  -- 두 표 모두 import_id 를 가진다
  IF NEW.import_id IS NOT NULL AND (v_all OR NEW.import_id IS DISTINCT FROM OLD.import_id) THEN
    SELECT company_id INTO v_company FROM public.channel_order_imports WHERE id = NEW.import_id;
    IF v_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION '다른 회사의 행을 참조할 수 없습니다 (%.import_id)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'channel_order_claims' THEN
    IF NEW.restock_doc_id IS NOT NULL AND (v_all OR NEW.restock_doc_id IS DISTINCT FROM OLD.restock_doc_id) THEN
      SELECT company_id INTO v_company FROM public.stock_docs WHERE id = NEW.restock_doc_id;
      IF v_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION '다른 회사의 행을 참조할 수 없습니다 (%.restock_doc_id)', TG_TABLE_NAME USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.exchange_doc_id IS NOT NULL AND (v_all OR NEW.exchange_doc_id IS DISTINCT FROM OLD.exchange_doc_id) THEN
      SELECT company_id INTO v_company FROM public.stock_docs WHERE id = NEW.exchange_doc_id;
      IF v_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION '다른 회사의 행을 참조할 수 없습니다 (%.exchange_doc_id)', TG_TABLE_NAME USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'channel_settlements' THEN
    IF NEW.journal_entry_id IS NOT NULL AND (v_all OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
      SELECT company_id INTO v_company FROM public.journal_entries WHERE id = NEW.journal_entry_id;
      IF v_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION '다른 회사의 행을 참조할 수 없습니다 (%.journal_entry_id)', TG_TABLE_NAME USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.channel_claims_settlements_check_company() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS channel_order_claims_check_company ON public.channel_order_claims;
CREATE TRIGGER channel_order_claims_check_company
  BEFORE INSERT OR UPDATE ON public.channel_order_claims
  FOR EACH ROW EXECUTE FUNCTION public.channel_claims_settlements_check_company();

DROP TRIGGER IF EXISTS channel_settlements_check_company ON public.channel_settlements;
CREATE TRIGGER channel_settlements_check_company
  BEFORE INSERT OR UPDATE ON public.channel_settlements
  FOR EACH ROW EXECUTE FUNCTION public.channel_claims_settlements_check_company();

-- W5
CREATE INDEX IF NOT EXISTS channel_order_claims_import_idx ON public.channel_order_claims (import_id);
