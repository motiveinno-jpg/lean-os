-- 결재선 하나 안에서 적용 대상별로 결재선·참조를 따로 (2026-08-20 사장님:
--   "적용대상을 여러개 생성할 수 있고 그 적용 대상마다 각각의 '누구한테결재받나'를 선택하고
--    그 각각의 참조를 걸 수 있게 — 하나의 결재선에서 관리")
--
-- AS_IS: 정책 1개 = 적용 대상 1묶음(requester_ids | requester_department) + 단계 1세트(stages)
--        + 참조 1세트(reference_user_ids). 사람마다 결재선이 다르면 결재선을 사람 수만큼 만들어야 했다.
-- TO_BE: rules = [{ id, target:{mode:'all'|'users'|'department'|'position', ...}, stages, reference_user_ids }, ...]
--        한 결재선 안에서 [대상 → 그 대상 전용 단계 → 그 대상 전용 참조] 를 N개 관리한다.
--        매칭 우선순위(pickRuleForRequester): 특정 직원 > 팀(부서) > 직급 > 회사 전체.
--        'all' 규칙은 폼에서 항상 유지되며 어느 규칙에도 안 걸리는 요청자가 쓴다.
--
-- 기존 데이터: 손대지 않는다. rules 가 null 인 옛 정책은 policyRules() 가 기존
--   requester_ids/requester_department + stages + reference_user_ids 를 '규칙 1개'로 읽어
--   종전과 똑같이 동작한다. 새로 저장할 때만 rules 가 채워진다.
--   저장 시 stages/reference_user_ids 에는 'all' 규칙을 거울로 복사해 두므로,
--   rules 를 모르는 옛 읽기 경로(요청 상세·PDF 등)도 깨지지 않는다.
--
-- 대상 기준 컬럼: 부서 = employees.department, 직급 = employees.position.
--   ⚠️ users.role(admin|employee|owner|partner) 이 아니다 — 팀장·사원 같은 직책은 employees.position 에만 있다.
--
-- RLS: approval_policies 의 기존 정책을 그대로 쓴다(컬럼 추가일 뿐 접근 주체 변화 없음).

alter table public.approval_policies
  add column if not exists rules jsonb;

comment on column public.approval_policies.rules is
  '적용 대상별 결재선·참조 (2026-08-20). [{id, target:{mode:all|users|department|position, userIds?, department?, position?}, stages, reference_user_ids}]. null 이면 기존 requester_*/stages/reference_user_ids 를 규칙 1개로 읽는다.';
