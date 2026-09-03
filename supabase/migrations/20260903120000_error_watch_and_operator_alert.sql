-- 2026-09-03 사장님 지시: "오너뷰 모든 기능에 예외처리 — 원인을 금방 찾고, 오류가 나면 반응할 수 있게".
-- ① 예약 작업(pg_cron) 실패와 크론이 부른 HTTP 호출의 5xx/타임아웃을 매시간 오류 기록장(error_logs)에 모은다.
--    그동안 cron.job_run_details / net._http_response 에만 남아 아무 화면에도 안 보였다.
-- ② 심각한 오류(엣지·서버·크론·HTTP·화면 붕괴·DB 5xx)가 기록되면 운영자에게 알림(벨+웹푸시)을 보낸다.
--    같은 제목은 30분에 한 번만. error_logs 는 24시간 같은 메시지를 접으므로(dedup 트리거) 첫 발생만 울린다.

create or replace function public.collect_infra_errors()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  -- 예약 작업 실패
  for r in
    select j.jobname, d.return_message, d.start_time
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
     where d.status = 'failed'
       and d.start_time > now() - interval '65 minutes'
  loop
    insert into public.error_logs (source, error_type, message, url, context)
    values ('manual', 'cron',
            format('[cron %s] %s', r.jobname, left(coalesce(r.return_message, '(메시지 없음)'), 1500)),
            'cron:' || r.jobname,
            jsonb_build_object('job', r.jobname, 'started_at', r.start_time));
    n := n + 1;
  end loop;

  -- 크론이 부른 HTTP 호출(엣지 함수 등)의 서버 오류·타임아웃
  for r in
    select id, status_code, error_msg, timed_out, left(content, 300) as content, created
      from net._http_response
     where created > now() - interval '65 minutes'
       and (status_code >= 500 or error_msg is not null or timed_out)
  loop
    insert into public.error_logs (source, error_type, message, url, context)
    values ('manual', 'http',
            format('[cron http %s] %s', coalesce(r.status_code::text, '응답 없음'), left(coalesce(r.error_msg, r.content, '(본문 없음)'), 1500)),
            'cron-http',
            jsonb_build_object('status', r.status_code, 'timed_out', r.timed_out, 'response_id', r.id, 'at', r.created));
    n := n + 1;
  end loop;

  return n;
end
$$;

revoke all on function public.collect_infra_errors() from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'infra-error-watch') then
    perform cron.unschedule('infra-error-watch');
  end if;
end
$$;

select cron.schedule('infra-error-watch', '7 * * * *', $$select public.collect_infra_errors();$$);

-- ② 운영자 알림
create or replace function public.error_logs_alert_operator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_user record;
begin
  if not (coalesce(new.error_type, '') in ('edge', 'server', 'cron', 'http')
          or new.source = 'boundary'
          or new.message like '[DB 5%') then
    return new;
  end if;

  v_title := case new.error_type
               when 'edge' then '서버 기능 오류 감지'
               when 'cron' then '예약 작업 실패 감지'
               when 'http' then '예약 호출 실패 감지'
               when 'server' then '서버 처리 오류 감지'
               else '화면 오류 감지'
             end;

  for v_user in
    select id, company_id from public.users
     where lower(coalesce(email, '')) in ('creative@mo-tive.com')
  loop
    if exists (
      select 1 from public.notifications
       where user_id = v_user.id and type = 'system' and title = v_title
         and created_at > now() - interval '30 minutes'
    ) then
      continue;
    end if;
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, link)
    values (v_user.company_id, v_user.id, 'system', v_title, left(new.message, 300), 'error_log', new.id, '/error-logs');
  end loop;
  return new;
exception when others then
  -- 알림 실패가 오류 기록 자체를 막으면 안 된다
  return new;
end
$$;

drop trigger if exists trg_error_logs_alert_operator on public.error_logs;
create trigger trg_error_logs_alert_operator
  after insert on public.error_logs
  for each row execute function public.error_logs_alert_operator();
