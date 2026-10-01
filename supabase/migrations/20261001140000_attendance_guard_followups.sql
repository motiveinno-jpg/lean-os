-- 근태 보안 검토(2026-10-01) 후속 — DB 쪽 M2·L1·L6.
--   M2: 직원에게 열어 둔 현장(deal_id)에 아무 프로젝트 id 나 넣을 수 있었다 → 그 행과 같은 회사 프로젝트만(누가 쓰든).
--       기존 데이터: deal_id 있는 행 1건, 다른 회사 연결 0건 — 손대지 않음(바뀔 때만 검사).
--   L1: 통과 역할을 'authenticated 가 아니면' 대신 '클라이언트 역할(authenticated·anon)만 검사'로 명시.
--   L6: attendance_judge 를 로그인 사용자가 직접 불러 다른 직원의 출근 기준·휴가 여부를 추론할 수 있었다 → 실행 권한 회수
--       (트리거 attendance_records_judge_trg 는 SECURITY DEFINER 라 영향 없음. 화면 호출 0건 확인).
create or replace function public.attendance_records_guard_self_trg()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.deal_id is not null and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id) then
    if not exists (select 1 from public.deals d where d.id = new.deal_id and d.company_id = new.company_id) then
      raise exception '같은 회사 프로젝트만 현장으로 기록할 수 있습니다' using errcode = '42501';
    end if;
  end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_company_admin() or public.has_perm('/attendance:records') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception '출근 기록은 출근 버튼으로만 만들 수 있습니다' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['attendance_type', 'deal_id']) is distinct from (to_jsonb(old) - array['attendance_type', 'deal_id']) then
    raise exception '본인 출퇴근 기록은 근무 유형·현장만 바꿀 수 있습니다. 시각이 틀렸으면 정정 요청을 보내세요' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function public.attendance_judge(uuid, uuid, date, timestamptz, text) from public, anon, authenticated;
