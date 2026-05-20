-- v4 B1: 게시판 댓글 답글 + @멘션.
--   parent_comment_id: 답글 트리 (depth-1만 — 트리 깊이 제한 UI/RLS 단순화)
--   mentioned_user_ids: 멘션받은 사용자 uuid[] — 알림 트리거용 (클라이언트가 notifications INSERT, DB 트리거 X)
--
-- 사전조사:
--   board_comments 컬럼 = id, post_id, company_id, author_id, author_name, content, created_at
--   기존 RLS = 단일 ALL 정책 board_comments_company (USING=WITH CHECK=(company_id = get_my_company_id()))
--   → 회사격리 그대로 유지, 신규 컬럼은 동일 회사 안에서 자유로이 참조 가능.

-- 1) 컬럼 추가 (멱등)
ALTER TABLE public.board_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES public.board_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] DEFAULT '{}';

-- 2) depth-1 제약 — 답글의 답글 금지 (parent 가 또 parent 를 가지면 안 됨)
--    CHECK 제약은 row-level 만 가능, 다른 행 참조 불가 → 트리거로 검증
CREATE OR REPLACE FUNCTION public.board_comments_depth_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.board_comments
      WHERE id = NEW.parent_comment_id AND parent_comment_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'board_comments depth-1 only — cannot reply to a reply';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS board_comments_depth_check ON public.board_comments;
CREATE TRIGGER board_comments_depth_check
  BEFORE INSERT OR UPDATE OF parent_comment_id ON public.board_comments
  FOR EACH ROW EXECUTE FUNCTION public.board_comments_depth_check();

-- 3) 인덱스 — 답글 펼치기 빠름
CREATE INDEX IF NOT EXISTS idx_board_comments_parent
  ON public.board_comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

-- 4) RLS 정책 무수정 (기존 회사격리 그대로 — parent_comment_id/mentioned_user_ids 추가 정책 불필요)

COMMENT ON COLUMN public.board_comments.parent_comment_id IS 'v4 B1: 답글 트리 (depth-1 only, 트리거 board_comments_depth_check 검증). NULL=일반 댓글, NOT NULL=답글.';
COMMENT ON COLUMN public.board_comments.mentioned_user_ids IS 'v4 B1: @멘션 사용자 uuid[]. 알림은 클라이언트가 notifications INSERT (DB 트리거 X).';
