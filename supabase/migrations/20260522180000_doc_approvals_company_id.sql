-- 2026-05-22 504 긴급 — doc_approvals.company_id 누락 수정.
--   dashboard/sidebar/notification-center/quick-approval 이 .eq('company_id', companyId) 호출하나
--   doc_approvals 에 company_id 컬럼 없음 → 로그인마다 쿼리 반복 실패(column does not exist) → 504.
--   document_id 경유로 company_id 추가 + 백필 + insert 트리거 자동 채움(코드 누락 방지) + 인덱스.

ALTER TABLE doc_approvals ADD COLUMN IF NOT EXISTS company_id uuid;

-- 백필: documents.company_id
UPDATE doc_approvals da
   SET company_id = d.company_id
  FROM documents d
 WHERE d.id = da.document_id
   AND da.company_id IS NULL;

-- insert 시 company_id 자동 채움 (documents 경유) — 코드가 안 넣어도 보장
CREATE OR REPLACE FUNCTION public.doc_approvals_set_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.document_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id FROM documents WHERE id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doc_approvals_set_company ON doc_approvals;
CREATE TRIGGER trg_doc_approvals_set_company
  BEFORE INSERT ON doc_approvals
  FOR EACH ROW EXECUTE FUNCTION public.doc_approvals_set_company();

CREATE INDEX IF NOT EXISTS idx_doc_approvals_company_status ON doc_approvals(company_id, status);
