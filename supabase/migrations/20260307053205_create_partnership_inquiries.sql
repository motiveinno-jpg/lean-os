-- Migration: create_partnership_inquiries
-- Version: 20260307053205
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 제휴 문의 테이블
CREATE TABLE IF NOT EXISTS partnership_inquiries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  status text DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at timestamptz DEFAULT now()
);

-- 비인증 사용자도 insert 가능 (랜딩페이지에서 제출)
ALTER TABLE partnership_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert partnership inquiries"
  ON partnership_inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 읽기는 인증된 owner만
CREATE POLICY "Authenticated users can read inquiries"
  ON partnership_inquiries FOR SELECT
  TO authenticated
  USING (true);
