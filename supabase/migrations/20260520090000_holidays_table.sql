-- L 근태: 휴일 관리 (회사별 + 한국 법정).
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'company' CHECK (type IN ('legal','company','substitute')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, date)
);
CREATE INDEX IF NOT EXISTS idx_holidays_company_date ON public.holidays (company_id, date);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- 회사격리 SELECT + 관리자만 쓰기
DROP POLICY IF EXISTS holidays_select_company ON public.holidays;
CREATE POLICY holidays_select_company ON public.holidays
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS holidays_write_admin ON public.holidays;
CREATE POLICY holidays_write_admin ON public.holidays
  FOR ALL TO authenticated
  USING (is_company_admin() AND company_id = get_my_company_id())
  WITH CHECK (is_company_admin() AND company_id = get_my_company_id());

-- 한국 법정공휴일 seed RPC (회사별 1년치 일괄 추가)
CREATE OR REPLACE FUNCTION public.seed_korean_legal_holidays(p_year int DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := get_my_company_id();
  v_user uuid := current_app_user_id();
  v_count int := 0;
BEGIN
  IF v_company IS NULL OR NOT is_company_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 한국 법정 공휴일 (고정일만 — 음력 명절은 매년 다르므로 사용자가 수동 추가 권장).
  -- 신정 / 3·1절 / 어린이날 / 현충일 / 광복절 / 개천절 / 한글날 / 성탄절
  INSERT INTO public.holidays (company_id, date, name, type, created_by)
  VALUES
    (v_company, make_date(p_year, 1, 1),  '신정',     'legal', v_user),
    (v_company, make_date(p_year, 3, 1),  '3·1절',    'legal', v_user),
    (v_company, make_date(p_year, 5, 5),  '어린이날', 'legal', v_user),
    (v_company, make_date(p_year, 6, 6),  '현충일',   'legal', v_user),
    (v_company, make_date(p_year, 8, 15), '광복절',   'legal', v_user),
    (v_company, make_date(p_year, 10, 3), '개천절',   'legal', v_user),
    (v_company, make_date(p_year, 10, 9), '한글날',   'legal', v_user),
    (v_company, make_date(p_year, 12, 25), '성탄절',  'legal', v_user)
  ON CONFLICT (company_id, date) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_korean_legal_holidays(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_korean_legal_holidays(int) TO authenticated;

COMMENT ON FUNCTION public.seed_korean_legal_holidays IS 'L 근태: 한국 법정공휴일 고정일 8건 회사별 seed (음력 명절 별도). 관리자만.';
