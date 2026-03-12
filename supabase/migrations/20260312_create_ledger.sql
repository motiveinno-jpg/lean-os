-- ============================================================
-- General Ledger (총계정원장) — Double-Entry Bookkeeping Engine
-- ============================================================

-- 1. Chart of Accounts (계정과목)
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid REFERENCES chart_of_accounts(id),
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX idx_coa_company ON chart_of_accounts(company_id, code);
CREATE INDEX idx_coa_type ON chart_of_accounts(company_id, account_type);

-- 2. Journal Entries (분개)
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL DEFAULT '',
  reference_type text CHECK (reference_type IN ('invoice', 'payment', 'expense', 'transfer', 'adjustment')),
  reference_id uuid,
  created_by uuid,
  approved_by uuid,
  is_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_je_company_date ON journal_entries(company_id, entry_date DESC);
CREATE INDEX idx_je_reference ON journal_entries(reference_type, reference_id);

-- 3. Journal Lines (분개 항목)
CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  debit numeric(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text DEFAULT '',
  CONSTRAINT debit_or_credit_nonzero CHECK (debit > 0 OR credit > 0),
  CONSTRAINT not_both_nonzero CHECK (NOT (debit > 0 AND credit > 0))
);

CREATE INDEX idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX idx_jl_account ON journal_lines(account_id);

-- 4. Balance validation trigger — debits must equal credits per entry
CREATE OR REPLACE FUNCTION check_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debit numeric(15,2);
  total_credit numeric(15,2);
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_lines
   WHERE entry_id = NEW.entry_id;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'Journal entry is unbalanced: debits (%) <> credits (%)',
      total_debit, total_credit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire as a constraint trigger so it runs after all lines in a transaction are inserted
CREATE CONSTRAINT TRIGGER trg_check_journal_balance
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balance();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

-- chart_of_accounts
CREATE POLICY "Users can view chart of accounts for their company"
  ON chart_of_accounts FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage chart of accounts for their company"
  ON chart_of_accounts FOR ALL
  USING (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid()
  ));

-- journal_entries
CREATE POLICY "Users can view journal entries for their company"
  ON journal_entries FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage journal entries for their company"
  ON journal_entries FOR ALL
  USING (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid()
  ));

-- journal_lines (access through entry's company_id)
CREATE POLICY "Users can view journal lines for their company"
  ON journal_lines FOR SELECT
  USING (entry_id IN (
    SELECT je.id FROM journal_entries je
     WHERE je.company_id IN (
       SELECT company_id FROM company_members WHERE user_id = auth.uid()
     )
  ));

CREATE POLICY "Users can manage journal lines for their company"
  ON journal_lines FOR ALL
  USING (entry_id IN (
    SELECT je.id FROM journal_entries je
     WHERE je.company_id IN (
       SELECT company_id FROM company_members WHERE user_id = auth.uid()
     )
  ))
  WITH CHECK (entry_id IN (
    SELECT je.id FROM journal_entries je
     WHERE je.company_id IN (
       SELECT company_id FROM company_members WHERE user_id = auth.uid()
     )
  ));

-- ============================================================
-- Default Korean Chart of Accounts (한국 표준 계정과목)
-- Inserted via a function so each company gets its own copy.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_default_chart_of_accounts(p_company_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts (company_id, code, name, account_type, is_system) VALUES
    -- 자산 (Assets)
    (p_company_id, '101', '보통예금',     'asset',     true),
    (p_company_id, '102', '현금',         'asset',     true),
    (p_company_id, '103', '매출채권',     'asset',     true),
    (p_company_id, '104', '미수금',       'asset',     true),
    (p_company_id, '105', '선급금',       'asset',     true),
    (p_company_id, '106', '부가세대급금', 'asset',     true),
    -- 부채 (Liabilities)
    (p_company_id, '201', '매입채무',     'liability', true),
    (p_company_id, '202', '미지급금',     'liability', true),
    (p_company_id, '203', '선수금',       'liability', true),
    (p_company_id, '204', '예수금',       'liability', true),
    (p_company_id, '205', '부가세예수금', 'liability', true),
    (p_company_id, '206', '차입금',       'liability', true),
    -- 자본 (Equity)
    (p_company_id, '301', '자본금',       'equity',    true),
    (p_company_id, '302', '이익잉여금',   'equity',    true),
    -- 수익 (Revenue)
    (p_company_id, '401', '매출',         'revenue',   true),
    (p_company_id, '402', '기타수익',     'revenue',   true),
    -- 비용 (Expenses)
    (p_company_id, '501', '급여',         'expense',   true),
    (p_company_id, '502', '임차료',       'expense',   true),
    (p_company_id, '503', '소모품비',     'expense',   true),
    (p_company_id, '504', '접대비',       'expense',   true),
    (p_company_id, '505', '통신비',       'expense',   true),
    (p_company_id, '506', '여비교통비',   'expense',   true),
    (p_company_id, '507', '수수료',       'expense',   true),
    (p_company_id, '508', '감가상각비',   'expense',   true),
    (p_company_id, '509', '기타비용',     'expense',   true)
  ON CONFLICT (company_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
