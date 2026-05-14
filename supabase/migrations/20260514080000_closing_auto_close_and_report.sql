-- Migration: 월결산 자동 마감 + PDF 리포트 보관 (Granter 벤치마킹 5단계)
-- Version: 20260514080000

-- 1) closing_checklists: 저장된 월간 리포트 URL + 자동 생성 메타
ALTER TABLE public.closing_checklists ADD COLUMN IF NOT EXISTS report_url text;
ALTER TABLE public.closing_checklists ADD COLUMN IF NOT EXISTS report_generated_at timestamptz;
ALTER TABLE public.closing_checklists ADD COLUMN IF NOT EXISTS auto_closed boolean DEFAULT false;

-- 2) closing_checklist_items: 자동 검증 표시
ALTER TABLE public.closing_checklist_items ADD COLUMN IF NOT EXISTS auto_verified boolean DEFAULT false;
ALTER TABLE public.closing_checklist_items ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.closing_checklist_items ADD COLUMN IF NOT EXISTS verified_reason text;

-- 3) status check 확장: 'locked' 허용 (closing.ts 가 이미 사용 중이지만 원본 CHECK 에 없음)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'closing_checklists_status_check'
      AND conrelid = 'public.closing_checklists'::regclass
  ) THEN
    ALTER TABLE public.closing_checklists DROP CONSTRAINT closing_checklists_status_check;
  END IF;
  ALTER TABLE public.closing_checklists
    ADD CONSTRAINT closing_checklists_status_check
    CHECK (status IN ('open','in_progress','completed','locked'));
END $$;

-- 4) 인덱스: 자동 검증/리포트 조회 가속
CREATE INDEX IF NOT EXISTS closing_checklists_company_month_idx
  ON public.closing_checklists (company_id, month DESC);
