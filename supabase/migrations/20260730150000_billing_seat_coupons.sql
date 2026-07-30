-- 연간 결제 혜택: 추가인원 12명 무료 등록 쿠폰 (2026-07-30 사장님)
--   발급: 연간 결제 완료 웹훅(구독당 1장, 멱등). 사용: redeem_seat_coupon RPC(관리자/대표).
--   효과: 사용된 쿠폰의 free_seats 만큼 추가좌석 과금에서 제외(체크아웃 서버 계산).
create table if not exists billing_seat_coupons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  free_seats int not null default 12 check (free_seats > 0),
  source text not null default 'annual_subscription',
  stripe_subscription_id text,
  status text not null default 'issued' check (status in ('issued','redeemed','expired')),
  issued_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references users(id)
);
create unique index if not exists billing_seat_coupons_sub_uniq
  on billing_seat_coupons(stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists billing_seat_coupons_company_idx on billing_seat_coupons(company_id, status);

alter table billing_seat_coupons enable row level security;
drop policy if exists seat_coupons_select on billing_seat_coupons;
create policy seat_coupons_select on billing_seat_coupons
  for select to authenticated using (company_id = get_my_company_id());
-- insert 는 service role(웹훅)만, 상태 변경은 RPC 만 — 직접 update/insert 정책 없음

create or replace function redeem_seat_coupon(p_coupon_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_user users%rowtype;
  v_coupon billing_seat_coupons%rowtype;
begin
  select * into v_user from users where auth_id = auth.uid() limit 1;
  if v_user.id is null then
    return json_build_object('ok', false, 'error', '로그인이 필요합니다');
  end if;
  if v_user.role not in ('owner','admin') then
    return json_build_object('ok', false, 'error', '관리자/대표만 쿠폰을 사용할 수 있습니다');
  end if;
  select * into v_coupon from billing_seat_coupons
    where id = p_coupon_id and company_id = v_user.company_id for update;
  if v_coupon.id is null then
    return json_build_object('ok', false, 'error', '쿠폰을 찾을 수 없습니다');
  end if;
  if v_coupon.status <> 'issued' then
    return json_build_object('ok', false, 'error', '이미 사용되었거나 만료된 쿠폰입니다');
  end if;
  update billing_seat_coupons
    set status = 'redeemed', redeemed_at = now(), redeemed_by = v_user.id
    where id = v_coupon.id;
  return json_build_object('ok', true, 'free_seats', v_coupon.free_seats);
end $$;
