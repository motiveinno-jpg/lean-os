-- 게시판 상단 고정은 마스터(또는 '/board:pin' 권한 위임자)만 (2026-08-05 사장님 제보)
--   그동안 board_posts 의 정책은 회사 격리(board_posts_company) 뿐이라, 같은 회사면
--   누구나 남의 글까지 고정·해제할 수 있었다. 화면 버튼만 감추면 API 로 우회되므로
--   pinned 컬럼이 실제로 바뀔 때 DB 에서 막는다.
--   (수정·삭제 등 다른 UPDATE 는 기존 그대로 — pinned 가 안 바뀌면 이 트리거는 통과)

CREATE OR REPLACE FUNCTION public.enforce_board_pin_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_is_master boolean;
  v_has_perm boolean;
BEGIN
  -- pinned 가 그대로면 검사 대상 아님
  IF NEW.pinned IS NOT DISTINCT FROM OLD.pinned THEN
    RETURN NEW;
  END IF;

  -- 서버 작업(엣지 함수·마이그레이션 등 auth 컨텍스트 없음)은 통과
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.id, COALESCE(u.is_master, false)
    INTO v_user_id, v_is_master
    FROM public.users u
   WHERE u.auth_id = auth.uid()          -- 신원 대조는 auth_id 만 (users.id 금지)
   LIMIT 1;

  IF v_is_master THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.member_permissions mp
     WHERE mp.user_id = v_user_id
       AND mp.perm_key = '/board:pin'
  ) INTO v_has_perm;

  IF v_has_perm THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '게시글 상단 고정·해제는 관리자만 할 수 있습니다'
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS board_posts_pin_permission ON public.board_posts;
CREATE TRIGGER board_posts_pin_permission
  BEFORE UPDATE ON public.board_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_board_pin_permission();
