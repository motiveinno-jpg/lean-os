-- 전표가 가리키는 거래는 지우지 못하게 한다 (2026-09-17)
--
--   왜: 세금계산서·현금영수증·카드거래를 지워도 그 거래로 만든 **전표는 그대로 남는다.**
--   남은 전표는 사라진 행을 가리키고, 그때부터 장부와 원거래가 갈린다.
--   2026-09-17 실측: 이미 그렇게 된 전표가 카드거래 1건 있다(고아 전표).
--   앱의 삭제 경로(세금계산서 화면 2곳)는 전표가 있는지 보지 않고 바로 지운다.
--
--   무엇을 막나: 그 행을 가리키는 전표가 하나라도 있으면 삭제를 거절한다.
--   전표를 먼저 지우거나 되돌린 뒤에 지우면 된다 — 순서를 강제할 뿐 할 수 없게 만드는 게 아니다.
--
--   ⚠️ 회사 삭제(master_delete_company)는 영향받지 않는다.
--      그 함수는 삭제가 실패하면 `alter table … disable trigger user` 로 사용자 트리거를 끄고
--      다시 시도하는 구조다(2026-09-17 함수 본문 확인). 회사 통째 삭제는 그대로 된다.
--   ⚠️ 수집(엣지 함수)도 영향받지 않는다 — codef-sync 등은 upsert 만 하고 이 표들을 지우지 않는다(전수 확인).
--
--   통장거래(bank_transactions)는 지금 이 방식으로 연결된 전표가 0건이지만(reference_type 에 없고
--   linked_bank_tx_id 도 0건), 나중에 생길 자리라 같은 가드를 함께 걸어 둔다.

CREATE OR REPLACE FUNCTION public.block_delete_when_journaled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_ref_type text;
  v_label    text;
  v_cnt      integer;
BEGIN
  --   표 이름 → 전표가 쓰는 reference_type · 사람에게 보일 이름
  CASE TG_TABLE_NAME
    WHEN 'tax_invoices'      THEN v_ref_type := 'tax_invoice';      v_label := '세금계산서';
    WHEN 'cash_receipts'     THEN v_ref_type := 'cash_receipt';     v_label := '현금영수증';
    WHEN 'card_transactions' THEN v_ref_type := 'card_transaction'; v_label := '카드 거래';
    WHEN 'bank_transactions' THEN v_ref_type := 'bank_transaction'; v_label := '통장 거래';
    ELSE RETURN OLD;
  END CASE;

  SELECT count(*) INTO v_cnt
  FROM journal_entries je
  WHERE (je.reference_type = v_ref_type AND je.reference_id = OLD.id)
     OR (TG_TABLE_NAME = 'bank_transactions'  AND je.linked_bank_tx_id = OLD.id)
     OR (TG_TABLE_NAME = 'tax_invoices'       AND je.linked_invoice_id = OLD.id);

  IF v_cnt > 0 THEN
    --   메시지는 그대로 화면에 뜬다(supabase-js 가 error.message 로 올려 준다) — 사람 말로 적는다.
    RAISE EXCEPTION '이 %는 전표 %건이 참조하고 있어 지울 수 없습니다. 전표를 먼저 지우거나 되돌린 뒤에 삭제해 주세요.',
      v_label, v_cnt
      USING ERRCODE = 'P0001', HINT = '재무 › 전표 현황에서 해당 전표를 찾을 수 있습니다.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_delete_journaled ON public.tax_invoices;
CREATE TRIGGER trg_block_delete_journaled BEFORE DELETE ON public.tax_invoices
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_when_journaled();

DROP TRIGGER IF EXISTS trg_block_delete_journaled ON public.cash_receipts;
CREATE TRIGGER trg_block_delete_journaled BEFORE DELETE ON public.cash_receipts
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_when_journaled();

DROP TRIGGER IF EXISTS trg_block_delete_journaled ON public.card_transactions;
CREATE TRIGGER trg_block_delete_journaled BEFORE DELETE ON public.card_transactions
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_when_journaled();

DROP TRIGGER IF EXISTS trg_block_delete_journaled ON public.bank_transactions;
CREATE TRIGGER trg_block_delete_journaled BEFORE DELETE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_when_journaled();

COMMENT ON FUNCTION public.block_delete_when_journaled() IS
  '전표가 참조하는 원거래(세금계산서·현금영수증·카드·통장)의 삭제를 막는다. 회사 삭제는 트리거를 끄고 돌므로 영향 없음.';
