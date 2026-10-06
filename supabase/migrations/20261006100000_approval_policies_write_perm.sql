-- 결재선(approval_policies) 쓰기 권한 좁히기 — 2026-10-06 사장님 "결재선 보안 진행해줘"
--
-- 왜: approval_policies_company(ALL) 가 회사 소속만 봤다. 화면(설정 › 결재선)은 권한자만 열지만
--     API 로는 같은 회사 아무 직원이나 결재선을 만들고·바꾸고·지울 수 있었다 → 자기 결재를 1단계 셀프 결재선으로
--     바꾸거나 자동 승인 금액을 올리는 식의 우회가 가능했다. approval_forms 는 이미 has_perm('/approvals:forms') 로 막혀 있다.
--
-- 규칙:
--   읽기  = 같은 회사 전원 (결재 요청을 올릴 때 결재선을 읽어 단계를 만든다 — 막으면 상신이 깨진다)
--   쓰기  = 같은 회사 AND (마스터 OR /approvals:policies OR /approvals:forms)
--           /approvals:forms 를 같이 받는 이유: 설정 › 결재 양식의 '기본 제공 유형 편집'이 approval_policies 에 저장한다
--           (입력 칸·내용 템플릿). 그 권한자를 막으면 결재 양식 화면 저장이 깨진다.
--   세무대리인 쓰기 금지(advisor_ro_*)는 RESTRICTIVE 로 그대로 남는다.
--
-- 기존 데이터: 변경 없음(정책만 바꾼다).
-- 버린 안: 결재 양식 권한자에겐 fields·label 칸만 허용(칸별 트리거) — 지금 결재 양식 권한자 3명이 모두 결재선 권한도 갖고 있어
--          이득이 없고 트리거 유지비만 는다. 필요해지면 그때 추가.

drop policy if exists approval_policies_company on public.approval_policies;

create policy approval_policies_select on public.approval_policies
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

create policy approval_policies_write on public.approval_policies
  for all to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin())
         or (select public.has_perm('/approvals:policies'))
         or (select public.has_perm('/approvals:forms')))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin())
         or (select public.has_perm('/approvals:policies'))
         or (select public.has_perm('/approvals:forms')))
  );
