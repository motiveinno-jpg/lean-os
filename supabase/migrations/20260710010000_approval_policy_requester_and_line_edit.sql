-- 승인정책 — 요청자별 정책 + 승인라인 변경 허용 여부 (2026-07-10)
--   requester_id: 이 정책을 특정 요청자에게만 적용(null=회사 공통, 기존 동작). 요청 생성 시
--     요청자 전용 정책이 있으면 우선, 없으면 document_type/default 매칭.
--   allow_line_edit: 요청자가 새 요청에서 승인라인(승인자)을 바꿀 수 있는지. default true(기존 동작 유지).
alter table public.approval_policies add column if not exists requester_id uuid;
alter table public.approval_policies add column if not exists allow_line_edit boolean not null default true;
create index if not exists idx_approval_policies_requester on public.approval_policies(company_id, requester_id) where requester_id is not null;
