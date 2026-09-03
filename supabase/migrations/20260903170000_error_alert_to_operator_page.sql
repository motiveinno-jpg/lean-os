-- 오류 감지 알림을 개인 벨 알림에서 뺀다 (2026-09-03 사장님: "운영자 페이지에 나와야 하는 것 아닌가")
--   오류 수집(error_logs·크론/HTTP 실패 수집)은 그대로. 알림 대신 운영 › 에러 모니터링 메뉴 배지(미해결 심각 오류 수)로 보인다.
drop trigger if exists trg_error_logs_alert_operator on public.error_logs;
drop function if exists public.error_logs_alert_operator();
-- 이미 간 오류 감지 알림 정리
delete from public.notifications where type = 'system' and entity_type = 'error_log';

-- 운영 메뉴 배지용: 최근 24시간 미해결 심각 오류 수 (운영자만 호출 — 기존 error_logs RLS 와 동일 권한)
create or replace function public.critical_error_count_24h()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.error_logs
   where coalesce(resolved, false) = false
     and coalesce(last_seen_at, created_at) > now() - interval '24 hours'
     and (error_type in ('edge','server','cron','http') or source = 'boundary' or message like '[DB 5%');
$$;
revoke all on function public.critical_error_count_24h() from public;
grant execute on function public.critical_error_count_24h() to authenticated;
