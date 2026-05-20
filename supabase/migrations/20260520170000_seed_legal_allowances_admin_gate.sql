-- L 수당: seed_legal_allowances 권한 게이트 강화
--
-- 배경
--   기존 public.seed_legal_allowances(uuid) 는 SECURITY DEFINER + EXECUTE 가 authenticated 에게
--   허용되어 있어, 일반 직원이 임의 회사 ID 로 호출 가능 (advisor warning).
--   회사 생성 트리거 _seed_allowances_on_company_insert 도 이 함수를 호출하므로,
--   본문에 admin 체크를 그냥 박으면 새 회사 가입이 깨진다.
--
-- 해결 구조 (DRY 보존 + 보안 강화)
--   1) internal 함수 public._seed_legal_allowances_internal(uuid) 신설
--      - 실제 seed 본문 (DECLARE/SELECT/INSERT ON CONFLICT) 이쪽으로 이관
--      - SECURITY DEFINER, RLS 우회
--      - EXECUTE 는 PUBLIC, anon, authenticated 모두 REVOKE → service_role 만 직접 호출 가능
--        (다만 SECURITY DEFINER 트리거 함수 _seed_allowances_on_company_insert 가
--         postgres owner 권한으로 호출하므로 트리거 경로는 영향 없음)
--   2) public.seed_legal_allowances(uuid) 는 권한 게이트만 수행 후 internal 위임
--      - is_company_admin() 체크 + p_company_id = get_my_company_id() 체크
--      - 둘 다 통과 시 _internal 호출
--      - EXECUTE 는 authenticated, service_role (기존 그대로) — 게이트는 본문에서
--   3) 트리거 함수 _seed_allowances_on_company_insert 는 _internal 을 직접 호출하도록 갱신
--      → 회사 생성 시 admin 컨텍스트가 없어도(아직 회사 멤버 0명) 가입 안 깨짐
--
-- 멱등: CREATE OR REPLACE FUNCTION 패턴, ON CONFLICT DO NOTHING 그대로.

SET lock_timeout = '4000';
SET statement_timeout = '60000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) internal 함수: 실제 seed 본문 (RLS/권한 우회, 트리거/관리자 게이트에서만 호출)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._seed_legal_allowances_internal(p_company_id uuid)
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
    (p_company_id, 'overtime',        '연장근로수당',         'auto_time', 'overtime_minutes',          'hourly_multiplier', 1.5,              true, true, 10),
    (p_company_id, 'night',           '야간근로 가산수당',     'auto_time', 'night_minutes',             'hourly_multiplier', 0.5,              true, true, 20),
    (p_company_id, 'holiday',         '휴일근로수당(8h이내)',  'auto_time', 'holiday_minutes',           'hourly_multiplier', 1.5,              true, true, 30),
    (p_company_id, 'holiday_over_8h', '휴일근로수당(8h초과)',  'auto_time', 'holiday_over_8h_minutes',   'hourly_multiplier', 2.0,              true, true, 40),
    (p_company_id, 'on_duty',         '당직수당',             'per_count', NULL,                        'fixed_per_count',   v_on_duty_rate,   true, true, 50)
  ON CONFLICT (company_id, code) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- internal 함수: 외부 RPC 노출 차단
REVOKE ALL ON FUNCTION public._seed_legal_allowances_internal(uuid) FROM PUBLIC, anon, authenticated;
-- service_role 은 운영 backfill 용으로만 명시 허용 (SECURITY DEFINER 함수 owner=postgres 가
-- 트리거 경로에서 호출하는 건 GRANT 와 무관).
GRANT EXECUTE ON FUNCTION public._seed_legal_allowances_internal(uuid) TO service_role;

COMMENT ON FUNCTION public._seed_legal_allowances_internal(uuid) IS
  'L 수당 internal: 실제 seed 본문. 외부 호출 금지(REVOKE). 트리거(_seed_allowances_on_company_insert) 또는 게이트 함수(seed_legal_allowances) 또는 service_role 만 호출.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) public seed 함수: 권한 게이트 후 internal 위임
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_legal_allowances(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- 게이트 1: admin 만 호출 허용 (직원/외부 임의 호출 차단)
  IF NOT public.is_company_admin() THEN
    RAISE EXCEPTION 'seed_legal_allowances: 회사 관리자만 호출할 수 있습니다.'
      USING ERRCODE = '42501';
  END IF;
  -- 게이트 2: 본인 회사 외 차단
  IF p_company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'seed_legal_allowances: 본인 회사 외 호출 차단.'
      USING ERRCODE = '42501';
  END IF;

  RETURN public._seed_legal_allowances_internal(p_company_id);
END;
$$;

-- 기존 GRANT 정리 후 재부여 (authenticated 는 게이트 통과 시에만 의미가 있음)
REVOKE ALL ON FUNCTION public.seed_legal_allowances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_legal_allowances(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.seed_legal_allowances(uuid) IS
  'L 수당: 회사 법정 4종 seed (게이트). admin + 본인 회사 ID 일 때만 _seed_legal_allowances_internal 위임. 회사 생성 시 자동 seed 는 트리거가 internal 을 직접 호출하므로 영향 없음.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 회사 INSERT 트리거: internal 을 직접 호출하도록 갱신
--    (회사 생성 시점엔 멤버가 없어 is_company_admin() 이 false 라 게이트 함수를 못 씀)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._seed_allowances_on_company_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._seed_legal_allowances_internal(NEW.id);
  RETURN NEW;
END;
$$;

-- 트리거 자체 재선언 불필요 (FUNCTION 만 REPLACE 했고 트리거는 같은 함수를 가리킴).
-- 단, 함수 RPC 노출은 다시 확실히 차단 (안전망).
REVOKE ALL ON FUNCTION public._seed_allowances_on_company_insert() FROM PUBLIC, anon, authenticated;
