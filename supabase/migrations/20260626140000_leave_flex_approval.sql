-- 휴가 Flex식 N단계 유연 승인 (2026-06-26)
--   기존 1차/2차 고정 컬럼을 N단계로 일반화. approval_steps jsonb 배열:
--   [{ "approver_id": uuid, "status": "pending|approved|rejected", "decided_by": uuid|null, "decided_at": ts|null }]
--   순서대로 진행(앞 단계 승인돼야 다음 pending). 승인자는 owner/admin 아니어도 가능(팀장 등 구성원).
--   참조(cc)는 기존 cc_user_ids 재사용. 반차 오전/오후는 기존 start_time/end_time 재사용(컬럼 추가 없음).
--   추가형 컬럼만 — 기존 단일/2차 흐름과 공존(approval_steps 비어있으면 기존 로직).
alter table public.leave_requests add column if not exists approval_steps jsonb not null default '[]'::jsonb;
comment on column public.leave_requests.approval_steps is 'N단계 승인 체인(순서대로). 각 step: approver_id/status/decided_by/decided_at. 승인자는 비관리자 구성원 가능.';
