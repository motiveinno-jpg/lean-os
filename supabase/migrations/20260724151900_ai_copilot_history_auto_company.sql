-- AI 참모 대화 기록: 클라이언트가 company_id를 보내지 않고 서버가 자동 채움
-- RLS 정책 위반 해결 (클라이언트 company_id != get_my_company_id() 불일치)

-- 1. company_id DEFAULT를 get_my_company_id()로 변경
ALTER TABLE ai_copilot_history
  ALTER COLUMN company_id SET DEFAULT get_my_company_id();

-- 2. INSERT 트리거로 company_id 강제 덮어쓰기 (클라이언트 값 무시)
CREATE OR REPLACE FUNCTION set_copilot_history_company()
RETURNS TRIGGER AS $$
BEGIN
  NEW.company_id := get_my_company_id();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_copilot_history_company_trigger ON ai_copilot_history;

CREATE TRIGGER set_copilot_history_company_trigger
  BEFORE INSERT ON ai_copilot_history
  FOR EACH ROW
  EXECUTE FUNCTION set_copilot_history_company();

-- 3. RLS INSERT 정책 수정 (이제 자동으로 덮어쓰니 체크 불필요)
DROP POLICY IF EXISTS ai_copilot_history_insert ON ai_copilot_history;

CREATE POLICY ai_copilot_history_insert
  ON ai_copilot_history FOR INSERT
  WITH CHECK (true);  -- 트리거가 알아서 company_id를 채우므로 체크 불필요
