-- 무료 플랜 은행·카드 허용 + 충전(크레딧) 도입 (2026-08-07 사장님 지시)
--
-- ① 무료 플랜도 은행·카드 동기화 허용.
--    자동 동기화는 전 플랜 공통 하루 2회(09:10·18:10 KST) — 이미 그렇게 돈다.
--    즉시 동기화 버튼은 횟수 제한 없이 30분 쿨다운(sync_cooldowns) — 기존 그대로.
--    ⚠️ 무료 회사도 CODEF 비용(계좌당 약 600원/월)이 발생한다. 수익 없이 나가는 비용임을 전제로 한 결정.
-- ② 충전 — 월 기본 제공량을 다 쓴 뒤 돈으로 사서 이어 쓰는 잔액.
--    단가: 발행 300원/건, AI 토큰 100만개 10,000원. 유효기간 없음(소진까지 이월). 구독자만 구매.
--    소비 순서: 월 제공량 먼저 → 소진 후 충전 잔액.
--
-- 실제 적용은 2026-08-07 운영에 먼저 반영했고(apply_migration), 이 파일은 저장소 기록용이다.
-- 함수 본문은 운영과 동일하게 유지할 것.

update public.subscription_plans set bank_sync_enabled = true where slug = 'free';

create table if not exists public.credit_balances (
  company_id    uuid primary key references public.companies(id) on delete cascade,
  ai_tokens     bigint  not null default 0 check (ai_tokens >= 0),
  issue_credits integer not null default 0 check (issue_credits >= 0),
  updated_at    timestamptz not null default now()
);

create table if not exists public.credit_purchases (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null check (kind in ('ai_tokens', 'issue')),
  quantity     bigint not null check (quantity > 0),
  amount_krw   integer not null check (amount_krw >= 0),
  status       text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  provider     text not null default 'stripe',
  provider_ref text,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists credit_purchases_company_idx on public.credit_purchases (company_id, created_at desc);
create unique index if not exists credit_purchases_provider_ref_uniq
  on public.credit_purchases (provider_ref) where provider_ref is not null;

alter table public.credit_balances  enable row level security;
alter table public.credit_purchases enable row level security;

drop policy if exists credit_balances_select on public.credit_balances;
create policy credit_balances_select on public.credit_balances
  for select using (company_id = (select public.get_my_company_id()));

drop policy if exists credit_purchases_select on public.credit_purchases;
create policy credit_purchases_select on public.credit_purchases
  for select using (company_id = (select public.get_my_company_id()));

-- 소비·적립 함수 (issue_allowance / consume_issue_credit / ai_token_allowance /
--   consume_ai_tokens / apply_credit_purchase) 는 운영에 적용된 정의와 동일하다.
--   전체 본문은 20260807100001_credit_consume_functions.sql 참조.
