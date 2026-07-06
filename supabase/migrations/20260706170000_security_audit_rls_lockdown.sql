-- 2026-07-06 보안감사 — 과대허용 anon SELECT 정책 제거 (프로덕션 Management API 로 선적용, 재현용 기록)
--   P0: automation_credentials 은행/홈택스 자격증명 전체 공개 SELECT(USING true) — anon 키로 전 회사 크리덴셜 유출 가능했음.
--       service_role 은 RLS 를 우회하므로 이 정책은 애초에 불필요. company_select(owner+회사스코프)만 유지.
--   P1: document_share_feedback/views 의 anon/auth 전체 READ — 전 회사 responder PII·조회로그(IP/UA) 유출.
--       클라이언트는 이 테이블을 직접 SELECT 하지 않고(제출 insert 만), 관리자는 회사 스코프로만 조회하면 됨.

drop policy if exists service_key_read on public.automation_credentials;

drop policy if exists anon_read_feedback on public.document_share_feedback;
drop policy if exists auth_read_feedback on public.document_share_feedback;
drop policy if exists anon_read_views on public.document_share_views;

-- 관리자/회사 멤버가 자기 회사 공유문서의 피드백만 조회 (get_my_company_id SECURITY DEFINER 헬퍼 — users 인라인 재귀 없음)
drop policy if exists company_read_feedback on public.document_share_feedback;
create policy company_read_feedback on public.document_share_feedback
  for select using (
    share_id in (
      select ds.id from public.document_shares ds
      join public.documents d on d.id = ds.document_id
      where d.company_id = (select public.get_my_company_id())
    )
  );

-- 후속(Phase 2): document_shares.anon_read_active_shares(USING is_active=true) 는 공개 share 흐름
--   (getShareByToken/recordShareView/submitShareFeedback 이 anon 세션으로 document_shares 참조)이 얽혀 있어
--   토큰 기반 SECURITY DEFINER RPC(get_share_by_token) 전환과 함께 별도 제거 예정. 문서 본문은 documents RLS 로 이미 보호됨.
