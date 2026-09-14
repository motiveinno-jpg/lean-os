-- 반복 일정 회차별 관리 (결정 145 보완)
--
--   결정 145 는 반복을 행 하나로 두고 달력이 가상 회차를 펼쳤다. 그런데 가상 회차의 완료·수정·삭제가
--   전부 원본 한 건으로 가서, 하나를 완료하면 미래 회차가 다 완료되고 하나를 고치면 전체가 바뀌었다.
--
--   이제 회차는 **날짜 단위로 독립**이다.
--   · 가상 회차에 손을 대는 순간 그 날짜를 실제 행으로 떼어낸다(detach) — 원본을 복사한 자식 행
--     (recurrence_parent_id·occurrence_date, 반복 규칙 없음) + 원본 recurrence_exceptions 에 그 날짜.
--     달력은 예외 날짜의 가상 회차를 그리지 않고 자식 행을 대신 보여 준다.
--   · 가상 회차 삭제 = 자식 없이 예외 날짜만(그 날만 사라진다).
--   · 원본(첫 회차) 수정 = 아직 떼어내지 않은 회차 전체에 적용. 원본 삭제 = 반복 전체 삭제, 떼어낸 회차는 남는다(set null).
--   행 수는 사람이 실제로 손댄 회차만큼만 는다.

alter table public.schedule_events
  add column if not exists recurrence_parent_id uuid references public.schedule_events(id) on delete set null,
  add column if not exists occurrence_date date,
  add column if not exists recurrence_exceptions date[] not null default '{}';

create unique index if not exists schedule_events_occurrence_uniq
  on public.schedule_events (recurrence_parent_id, occurrence_date)
  where recurrence_parent_id is not null and occurrence_date is not null;

-- ── 회차 떼어내기 ─────────────────────────────────────────────────────────────────────────────
--   RLS 그대로(security invoker) — 원본 갱신은 'manage own events' 정책이 막으면 0행이라 FORBIDDEN.
--   p_patch: 이 회차에만 적용할 값(title·description·start_at·end_at·all_day·color·visibility·
--            target_user_ids·target_departments·priority·attachments·completed). 없는 키는 원본값.
--   같은 (원본, 날짜) 자식이 이미 있으면 그 행에 patch 만 적용한다(두 번 눌러도 행이 늘지 않는다).
create or replace function public.schedule_detach_occurrence(p_parent uuid, p_date date, p_patch jsonb default '{}'::jsonb)
returns public.schedule_events
language plpgsql
set search_path to 'public'
as $function$
declare
  v_p public.schedule_events;
  v_c public.schedule_events;
  v_start timestamptz; v_end timestamptz; v_dur interval;
  v_completed boolean;
begin
  select * into v_p from public.schedule_events where id = p_parent;
  if v_p.id is null then raise exception 'NOT_FOUND'; end if;
  if v_p.recurrence is null or coalesce(v_p.recurrence->>'freq', '') = '' then raise exception 'NOT_RECURRING'; end if;
  if v_p.start_at is null then raise exception 'NOT_RECURRING'; end if;

  -- 회차 시각 = 그 날짜 + 원본의 하루 중 시각(KST), 길이 = 원본 길이
  v_start := (p_date::text || ' ' || to_char(v_p.start_at at time zone 'Asia/Seoul', 'HH24:MI:SS'))::timestamp at time zone 'Asia/Seoul';
  v_dur := case when v_p.end_at is null then null else v_p.end_at - v_p.start_at end;
  v_end := case when v_dur is null then null else v_start + v_dur end;
  if p_patch ? 'start_at' then v_start := (p_patch->>'start_at')::timestamptz; end if;
  if p_patch ? 'end_at' then v_end := nullif(p_patch->>'end_at', '')::timestamptz; end if;
  v_completed := coalesce((p_patch->>'completed')::boolean, false);

  select * into v_c from public.schedule_events
   where recurrence_parent_id = p_parent and occurrence_date = p_date;

  if v_c.id is null then
    insert into public.schedule_events (
      company_id, user_id, title, description, start_at, end_at, all_day, color, is_shared, visibility,
      target_user_ids, target_departments, priority, position, attachments, deal_id,
      completed, completed_at, recurrence, reminder, reminders, reminded_at, reminders_sent,
      recurrence_parent_id, occurrence_date)
    values (
      v_p.company_id, v_p.user_id,
      coalesce(p_patch->>'title', v_p.title),
      case when p_patch ? 'description' then nullif(p_patch->>'description', '') else v_p.description end,
      v_start, v_end,
      coalesce((p_patch->>'all_day')::boolean, v_p.all_day),
      coalesce(p_patch->>'color', v_p.color),
      coalesce(p_patch->>'visibility', v_p.visibility) = 'company',
      coalesce(p_patch->>'visibility', v_p.visibility),
      case when p_patch ? 'target_user_ids' then (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(p_patch->'target_user_ids') x) else v_p.target_user_ids end,
      case when p_patch ? 'target_departments' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(p_patch->'target_departments') x) else v_p.target_departments end,
      coalesce((p_patch->>'priority')::smallint, v_p.priority),
      v_p.position,
      coalesce(p_patch->'attachments', v_p.attachments),
      v_p.deal_id,
      v_completed, case when v_completed then now() else null end,
      null, null, null, null, '[]'::jsonb,
      p_parent, p_date)
    returning * into v_c;
  else
    update public.schedule_events set
      title = coalesce(p_patch->>'title', title),
      description = case when p_patch ? 'description' then nullif(p_patch->>'description', '') else description end,
      start_at = case when p_patch ? 'start_at' then v_start else start_at end,
      end_at = case when p_patch ? 'end_at' then v_end else end_at end,
      all_day = coalesce((p_patch->>'all_day')::boolean, all_day),
      color = coalesce(p_patch->>'color', color),
      visibility = coalesce(p_patch->>'visibility', visibility),
      is_shared = coalesce(p_patch->>'visibility', visibility) = 'company',
      target_user_ids = case when p_patch ? 'target_user_ids' then (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(p_patch->'target_user_ids') x) else target_user_ids end,
      target_departments = case when p_patch ? 'target_departments' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(p_patch->'target_departments') x) else target_departments end,
      priority = coalesce((p_patch->>'priority')::smallint, priority),
      attachments = coalesce(p_patch->'attachments', attachments),
      completed = case when p_patch ? 'completed' then v_completed else completed end,
      completed_at = case when p_patch ? 'completed' then (case when v_completed then now() else null end) else completed_at end,
      updated_at = now()
    where id = v_c.id
    returning * into v_c;
    if v_c.id is null then raise exception 'FORBIDDEN'; end if;
  end if;

  -- 원본에 예외 날짜 — 달력이 그 날 가상 회차를 더 그리지 않는다
  update public.schedule_events
     set recurrence_exceptions = array(select distinct d from unnest(recurrence_exceptions || p_date) d),
         updated_at = now()
   where id = p_parent;
  if not found then raise exception 'FORBIDDEN'; end if;
  return v_c;
end $function$;

-- ── 회차 하나만 지우기 — 자식 행 없이 예외 날짜만 ─────────────────────────────────────────────
create or replace function public.schedule_skip_occurrence(p_parent uuid, p_date date)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  delete from public.schedule_events where recurrence_parent_id = p_parent and occurrence_date = p_date;
  update public.schedule_events
     set recurrence_exceptions = array(select distinct d from unnest(recurrence_exceptions || p_date) d),
         updated_at = now()
   where id = p_parent;
  if not found then raise exception 'FORBIDDEN'; end if;
end $function$;

revoke execute on function public.schedule_detach_occurrence(uuid, date, jsonb) from public, anon;
revoke execute on function public.schedule_skip_occurrence(uuid, date) from public, anon;
grant execute on function public.schedule_detach_occurrence(uuid, date, jsonb) to authenticated;
grant execute on function public.schedule_skip_occurrence(uuid, date) to authenticated;
