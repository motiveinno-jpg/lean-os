-- AI 참모 대화 기록 테이블
-- 클라이언트(브라우저)에서 직접 INSERT/SELECT 가능
-- 페이지 재진입 시 기록 복원 목적

CREATE TABLE IF NOT EXISTS ai_copilot_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  query       text NOT NULL,
  answer      jsonb,           -- { headline, summary, actions, risks, opportunities, evidence }
  as_of       text,            -- edge function이 반환한 데이터 기준 시각
  model       text,
  created_at  timestamptz DEFAULT now()
);

-- 인덱스: 회사별 최근 기록 조회용
CREATE INDEX IF NOT EXISTS ai_copilot_history_company_created
  ON ai_copilot_history(company_id, created_at DESC);

-- RLS 활성화
ALTER TABLE ai_copilot_history ENABLE ROW LEVEL SECURITY;

-- 정책: 같은 company만 SELECT/INSERT (SECURITY DEFINER 헬퍼 사용)
CREATE POLICY ai_copilot_history_select
  ON ai_copilot_history FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY ai_copilot_history_insert
  ON ai_copilot_history FOR INSERT
  WITH CHECK (company_id = get_my_company_id());
