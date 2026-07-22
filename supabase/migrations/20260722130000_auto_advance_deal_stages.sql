-- Migration: auto_advance_deal_stages
-- 프로젝트 단계(deals.stage) 자동 전환 — 사용자가 단계 드롭다운을 안 옮기고 작업하는 패턴 대응.
--   견적 → 계약 → 진행 → 완료 → 정산 중, 확실한 신호로 "앞으로만" 자동 전진(regress 안 함).
--   · → 진행(in_progress): 실행형에 태스크 1개+ 있거나, 시작일이 지남(= 작업 시작)
--   · → 완료(completed): 실행형이고 태스크 있고 전부 done(= 납품 완료)
--   계약·정산은 판단이 모호해 자동 전환 안 함(수동/제안 유지).
--   수동으로 올려둔 더 높은 단계는 절대 덮지 않음(forward-only).

CREATE OR REPLACE FUNCTION public.advance_deal_stages(p_deal_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_n int := 0;
BEGIN
  WITH ord(stage, pos) AS (
    VALUES ('estimate', 1), ('contract', 2), ('in_progress', 3), ('completed', 4), ('settlement', 5)
  ),
  sig AS (
    SELECT d.id, COALESCE(d.stage, 'estimate') AS cur_stage, d.project_type, d.start_date,
      (SELECT count(*) FROM project_tasks t WHERE t.deal_id = d.id AND t.archived_at IS NULL) AS task_total,
      (SELECT count(*) FROM project_tasks t WHERE t.deal_id = d.id AND t.archived_at IS NULL AND t.status = 'done') AS task_done
    FROM deals d
    WHERE d.archived_at IS NULL
      AND (p_deal_id IS NULL OR d.id = p_deal_id)
  ),
  target AS (
    SELECT id, cur_stage,
      CASE
        WHEN project_type = 'delivery' AND task_total > 0 AND task_done = task_total THEN 'completed'
        WHEN task_total > 0 OR (start_date IS NOT NULL AND start_date <= v_today) THEN 'in_progress'
        ELSE 'estimate'
      END AS target_stage
    FROM sig
  ),
  ranked AS (
    SELECT tg.id, tg.target_stage, oc.pos AS cur_pos, ot.pos AS tgt_pos
    FROM target tg
    JOIN ord oc ON oc.stage = tg.cur_stage
    JOIN ord ot ON ot.stage = tg.target_stage
  )
  UPDATE deals d
  SET stage = r.target_stage
  FROM ranked r
  WHERE d.id = r.id
    AND r.tgt_pos > r.cur_pos;   -- 앞으로만(forward-only)
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_deal_stages(uuid) FROM PUBLIC, anon, authenticated;

-- 태스크 변경 시 해당 프로젝트 단계 즉시 재계산(생성·상태변경·보관·삭제)
CREATE OR REPLACE FUNCTION public.trg_advance_deal_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.advance_deal_stages(COALESCE(NEW.deal_id, OLD.deal_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deal_stage_on_task ON project_tasks;
CREATE TRIGGER deal_stage_on_task
  AFTER INSERT OR DELETE OR UPDATE OF status, archived_at, deal_id ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_advance_deal_stage();

-- 시작일 도래는 이벤트가 없으므로 매일 자정(KST 00:20) 일괄 재계산
SELECT cron.unschedule('deal-stage-advance')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deal-stage-advance');
SELECT cron.schedule('deal-stage-advance', '20 15 * * *', $cron$SELECT public.advance_deal_stages()$cron$);

-- 기존 데이터 1회 정합화(멈춰있던 견적 프로젝트 전진)
SELECT public.advance_deal_stages();
