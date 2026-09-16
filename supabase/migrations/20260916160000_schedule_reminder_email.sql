-- 일정 알림 메일 — 리마인더 크론이 email:true 알림에서 send-schedule-reminder-email 엣지를 호출한다.
--   앱 알림(notifications insert)은 그대로 두고, 메일은 그 뒤에 best-effort 로 얹는다(실패해도 발송 표시·앱 알림 불변).
--   수신자는 엣지가 user_id 로 계정 이메일을 찾아 보낸다(회사 이탈·묘비 이메일이면 안 보냄).

CREATE OR REPLACE FUNCTION public.schedule_reminders_tick()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r        record;
  rem      jsonb;
  v_days   int;
  v_time   time;
  v_at     timestamptz;
  v_key    text;
  v_sent   integer := 0;
  v_label  text;
begin
  for r in
    select e.id, e.company_id, e.user_id, e.title, e.start_at, e.reminder, e.reminders, e.reminders_sent, e.reminded_at
      from public.schedule_events e
     where (e.reminder is not null or (e.reminders is not null and e.reminders <> '[]'::jsonb))
       and e.start_at is not null
       and e.recurrence is null
       and e.user_id is not null
       and public.feature_on('schedule_reminders', e.company_id)
  loop
    begin
      if r.reminders is not null and jsonb_typeof(r.reminders) = 'array' and r.reminders <> '[]'::jsonb then
        -- 새 형식: 알림마다 시각 계산 → 발송 창 20분 안 + 아직 안 보낸 것만
        for rem in select * from jsonb_array_elements(r.reminders) loop
          v_days := coalesce((rem->>'days_before')::int, 0);
          v_time := coalesce(nullif(rem->>'time', ''), '08:30')::time;
          v_at   := ((((r.start_at at time zone 'Asia/Seoul')::date - v_days) + v_time) at time zone 'Asia/Seoul');
          v_key  := to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
          if not (now() >= v_at and now() < v_at + interval '20 minutes') then continue; end if;
          if coalesce(r.reminders_sent, '[]'::jsonb) ? v_key then continue; end if;
          v_label := case when v_days = 0 then '오늘' when v_days = 1 then '내일' when v_days = 7 then '일주일 뒤' else v_days || '일 뒤' end;
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
          values (r.company_id, r.user_id, 'system', '일정 알림 · ' || v_label,
                  to_char(r.start_at at time zone 'Asia/Seoul', 'MM-DD') || ' ' || coalesce(nullif(r.title, ''), '(제목 없음)'),
                  'schedule_events', r.id);
          -- 메일로도 받기 — 이 알림에 email:true 면 일정 만든 사람 메일로 (best-effort: 실패해도 앱 알림·발송 표시엔 영향 없음).
          if coalesce(rem->>'email','') = 'true' then
            begin
              perform net.http_post(
                url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-schedule-reminder-email',
                headers := jsonb_build_object(
                  'Content-Type','application/json',
                  'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho',
                  'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho',
                  'x-cron-secret','6958d1db106824dd7251457c00e1c531f848dc6f918738b9a6922a1cedbb8e96'
                ),
                body := jsonb_build_object('user_id', r.user_id, 'company_id', r.company_id, 'title', r.title, 'start_at', r.start_at, 'label', v_label)
              );
            exception when others then raise warning 'schedule reminder email post failed: %', sqlerrm;
            end;
          end if;
          update public.schedule_events
             set reminders_sent = coalesce(reminders_sent, '[]'::jsonb) || to_jsonb(v_key), reminded_at = now()
           where id = r.id;
          v_sent := v_sent + 1;
        end loop;
      elsif r.reminder is not null then
        -- 옛 형식(호환) — v1 계산식 그대로
        v_at := case when r.reminder = 'morning'
                     then (((r.start_at at time zone 'Asia/Seoul')::date + time '08:30') at time zone 'Asia/Seoul')
                     else r.start_at - ((r.reminder)::int || ' minutes')::interval end;
        if not (now() >= v_at and now() < v_at + interval '20 minutes') then continue; end if;
        if r.reminded_at is not null and r.reminded_at >= v_at then continue; end if;
        insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
        values (r.company_id, r.user_id, 'system', '일정 알림',
                to_char(r.start_at at time zone 'Asia/Seoul', 'HH24:MI') || ' ' || coalesce(nullif(r.title, ''), '(제목 없음)'),
                'schedule_events', r.id);
        update public.schedule_events set reminded_at = now() where id = r.id;
        v_sent := v_sent + 1;
      end if;
    exception when others then
      raise warning 'schedule_reminders_tick: event % skipped (%)', r.id, sqlerrm;
    end;
  end loop;
  return v_sent;
end;
$function$

