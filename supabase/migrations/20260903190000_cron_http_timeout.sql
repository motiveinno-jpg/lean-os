-- 2026-09-03: 크론이 부르는 엣지 함수 호출의 응답 대기 시간을 5초(pg_net 기본) → 20초로.
--   17:00 KST hometax-sync-tick 이 콜드스타트(codef-sync 142KB) 중 5초 안에 응답 못 해 "응답 없음"으로
--   오류 기록장에 잡혔다(24시간 중 1회). 함수는 정상이었고 대기 시간만 짧았던 것.
--   명령문 안 시크릿은 파일에 적지 않고 DB 의 기존 명령문을 그대로 고쳐 쓴다.
do $$
declare
  r record;
  c text;
begin
  for r in select jobid, command from cron.job where jobname in ('hometax-sync-tick', 'bank-sync-tick', 'card-sync-tick') loop
    if r.command !~ 'timeout_milliseconds' then
      c := regexp_replace(r.command, '\)\s*;?\s*$', E',\n    timeout_milliseconds := 20000\n  );');
      perform cron.alter_job(r.jobid, command := c);
    end if;
  end loop;
end
$$;
