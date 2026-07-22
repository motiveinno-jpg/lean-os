-- P2 보안 advisor: rls_policy_always_true — sync_logs INSERT 정책의 anon 과다권한만 안전 축소 (2026-07-22).
--   앱(src/lib/data-sync.ts)은 로그인 사용자(authenticated) 컨텍스트로 sync_logs 를 insert하고,
--   엣지(codef-sync 등)는 service_role(RLS 우회)로 insert 한다. 따라서 anon 직접 insert 는 정당한 경로가 없음.
--   WITH CHECK (true) → auth.uid() IS NOT NULL 로 좁혀 익명 위조 telemetry insert 차단(정당 경로는 유지).
--   ※ 나머지 always-true INSERT 정책(companies 가입·document_share_*·error_logs·partnership_inquiries)은
--     공개폼/가입용으로 의도된 설계라 변경하지 않음(조이면 공개 기능 파손).
alter policy "Service role can insert sync logs" on public.sync_logs
  with check (auth.uid() is not null);
