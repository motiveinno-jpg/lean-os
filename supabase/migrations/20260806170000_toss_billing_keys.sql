-- 토스페이먼츠 자동결제(빌링) 1단계 — 카드 등록/빌링키 보관 (2026-08-06).
--   빌링키는 "이 카드로 임의 금액을 결제할 수 있는 열쇠"다. 유출 = 무단 결제.
--   그래서 subscriptions(대표가 SELECT 가능) 에 두지 않고 별도 테이블에 격리하고,
--   authenticated 정책을 **하나도 만들지 않아** 클라이언트 접근을 전면 차단한다(서비스 롤=엣지 함수만).
--   값 자체도 엣지 함수에서 AES-GCM 으로 암호화해 넣는다 — DB 덤프만으로는 쓸 수 없다.

create table if not exists public.toss_billing_keys (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  -- 토스에 보내는 고객 식별자. 회사 UUID 를 그대로 쓰면 URL 로 노출되므로 별도 난수를 쓴다.
  customer_key        text not null unique,
  -- AES-GCM 암호문(base64). 평문 빌링키는 어디에도 저장하지 않는다.
  billing_key_enc     text,
  card_company        text,
  card_number_masked  text,
  card_type           text,
  registered_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.toss_billing_keys enable row level security;
-- ⚠️ 의도적으로 authenticated 용 정책을 만들지 않는다(= 전면 차단).
--   화면에 필요한 카드사·마스킹 번호는 아래 get_toss_card_info() 로만 나간다.

-- 화면 표시용 — 빌링키는 절대 반환하지 않고, 본인 회사만 조회 가능.
create or replace function public.get_toss_card_info(p_company_id uuid)
returns table(card_company text, card_number_masked text, card_type text, registered_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.card_company, t.card_number_masked, t.card_type, t.registered_at
  from public.toss_billing_keys t
  where t.company_id = p_company_id
    and exists (
      select 1 from public.users u
      where u.auth_id = auth.uid() and u.company_id = p_company_id
    );
$$;

grant execute on function public.get_toss_card_info(uuid) to authenticated;

-- 한 회사가 Stripe·토스 양쪽으로 이중 청구되는 걸 구조로 막는다.
alter table public.subscriptions
  add column if not exists payment_provider text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_payment_provider_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_payment_provider_check
      check (payment_provider is null or payment_provider in ('stripe', 'toss'));
  end if;
end $$;

-- 기존 행 백필 — Stripe 고객 식별자가 있으면 stripe 로 표시.
update public.subscriptions
   set payment_provider = 'stripe'
 where payment_provider is null and stripe_customer_id is not null;

-- billing_events.event_type CHECK 는 코드가 쓰는 값보다 좁으면 insert 가 실패한다
--   (구독 해지 정합 때 같은 함정을 겪었다) — 토스 1단계에서 쓸 값을 미리 넓혀 둔다.
alter table public.billing_events drop constraint if exists billing_events_event_type_check;
alter table public.billing_events add constraint billing_events_event_type_check
  check (event_type = any (array[
    'payment_success','payment_failed','plan_changed','subscription_created','subscription_canceled',
    'subscription_paused','subscription_resumed','refund','trial_started','trial_ended','seat_changed',
    'checkout_completed','feedback_received','invoice_paid','payment_confirm_failed','payment_confirmed',
    'subscription_cancel_requested','subscription_deleted','subscription_ended','subscription_updated',
    'internal_plan_restored','trial_will_end',
    -- 토스 자동결제
    'billing_key_registered','billing_key_removed','billing_key_failed'
  ]));
