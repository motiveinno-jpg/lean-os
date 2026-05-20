-- PR2: deals 에 칸반 단계(stage) + 다음액션 텍스트 컬럼 추가.
--   기존 status('active'/'completed'/'archived' 등) 는 그대로 유지.
--   stage 는 5단계 칸반용 - estimate/contract/in_progress/completed/settlement.
--   기존 행 백필: status + 관련 doc 존재여부로 추정.

-- 1) 컬럼 (멱등)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS stage text DEFAULT 'estimate'
    CHECK (stage IN ('estimate','contract','in_progress','completed','settlement')),
  ADD COLUMN IF NOT EXISTS next_action_text text;

-- 2) 인덱스
CREATE INDEX IF NOT EXISTS idx_deals_company_stage
  ON public.deals (company_id, stage);

-- 3) 백필 (1회 — 기존 stage IS NULL 또는 default 인 행만)
--    원칙:
--      status='archived' → settlement (이미 종결)
--      status='completed' → completed
--      status='active' + 계약서(documents type=contract 존재) → in_progress
--      status='active' + 견적서만 있음 → contract  (견적 발행됨, 계약 대기)
--      그 외 → estimate (default)
WITH doc_state AS (
  SELECT
    d.id AS deal_id,
    bool_or(coalesce((dx.content_json->>'type'), '') = 'contract') AS has_contract,
    bool_or(coalesce((dx.content_json->>'type'), '') IN ('invoice','quote')) AS has_quote
  FROM public.deals d
  LEFT JOIN public.documents dx ON dx.deal_id = d.id
  GROUP BY d.id
)
UPDATE public.deals d
SET stage = CASE
  WHEN d.status = 'archived' THEN 'settlement'
  WHEN d.status = 'completed' THEN 'completed'
  WHEN d.status = 'active' AND ds.has_contract THEN 'in_progress'
  WHEN d.status = 'active' AND ds.has_quote THEN 'contract'
  ELSE 'estimate'
END
FROM doc_state ds
WHERE ds.deal_id = d.id
  AND (d.stage IS NULL OR d.stage = 'estimate');  -- default 만 백필 (이미 수동 설정된 행 보존)

COMMENT ON COLUMN public.deals.stage IS 'PR2 칸반 5단계 — estimate→contract→in_progress→completed→settlement. 기존 status 와 병존.';
COMMENT ON COLUMN public.deals.next_action_text IS 'PR2 자동 다음 액션 추천 텍스트 (lib/project-rules.ts 가 산출. 옵션).';
