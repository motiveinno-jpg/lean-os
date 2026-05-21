-- 2026-05-21 프로젝트 슬라이드 패널 '일정 관리' 탭 (체크리스트/간트/캘린더) — 간트 시작점용 컬럼 추가
-- 멱등 + 백필 안전. RLS 정책은 기존(회사격리 deal JOIN) 그대로 유지.

ALTER TABLE deal_milestones
  ADD COLUMN IF NOT EXISTS start_date date;

-- 핸드오프 B: "name 필수, due_date 선택, start_date 선택" — due_date NULLABLE 로 풀기.
-- 기존 데이터는 모두 NOT NULL 만족하므로 손실 없음 (제약만 완화).
ALTER TABLE deal_milestones
  ALTER COLUMN due_date DROP NOT NULL;

-- 백필: 기존 행은 created_at 우선, 없으면 due_date - 7일.
-- (NULL 유지도 허용 — UI 에서 due_date 단일 점으로 표시)
UPDATE deal_milestones
   SET start_date = COALESCE(created_at::date, due_date - INTERVAL '7 days')
 WHERE start_date IS NULL
   AND due_date IS NOT NULL;

COMMENT ON COLUMN deal_milestones.start_date IS
  '간트차트 시작점. NULL 허용 — NULL이면 due_date 당일 점 표시. 백필: created_at::date 우선, fallback due_date-7d.';
