begin;
--   무료 구성원 한도를 초대 단계에서도 건다.
--   합류(invited → joined) 때에야 막으면 users 는 이미 회사로 옮겨진 뒤라 반쯤 들어온 상태가 되고,
--   일괄 초대는 구성원 행 저장이 실패해도 초대 메일을 보내 구성원 행 없이 합류(=좌석 밖)할 수 있었다.
--   그래서 초대 대기(invited)도 자리를 잡은 것으로 센다(청구 좌석은 여전히 active·joined 만).
--   초대 수락처럼 이미 자리를 잡은 행의 상태 변경은 다시 검사하지 않는다.

create or replace function public._free_seat_limit_check(p_company uuid, p_exclude uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug  text;
  v_limit int;
  v_used  int;
begin
  if coalesce(current_setting('ownerview.sample_seed', true), '') = 'on' then return; end if;
  select effective_plan_slug into v_slug from public.get_company_entitlement(p_company);
  select sp.max_seats into v_limit from public.subscription_plans sp where sp.slug = coalesce(v_slug, 'free');
  if v_limit is null then return; end if;
  select count(*) into v_used from public.employees e
   where e.company_id = p_company
     and e.status in ('active', 'joined', 'invited')
     and e.id is distinct from p_exclude
     and not exists (select 1 from public.sample_data_rows s
                      where s.company_id = p_company and s.table_name = 'employees' and s.row_id = e.id);
  if v_used >= v_limit then
    raise exception 'SEAT_LIMIT_EXCEEDED: 무료 요금제는 구성원 %명까지입니다.', v_limit using errcode = 'P0001';
  end if;
end $$;
revoke all on function public._free_seat_limit_check(uuid, uuid) from public, anon, authenticated;

create or replace function public.enforce_free_seat_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status not in ('active', 'joined', 'invited') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('active', 'joined', 'invited') and old.company_id = new.company_id then return new; end if;
  perform public._free_seat_limit_check(new.company_id, new.id);
  return new;
end $$;

create or replace function public.enforce_free_seat_limit_invite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  --   같은 이메일의 구성원 행이 이미 자리를 잡고 있으면(재초대) 새 자리가 아니다
  if exists (select 1 from public.employees e
              where e.company_id = new.company_id and lower(e.email) = lower(new.email)
                and e.status in ('active', 'joined', 'invited')) then
    return new;
  end if;
  perform public._free_seat_limit_check(new.company_id, null);
  return new;
end $$;
revoke all on function public.enforce_free_seat_limit_invite() from public, anon, authenticated;

drop trigger if exists trg_enforce_free_seat_limit_invite on public.employee_invitations;
create trigger trg_enforce_free_seat_limit_invite
  before insert on public.employee_invitations
  for each row execute function public.enforce_free_seat_limit_invite();
commit;
