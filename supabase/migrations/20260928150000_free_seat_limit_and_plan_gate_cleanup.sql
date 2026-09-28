begin;
--   요금제 제한을 공개 요금표와 맞춘다.
--
--   1) 옛 "Plan gate" 정책 6개 삭제
--      starter/pro 3단 요금제 시절 정책이다. 지금 요금제는 free·standard(·자사 ultra)뿐인데 plan_rank('standard') 가 0 이라,
--      이 정책을 제대로 막는 쪽(RESTRICTIVE)으로 켜면 유료 고객이 거래처·직원·계산서를 못 넣는다.
--      지금은 PERMISSIVE 라 아무것도 막지 않는 죽은 규칙이고, 공개 요금표도 무료에 거래처·프로젝트·급여를 준다.
--      실제 한도는 아래 전용 트리거들이 맡는다(계좌 3개·전자계약 월 5건·발행 월 5건·구성원 5명).
--
--   2) 무료 구성원 5명 — 요금표·billing.ts 는 5명이라 적었는데 서버에서 막는 곳이 없었다.
--      좌석 = 재직(active·joined) 구성원(토스 월 청구와 같은 기준). 샘플 회사 체험으로 복사한 가짜 구성원은 좌석이 아니다.
--      이미 5명을 넘은 무료 회사는 그대로 두고 새로 늘리는 것만 막는다.
--
--   3) 좌석 수 한 곳 — company_seat_count. 월 청구(toss-charge)·요금제 화면이 샘플 구성원까지 세어
--      샘플을 지우지 않고 결제하면 가짜 인원만큼 추가 좌석이 청구될 수 있었다.

drop policy if exists "Plan gate: loans require pro" on public.loans;
drop policy if exists "Plan gate: tax_invoices require pro" on public.tax_invoices;
drop policy if exists "Plan gate: deals require starter" on public.deals;
drop policy if exists "Plan gate: partners require starter" on public.partners;
drop policy if exists "Plan gate: employees require starter" on public.employees;
drop policy if exists "Plan gate: signature_requests require starter" on public.signature_requests;

create or replace function public.company_seat_count(p_company uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth.uid() is not null
     and not exists (select 1 from public.users where auth_id = auth.uid() and company_id = p_company)
     and not public.is_platform_operator()
      then null
    else (
      select count(*)::int from public.employees e
       where e.company_id = p_company
         and e.status in ('active', 'joined')
         and not exists (select 1 from public.sample_data_rows s
                          where s.company_id = p_company and s.table_name = 'employees' and s.row_id = e.id))
  end
$$;
revoke all on function public.company_seat_count(uuid) from public, anon;
grant execute on function public.company_seat_count(uuid) to authenticated, service_role;

create or replace function public.enforce_free_seat_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug  text;
  v_limit int;
  v_used  int;
begin
  if new.status not in ('active', 'joined') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('active', 'joined') and old.company_id = new.company_id then return new; end if;
  --   샘플 회사 체험 복사(sample_company_seed 가 트랜잭션 한정으로 켠다)
  if coalesce(current_setting('ownerview.sample_seed', true), '') = 'on' then return new; end if;

  select effective_plan_slug into v_slug from public.get_company_entitlement(new.company_id);
  select sp.max_seats into v_limit from public.subscription_plans sp where sp.slug = coalesce(v_slug, 'free');
  if v_limit is null then return new; end if;

  select count(*) into v_used from public.employees e
   where e.company_id = new.company_id
     and e.status in ('active', 'joined')
     and e.id <> new.id
     and not exists (select 1 from public.sample_data_rows s
                      where s.company_id = new.company_id and s.table_name = 'employees' and s.row_id = e.id);
  if v_used >= v_limit then
    raise exception 'SEAT_LIMIT_EXCEEDED: 무료 요금제는 구성원 %명까지입니다.', v_limit using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_free_seat_limit() from public, anon, authenticated;

drop trigger if exists trg_enforce_free_seat_limit on public.employees;
create trigger trg_enforce_free_seat_limit
  before insert or update of status, company_id on public.employees
  for each row execute function public.enforce_free_seat_limit();

--   샘플 복사는 본문을 그대로 두고 앞에서 표시만 켠다(트랜잭션 한정). 함수 단위 SET 은 사용자 GUC 라 권한이 없어 감쌌다.
alter function public.sample_company_seed(uuid) rename to _sample_company_seed_body;
revoke all on function public._sample_company_seed_body(uuid) from public, anon, authenticated;
create function public.sample_company_seed(p_company uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform set_config('ownerview.sample_seed', 'on', true);
  return public._sample_company_seed_body(p_company);
end $$;
revoke all on function public.sample_company_seed(uuid) from public, anon;
grant execute on function public.sample_company_seed(uuid) to authenticated, service_role;
commit;
