-- L 수당: allowance_types (회사별 수당 카탈로그) + allowance_entries (월별 직원별 산정 결과)
--
-- 비재귀 RLS 게이트 준수 (feedback_rls_recursion_gate):
--   정책 본문에서 users/employees/companies 인라인 서브쿼리 금지.
--   회사 격리 / 본인 격리 모두 SECURITY DEFINER 헬퍼만 사용.
--     · is_company_admin()        — 20260519040000 에서 정의 (RLS 우회, 재귀 없음)
--     · current_employee_id()     — 20260519040000 에서 정의
--     · get_my_company_id()       — 기존 헬퍼 (회사 격리)
--
-- 법정 4종 (overtime / night / holiday / on_duty) 은 시스템 예약 코드로 보호:
--   is_legal_mandatory=true 행은 DELETE 거부, code 변경 거부, is_legal_mandatory
--   변경 거부 (BEFORE 트리거).
--
-- 멱등 (재실행 안전):
--   CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS → CREATE POLICY,
--   ON CONFLICT DO NOTHING (seed), CREATE OR REPLACE FUNCTION/TRIGGER 패턴.
--
-- 락 안전장치 (정책/트리거 ACCESS EXCLUSIVE 락 무한대기 방지 — 20260519040000 패턴):
SET lock_timeout = '4000';
SET statement_timeout = '60000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) allowance_types — 회사별 수당 카탈로그
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.allowance_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  calc_mode           text NOT NULL CHECK (calc_mode IN ('auto_time','per_count','manual','fixed_per_month')),
  base_field          text,
  rate_type           text NOT NULL CHECK (rate_type IN ('hourly_multiplier','fixed_per_minute','fixed_per_count','fixed_per_month')),
  rate_amount         numeric NOT NULL DEFAULT 0,
  is_legal_mandatory  boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  applies_to          text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','employees')),
  target_employee_ids uuid[] NOT NULL DEFAULT '{}',
  display_order       int NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allowance_types_company_code_uq UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_allowance_types_company_active_order
  ON public.allowance_types (company_id, is_active, display_order);

COMMENT ON TABLE public.allowance_types IS
  'L 수당: 회사별 수당 카탈로그. 법정 4종(overtime/night/holiday/on_duty)은 is_legal_mandatory=true 보호. 커스텀은 자유 추가.';
COMMENT ON COLUMN public.allowance_types.calc_mode IS
  'auto_time = attendance_records 의 *_minutes 자동 집계 / per_count = 발생 횟수 입력 / manual = 관리자 수기 / fixed_per_month = 매월 고정액.';
COMMENT ON COLUMN public.allowance_types.base_field IS
  'auto_time 일 때 집계 대상 컬럼명 (예: overtime_minutes, night_minutes, holiday_minutes 또는 커스텀).';
COMMENT ON COLUMN public.allowance_types.rate_amount IS
  'hourly_multiplier=배수(1.5=50%가산 후 150%), fixed_per_minute=원/분, fixed_per_count=원/회, fixed_per_month=원/월.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) allowance_entries — 월별 직원별 산정 결과
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.allowance_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  payroll_month       text NOT NULL,
  allowance_type_id   uuid NOT NULL REFERENCES public.allowance_types(id) ON DELETE CASCADE,
  calculated_minutes  int,
  count               int,
  amount              numeric NOT NULL DEFAULT 0,
  source              text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual','edit')),
  edited_by           uuid REFERENCES public.users(id),
  edited_at           timestamptz,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allowance_entries_unique UNIQUE (company_id, employee_id, payroll_month, allowance_type_id)
);

CREATE INDEX IF NOT EXISTS idx_allowance_entries_company_month
  ON public.allowance_entries (company_id, payroll_month);
CREATE INDEX IF NOT EXISTS idx_allowance_entries_employee_month
  ON public.allowance_entries (employee_id, payroll_month);

COMMENT ON TABLE public.allowance_entries IS
  'L 수당: 월별 직원별 수당 산정 결과. payroll_month=YYYY-MM. source=auto/manual/edit, edit 시 edited_by/edited_at 기록.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) updated_at 자동 갱신 트리거
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._allowance_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allowance_types_touch ON public.allowance_types;
CREATE TRIGGER trg_allowance_types_touch
  BEFORE UPDATE ON public.allowance_types
  FOR EACH ROW EXECUTE FUNCTION public._allowance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_allowance_entries_touch ON public.allowance_entries;
CREATE TRIGGER trg_allowance_entries_touch
  BEFORE UPDATE ON public.allowance_entries
  FOR EACH ROW EXECUTE FUNCTION public._allowance_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 법정 4종 보호 트리거 (DELETE 거부 + code/is_legal_mandatory 변경 거부)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._allowance_types_protect_legal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- CASCADE (companies 삭제) 또는 다른 트리거에서 호출 시 보호 우회.
  -- 일반 사용자 DELETE 는 depth=1 이라 if 미발동 → 보호 유효.
  -- (FK CASCADE 가 들어오면 RI 액션이 depth 를 올려 통과시킨다.)
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_legal_mandatory THEN
      RAISE EXCEPTION '법정 수당(%)은 삭제할 수 없습니다. 비활성화(is_active=false)로 처리하세요.', OLD.code
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_legal_mandatory AND NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION '법정 수당(%)의 code 는 변경할 수 없습니다.', OLD.code
        USING ERRCODE = '23514';
    END IF;
    IF OLD.is_legal_mandatory AND NEW.is_legal_mandatory = false THEN
      RAISE EXCEPTION '법정 수당(%)의 is_legal_mandatory 플래그를 해제할 수 없습니다.', OLD.code
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allowance_types_protect_legal_del ON public.allowance_types;
CREATE TRIGGER trg_allowance_types_protect_legal_del
  BEFORE DELETE ON public.allowance_types
  FOR EACH ROW EXECUTE FUNCTION public._allowance_types_protect_legal();

DROP TRIGGER IF EXISTS trg_allowance_types_protect_legal_upd ON public.allowance_types;
CREATE TRIGGER trg_allowance_types_protect_legal_upd
  BEFORE UPDATE OF code, is_legal_mandatory ON public.allowance_types
  FOR EACH ROW EXECUTE FUNCTION public._allowance_types_protect_legal();

-- ─────────────────────────────────────────────────────────────────────────
-- 5) RLS — 비재귀 (헬퍼만 사용)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.allowance_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowance_types   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.allowance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowance_entries FORCE  ROW LEVEL SECURITY;

-- 5a) allowance_types: 회사격리 SELECT + 관리자만 쓰기
DROP POLICY IF EXISTS allowance_types_select_company ON public.allowance_types;
CREATE POLICY allowance_types_select_company ON public.allowance_types
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS allowance_types_admin_write ON public.allowance_types;
CREATE POLICY allowance_types_admin_write ON public.allowance_types
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id() AND is_company_admin())
  WITH CHECK (company_id = get_my_company_id() AND is_company_admin());

-- 5b) allowance_entries: 본인 또는 관리자 SELECT + 관리자만 쓰기
DROP POLICY IF EXISTS allowance_entries_select_self_or_admin ON public.allowance_entries;
CREATE POLICY allowance_entries_select_self_or_admin ON public.allowance_entries
  FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    AND (is_company_admin() OR employee_id = current_employee_id())
  );

DROP POLICY IF EXISTS allowance_entries_admin_insert ON public.allowance_entries;
CREATE POLICY allowance_entries_admin_insert ON public.allowance_entries
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() AND is_company_admin());

DROP POLICY IF EXISTS allowance_entries_admin_update ON public.allowance_entries;
CREATE POLICY allowance_entries_admin_update ON public.allowance_entries
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() AND is_company_admin())
  WITH CHECK (company_id = get_my_company_id() AND is_company_admin());

DROP POLICY IF EXISTS allowance_entries_admin_delete ON public.allowance_entries;
CREATE POLICY allowance_entries_admin_delete ON public.allowance_entries
  FOR DELETE TO authenticated
  USING (company_id = get_my_company_id() AND is_company_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 법정 4종 seed 헬퍼 (회사별 호출 — SECURITY DEFINER 로 RLS 우회)
-- ─────────────────────────────────────────────────────────────────────────
--   overtime         : 연장근로 = 통상시급 × 1.5 (auto_time, base=overtime_minutes)
--   night            : 야간 가산 = 통상시급 × 0.5 (가산분만, auto_time, base=night_minutes)
--   holiday          : 휴일근로 8h 이내 = 통상시급 × 1.5 (auto_time, base=holiday_minutes)
--   holiday_over_8h  : 휴일근로 8h 초과 = 통상시급 × 2.0 (auto_time, base=holiday_over_8h_minutes)
--   on_duty          : 당직 = 1회당 단가 (per_count, fixed_per_count, company_settings.on_duty_pay_per_shift)
CREATE OR REPLACE FUNCTION public.seed_legal_allowances(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on_duty_rate numeric;
  v_count int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- 당직 1회 단가 (company_settings 가 있고 값>0 이면 그 값, 아니면 50000 기본)
  SELECT COALESCE(NULLIF(on_duty_pay_per_shift, 0), 50000)::numeric
    INTO v_on_duty_rate
  FROM public.company_settings
  WHERE company_id = p_company_id
  LIMIT 1;
  IF v_on_duty_rate IS NULL THEN
    v_on_duty_rate := 50000;
  END IF;

  INSERT INTO public.allowance_types
    (company_id, code, name, calc_mode, base_field, rate_type, rate_amount, is_legal_mandatory, is_active, display_order)
  VALUES
    (p_company_id, 'overtime',        '연장근로수당',     'auto_time', 'overtime_minutes',         'hourly_multiplier', 1.5,              true, true, 10),
    (p_company_id, 'night',           '야간근로 가산수당', 'auto_time', 'night_minutes',            'hourly_multiplier', 0.5,              true, true, 20),
    (p_company_id, 'holiday',         '휴일근로수당(8h이내)', 'auto_time', 'holiday_minutes',       'hourly_multiplier', 1.5,              true, true, 30),
    (p_company_id, 'holiday_over_8h', '휴일근로수당(8h초과)', 'auto_time', 'holiday_over_8h_minutes','hourly_multiplier', 2.0,              true, true, 40),
    (p_company_id, 'on_duty',         '당직수당',         'per_count', NULL,                       'fixed_per_count',   v_on_duty_rate,   true, true, 50)
  ON CONFLICT (company_id, code) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_legal_allowances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_legal_allowances(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.seed_legal_allowances(uuid) IS
  'L 수당: 회사 법정 4종(+휴일 8h초과 분리행) seed. on_duty 단가는 company_settings.on_duty_pay_per_shift(>0) 우선, 없으면 50000원. ON CONFLICT DO NOTHING 멱등.';

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 회사 생성 시 자동 seed 트리거
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._seed_allowances_on_company_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_legal_allowances(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_allowances_on_company_insert ON public.companies;
CREATE TRIGGER trg_seed_allowances_on_company_insert
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public._seed_allowances_on_company_insert();

-- 트리거 전용 함수 RPC 노출 차단 (anon/authenticated 가 임의 회사 ID 로 호출 못하게).
REVOKE ALL ON FUNCTION public._seed_allowances_on_company_insert() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 기존 회사 일괄 backfill
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_legal_allowances(r.id);
  END LOOP;
END
$$;
