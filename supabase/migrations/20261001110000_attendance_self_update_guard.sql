-- 직원 본인 출퇴근 기록 — 직접 고칠 수 있는 칸을 근무 유형·현장으로 좁힌다 (2026-10-01 지각 사유 후속).
--
-- History: 2026-05-20 attendance_records_update_admin_or_self 가 '본인 행 UPDATE' 를 열었다(그때 이유: 브라우저가
--   분 칸을 직접 쓰던 시절 42501 로 0 이 남던 회귀). 지금은 분 칸은 set_attendance_minutes, 지각 사유는 set_late_reason,
--   출근·퇴근·퇴근취소는 attendance-checkin 엣지(서비스 키)가 쓴다. 그런데 정책은 행 단위라 직원이 브라우저에서
--   check_in·status·note 같은 칸까지 직접 바꿀 수 있었다(정정 요청·관리자 승인을 건너뜀). INSERT 도 본인 행이면 열려 있었다.
--
-- 규칙: 클라이언트가 직접 보낸 문장(current_user = 'authenticated')이고, 관리자(is_company_admin / /attendance:records)가 아니면
--   · INSERT 금지 — 출근 기록은 출근 버튼(엣지)으로만 생긴다
--   · UPDATE 는 attendance_type·deal_id 외 칸이 바뀌면 거부
--   SECURITY DEFINER 함수 안(current_user = 함수 소유자)·엣지 서비스 키(service_role)는 그대로 통과한다.
-- 순서: BEFORE 트리거는 이름순 — attendance_records_guard_self 가 attendance_records_judge 보다 먼저 돌아
--   판정이 다시 채운 칸(is_late·status)을 '직원이 바꾼 것'으로 오인하지 않는다.
-- 기존 데이터: 손대지 않음(검사만).
create or replace function public.attendance_records_guard_self_trg()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if public.is_company_admin() or public.has_perm('/attendance:records') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception '출근 기록은 출근 버튼으로만 만들 수 있습니다' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['attendance_type', 'deal_id']) is distinct from (to_jsonb(old) - array['attendance_type', 'deal_id']) then
    raise exception '본인 출퇴근 기록은 근무 유형·현장만 바꿀 수 있습니다. 시각이 틀렸으면 정정 요청을 보내세요' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists attendance_records_guard_self on public.attendance_records;
create trigger attendance_records_guard_self
  before insert or update on public.attendance_records
  for each row execute function public.attendance_records_guard_self_trg();
