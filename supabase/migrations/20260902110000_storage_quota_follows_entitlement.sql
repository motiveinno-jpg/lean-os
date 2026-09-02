-- 저장공간 한도가 '실효 플랜'을 따르게 (스토리지 팩 후속, 2026-09-02 사장님 "네가 판단해 적용")
--   문제: get_company_storage / company_storage_quota 가 최신 구독을 status 무관하게 집어,
--         해지 완료·기간 만료 회사도 좌석·팩 한도를 그대로 유지했다(무료인데 유료 한도 = 수익 누수).
--   결정: 한도는 get_company_entitlement 와 같은 규칙으로 판정한다 — 실효 플랜이 free 면
--         기본 500MiB 만(좌석·팩 0), 아니면 플랜 공식. 만료 시 파일은 그대로 두고 새 업로드만 막힌다
--         (다시 결제하면 즉시 원복). 판정 규칙을 한 곳(storage_quota_params)에 모아 두 함수가 공유.
--   규칙(get_company_entitlement 와 동일): 구독 없음 → free / trialing 은 trial_ends_at 지나면 free /
--         active·past_due·paused 는 current_period_end + 3일 유예 지나면 free / 그 외(canceled 등) free.

create or replace function public.storage_quota_params(p_company uuid)
returns table(included_bytes bigint, per_unit_bytes bigint, extra_seats int, storage_packs int, effective_paid boolean)
language plpgsql stable security definer set search_path=public as $$
declare
  s record;
  v_incl bigint; v_unit bigint; v_incl_seats int; v_paid boolean := false;
begin
  select sub.seat_count, sub.storage_pack_count, sub.status, sub.trial_ends_at, sub.current_period_end,
         p.included_seats, p.included_storage_bytes, p.storage_per_unit_bytes, p.slug
    into s
  from public.subscriptions sub
  join public.subscription_plans p on p.id = sub.plan_id
  where sub.company_id = p_company
  order by sub.created_at desc limit 1;

  if not found then
    included_bytes := 524288000; per_unit_bytes := 10737418240;
    extra_seats := 0; storage_packs := 0; effective_paid := false;
    return next; return;
  end if;

  v_incl := coalesce(s.included_storage_bytes, 524288000);
  v_unit := coalesce(s.storage_per_unit_bytes, 10737418240);
  v_incl_seats := coalesce(s.included_seats, 0);

  if coalesce(s.slug, 'free') = 'free' then
    v_paid := false;
  elsif s.status = 'trialing' then
    v_paid := s.trial_ends_at is not null and s.trial_ends_at > now();
  elsif s.status in ('active', 'past_due', 'paused') then
    v_paid := s.current_period_end is null or s.current_period_end + interval '3 days' > now();
  else
    v_paid := false;
  end if;

  included_bytes := v_incl; per_unit_bytes := v_unit; effective_paid := v_paid;
  if v_paid then
    extra_seats := greatest(0, coalesce(s.seat_count, 1) - v_incl_seats);
    storage_packs := coalesce(s.storage_pack_count, 0);
  else
    -- 실효 무료: 좌석·팩 한도 없음. 파일은 남고 새 업로드만 막힌다(재결제 시 즉시 원복).
    extra_seats := 0; storage_packs := 0;
  end if;
  return next;
end $$;
grant execute on function public.storage_quota_params(uuid) to authenticated;

-- 조회 RPC — effective_paid 컬럼 추가(화면이 "만료돼 기본 한도로 돌아감"을 설명할 수 있게)
drop function if exists public.get_company_storage(uuid);
create function public.get_company_storage(p_company uuid default null)
returns table(used_bytes bigint, quota_bytes bigint, included_bytes bigint,
              per_unit_bytes bigint, extra_seats int, storage_packs int, effective_paid boolean)
language plpgsql stable security definer set search_path=public as $$
declare
  cid uuid := coalesce(p_company, public.get_my_company_id());
  q record;
begin
  select * into q from public.storage_quota_params(cid);
  used_bytes := coalesce((select u.used_bytes from public.company_storage_usage u where u.company_id = cid), 0);
  included_bytes := q.included_bytes; per_unit_bytes := q.per_unit_bytes;
  extra_seats := q.extra_seats; storage_packs := q.storage_packs; effective_paid := q.effective_paid;
  quota_bytes := q.included_bytes + (q.extra_seats + q.storage_packs)::bigint * q.per_unit_bytes;
  return next;
end $$;
grant execute on function public.get_company_storage(uuid) to authenticated;

-- 게이트용 경량 함수 — 같은 규칙
create or replace function public.company_storage_quota(p_company uuid)
returns bigint language plpgsql stable security definer set search_path=public as $$
declare q record;
begin
  select * into q from public.storage_quota_params(p_company);
  return q.included_bytes + (q.extra_seats + q.storage_packs)::bigint * q.per_unit_bytes;
end $$;
grant execute on function public.company_storage_quota(uuid) to authenticated;

-- 팩 변경은 실효 유료 회사만 — 만료 구독에 팩을 붙여도 한도가 안 늘어 혼란만 생긴다.
create or replace function public.set_storage_packs(p_count int)
returns int language plpgsql security definer set search_path=public as $$
declare cid uuid := public.get_my_company_id(); q record;
begin
  if not public.is_company_owner() then raise exception 'not authorized'; end if;
  if p_count is null or p_count < 0 then raise exception 'invalid count'; end if;
  select * into q from public.storage_quota_params(cid);
  if not q.effective_paid then raise exception 'no subscription'; end if;
  update public.subscriptions set storage_pack_count = p_count, updated_at = now()
    where company_id = cid;
  if not found then raise exception 'no subscription'; end if;
  return p_count;
end $$;
grant execute on function public.set_storage_packs(int) to authenticated;
