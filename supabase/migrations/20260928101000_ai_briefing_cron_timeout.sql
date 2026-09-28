begin;
--   ai-briefing 은 회사마다 모델을 불러 브리핑을 만들어 수십 초가 걸린다. pg_net 기본 대기 5초라
--   함수는 끝까지 돌아 브리핑이 생기는데도 매일 08:00 에 '[cron http 응답 없음]' 이 운영자 오류로 쌓였다.
--   다른 긴 잡(ads-sync 120초·toss-charge 180초)과 같이 대기 시간을 명시한다. 시크릿이 든 명령문을 옮겨 적지 않도록 replace 로 고친다.
select cron.alter_job(
  job_id := j.jobid,
  command := replace(j.command, 'body := ''{}''::jsonb', 'body := ''{}''::jsonb, timeout_milliseconds := 120000')
)
from cron.job j
where j.jobname = 'ai-briefing-morning'
  and j.command not ilike '%timeout_milliseconds%';
commit;
