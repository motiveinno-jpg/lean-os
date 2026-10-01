-- set_attendance_minutes — 관리자(마스터·/attendance:records) 전용 (2026-10-01).
--   History: 2026-05-20 직원 본인 행도 허용(브라우저가 퇴근 직후 분을 계산해 넘기던 시절). 그 탓에 직원이 본인 행에
--   연장·야간 분을 임의 숫자로 넣을 수 있었다(연장 수당 직결). 직원 경로는 /api/attendance/recompute-self 가
--   서버에서 계산·저장하도록 옮겼다(같은 attendance-calc). 이 함수는 관리자 재계산(다른 사람·회사 전체)만 남는다.
--   시그니처·반환 그대로. 기존 데이터 무변경.
create or replace function public.set_attendance_minutes(
  p_record_id uuid, p_is_late boolean, p_late_minutes integer, p_regular_minutes integer,
  p_overtime_minutes integer, p_night_minutes integer, p_holiday_minutes integer, p_is_holiday boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := current_app_user_id();
  v_company uuid;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if not (public.is_company_admin() or public.has_perm('/attendance:records')) then
    raise exception 'forbidden — 근무 분 저장은 관리자만 할 수 있습니다';
  end if;
  select ar.company_id into v_company from attendance_records ar where ar.id = p_record_id;
  if v_company is null then raise exception 'record not found'; end if;
  if v_company is distinct from get_my_company_id() then raise exception 'forbidden'; end if;

  update attendance_records
     set is_late = p_is_late,
         late_minutes = coalesce(p_late_minutes, 0),
         regular_minutes = coalesce(p_regular_minutes, 0),
         overtime_minutes = coalesce(p_overtime_minutes, 0),
         night_minutes = coalesce(p_night_minutes, 0),
         holiday_minutes = coalesce(p_holiday_minutes, 0),
         is_holiday = coalesce(p_is_holiday, is_holiday)
   where id = p_record_id;
  return found;
end $$;
