-- Migration: create_permission_groups
-- Version: 20260417071731
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================================
-- 권한 그룹 시스템 (플렉스 스타일)
-- ============================================================

-- 1. 권한 그룹 정의
CREATE TABLE IF NOT EXISTS permission_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  icon text DEFAULT 'shield',
  is_system boolean DEFAULT false,  -- 시스템 기본 그룹 (삭제 불가)
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, name)
);

-- 2. 모듈별 세부 권한 정의
CREATE TABLE IF NOT EXISTS permission_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,        -- 'dashboard','deals','invoices','hr','payroll','accounting','documents','chat','settings'
  action text NOT NULL,        -- 'view','create','edit','delete','approve','export'
  label text NOT NULL,         -- 표시명: '대시보드 조회', '딜 생성' 등
  description text DEFAULT '',
  sort_order int DEFAULT 0,
  UNIQUE(module, action)
);

-- 3. 그룹 ↔ 권한 매핑
CREATE TABLE IF NOT EXISTS permission_group_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission_definitions(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, permission_id)
);

-- 4. 구성원 ↔ 그룹 매핑
CREATE TABLE IF NOT EXISTS permission_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_pg_company ON permission_groups(company_id);
CREATE INDEX IF NOT EXISTS idx_pgp_group ON permission_group_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_pgm_user ON permission_group_members(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_pgm_group ON permission_group_members(group_id);

-- ============================================================
-- RLS 정책
-- ============================================================

ALTER TABLE permission_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_group_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_group_members ENABLE ROW LEVEL SECURITY;

-- permission_groups: 같은 회사 구성원만 조회, owner/admin만 수정
CREATE POLICY "pg_select" ON permission_groups FOR SELECT USING (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
);
CREATE POLICY "pg_insert" ON permission_groups FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin'))
);
CREATE POLICY "pg_update" ON permission_groups FOR UPDATE USING (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin'))
);
CREATE POLICY "pg_delete" ON permission_groups FOR DELETE USING (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin'))
  AND is_system = false
);

-- permission_definitions: 전체 공개 (시스템 데이터)
CREATE POLICY "pd_select" ON permission_definitions FOR SELECT USING (true);

-- permission_group_permissions: 같은 회사만 조회, owner/admin만 수정
CREATE POLICY "pgp_select" ON permission_group_permissions FOR SELECT USING (
  group_id IN (SELECT id FROM permission_groups WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid()))
);
CREATE POLICY "pgp_insert" ON permission_group_permissions FOR INSERT WITH CHECK (
  group_id IN (SELECT id FROM permission_groups WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin')))
);
CREATE POLICY "pgp_delete" ON permission_group_permissions FOR DELETE USING (
  group_id IN (SELECT id FROM permission_groups WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin')))
);

-- permission_group_members: 같은 회사만 조회, owner/admin만 수정
CREATE POLICY "pgm_select" ON permission_group_members FOR SELECT USING (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
);
CREATE POLICY "pgm_insert" ON permission_group_members FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin'))
);
CREATE POLICY "pgm_delete" ON permission_group_members FOR DELETE USING (
  company_id IN (SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin'))
);

-- ============================================================
-- 기본 권한 정의 시드 (모든 회사 공용)
-- ============================================================

INSERT INTO permission_definitions (module, action, label, description, sort_order) VALUES
  -- 대시보드
  ('dashboard', 'view', '대시보드 조회', '대시보드 6-Pack 지표 조회', 100),
  -- 딜 파이프라인
  ('deals', 'view', '딜 조회', '딜/견적 목록 조회', 200),
  ('deals', 'create', '딜 생성', '새 딜/견적 생성', 201),
  ('deals', 'edit', '딜 수정', '딜/견적 수정', 202),
  ('deals', 'delete', '딜 삭제', '딜/견적 삭제', 203),
  ('deals', 'approve', '딜 승인', '딜/견적 승인', 204),
  -- 세금계산서
  ('invoices', 'view', '세금계산서 조회', '세금계산서/매칭 조회', 300),
  ('invoices', 'create', '세금계산서 발행', '세금계산서 발행', 301),
  ('invoices', 'edit', '세금계산서 수정', '세금계산서 수정', 302),
  ('invoices', 'delete', '세금계산서 삭제', '세금계산서 삭제', 303),
  -- HR / 직원관리
  ('hr', 'view', '구성원 조회', '구성원 정보 조회', 400),
  ('hr', 'create', '구성원 등록', '신규 구성원 등록', 401),
  ('hr', 'edit', '구성원 수정', '구성원 정보 수정', 402),
  ('hr', 'delete', '구성원 삭제', '구성원 삭제', 403),
  -- 급여
  ('payroll', 'view', '급여 조회', '급여 명세서 조회', 500),
  ('payroll', 'create', '급여 실행', '급여 계산/지급 실행', 501),
  ('payroll', 'edit', '급여 수정', '급여 항목 수정', 502),
  ('payroll', 'approve', '급여 승인', '급여 지급 승인', 503),
  -- 근태
  ('attendance', 'view', '근태 조회', '출퇴근/근태 조회', 550),
  ('attendance', 'edit', '근태 수정', '근태 기록 수정', 551),
  ('attendance', 'approve', '근태 승인', '휴가/연차 승인', 552),
  -- 회계/거래내역
  ('accounting', 'view', '거래내역 조회', '입출금/거래내역 조회', 600),
  ('accounting', 'create', '거래 등록', '수동 거래 등록', 601),
  ('accounting', 'edit', '거래 수정', '거래 분류/수정', 602),
  ('accounting', 'export', '거래 내보내기', '거래내역 엑셀 다운로드', 603),
  -- 계약/문서
  ('documents', 'view', '문서 조회', '계약서/문서 조회', 700),
  ('documents', 'create', '문서 생성', '계약서/문서 생성', 701),
  ('documents', 'edit', '문서 수정', '문서 수정', 702),
  ('documents', 'delete', '문서 삭제', '문서 삭제', 703),
  ('documents', 'approve', '문서 서명', '전자서명/승인', 704),
  -- 채팅
  ('chat', 'view', '채팅 조회', '팀 채팅 조회', 800),
  ('chat', 'create', '채팅 전송', '메시지 전송', 801),
  -- 거래처
  ('contacts', 'view', '거래처 조회', '거래처 DB 조회', 900),
  ('contacts', 'create', '거래처 등록', '새 거래처 등록', 901),
  ('contacts', 'edit', '거래처 수정', '거래처 정보 수정', 902),
  ('contacts', 'delete', '거래처 삭제', '거래처 삭제', 903),
  -- 설정
  ('settings', 'view', '설정 조회', '회사 설정 조회', 1000),
  ('settings', 'edit', '설정 수정', '회사 설정 수정', 1001),
  ('settings', 'manage_members', '구성원 관리', '초대/권한 관리', 1002),
  ('settings', 'manage_billing', '구독 관리', '구독/결제 관리', 1003)
ON CONFLICT (module, action) DO NOTHING;
