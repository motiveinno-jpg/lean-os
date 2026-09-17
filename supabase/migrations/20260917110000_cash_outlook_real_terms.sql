-- 자금 전망이 회사 실제 조건을 읽게 한다 (2026-09-17)
--
--   자금 전망(lib/cash-outlook.ts)은 두 가지를 **추측**으로 깔고 있었다.
--     ① 급여는 매월 25일에 나간다        → 회사마다 다르다(10일·말일이 흔하다)
--     ② 세금계산서는 발행일 + 30일에 오간다 → 거래처마다 다르다(당월 말·익월 말·60일…)
--   두 코드 주석 모두 "설정이 없어서" 라고 적혀 있었다. 담을 칸이 실제로 없었다.
--   2026-09-17 실측: company_settings 에 급여일 칸 없음, tax_invoices 에 만기 칸 없음,
--   partners 에도 결제조건 칸 없음(preferred_invoice_day 는 '발행 희망일' 이라 다른 값).
--
--   그래서 칸을 만든다. 둘 다 **비워 둘 수 있고**, 비어 있으면 지금과 똑같이 동작한다(25일 · +30일).
--   채우면 그 회사·그 거래처의 실제 조건으로 곡선이 그려진다.

-- ① 급여일 — 회사 하나에 하나
alter table public.company_settings
  add column if not exists payroll_day smallint;

alter table public.company_settings
  drop constraint if exists company_settings_payroll_day_check;
alter table public.company_settings
  add constraint company_settings_payroll_day_check
  check (payroll_day is null or (payroll_day between 1 and 31));

comment on column public.company_settings.payroll_day is
  '급여 지급일(1~31). 비워 두면 자금 전망이 25일로 가정한다. 31 을 넣으면 그 달의 말일로 맞춰 계산한다.';

-- ② 결제조건 — 거래처마다 "발행 후 며칠"
--   건건이 만기를 적게 하지 않는 이유: 실무에서 만기는 거래처와 맺은 조건이지 계산서마다 정하는 값이 아니다.
--   한 번 넣으면 그 거래처의 모든 계산서에 적용된다.
alter table public.partners
  add column if not exists payment_terms_days smallint;

alter table public.partners
  drop constraint if exists partners_payment_terms_days_check;
alter table public.partners
  add constraint partners_payment_terms_days_check
  check (payment_terms_days is null or (payment_terms_days between 0 and 180));

comment on column public.partners.payment_terms_days is
  '결제조건 — 세금계산서 발행 후 며칠에 주고받는지(0~180). 비워 두면 자금 전망이 30일로 가정한다.';
