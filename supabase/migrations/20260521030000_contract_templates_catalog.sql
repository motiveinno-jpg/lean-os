-- L 견적/계약 워크플로우 — 계약서 양식 카탈로그
--
-- 핸드오프 명세는 deal_contract_templates(20260310072822) 재사용을 가정했으나
-- prod 에 해당 테이블 없음. doc_templates 는 hr-contracts 영역(employee_contracts/
-- hr_contract_packages 옆)이라 도메인 다름. 견적 워크플로우 전용 신규 테이블
-- contract_templates 신설.
--
-- 비재귀 RLS (feedback_rls_recursion_gate 준수):
--   정책 본문 인라인 서브쿼리 0건. SECURITY DEFINER 헬퍼만 사용.
--   - SELECT: is_system=true OR company_id = get_my_company_id()
--   - INSERT/UPDATE/DELETE: is_company_admin() AND 본인 회사 (시스템 행은 service_role 만)
--
-- 멱등: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS → CREATE.

SET lock_timeout = '4000';
SET statement_timeout = '60000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) contract_templates 테이블
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES public.companies(id) ON DELETE CASCADE,  -- NULL = 시스템 양식
  name            text NOT NULL,
  code            text,                                                     -- 시스템 양식 식별 ('service','supply','consulting')
  body_html       text,                                                     -- HTML 본문 (변수 토큰 {변수명} 포함)
  body_markdown   text,                                                     -- Markdown 본문 (옵션)
  variables       jsonb NOT NULL DEFAULT '[]'::jsonb,                       -- ["갑사명","을사명",...] 자동 추출
  is_system       bool NOT NULL DEFAULT false,                              -- 시스템 양식 (company_id NULL)
  is_active       bool NOT NULL DEFAULT true,
  sort_order      int  NOT NULL DEFAULT 100,
  file_url        text,                                                     -- 업로드 PDF URL (옵션)
  file_type       text CHECK (file_type IN ('html','markdown','pdf')) DEFAULT 'html',
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_templates_system_company_xor CHECK (
    (is_system = true  AND company_id IS NULL) OR
    (is_system = false AND company_id IS NOT NULL)
  ),
  CONSTRAINT contract_templates_body_present CHECK (
    body_html IS NOT NULL OR body_markdown IS NOT NULL OR file_url IS NOT NULL
  )
);

-- 시스템 양식 code 는 전역 UNIQUE (1종 1개), 회사 양식은 (company_id, name) UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_system_code_uq
  ON public.contract_templates (code) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS contract_templates_company_active_idx
  ON public.contract_templates (company_id, is_active, sort_order);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public._contract_templates_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contract_templates_touch ON public.contract_templates;
CREATE TRIGGER trg_contract_templates_touch
  BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public._contract_templates_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 2) RLS (비재귀 — SECURITY DEFINER 헬퍼만, 인라인 서브쿼리 0)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_templates FORCE ROW LEVEL SECURITY;

-- SELECT: 시스템 양식 + 본인 회사 양식
DROP POLICY IF EXISTS contract_templates_select_system_or_company ON public.contract_templates;
CREATE POLICY contract_templates_select_system_or_company
  ON public.contract_templates FOR SELECT TO authenticated
  USING (is_system = true OR company_id = get_my_company_id());

-- INSERT/UPDATE/DELETE: admin only + 본인 회사 (시스템 행은 service_role 만)
DROP POLICY IF EXISTS contract_templates_admin_insert ON public.contract_templates;
CREATE POLICY contract_templates_admin_insert
  ON public.contract_templates FOR INSERT TO authenticated
  WITH CHECK (
    is_system = false
    AND company_id = get_my_company_id()
    AND is_company_admin()
  );

DROP POLICY IF EXISTS contract_templates_admin_update ON public.contract_templates;
CREATE POLICY contract_templates_admin_update
  ON public.contract_templates FOR UPDATE TO authenticated
  USING (is_system = false AND company_id = get_my_company_id() AND is_company_admin())
  WITH CHECK (is_system = false AND company_id = get_my_company_id() AND is_company_admin());

DROP POLICY IF EXISTS contract_templates_admin_delete ON public.contract_templates;
CREATE POLICY contract_templates_admin_delete
  ON public.contract_templates FOR DELETE TO authenticated
  USING (is_system = false AND company_id = get_my_company_id() AND is_company_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 3) supabase_realtime publication (다음 라운드에서 .channel() 구독 시 대비)
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='contract_templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contract_templates;
  END IF;
END $$;

COMMENT ON TABLE public.contract_templates IS
  'L 견적 워크플로우 — 계약서 양식 카탈로그. is_system=true 는 시스템 전역 양식(company_id NULL), false 는 회사별 자체 양식. body_html/body_markdown/file_url 중 1개 이상 필수. 비재귀 RLS (get_my_company_id + is_company_admin 헬퍼만).';
