-- Migration: hr_contract_packages_and_leave_enhancement
-- Version: 20260309010446
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================================
-- 1. 계약 패키지 (여러 계약서를 묶어서 직원에게 발송)
-- ============================================================
CREATE TABLE hr_contract_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,                           -- "2026년 연봉계약 패키지"
  status TEXT NOT NULL DEFAULT 'draft',          -- draft → sent → partially_signed → completed → cancelled
  created_by UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                        -- 서명 기한
  sign_token TEXT UNIQUE,                        -- 외부 서명 URL 토큰
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. 패키지 내 개별 계약 문서
-- ============================================================
CREATE TABLE hr_contract_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES hr_contract_packages(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id),     -- 생성된 문서
  template_id UUID REFERENCES doc_templates(id), -- 원본 템플릿
  title TEXT NOT NULL,                           -- "연봉계약서"
  sort_order INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending → signed → rejected
  signed_at TIMESTAMPTZ,
  signature_data JSONB,                          -- 서명 이미지/좌표
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. 연차촉진 통보 이력 (근로기준법 §61)
-- ============================================================
CREATE TABLE leave_promotion_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  year INTEGER NOT NULL,                         -- 연차 귀속 연도
  notice_type TEXT NOT NULL,                     -- 'first' (6개월 전) | 'second' (2개월 전)
  unused_days NUMERIC(5,2) NOT NULL,             -- 미사용 연차일수
  sent_at TIMESTAMPTZ DEFAULT now(),
  sent_via TEXT DEFAULT 'email',                 -- email | system
  email_to TEXT,
  deadline DATE,                                 -- 사용 촉진 기한
  employee_response TEXT,                        -- 'plan_submitted' | 'no_response' | NULL
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. leave_requests에 연차 단위 컬럼 추가
-- ============================================================
ALTER TABLE leave_requests 
  ADD COLUMN IF NOT EXISTS leave_unit TEXT DEFAULT 'full_day',  -- full_day | half_day | two_hours
  ADD COLUMN IF NOT EXISTS start_time TEXT,                     -- "09:00" (2시간 단위용)
  ADD COLUMN IF NOT EXISTS end_time TEXT;                       -- "11:00"

-- ============================================================
-- 5. doc_templates에 카테고리/커스텀 컬럼 추가
-- ============================================================
ALTER TABLE doc_templates
  ADD COLUMN IF NOT EXISTS category TEXT,       -- 'contract_labor', 'nda', 'non_compete', 'privacy_consent', 'comprehensive_labor'
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;

-- ============================================================
-- 6. RLS 정책
-- ============================================================
ALTER TABLE hr_contract_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_contract_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_promotion_notices ENABLE ROW LEVEL SECURITY;

-- hr_contract_packages: 같은 회사 사용자 접근
CREATE POLICY "hr_contract_packages_company" ON hr_contract_packages
  FOR ALL USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- hr_contract_package_items: 패키지를 통해 접근
CREATE POLICY "hr_contract_package_items_access" ON hr_contract_package_items
  FOR ALL USING (
    package_id IN (
      SELECT id FROM hr_contract_packages 
      WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
    )
  );

-- leave_promotion_notices: 같은 회사 사용자 접근
CREATE POLICY "leave_promotion_notices_company" ON leave_promotion_notices
  FOR ALL USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- 외부 서명용: sign_token으로 패키지 조회 (비인증 접근)
CREATE POLICY "hr_contract_packages_sign_token" ON hr_contract_packages
  FOR SELECT USING (sign_token IS NOT NULL);

CREATE POLICY "hr_contract_package_items_sign_token" ON hr_contract_package_items
  FOR SELECT USING (
    package_id IN (SELECT id FROM hr_contract_packages WHERE sign_token IS NOT NULL)
  );

-- ============================================================
-- 7. 인덱스
-- ============================================================
CREATE INDEX idx_hr_contract_packages_company ON hr_contract_packages(company_id);
CREATE INDEX idx_hr_contract_packages_employee ON hr_contract_packages(employee_id);
CREATE INDEX idx_hr_contract_packages_token ON hr_contract_packages(sign_token);
CREATE INDEX idx_hr_contract_package_items_package ON hr_contract_package_items(package_id);
CREATE INDEX idx_leave_promotion_notices_company ON leave_promotion_notices(company_id);
CREATE INDEX idx_leave_promotion_notices_employee ON leave_promotion_notices(employee_id, year);
