-- 구독 결제 결과를 고객(회사 대표·관리자)에게 메일로 — 결제 완료(카드 전표 링크)·결제 실패(재시도 일정)
--   전에는 고객에겐 앱 안 알림뿐이고 메일은 운영자(creative@)에게만 갔다. 카드 전표도 저장하지 않아
--   고객이 부가세 매입 증빙을 받을 길이 없었다.
--   · invoices.receipt_url — 토스 결제 응답의 receipt.url(카드 매출전표). Stripe 는 stripe_invoice_url 을 쓴다.
--   · billing_customer_emails — 같은 결제·같은 실패 회차에 메일이 두 번 가지 않게(dedupe_key 유니크).

alter table public.invoices add column if not exists receipt_url text;

create table if not exists public.billing_customer_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null check (kind = any (array['paid', 'failed'])),
  recipients text[] not null default '{}',
  status text not null default 'pending' check (status = any (array['pending', 'sent', 'failed', 'skipped'])),
  resend_email_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.billing_customer_emails enable row level security;   -- 정책 0 — 엣지(service_role)만
create index if not exists billing_customer_emails_company_idx on public.billing_customer_emails (company_id, created_at desc);
