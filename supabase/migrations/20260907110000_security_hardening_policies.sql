-- 보안 정비 ② 운영자 판정 정책.
--   error_logs·marketing_events 의 운영자 정책이 public.users.email 의 도메인(@mo-tive.com)만 봤다.
--   users.email 은 회사 대표가 구성원 행을 고칠 수 있는 컬럼이라, 구성원 이메일을 @mo-tive.com 으로 바꾸면
--   전 회사의 오류 기록(토큰·개인정보 포함)을 읽고 쓸 수 있었다. 세션(JWT) 이메일 정확 일치인 is_platform_operator() 로 통일.
SET statement_timeout = '60000';

drop policy if exists error_logs_operator_rw on public.error_logs;
create policy error_logs_operator_write on public.error_logs
  for update to authenticated using (public.is_platform_operator()) with check (public.is_platform_operator());
create policy error_logs_operator_delete on public.error_logs
  for delete to authenticated using (public.is_platform_operator());

drop policy if exists marketing_events_operator_read on public.marketing_events;
create policy marketing_events_operator_read on public.marketing_events
  for select to authenticated using (public.is_platform_operator());
