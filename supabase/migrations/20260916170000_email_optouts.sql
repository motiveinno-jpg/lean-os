-- 광고 메일 수신거부 목록 (2026-09-16)
--   배경: 서비스 소개서를 첨부한 소개 메일을 보내기로 하면서, 정보통신망법 제50조가 요구하는
--     「수신거부 의사를 쉽고 무료로 밝힐 수 있는 방법」을 갖춰야 했다. 발송은 당분간 사람이 수동으로 하고,
--     목록만 우리가 쥔다(사장님 확정 (가)안).
--
--   왜 여기에 두나: 회사(테넌트) 데이터가 아니다. 아직 고객이 아닌 사람의 주소이므로 company_id 가 없고,
--     플랫폼 전역 목록이다. 그래서 partnership_inquiries 와 같은 보호 방식을 그대로 쓴다 —
--     RLS 켜고 정책 0개(사용자 세션으로는 읽기·쓰기 불가), 쓰기는 service_role(API 라우트),
--     읽기·수정은 operator_* SECURITY DEFINER RPC.
--
--   버린 안: anon INSERT 정책을 열어 페이지에서 바로 넣는 방식. 공개 anon 키로 목록을 무제한 적재할 수 있고
--     (스팸), 무엇보다 SELECT 를 막아도 INSERT 충돌 반응으로 특정 주소의 등록 여부를 캐낼 수 있다.
--     → /api/unsubscribe (service_role + 레이트리밋) 경유로 간다. /api/track 과 같은 패턴.

-- ============================================================
-- 1) 목록 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  -- 어디로 들어온 거부인지. 나중에 자동 발송으로 가면 반송·스팸신고도 같은 목록으로 모인다.
  source text NOT NULL DEFAULT 'self'
    CHECK (source IN ('self', 'reply', 'manual', 'bounce', 'complaint')),
  note text,
  -- IP 는 남기지 않는다 — /api/partnership 과 같은 방침(「IP 는 PII 라 저장하지 않음」).
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 운영자가 손으로 넣은 건만 채운다. 본인이 페이지에서 뺀 건은 NULL.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 대소문자·앞뒤 공백이 다른 같은 주소가 각각 들어가면 거른 목록이 새어 거부한 사람에게 또 나간다.
--   저장 직전에 항상 정규화한다(BEFORE 트리거는 유일 제약 검사보다 먼저 돈다 → ON CONFLICT (email) 도 정상 동작).
CREATE OR REPLACE FUNCTION public.email_optouts_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  IF NEW.email = '' OR position('@' in NEW.email) = 0 THEN
    RAISE EXCEPTION 'invalid email';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_optouts_normalize_trg ON public.email_optouts;
CREATE TRIGGER email_optouts_normalize_trg
  BEFORE INSERT OR UPDATE ON public.email_optouts
  FOR EACH ROW EXECUTE FUNCTION public.email_optouts_normalize();

CREATE UNIQUE INDEX IF NOT EXISTS email_optouts_email_key
  ON public.email_optouts (email);
CREATE INDEX IF NOT EXISTS email_optouts_created_idx
  ON public.email_optouts (created_at DESC);

-- ============================================================
-- 2) RLS — 켜고, 정책은 만들지 않는다
--    service_role 은 RLS 를 우회하므로 서버에서만 쓰기가 된다.
-- ============================================================
ALTER TABLE public.email_optouts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.email_optouts IS
  '광고 메일 수신거부 목록(정보통신망법 제50조). 쓰기는 /api/unsubscribe (service_role) 만, 읽기·수정은 operator_* RPC 만.';

-- ============================================================
-- 3) 운영자 RPC — is_platform_operator() 게이트
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_list_email_optouts(
  p_limit integer DEFAULT 500,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  source text,
  note text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer;
  v_q text;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_q := NULLIF(btrim(COALESCE(p_search, '')), '');

  RETURN QUERY
  SELECT eo.id, eo.email, eo.source, eo.note, eo.created_at
  FROM email_optouts eo
  WHERE v_q IS NULL
     OR eo.email ILIKE '%' || v_q || '%'
     OR COALESCE(eo.note, '') ILIKE '%' || v_q || '%'
  ORDER BY eo.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_list_email_optouts(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_list_email_optouts(integer, text) TO authenticated;

-- 메일 회신으로 받은 수신거부를 운영자가 손으로 등록한다(수동 발송 단계에선 이쪽이 주 경로).
CREATE OR REPLACE FUNCTION public.operator_add_email_optout(
  p_email text,
  p_note text DEFAULT NULL,
  p_source text DEFAULT 'reply'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_source NOT IN ('reply', 'manual', 'bounce', 'complaint') THEN
    RAISE EXCEPTION 'invalid source';
  END IF;

  INSERT INTO email_optouts (email, source, note, created_by)
  VALUES (p_email, p_source, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  ON CONFLICT (email) DO NOTHING;

  -- 이미 있던 주소여도 「거부 상태」라는 결과는 같다 → 오류로 돌리지 않는다.
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_add_email_optout(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_add_email_optout(text, text, text) TO authenticated;

-- 잘못 등록한 것을 빼는 수단. 없으면 운영자가 실수를 되돌릴 방법이 없다.
CREATE OR REPLACE FUNCTION public.operator_remove_email_optout(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM email_optouts WHERE email = lower(btrim(p_email));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_remove_email_optout(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_remove_email_optout(text) TO authenticated;
