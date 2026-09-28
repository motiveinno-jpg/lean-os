-- 이커머스 1단계(docs/20260928_PLAN_ecommerce_stage1.md) 결정 267·269 의 표 2개.
-- 267: channel_order_claims — 채널 주문 1건 기준 취소·반품·교환 기록(환불액·되돌림/교환 재고 문서 연결).
-- 269: channel_settlements — 채널 정산 내역 붙여넣기 한 줄, 같은 줄 두 번 붙여넣기는 유일 제약으로 막는다.

-- 정책: channel_order_imports 와 같은 get_my_company_id() 회사 격리 + is_advisor_session() 읽기전용.
-- advisor_ro_* 는 RESTRICTIVE 로 둔다 — 운영 DB 220개 표가 RESTRICTIVE, channel_order_imports 등 23개 표만
-- PERMISSIVE 로 붙어 있는데 PERMISSIVE 면 회사 격리와 OR 로 합쳐져 다른 회사 행 INSERT 가 열린다.

-- 1) 채널 주문 클레임
CREATE TABLE IF NOT EXISTS public.channel_order_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.channel_order_imports(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cancel','return','exchange')),
  refund_amount numeric NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  reason text,
  claimed_at date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'done' CHECK (status IN ('requested','done')),
  restock boolean NOT NULL DEFAULT true,
  restock_doc_id uuid REFERENCES public.stock_docs(id) ON DELETE SET NULL,
  exchange_doc_id uuid REFERENCES public.stock_docs(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_order_claims_company_import_idx ON public.channel_order_claims (company_id, import_id);
CREATE INDEX IF NOT EXISTS channel_order_claims_company_claimed_idx ON public.channel_order_claims (company_id, claimed_at);
CREATE INDEX IF NOT EXISTS channel_order_claims_restock_doc_idx ON public.channel_order_claims (restock_doc_id);
CREATE INDEX IF NOT EXISTS channel_order_claims_exchange_doc_idx ON public.channel_order_claims (exchange_doc_id);
CREATE INDEX IF NOT EXISTS channel_order_claims_created_by_idx ON public.channel_order_claims (created_by);

ALTER TABLE public.channel_order_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_order_claims_company ON public.channel_order_claims;
CREATE POLICY channel_order_claims_company ON public.channel_order_claims FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS advisor_ro_ins ON public.channel_order_claims;
CREATE POLICY advisor_ro_ins ON public.channel_order_claims AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT (SELECT public.is_advisor_session()));
DROP POLICY IF EXISTS advisor_ro_upd ON public.channel_order_claims;
CREATE POLICY advisor_ro_upd ON public.channel_order_claims AS RESTRICTIVE FOR UPDATE
  USING (NOT (SELECT public.is_advisor_session()));
DROP POLICY IF EXISTS advisor_ro_del ON public.channel_order_claims;
CREATE POLICY advisor_ro_del ON public.channel_order_claims AS RESTRICTIVE FOR DELETE
  USING (NOT (SELECT public.is_advisor_session()));

-- 2) 채널 정산 내역
CREATE TABLE IF NOT EXISTS public.channel_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  channel text NOT NULL,
  channel_order_no text NOT NULL,
  settled_at date NOT NULL,
  sale_amount numeric NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0,
  shipping_amount numeric NOT NULL DEFAULT 0,
  settle_amount numeric NOT NULL DEFAULT 0,   -- 실입금(음수 허용)
  raw jsonb,
  import_id uuid REFERENCES public.channel_order_imports(id) ON DELETE SET NULL,   -- 대조된 주문
  batch_id uuid NOT NULL,                     -- 같은 붙여넣기 묶음
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL, -- 1c 정산 전표 초안
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_settlements_unique_line UNIQUE (company_id, channel, channel_order_no, settled_at, settle_amount)
);
CREATE INDEX IF NOT EXISTS channel_settlements_company_channel_settled_idx ON public.channel_settlements (company_id, channel, settled_at);
CREATE INDEX IF NOT EXISTS channel_settlements_company_batch_idx ON public.channel_settlements (company_id, batch_id);
CREATE INDEX IF NOT EXISTS channel_settlements_import_idx ON public.channel_settlements (import_id);
CREATE INDEX IF NOT EXISTS channel_settlements_journal_entry_idx ON public.channel_settlements (journal_entry_id);
CREATE INDEX IF NOT EXISTS channel_settlements_created_by_idx ON public.channel_settlements (created_by);

ALTER TABLE public.channel_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_settlements_company ON public.channel_settlements;
CREATE POLICY channel_settlements_company ON public.channel_settlements FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS advisor_ro_ins ON public.channel_settlements;
CREATE POLICY advisor_ro_ins ON public.channel_settlements AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT (SELECT public.is_advisor_session()));
DROP POLICY IF EXISTS advisor_ro_upd ON public.channel_settlements;
CREATE POLICY advisor_ro_upd ON public.channel_settlements AS RESTRICTIVE FOR UPDATE
  USING (NOT (SELECT public.is_advisor_session()));
DROP POLICY IF EXISTS advisor_ro_del ON public.channel_settlements;
CREATE POLICY advisor_ro_del ON public.channel_settlements AS RESTRICTIVE FOR DELETE
  USING (NOT (SELECT public.is_advisor_session()));
