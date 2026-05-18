-- Migration: announcements (서비스 공지사항/게시판)
-- 모든 회사/모든 사용자에게 보이는 플랫폼 공지. 작성은 서비스 운영자(@mo-tive.com)만.

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  category text NOT NULL DEFAULT 'notice',  -- notice | update | maintenance | event
  pinned boolean NOT NULL DEFAULT false,
  author_email text,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- 읽기: 로그인한 모든 사용자
DROP POLICY IF EXISTS "announcements_select_all" ON announcements;
CREATE POLICY "announcements_select_all" ON announcements
  FOR SELECT TO authenticated
  USING (true);

-- 쓰기/수정/삭제: 서비스 운영자(@mo-tive.com 이메일) 만
DROP POLICY IF EXISTS "announcements_write_operator" ON announcements;
CREATE POLICY "announcements_write_operator" ON announcements
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_id = auth.uid()
        AND u.email LIKE '%@mo-tive.com'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_id = auth.uid()
        AND u.email LIKE '%@mo-tive.com'
    )
  );

CREATE INDEX IF NOT EXISTS idx_announcements_pinned_created
  ON announcements(pinned DESC, created_at DESC);
