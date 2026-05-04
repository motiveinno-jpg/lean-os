-- Add missing columns to approval_policies for multi-stage approval workflow
-- Required by the approval-workflow.ts engine which expects name, stages, is_active, updated_at

ALTER TABLE approval_policies
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Enable RLS (already enabled, but ensure)
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN approval_policies.name IS '정책 이름 (예: 경비 50만원 이상)';
COMMENT ON COLUMN approval_policies.stages IS '다단계 결재 단계 배열 [{stage, name, approver_role, required_count}]';
COMMENT ON COLUMN approval_policies.is_active IS '활성/비활성 토글';
