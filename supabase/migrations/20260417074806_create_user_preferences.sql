-- Migration: create_user_preferences
-- Version: 20260417074806
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================================
-- 사용자 환경설정 (대시보드 위젯 + 핀 고정 + 역할 프리셋)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- 역할 프리셋 (온보딩에서 선택)
  role_preset text DEFAULT 'ceo',  -- 'ceo' | 'accounting' | 'hr' | 'sales'
  
  -- 대시보드 위젯 설정 (JSON: { widgetId: { visible: bool, order: number } })
  dashboard_widgets jsonb DEFAULT '{}',
  
  -- 핀 고정 페이지 (JSON array: ["/deals", "/transactions"])
  pinned_pages jsonb DEFAULT '[]',
  
  -- 기타 환경설정
  sidebar_collapsed boolean DEFAULT false,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_up_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_up_company ON user_preferences(company_id);

-- RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- 본인만 조회/수정
CREATE POLICY "up_select" ON user_preferences FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "up_insert" ON user_preferences FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "up_update" ON user_preferences FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "up_delete" ON user_preferences FOR DELETE USING (user_id = auth.uid());
