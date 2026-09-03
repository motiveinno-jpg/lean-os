-- 연차 사용일수(leave_balances.used_days)를 승인된 휴가 기록에서 항상 다시 계산한다 (2026-09-03 사장님 신고: 양정훈 잔여 2일 ≠ 실제 1.5일)
--
--   History: used_days 는 세 곳이 제각각 '+days / -days / 덮어쓰기' 로 만졌다 —
--     ① apply_approval_side_effects(결재 승인): 잔액 행이 **있을 때만** used_days + days
--     ② lib/hr.ts deductLeaveBalance / cancel: used ± days (행 없으면 조용히 건너뜀)
--     ③ lib/hr.ts autoInitLeaveBalance(관리자 연차 설정): used_days 를 통째로 덮어씀
--   경로마다 계산이 달라 승인 순서·행 생성 시점에 따라 어긋났다. 실측(2026-09-03, 모티브):
--     양정훈 used 0.0 vs 승인 연차 합 0.5 / 권순철 used 3.0 vs 승인 합 4.0. 나머지 8명은 일치.
--
--   자문자답
--   ① 무엇을 기준으로 판단하는가 — **승인(approved)된 연차(leave_type='annual') 휴가 기록의 days 합**이 사용일수다.
--      다른 종류(공가·경조 등)는 hr.ts NON_DEDUCT_LEAVE_TYPES 와 같이 차감하지 않는다.
--   ② 관리자가 손으로 "사용 N일"을 넣는 경우는 — 기록이 없는 과거 사용분이다. 별도 칸 adjust_days(보정)에 두고
--      used_days = 기록 합 + 보정 으로 계산한다. 보정은 관리자 화면만 쓴다.
--   ③ 반대 경우 — 취소·반려·삭제되면 합에서 저절로 빠진다(트리거가 다시 계산). ± 코드가 남아 있어도 무해하다:
--      BEFORE 트리거가 들어오는 used_days 를 무시하고 계산값으로 바꾼다.
--   ④ 자동으로 못 푸는 것 — 잔액 행이 아예 없는 직원(신규)은 총부여가 없으니 잔여도 없다. 행 생성은 발생 크론·관리자 화면 몫.
--
--   기존 데이터 처리: 모티브만 재계산(다른 회사는 실측상 이미 일치, QA시드는 시드값이라 두고 다음 갱신 때 자연 정합).

alter table public.leave_balances
  add column if not exists adjust_days numeric not null default 0;
comment on column public.leave_balances.adjust_days is '관리자 보정(기록 없는 과거 사용분). used_days = 승인 연차 기록 합 + adjust_days (트리거 계산)';
comment on column public.leave_balances.used_days is '계산값 — 승인(approved) 연차(annual) leave_requests.days 합 + adjust_days. 직접 쓴 값은 트리거가 무시한다.';

create or replace function public.leave_used_from_requests(p_employee uuid, p_year int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(days), 0)
    from public.leave_requests
   where employee_id = p_employee and status = 'approved' and leave_type = 'annual'
     and extract(year from start_date)::int = p_year;
$$;
grant execute on function public.leave_used_from_requests(uuid, int) to authenticated;

create or replace function public.trg_leave_balances_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.used_days := public.leave_used_from_requests(new.employee_id, new.year) + coalesce(new.adjust_days, 0);
  return new;
end $$;
drop trigger if exists leave_balances_used_recompute on public.leave_balances;
create trigger leave_balances_used_recompute
  before insert or update on public.leave_balances
  for each row execute function public.trg_leave_balances_recompute();

create or replace function public.trg_leave_requests_touch_balance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    update public.leave_balances set used_days = used_days
     where employee_id = old.employee_id and year = extract(year from old.start_date)::int;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.leave_balances set used_days = used_days
     where employee_id = new.employee_id and year = extract(year from new.start_date)::int;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists leave_requests_touch_balance on public.leave_requests;
create trigger leave_requests_touch_balance
  after insert or update or delete on public.leave_requests
  for each row execute function public.trg_leave_requests_touch_balance();

-- 모티브 재계산(보정 0 기준)
update public.leave_balances set adjust_days = 0
 where company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c';
