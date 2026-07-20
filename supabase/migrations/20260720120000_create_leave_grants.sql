-- Migration: create_leave_grants
-- 연차 발생(부여) 이력 — leave_balances 는 연도별 합계 1행뿐이라 "몇 월 며칠에 몇 개 발생"을
-- 표현할 수 없었다. 입사일 기준 부여·월 발생(1년 미만 근속)·이월·수동조정을 날짜별로 쌓는다.
-- leave_balances 구조는 변경하지 않는다. total_days 는 앱에서 grants 합계로 동기화한다.

CREATE TABLE IF NOT EXISTS leave_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year integer NOT NULL,                                  -- 귀속 연도 (leave_balances.year 와 매칭)
  grant_date date NOT NULL,                               -- 발생 일자
  days numeric(4,1) NOT NULL,                             -- 발생 일수 (회수·조정 대비 음수 허용)
  grant_type text NOT NULL DEFAULT 'base'
    CHECK (grant_type IN ('base','monthly','carryover','adjustment')),
  memo text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leave_grants_employee_year_idx ON leave_grants (employee_id, year);
CREATE INDEX IF NOT EXISTS leave_grants_company_year_idx ON leave_grants (company_id, year);

-- RLS — 조회는 같은 회사(leave_balances 와 동일), 쓰기는 owner/admin 만(employee_files 패턴).
--   initplan 최적화 관용구((SELECT ...))를 기존 정책들과 동일하게 사용.
ALTER TABLE leave_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_grants_select" ON leave_grants
  FOR SELECT TO authenticated
  USING (company_id = (SELECT get_my_company_id()));

CREATE POLICY "leave_grants_insert" ON leave_grants
  FOR INSERT TO authenticated
  WITH CHECK (company_id IN (
    SELECT company_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner','admin')
  ));

CREATE POLICY "leave_grants_update" ON leave_grants
  FOR UPDATE TO authenticated
  USING (company_id IN (
    SELECT company_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner','admin')
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner','admin')
  ));

CREATE POLICY "leave_grants_delete" ON leave_grants
  FOR DELETE TO authenticated
  USING (company_id IN (
    SELECT company_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner','admin')
  ));

-- 백필 — 기존 연차 설정(leave_balances)을 각 연도 1월 1일 'base' 발생으로 이관. 멱등.
INSERT INTO leave_grants (company_id, employee_id, year, grant_date, days, grant_type, memo)
SELECT b.company_id, b.employee_id, b.year, make_date(b.year, 1, 1), b.total_days, 'base', '기존 연차 설정 이관'
FROM leave_balances b
WHERE b.total_days IS NOT NULL
  AND b.total_days <> 0
  AND NOT EXISTS (
    SELECT 1 FROM leave_grants g WHERE g.employee_id = b.employee_id AND g.year = b.year
  );
