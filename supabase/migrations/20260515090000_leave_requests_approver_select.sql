-- Migration: leave_requests_approver_select
-- 휴가/연차 신청 시 직원이 승인자(owner/admin)를 지정할 수 있도록 컬럼 추가.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS requested_approver_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_leave_requests_requested_approver
  ON leave_requests(requested_approver_id);
