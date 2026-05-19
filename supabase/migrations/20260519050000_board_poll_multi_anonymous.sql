-- Migration: board_poll_multi_anonymous  (직원 재작업 R13 / R14)
-- ─────────────────────────────────────────────────────────────────────────
-- R13: 게시판 투표 복수(중복) 선택 허용
-- R14: 투표 익명/실명 모드 — 익명이면 투표자 신원 비노출(집계만), 실명이면 표시
--
-- 설계 요지
--  [1] board_posts 에 poll_multi / poll_anonymous boolean 컬럼 추가
--      (DEFAULT false → 기존 글·기존 동작 100% 불변, 회귀 없음)
--  [2] board_poll_votes UNIQUE 재설계
--      현재 제약: UNIQUE (post_id, user_id)  ← 1인1표 강제
--        (정의처: 20260518170000_board_poll_attachments.sql L33,
--         이름은 PG 자동명명 board_poll_votes_post_id_user_id_key)
--      복수선택 시 한 사용자가 동일 글에서 여러 option 행을 가져야 하므로
--      → UNIQUE (post_id, user_id, option_index) 로 교체.
--        같은 옵션 중복 INSERT 만 차단, 서로 다른 옵션 복수표 허용.
--        단일선택 폴은 앱이 1행만 유지(스키마는 허용적 — 회귀 없음).
--      기존 데이터: 현재 user당 1행이므로 (post_id,user_id,option_index)
--        조합도 유일 → 새 제약과 충돌 0. 멱등 DROP/ADD.
--  [3] 익명 처리: board_poll_votes RLS(회사격리/initplan, 20260518170100)
--      는 그대로 유지. 익명은 RLS 로 행을 숨기지 않는다(집계엔 모든 행 필요).
--      신원 비노출은 조회 projection 책임 → SECURITY DEFINER 집계 RPC
--      get_poll_results(p_post_id uuid) 신설:
--        - 실명 폴: 옵션별 표수 + 투표자 user_id 목록 반환
--        - 익명 폴: 옵션별 표수만, 투표자 식별자(user_id) 절대 미반환
--      get_my_company_id() / is_company_owner() / get_company_directory()
--      와 동일 패턴(STABLE + SECURITY DEFINER + SET search_path=public).
--      함수 본문은 board_posts / board_poll_votes 만 참조 — users/employees
--      인라인 서브쿼리 없음, 회사 격리는 get_my_company_id() 헬퍼 호출로만
--      수행 → RLS 재귀 게이트(feedback_rls_recursion_gate) 준수.
--
-- 검증된 스키마 사실 (정적 확인)
--  * board_poll_votes: id,post_id,company_id,user_id,option_index,created_at
--  * 기존 UNIQUE = (post_id, user_id)  [board_poll_attachments.sql 정의]
--  * board_poll_votes 이후 변경 마이그레이션 없음(initplan RLS 1건 뿐)
--  * get_my_company_id() = SELECT company_id FROM users WHERE auth_id=auth.uid()
--    (SECURITY DEFINER, STABLE, search_path=public)
-- ─────────────────────────────────────────────────────────────────────────

SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- ============================================================
-- [1] board_posts 투표 플래그 컬럼 (기본 false → 동작 불변)
-- ============================================================
ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS poll_multi     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS poll_anonymous boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.board_posts.poll_multi IS
  'R13: true면 해당 글 투표에서 복수(중복) 선택 허용. 기본 false=단일선택(기존 동작).';
COMMENT ON COLUMN public.board_posts.poll_anonymous IS
  'R14: true면 익명 투표 — 집계만 노출, 투표자 신원 비노출(get_poll_results 책임). 기본 false=실명.';

-- 기존 board_posts_company (FOR ALL, company_id=get_my_company_id()) 는
-- 행 단위 정책이라 신규 컬럼을 자동 커버. 정책 변경 불필요.

-- ============================================================
-- [2] board_poll_votes UNIQUE 재설계 (복수선택 허용, 멱등)
--   기존 (post_id,user_id) → (post_id,user_id,option_index)
--   PG 자동명명 제약(board_poll_votes_post_id_user_id_key)을 제거하고
--   명시 명명 제약을 부여. ADD CONSTRAINT 는 IF NOT EXISTS 미지원이므로
--   존재 여부를 pg_constraint 로 가드한 DO 블록 사용(멱등).
-- ============================================================
ALTER TABLE public.board_poll_votes
  DROP CONSTRAINT IF EXISTS board_poll_votes_post_id_user_id_key;

-- (혹시 과거에 본 마이그레이션이 부분 적용돼 새 이름이 이미 있으면 정리)
ALTER TABLE public.board_poll_votes
  DROP CONSTRAINT IF EXISTS board_poll_votes_post_user_option_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'board_poll_votes_post_user_option_key'
      AND conrelid = 'public.board_poll_votes'::regclass
  ) THEN
    -- 충돌 안전성: 기존 행은 user당 1행이라 (post_id,user_id,option_index)
    -- 조합이 이미 유일 → 제약 추가 시 위반 0건.
    ALTER TABLE public.board_poll_votes
      ADD CONSTRAINT board_poll_votes_post_user_option_key
      UNIQUE (post_id, user_id, option_index);
  END IF;
END$$;

COMMENT ON CONSTRAINT board_poll_votes_post_user_option_key ON public.board_poll_votes IS
  'R13: 동일 옵션 중복표만 차단. 한 사용자가 한 글에서 서로 다른 옵션 복수표 허용. 단일선택 폴은 앱이 1행만 유지.';

-- ============================================================
-- [3] 안전 집계 RPC get_poll_results(p_post_id uuid)
--   익명 폴: 표수만. 실명 폴: 표수 + voter_user_ids.
--   SECURITY DEFINER 라 board_poll_votes RESTRICTIVE/회사격리 RLS 우회
--   가능하지만, 함수가 직접 회사 격리:
--     - p.company_id = get_my_company_id() AND v.company_id = get_my_company_id()
--   → 타 회사 글/표 절대 미반환. p_post_id 만 인자(회사 위조 불가).
--   재귀/인라인 서브쿼리 없음: users/employees 미참조, 회사 판정은
--   get_my_company_id() 헬퍼(SECURITY DEFINER) 호출로만.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_poll_results(p_post_id uuid)
RETURNS TABLE (
  option_index   int,
  vote_count     bigint,
  is_anonymous   boolean,
  voter_user_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT bp.id, bp.company_id, bp.poll_anonymous
    FROM board_posts bp
    WHERE bp.id = p_post_id
      AND bp.company_id = get_my_company_id()   -- 호출자 회사 글만
  )
  SELECT
    v.option_index,
    count(*)::bigint AS vote_count,
    t.poll_anonymous AS is_anonymous,
    CASE
      WHEN t.poll_anonymous THEN NULL::uuid[]                 -- 익명: 신원 미반환
      ELSE array_agg(v.user_id ORDER BY v.created_at)         -- 실명: 투표자 목록
    END AS voter_user_ids
  FROM target t
  JOIN board_poll_votes v
    ON v.post_id = t.id
   AND v.company_id = get_my_company_id()                     -- 표도 회사 격리
  GROUP BY v.option_index, t.poll_anonymous
  ORDER BY v.option_index;
$function$;

-- anon 제외: 로그인 사용자(authenticated)만 호출.
REVOKE ALL ON FUNCTION public.get_poll_results(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_poll_results(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_poll_results(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_poll_results(uuid) IS
  'R14 안전 집계. 호출자 회사(get_my_company_id())의 글만, 옵션별 표수 반환. 익명 폴이면 voter_user_ids=NULL(신원 비노출), 실명 폴이면 투표자 user_id 목록. SECURITY DEFINER — board_poll_votes 회사격리 RLS 우회용. authenticated 전용. users/employees 미참조 → RLS 재귀 없음.';
