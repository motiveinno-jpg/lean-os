-- Migration: approval_policies_reference_user_ids
-- Version: 20260716200000
--
-- 기본 제공 결재 유형(approval_policies)에도 참조(CC) 인원을 미리 지정할 수 있게 한다
-- (2026-07-16 사장님 요청: 양식관리 기본 유형 편집 모달에 참조 선택 추가).
-- approval_forms.reference_user_ids(20260714130000) 와 동일 타입/의미 — 요청 생성 시
-- approval_requests.reference_user_ids 로 복사돼 통보 알림을 받는다.
-- 순수 additive: 기존 행은 빈 배열, 기존 동작 무변경.

alter table public.approval_policies
  add column if not exists reference_user_ids uuid[] not null default '{}'::uuid[];

comment on column public.approval_policies.reference_user_ids is
  '기본 제공 유형의 참조(CC) 인원 - 이 유형으로 결재 생성 시 approval_requests.reference_user_ids 로 복사. approval_forms.reference_user_ids 와 동일 개념.';
