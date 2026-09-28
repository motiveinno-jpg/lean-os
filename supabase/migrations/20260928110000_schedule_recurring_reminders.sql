begin;
--   반복 일정 알림.
--   종전 크론은 recurrence 가 있는 행을 통째로 건너뛰어, 화면이 "반복 일정에는 아직 알림을 보내지 않습니다"라며
--   반복 일정의 알림을 저장하지 않았다. 매주 회의·매월 마감처럼 알림이 가장 필요한 일정이 반복 일정이다.
--
--   규칙
--   · 원본(반복 규칙이 있는 행)의 알림은 **회차마다** 그 회차 날짜 기준으로 간다. 회차 판정은 달력(expandRecurrence)과
--     같다 — daily 매일, weekly 요일(weekday 없으면 원본 요일), monthly 같은 일자(그 일자가 없는 달은 건너뜀),
--     원본 날짜 자신도 회차, recurrence_exceptions 날짜는 회차가 아니다(떼어낸 회차는 자기 행이 따로 보낸다).
--   · 떼어낸 회차(recurrence_parent_id 있는 행)는 자기 알림이 비어 있으면 원본 알림을 따른다.
--   · 완료한 일정·회차에는 보내지 않는다.
--   · 발송 기록 키는 발송 시각(UTC) — 회차마다 달라 한 번씩만 간다. 반복 원본은 기록이 끝없이 쌓이지 않게 최근 60개만 둔다.
--
--   메일 발송 시크릿은 저장소에 다시 적지 않도록 현재 함수 본문에서 꺼내 vault 로 옮기고, 새 함수는 vault 에서 읽는다.
do $$
declare v text;
begin
  if not exists (select 1 from vault.secrets where name = 'schedule_reminder_email_secret') then
    select substring(pg_get_functiondef('public.schedule_reminders_tick()'::regprocedure) from '''x-cron-secret'',''([0-9a-f]+)''') into v;
    if v is null then raise exception 'schedule reminder email secret not found in current function'; end if;
    perform vault.create_secret(v, 'schedule_reminder_email_secret', 'send-schedule-reminder-email x-cron-secret');
  end if;
end $$;

--   한 회차가 반복 규칙상 회차인지 — 달력 expandRecurrence 와 같은 판정
create or replace function public._schedule_is_occurrence(p_rec jsonb, p_base date, p_exceptions date[], p_day date)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select p_day >= p_base
     and not (p_day = any(coalesce(p_exceptions, '{}'::date[])))
     and case p_rec->>'freq'
           when 'daily' then true
           when 'weekly' then extract(dow from p_day)::int = coalesce((p_rec->>'weekday')::int, extract(dow from p_base)::int)
           when 'monthly' then extract(day from p_day) = extract(day from p_base)
           else p_day = p_base
         end
$$;
revoke all on function public._schedule_is_occurrence(jsonb, date, date[], date) from public, anon, authenticated;

create or replace function public.schedule_reminders_tick()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r        record;
  rem      jsonb;
  v_days   int;
  v_time   time;
  v_at     timestamptz;
  v_key    text;
  v_sent   integer := 0;
  v_label  text;
  v_occ    date;
  v_start  timestamptz;
  v_secret text;
  v_anon   constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho';
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
  v_prev   date := ((now() - interval '20 minutes') at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'schedule_reminder_email_secret';

  for r in
    select e.id, e.company_id, e.user_id, e.title, e.start_at, e.reminder, e.reminders_sent, e.reminded_at,
           e.recurrence, e.recurrence_exceptions,
           --   떼어낸 회차는 자기 알림이 비어 있으면 원본 알림을 따른다
           case when e.recurrence_parent_id is not null and (e.reminders is null or e.reminders = '[]'::jsonb)
                then p.reminders else e.reminders end as reminders
      from public.schedule_events e
      left join public.schedule_events p on p.id = e.recurrence_parent_id
     where (e.reminder is not null
            or (e.reminders is not null and e.reminders <> '[]'::jsonb)
            or (e.recurrence_parent_id is not null and p.reminders is not null and p.reminders <> '[]'::jsonb))
       and e.start_at is not null
       and e.user_id is not null
       and not coalesce(e.completed, false)
       and public.feature_on('schedule_reminders', e.company_id)
  loop
    begin
      if r.reminders is not null and jsonb_typeof(r.reminders) = 'array' and r.reminders <> '[]'::jsonb then
        for rem in select * from jsonb_array_elements(r.reminders) loop
          v_days := coalesce((rem->>'days_before')::int, 0);
          v_time := coalesce(nullif(rem->>'time', ''), '08:30')::time;

          --   이 알림이 지금(20분 창) 울릴 회차 날짜. 단발 일정은 시작 날짜 하나, 반복 원본은 오늘(또는 창이 자정을 넘으면 어제)+N일
          v_occ := null;
          if coalesce(r.recurrence->>'freq', '') = '' then
            v_occ := (r.start_at at time zone 'Asia/Seoul')::date;
          elsif public._schedule_is_occurrence(r.recurrence, (r.start_at at time zone 'Asia/Seoul')::date, r.recurrence_exceptions, v_today + v_days) then
            v_occ := v_today + v_days;
          elsif v_prev <> v_today
            and public._schedule_is_occurrence(r.recurrence, (r.start_at at time zone 'Asia/Seoul')::date, r.recurrence_exceptions, v_prev + v_days) then
            v_occ := v_prev + v_days;
          end if;
          if v_occ is null then continue; end if;

          v_at  := ((v_occ - v_days) + v_time) at time zone 'Asia/Seoul';
          v_key := to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
          if not (now() >= v_at and now() < v_at + interval '20 minutes') then continue; end if;
          if coalesce(r.reminders_sent, '[]'::jsonb) ? v_key then continue; end if;

          --   회차 시작 시각 = 회차 날짜 + 원본의 하루 중 시각
          v_start := (v_occ + (r.start_at at time zone 'Asia/Seoul')::time) at time zone 'Asia/Seoul';
          v_label := case when v_days = 0 then '오늘' when v_days = 1 then '내일' when v_days = 7 then '일주일 뒤' else v_days || '일 뒤' end;
          insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
          values (r.company_id, r.user_id, 'system', '일정 알림 · ' || v_label,
                  to_char(v_start at time zone 'Asia/Seoul', 'MM-DD') || ' ' || coalesce(nullif(r.title, ''), '(제목 없음)'),
                  'schedule_events', r.id);
          --   메일로도 받기 — 이 알림에 email:true 면 일정 만든 사람 메일로 (best-effort: 실패해도 앱 알림·발송 표시엔 영향 없음)
          if coalesce(rem->>'email', '') = 'true' and v_secret is not null then
            begin
              perform net.http_post(
                url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-schedule-reminder-email',
                headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || v_anon,
                  'apikey', v_anon,
                  'x-cron-secret', v_secret
                ),
                body := jsonb_build_object('user_id', r.user_id, 'company_id', r.company_id, 'title', r.title, 'start_at', v_start, 'label', v_label)
              );
            exception when others then raise warning 'schedule reminder email post failed: %', sqlerrm;
            end;
          end if;
          update public.schedule_events
             set reminders_sent = (
                   select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                     from (select k from jsonb_array_elements_text(coalesce(reminders_sent, '[]'::jsonb) || to_jsonb(v_key)) k
                            order by k desc limit 60) t),
                 reminded_at = now()
           where id = r.id;
          r.reminders_sent := coalesce(r.reminders_sent, '[]'::jsonb) || to_jsonb(v_key);
          v_sent := v_sent + 1;
        end loop;
      elsif r.reminder is not null and coalesce(r.recurrence->>'freq', '') = '' then
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
$function$;
commit;
