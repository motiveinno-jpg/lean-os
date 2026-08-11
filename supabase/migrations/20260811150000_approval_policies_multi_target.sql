-- 결재 정책 적용 대상 확장 (2026-08-11 사장님: 정책관리에서 직원 복수선택·팀단위 선택)
--   기존 requester_id(단일 uuid)는 하위호환으로 유지 — 매칭 코드는 requester_ids ∪ {requester_id} 를 본다.
--   requester_ids: 특정 직원 여러 명 / requester_department: 팀(부서) 단위. 둘 다 null 이면 회사 공통.
--   (프로덕션 적용: 2026-08-11 MCP apply_migration 'approval_policies_multi_target')
alter table public.approval_policies
  add column if not exists requester_ids uuid[],
  add column if not exists requester_department text;
