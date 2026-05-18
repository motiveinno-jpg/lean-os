-- Migration: tx_category_options
-- 통장/카드 매핑 시 사용자가 추가한 분류·카테고리 옵션을 저장 (재사용·삭제 가능).

CREATE TABLE IF NOT EXISTS tx_category_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('classification','category')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, kind, name)
);

ALTER TABLE tx_category_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tx_category_options_company" ON tx_category_options;
CREATE POLICY "tx_category_options_company" ON tx_category_options
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_tx_cat_opt_company ON tx_category_options(company_id, kind);
