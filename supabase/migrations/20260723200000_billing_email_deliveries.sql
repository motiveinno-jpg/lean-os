-- 결제 성공 내부 알림 메일 중복방지 대장 (2026-07-23).
--   Stripe webhook 재전송에도 메일이 한 번만 발송되도록 event/invoice 유니크. 원문·민감정보 없음(메타만).
create table if not exists public.billing_email_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  stripe_event_id    text unique,       -- webhook event 멱등키
  stripe_invoice_id  text unique,       -- invoice 멱등키
  company_id         uuid references public.companies(id) on delete set null,
  subscription_id    text,
  notification_type  text not null,     -- new | renewal | change
  recipient          text not null,
  status             text not null default 'pending' check (status in ('pending','sent','failed')),
  resend_email_id    text,
  attempts           integer not null default 0,
  last_error         text,
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists billing_email_deliveries_company_idx on public.billing_email_deliveries (company_id, created_at desc);

-- RLS: 정책 없음 → authenticated/anon 접근 불가. service_role(엣지)만 RLS 우회로 사용.
alter table public.billing_email_deliveries enable row level security;
