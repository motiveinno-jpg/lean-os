-- 일정 알림 여러 개 · 원하는 날/시각 (2026-09-03 사장님: "당일 아침 8:30만 가능 — 시간대·하루 전·일주일 전·여러 개")
--
--   History: 20260902040000 이 reminder text('morning'|'30'|'60'|'1440') 한 칸으로 v1 을 열었다.
--   화면은 '당일 아침 8:30' 하나만 내놓았고, 발송 기록은 reminded_at 한 시각이라 알림이 둘 이상이면
--   "어느 것을 보냈는가"를 구분할 수 없었다.
--
--   자문자답
--   ① 무엇을 기준으로 알림 시각을 정하는가 — 시작 **날짜**(KST) 기준 'N일 전 HH:MM'. 시작 시각 기준
--      'N분 전'이 아니다: 이 화면의 일정은 하루 종일 항목이 대부분이라 시각이 00:00 이고, 사장님이
--      원하는 것도 "일주일 전 아침에 알려줘"다.
--   ② 여러 개를 어떻게 각각 한 번만 보내는가 — reminders_sent(jsonb 배열)에 보낸 remind_at(ISO) 을
--      적는다. 알림 시각이 곧 열쇠라 순서·개수와 무관하고, 날짜를 바꾸면 앱이 배열을 비워 다시 보낸다.
--   ③ 기존 'morning' 은 — [{days_before:0,time:"08:30"}] 로 옮긴다(백필). '30'|'60'|'1440' 은 화면이 내놓은
--      적이 없어 실데이터 0건이지만, 남아 있어도 옛 계산식으로 계속 보낸다(호환 분기).
--   ④ 자동으로 못 푸는 것 — 반복 일정은 v1 과 같이 제외(회차 전개가 서버에 없다). 알림 시각이 이미
--      지난 채로 저장된 알림(어제 것)은 보내지 않는다 — 발송 창(20분)이 막는다.
--
--   기존 데이터 처리: reminders 는 백필로 채우고 reminder 는 그대로 둔다(옛 코드 읽기 호환). 새 저장은
--   reminders 만 쓰고 reminder 는 null.

alter table public.schedule_events
  add column if not exists reminders jsonb,
  add column if not exists reminders_sent jsonb not null default '[]'::jsonb;

comment on column public.schedule_events.reminders is
  '알림 목록 [{days_before:int(0=당일), time:''HH:MM''(KST)}] — 최대 5개. null/[] 이면 없음. 발송은 schedule_reminders_tick.';
comment on column public.schedule_events.reminders_sent is
  '보낸 알림 시각(ISO) 배열 — 알림마다 정확히 한 번. 날짜·알림을 바꾸면 앱이 비운다.';

-- 백필: 옛 '당일 아침 8:30' → 새 형식
update public.schedule_events
   set reminders = '[{"days_before":0,"time":"08:30"}]'::jsonb
 where reminder = 'morning' and reminders is null;

-- 크론 대상 인덱스 갱신(알림 있는 단발 일정만)
drop index if exists public.schedule_events_reminder_idx;
create index if not exists schedule_events_reminder_idx
  on public.schedule_events (start_at)
  where (reminder is not null or (reminders is not null and reminders <> '[]'::jsonb)) and recurrence is null;

create or replace function public.schedule_reminders_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

comment on function public.schedule_reminders_tick() is
  '일정 리마인더 발송(10분 크론). reminders[{days_before,time}] 마다 발송 창 20분 + reminders_sent 로 정확히 한 번. 옛 reminder 텍스트도 호환. 반복 일정 제외.';
revoke all on function public.schedule_reminders_tick() from public, anon, authenticated;
