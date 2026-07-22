-- Migration: project_tasks_completed_at
-- 실행형 번업 차트용 — 태스크 완료 "시점"을 기록. status='done' 전환 시 자동 세팅.
--   기존엔 done 여부만 있어 완료 시점별 누적(번업)을 그릴 수 없었다.

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 백필 — 이미 done 인 태스크는 마지막 변경시각(updated_at)을 완료 시점으로 근사
UPDATE project_tasks
SET completed_at = COALESCE(updated_at, created_at)
WHERE status = 'done' AND completed_at IS NULL;

-- 상태 변경 시 completed_at 자동 유지 (done 진입 → 현재시각, done 해제 → NULL)
CREATE OR REPLACE FUNCTION public.trg_task_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done' THEN
    IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM 'done') THEN
      IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_completed_at ON project_tasks;
CREATE TRIGGER task_completed_at
  BEFORE INSERT OR UPDATE OF status ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_task_completed_at();
