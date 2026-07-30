-- Migration: 프로젝트 유형(project_type) 폐지 + 단계 자동 전진을 이벤트 기반으로 확장
--
-- 배경 (2026-07-30 사장님 승인, 기획 v3 4단계):
--   유형 3분할(margin/goal/delivery)이 생성 후 변경 불가라 수익형 프로젝트 30개가 진행률·성과를
--   영구히 쓸 수 없었다. 앱에서 유형 참조를 전부 제거했으므로 컬럼도 내린다.
--
-- ⚠️⚠️ 실행 순서 주의 — 이 마이그레이션은 **새 앱 코드가 배포된 뒤에** 적용해야 한다.
--   현재 프로덕션에 배포된 코드는 deals.project_type 을 SELECT 한다. 코드 배포 전에 컬럼을
--   드롭하면 프로젝트 화면이 즉시 죽는다. 순서는 반드시:
--     ① 새 코드 배포(테스트 서버 → 프로덕션) → ② 화면 정상 확인 → ③ 이 마이그레이션 적용
--   되돌리기: 컬럼 재추가(아래 ROLLBACK 주석)만으로 옛 코드가 다시 동작한다(값은 전부 'margin').
--
-- 함께 처리하는 이유:
--   기존 advance_deal_stages() 가 project_type = 'delivery' 로 분기한다. 컬럼만 드롭하면
--   이 함수가 깨지므로 같은 트랜잭션에서 다시 만든다. 겸사겸사 "계약·정산은 판단이 모호해
--   자동 전환 안 함" 이던 제약을 실제 이벤트(서명 완료 · 계산서 전액 입금)로 풀어낸다.

-- ── 1) 단계 자동 전진 — 유형 분기 제거 + 계약·정산 이벤트 추가 ────────────────
--   신호(모두 확실한 것만):
--     · 서명 완료된 계약 문서가 있다        → 최소 '계약'
--     · 할 일이 있거나 시작일이 지났다        → 최소 '진행'
--     · 할 일이 전부 완료됐다                 → 최소 '완료'   (기존엔 실행형만)
--     · 매출 계산서가 있고 전액 입금됐다      → '정산'
--   forward-only: 사람이 수동으로 올려둔 더 높은 단계는 절대 되돌리지 않는다.
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
    SELECT d.id, COALESCE(d.stage, 'estimate') AS cur_stage, d.start_date,
      (SELECT count(*) FROM project_tasks t
        WHERE t.deal_id = d.id AND t.archived_at IS NULL) AS task_total,
      (SELECT count(*) FROM project_tasks t
        WHERE t.deal_id = d.id AND t.archived_at IS NULL AND t.status = 'done') AS task_done,
      -- 서명 완료된 계약 문서(견적서 제외 — content_type 이 invoice/quote 인 건 견적이다)
      EXISTS (
        SELECT 1 FROM signature_requests sr
        JOIN documents doc ON doc.id = sr.document_id
        WHERE doc.deal_id = d.id
          AND sr.status = 'signed'
          AND COALESCE(doc.content_type, '') NOT IN ('invoice', 'quote')
      ) AS has_signed_contract,
      -- 매출 계산서 발행분 / 실입금(통장 자동 매칭 결과)
      (SELECT count(*) FROM tax_invoices ti
        WHERE ti.deal_id = d.id AND ti.type = 'sales'
          AND COALESCE(ti.status, '') NOT IN ('void', 'draft')) AS inv_cnt,
      (SELECT COALESCE(sum(COALESCE(ti.total_amount, ti.supply_amount, 0)), 0) FROM tax_invoices ti
        WHERE ti.deal_id = d.id AND ti.type = 'sales'
          AND COALESCE(ti.status, '') NOT IN ('void', 'draft')) AS inv_total,
      (SELECT COALESCE(sum(COALESCE(ti.settled_amount, 0)), 0) FROM tax_invoices ti
        WHERE ti.deal_id = d.id AND ti.type = 'sales'
          AND COALESCE(ti.status, '') NOT IN ('void', 'draft')) AS inv_settled
    FROM deals d
    WHERE d.archived_at IS NULL
      AND (p_deal_id IS NULL OR d.id = p_deal_id)
  ),
  target AS (
    SELECT id, cur_stage,
      CASE
        -- 정산: 발행한 매출 계산서가 있고 전액(1원 이내 오차) 입금됨
        WHEN inv_cnt > 0 AND inv_total > 0 AND inv_settled >= inv_total - 1 THEN 'settlement'
        -- 완료: 할 일이 있고 전부 done (유형 조건 제거 — 모든 프로젝트에 적용)
        WHEN task_total > 0 AND task_done = task_total THEN 'completed'
        -- 진행: 할 일이 생겼거나 시작일이 지남
        WHEN task_total > 0 OR (start_date IS NOT NULL AND start_date <= v_today) THEN 'in_progress'
        -- 계약: 서명 완료된 계약서가 있음
        WHEN has_signed_contract THEN 'contract'
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

-- ── 2) 서명 완료·입금 반영 시점에도 즉시 재계산 ──────────────────────────────
--   기존엔 project_tasks 변경 트리거 + 매일 자정 배치만 있었다. 계약·정산 신호가 추가됐으니
--   그 신호가 바뀌는 지점에도 트리거를 건다(각각 해당 프로젝트 1건만 재계산 — 부하 무시 가능).
CREATE OR REPLACE FUNCTION public.trg_advance_deal_stage_by_signature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deal uuid;
BEGIN
  SELECT doc.deal_id INTO v_deal FROM documents doc
   WHERE doc.id = COALESCE(NEW.document_id, OLD.document_id);
  IF v_deal IS NOT NULL THEN
    PERFORM public.advance_deal_stages(v_deal);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deal_stage_on_signature ON signature_requests;
CREATE TRIGGER deal_stage_on_signature
  AFTER INSERT OR UPDATE OF status ON signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_advance_deal_stage_by_signature();

CREATE OR REPLACE FUNCTION public.trg_advance_deal_stage_by_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.deal_id, OLD.deal_id) IS NOT NULL THEN
    PERFORM public.advance_deal_stages(COALESCE(NEW.deal_id, OLD.deal_id));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deal_stage_on_invoice ON tax_invoices;
CREATE TRIGGER deal_stage_on_invoice
  AFTER INSERT OR UPDATE OF settled_amount, status, deal_id ON tax_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_advance_deal_stage_by_invoice();

-- ── 3) 유형 컬럼 드롭 ─────────────────────────────────────────────────────────
--   프로덕션 값 분포(2026-07-30): margin 30 / delivery 4 / goal 3. 유형별 기능 차이는
--   앱에서 이미 전부 제거됐으므로 값을 보존할 이유가 없다(자리 노출은 실제 데이터로 판정).
ALTER TABLE public.deals DROP COLUMN IF EXISTS project_type;

-- 기존 데이터 1회 정합화 — 새 규칙(계약·정산 포함)으로 멈춰 있던 단계 전진
SELECT public.advance_deal_stages();

-- ── ROLLBACK (필요 시 수동 실행) ──────────────────────────────────────────────
-- ALTER TABLE public.deals ADD COLUMN project_type text NOT NULL DEFAULT 'margin';
-- DROP TRIGGER IF EXISTS deal_stage_on_signature ON signature_requests;
-- DROP TRIGGER IF EXISTS deal_stage_on_invoice ON tax_invoices;
-- 그리고 20260722130000_auto_advance_deal_stages.sql 의 함수 정의를 다시 적용한다.
