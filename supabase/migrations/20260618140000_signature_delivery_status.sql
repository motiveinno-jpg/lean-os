-- Resend webhook 전달 상태 — 사후 반송/스팸/전달 이벤트를 서명 요청에 기록.
alter table signature_requests add column if not exists delivery_status text;  -- delivered/bounced/complained/delayed
alter table signature_requests add column if not exists delivery_detail text;
alter table signature_requests add column if not exists delivery_at timestamptz;
