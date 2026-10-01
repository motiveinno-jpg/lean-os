-- 지각 사유 (2026-10-01 사장님: "본래 출근시간보다 늦게 출근을 찍을 경우 지각에 대한 사유 작성이 가능하도록").
--   note 는 관리자 비고·정정 요청 승인이 덮어쓰는 칸이라 직원이 쓴 사유가 사라질 수 있다 → 칸을 따로 둔다.
--   지각 판정(is_late)은 attendance_judge 트리거 그대로 — 사유는 판정을 바꾸지 않는다(면제는 정정 요청·관리자 수정의 몫).
--   쓰기는 본인만, 지각인 날만. 빈 값 = 지움. 기존 데이터: 칸만 생기고 전부 null(소급 없음).
alter table public.attendance_records
  add column if not exists late_reason text,
  add column if not exists late_reason_at timestamptz;

create or replace function public.set_late_reason(p_record_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  r record;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  select ar.id, ar.is_late, e.user_id into r
    from public.attendance_records ar join public.employees e on e.id = ar.employee_id
   where ar.id = p_record_id;
  -- 한 사람이 여러 회사 직원일 수 있어 current_employee_id()(LIMIT 1) 대신 행의 직원 → user_id 로 본인 확인
  if r.id is null or r.user_id is distinct from v_user then raise exception 'forbidden'; end if;
  if v_reason is not null and not coalesce(r.is_late, false) then raise exception '지각으로 기록된 날만 사유를 적을 수 있습니다'; end if;
  if char_length(v_reason) > 500 then raise exception '사유는 500자까지 적을 수 있습니다'; end if;
  update public.attendance_records
     set late_reason = v_reason,
         late_reason_at = case when v_reason is null then null else now() end
   where id = p_record_id;
end $$;

revoke all on function public.set_late_reason(uuid, text) from public, anon;
grant execute on function public.set_late_reason(uuid, text) to authenticated;
