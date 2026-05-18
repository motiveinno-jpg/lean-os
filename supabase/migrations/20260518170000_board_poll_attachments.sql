-- 게시판 확장 (작업2): 글 작성 시 일정·투표·사진·파일 첨부
-- ops-agent 위임 → db-architect 적용
-- [1] board_posts 신규 컬럼 (event_date / poll_question / poll_options / attachments)
-- [2] board_poll_votes 신규 테이블 + RLS 4종 (1인1표, 회사 격리)
-- [3] Storage 'board-files' 버킷 + 정책 4종 (회사 경로 격리, 50MB)
-- 검증된 스키마 사실:
--   * users.auth_id (uuid) 가 auth.uid() 매핑 컬럼  (NOT user_id)
--   * get_my_company_id() = SELECT company_id FROM users WHERE auth_id = auth.uid()
--   * board_posts RLS = board_posts_company FOR ALL (company_id=get_my_company_id()) → 행 단위, 신규 컬럼 자동 커버
--   * schedule_events.end_at 이미 존재 (hr-agent 작업3 — 변경 불필요, 본 파일에서 다루지 않음)

-- ============================================================
-- [1] board_posts 컬럼 추가
-- ============================================================
ALTER TABLE board_posts
  ADD COLUMN IF NOT EXISTS event_date   date,
  ADD COLUMN IF NOT EXISTS poll_question text,
  ADD COLUMN IF NOT EXISTS poll_options  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments   jsonb NOT NULL DEFAULT '[]'::jsonb;
-- 기존 board_posts_company (FOR ALL, company_id=get_my_company_id()) 는 행 단위라
-- 신규 컬럼을 자동 커버. 정책 변경 불필요.

-- ============================================================
-- [2] board_poll_votes 신규 테이블 (1인 1표)
-- ============================================================
CREATE TABLE IF NOT EXISTS board_poll_votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  option_index int  NOT NULL CHECK (option_index >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_poll_votes_post ON board_poll_votes(post_id);
-- RLS 본인 판별 서브쿼리(users.auth_id=auth.uid())가 user_id 필터에 쓰이므로
-- company_id 격리 + 본인 조회 효율을 위해 보조 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_board_poll_votes_company ON board_poll_votes(company_id);

ALTER TABLE board_poll_votes ENABLE ROW LEVEL SECURITY;

-- 본인 users.id = (SELECT id FROM users WHERE auth_id = auth.uid())
-- schedule_events 의 검증된 패턴과 동일.

DROP POLICY IF EXISTS board_poll_votes_select ON board_poll_votes;
CREATE POLICY board_poll_votes_select ON board_poll_votes
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS board_poll_votes_insert ON board_poll_votes;
CREATE POLICY board_poll_votes_insert ON board_poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );

DROP POLICY IF EXISTS board_poll_votes_update ON board_poll_votes;
CREATE POLICY board_poll_votes_update ON board_poll_votes
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );

DROP POLICY IF EXISTS board_poll_votes_delete ON board_poll_votes;
CREATE POLICY board_poll_votes_delete ON board_poll_votes
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );

-- ============================================================
-- [3] Storage bucket 'board-files' (사내 공개, 50MB, 회사 경로 격리)
--   기존 deal-files 컨벤션(public=true, 50MB=52428800) 따름.
--   단, deal-files 의 정책은 bucket_id 만 검사하여 회사 격리가 없으므로
--   본 버킷은 경로 첫 세그먼트(companyId)=get_my_company_id() 로 격리 강화.
--   업로드 경로 규약: <companyId>/<postId>/<filename>
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('board-files', 'board-files', true, 52428800)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS board_files_select ON storage.objects;
CREATE POLICY board_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'board-files'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
  );

DROP POLICY IF EXISTS board_files_insert ON storage.objects;
CREATE POLICY board_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'board-files'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
  );

DROP POLICY IF EXISTS board_files_update ON storage.objects;
CREATE POLICY board_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'board-files'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
  )
  WITH CHECK (
    bucket_id = 'board-files'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
  );

DROP POLICY IF EXISTS board_files_delete ON storage.objects;
CREATE POLICY board_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'board-files'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
  );
