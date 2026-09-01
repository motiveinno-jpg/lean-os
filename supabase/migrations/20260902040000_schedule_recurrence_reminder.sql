-- 일정 — 반복·리마인더 (2026-09-02) · 결정 145 (드팜므 문의발 P3)
--
--   History: public.schedule_events 는 20260511020000 에서 '한 줄 = 한 번의 일정'으로 태어났다.
--   그 뒤 완료(completed)·공개범위(visibility)·담당(target_user_ids)·우선순위가 얹혔지만
--   '매주 월요일 회의' 같은 되풀이와 '10분 전에 알려줘'는 끝내 자리가 없었다. 사용자는 매주
--   같은 줄을 손으로 다시 만들고 있었고, 알림은 아예 없었다.
--
--   자문자답
--   ① 무엇을 기준으로 '한 번만' 보내는가 — 발송 창 + reminded_at 두 겹이다.
--      크론이 10분마다 도는데 알림 시각을 '지났는가'로만 판단하면 지난 일정이 영원히 다시
--      울린다. 그래서 (a) now() 가 remind_at 이후 20분 안(10분 크론이 한 칸은 반드시 잡되
--      두 칸에 걸쳐도 아래 (b) 가 막는다) (b) reminded_at 이 이번 remind_at 보다 앞설 것,
--      두 조건을 모두 만족한 행만 보낸다. 보낸 뒤 reminded_at = now() 로 도장을 찍는다.
--      reminded_at 을 '보낸 적 있음' 불리언이 아니라 '마지막 발송 시각'으로 둔 이유는,
--      나중에 반복 일정을 열 때 회차마다 remind_at 이 앞으로 밀리므로 시각 비교만으로
--      회차별 1회 발송이 자연스럽게 성립하기 때문이다.
--   ② 반복 일정을 왜 v1 리마인더에서 빼는가 — 반복은 '행을 만들지 않는다'(원본 1행 = 규칙,
--      화면이 회차를 펼쳐 그린다. 프로젝트 v3 project_items.recurrence 20260901190000 과 같은
--      문법이라 앱 코드가 하나다). 그래서 서버가 '다음 회차의 시작 시각'을 알려면 규칙을 SQL
--      안에서 다시 전개해야 하고, 예외(그 회차만 옮김·건너뜀)가 생기는 순간 화면과 서버가
--      서로 다른 날짜를 말하게 된다. 화면 표시는 계산으로 충분하지만 알림은 '틀리면 사람이
--      약속을 놓치는' 기능이라, 규칙 전개를 한 곳(앱)으로 모으기 전까지는 보내지 않는다.
--      → where recurrence is null. 반복 + 리마인더는 회차 전개가 서버로 내려오는 다음 판에.
--   ③ 왜 feature_rollout 게이트인가 — 이 크론은 회사 데이터(notifications 행)를 만드는
--      자동화다. CLAUDE.md 규칙대로 모티브(c361afb9…)에만 먼저 켜고, 사장님이 "문제 없다"
--      한 뒤 insert into feature_rollout (feature) values ('schedule_reminders') 로 전체에 연다.
--      아래 시드는 모티브 한정 행 하나뿐이다(다른 회사 데이터는 만들지 않는다).
--   ④ 자동으로 못 푸는 것 — 소유자(user_id)가 비어 있는 일정(회사 공용 줄)은 알림을 받을
--      사람이 정해지지 않는다. notifications.user_id 는 NOT NULL 이므로 이런 행은 건너뛴다.
--      누구에게 보낼지는 사람이 화면에서 담당을 지정해야 한다.
--
--   기존 데이터 처리: 세 칸 모두 null 로 들어가므로 기존 일정의 동작은 그대로다(반복 없음·
--   알림 없음). 백필 없음.

-- ─────────────────────────────────────────────────────────────
-- A. 컬럼 — 반복 규칙 / 알림 시점 / 마지막 발송 시각
-- ─────────────────────────────────────────────────────────────
alter table public.schedule_events
  add column if not exists recurrence jsonb,
  add column if not exists reminder text,
  add column if not exists reminded_at timestamptz;

comment on column public.schedule_events.recurrence is
  '반복 규칙 {freq:''daily''|''weekly''|''monthly'', weekday?:0-6} — null 이면 반복 없음. 행을 만들지 않고 화면이 회차를 펼쳐 그린다(원본 1행 = 규칙). project_items.recurrence(20260901190000)와 같은 문법.';
comment on column public.schedule_events.reminder is
  '알림 시점: ''30''|''60''|''1440'' = 시작 N분 전 / ''morning'' = 당일 08:30(KST). null 이면 알림 없음.';
comment on column public.schedule_events.reminded_at is
  '이번 알림을 보낸 시각(중복 발송 방지). 불리언이 아니라 ''마지막 발송 시각''이라 회차마다 remind_at 이 밀리는 반복 일정에서도 회차별 1회가 성립한다.';

-- check 는 add column 과 분리 — 재실행 시 이미 있으면 건너뛴다(idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.schedule_events'::regclass
       and conname = 'schedule_events_reminder_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_reminder_check
      check (reminder is null or reminder in ('30','60','1440','morning'));
  end if;
end $$;

-- 크론이 매 10분 훑는 대상만 담는 얇은 인덱스(알림 켠 일정은 전체의 일부다).
create index if not exists schedule_events_reminder_idx
  on public.schedule_events (start_at)
  where reminder is not null and recurrence is null;

-- ─────────────────────────────────────────────────────────────
-- B. 게이트 시드 — 모티브 오너뷰에만 먼저 (CLAUDE.md: 회사 데이터를 만드는 자동화)
-- ─────────────────────────────────────────────────────────────
insert into public.feature_rollout (feature, company_id, note)
values ('schedule_reminders', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '일정 리마인더 크론 — 모티브 먼저(결정 145)')
on conflict (feature, company_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- C. 발송 함수 — 10분 크론이 부른다
-- ─────────────────────────────────────────────────────────────
create or replace function public.schedule_reminders_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r      record;
  v_sent integer := 0;
begin
  for r in
    select e.id,
           e.company_id,
           e.user_id,
           e.title,
           e.start_at,
           case
             when e.reminder = 'morning'
               -- 당일 08:30 KST → UTC. 시작이 08:30 이전인 새벽 일정도 같은 날 아침 기준을 쓴다.
               then (((e.start_at at time zone 'Asia/Seoul')::date + time '08:30') at time zone 'Asia/Seoul')
             else e.start_at - ((e.reminder)::int || ' minutes')::interval
           end as remind_at
      from public.schedule_events e
     where e.reminder is not null
       and e.start_at is not null
       -- 반복 일정은 v1 제외(헤더 자문자답 ②) — 회차가 행이 아니라 규칙이라 서버가 시각을 모른다.
       and e.recurrence is null
       -- 받을 사람이 정해진 줄만(notifications.user_id 는 NOT NULL) — 헤더 자문자답 ④
       and e.user_id is not null
       and public.feature_on('schedule_reminders', e.company_id)
  loop
    begin
      -- 발송 창: 알림 시각 이후 20분 안 + 이번 remind_at 에 대해 아직 안 보냄
      if not (now() >= r.remind_at
              and now() < r.remind_at + interval '20 minutes') then
        continue;
      end if;

      if exists (
        select 1 from public.schedule_events s
         where s.id = r.id and s.reminded_at is not null and s.reminded_at >= r.remind_at
      ) then
        continue;
      end if;

      -- notifications.type 은 check 목록이 정해져 있다(일정 전용 값 없음) → 기존 관례대로
      -- 'system' + entity_type 으로 출처를 적는다(예: system/attendance_edit_request).
      insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
      values (
        r.company_id,
        r.user_id,
        'system',
        '일정 알림',
        to_char(r.start_at at time zone 'Asia/Seoul', 'HH24:MI') || ' ' || coalesce(nullif(r.title, ''), '(제목 없음)'),
        'schedule_events',
        r.id
      );

      update public.schedule_events set reminded_at = now() where id = r.id;
      v_sent := v_sent + 1;
    exception when others then
      -- 한 줄이 실패해도 나머지는 계속 보낸다(크론 전체를 죽이지 않는다).
      raise warning 'schedule_reminders_tick: event % skipped (%)', r.id, sqlerrm;
    end;
  end loop;

  return v_sent;
end;
$fn$;

comment on function public.schedule_reminders_tick() is
  '일정 리마인더 발송(10분 크론). 발송 창 20분 + reminded_at 으로 정확히 한 번. 반복 일정(recurrence not null)은 v1 제외. feature_on(''schedule_reminders'', company_id) 인 회사만.';

revoke all on function public.schedule_reminders_tick() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- D. pg_cron — 10분마다. 이미 있으면 지우고 다시 등록(idempotent)
-- ─────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule('schedule-reminders')
   where exists (select 1 from cron.job where jobname = 'schedule-reminders');
end $$;

select cron.schedule(
  'schedule-reminders',
  '*/10 * * * *',
  $cron$select public.schedule_reminders_tick();$cron$
);
