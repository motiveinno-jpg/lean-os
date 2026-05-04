-- Migration: fix_role_constraint_and_missing_tables
-- Version: 20260307061055
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1. 기존 제약 제거
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. 기존 staff → employee 변환
UPDATE users SET role = 'employee' WHERE role = 'staff';
UPDATE users SET role = 'admin' WHERE role = 'manager';

-- 3. 앱 코드에 맞는 제약 재생성
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('owner', 'admin', 'employee', 'partner'));

-- 4. approval_requests 테이블 생성
CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES approval_policies(id),
  request_type text NOT NULL DEFAULT 'custom' 
    CHECK (request_type IN ('expense','payment','leave','overtime','purchase','contract','travel','card_expense','equipment','custom')),
  request_id uuid,
  requester_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  amount numeric DEFAULT 0,
  description text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  current_stage integer DEFAULT 1,
  total_stages integer DEFAULT 1,
  attachments text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 5. approval_steps 테이블 생성
CREATE TABLE IF NOT EXISTS approval_steps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  stage integer NOT NULL DEFAULT 1,
  stage_name text,
  approver_id uuid NOT NULL REFERENCES users(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','skipped')),
  comment text,
  decided_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 6. RLS 활성화
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;

-- 7. RLS 정책
CREATE POLICY "Company members can view approval requests"
  ON approval_requests FOR SELECT TO authenticated
  USING (company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Company members can insert approval requests"
  ON approval_requests FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Company members can update approval requests"
  ON approval_requests FOR UPDATE TO authenticated
  USING (company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Approval steps viewable by company members"
  ON approval_steps FOR SELECT TO authenticated
  USING (request_id IN (
    SELECT id FROM approval_requests 
    WHERE company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid())
  ));

CREATE POLICY "Approval steps updatable by approvers"
  ON approval_steps FOR UPDATE TO authenticated
  USING (approver_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Approval steps insertable by company members"
  ON approval_steps FOR INSERT TO authenticated
  WITH CHECK (request_id IN (
    SELECT id FROM approval_requests 
    WHERE company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid())
  ));

-- 8. 인덱스
CREATE INDEX IF NOT EXISTS idx_approval_requests_company_status 
  ON approval_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester 
  ON approval_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_request 
  ON approval_steps(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_approver 
  ON approval_steps(approver_id, status);
