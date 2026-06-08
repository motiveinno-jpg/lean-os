-- pg_cron 이력 테이블(cron.job_run_details) 무한 누적 → autovacuum I/O 독점 → DB 응답불가(504)
-- (2026-06-08 인시던트, 3번째 전면장애)
--
-- 증상: 재시작해도 몇 분 만에 db UNHEALTHY("Failed to connect"/connection timeout) 재발.
--   슬롯 고갈이 아니라 autovacuum 이 비대해진 cron.job_run_details 를 11분+ 청소하며
--   마이크로 인스턴스 디스크 I/O 를 독점 → 새 연결 핸드셰이크 타임아웃.
--   가속 요인: auto-clock-out cron(*/5)이 하루 288행씩 적재(2026-05-29 도입 후).
--
-- 조치(인시던트 시 적용 완료):
--   1) (1회성) autovacuum 강제종료 + TRUNCATE cron.job_run_details  ← prod 적용됨
--   2) 매일 03:17 이력 3일치만 남기고 자동 삭제하는 cron 등록(아래) ← 재발 영구 차단
--
-- 이 파일은 repo 기록/재현용. prod 에는 Management API 로 이미 반영됨.

-- 보존 cron (idempotent)
do $cron$
begin
  perform cron.unschedule('purge-cron-history');
exception when others then
  null; -- 없으면 무시
end
$cron$;

select cron.schedule(
  'purge-cron-history',
  '17 3 * * *',
  $purge$delete from cron.job_run_details where end_time < now() - interval '3 days'$purge$
);
