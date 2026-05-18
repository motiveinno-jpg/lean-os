-- Migration: schedule_events.completed
-- 캘린더 일정 완료 처리 (클릭 시 취소선 표시).

ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS completed_at timestamptz;
