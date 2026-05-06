-- card_aliases — codef sync 카드명을 사용자 친화 별명으로 매핑
--
-- 배경: codef-sync 가 저장하는 card_name 은 "롯데카드 2120" 같이 카드사+끝4자리 형태.
-- AMEX 카드의 경우 마스킹 패턴 때문에 사용자가 인식하는 끝번호(예: 66120)와
-- DB 저장 끝4자리(2120)가 달라서 혼란. 사용자가 별명("법인 AMEX 66120")을 붙일 수 있게 함.
--
-- 거래내역 카드 그리드 조회 시 alias 우선 표시.

CREATE TABLE IF NOT EXISTS public.card_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_card_name text NOT NULL,           -- 예: "롯데카드 2120" (codef sync 결과)
  alias text NOT NULL,                       -- 예: "법인 AMEX 66120"
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_card_name)
);

CREATE INDEX IF NOT EXISTS card_aliases_company_idx
  ON public.card_aliases(company_id);

ALTER TABLE public.card_aliases ENABLE ROW LEVEL SECURITY;

-- 동일 회사 사용자만 조회/생성/수정/삭제 가능
CREATE POLICY "Company can manage card_aliases"
  ON public.card_aliases
  FOR ALL
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_card_aliases_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_card_aliases_updated_at
  BEFORE UPDATE ON public.card_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_card_aliases_updated_at();

COMMENT ON TABLE public.card_aliases IS
  'codef sync 카드명 → 사용자 친화 별명 매핑 (UI 표시용). 거래 데이터 자체는 변경 안 함.';
