-- 계약의 정기 청구 조건 (2026-09-21, 랜딩 문구 대조 🟠 → 기능으로 참으로)
--
-- History
--   · 2026-09-18 계약 대장(documents.contract_start_date / end_date / contract_amount) — 기간·금액만 있고 "언제 얼마를 청구하나" 는 없었다.
--   · 프로젝트 계약 회차(deal_revenue_schedule)는 건별 날짜라 "매월 같은 날" 을 표현하지 못한다.
--   · 업종 페이지(노무·법무·렌탈, 2026-09-16)가 "계약에 청구일을 적어 두면 그날 할 일로 올라옵니다 · 매월 같은 날 청구" 라고 적었다.
--
-- 기준
--   · 정기 청구 = 계약 문서에 **매월 며칠(billing_day, 31=말일)·얼마(billing_amount)** 를 적는다. 계약 기간(start~end) 안에서만 돈다.
--   · 읽는 곳: 대시보드 '다가오는 일정'(그날 청구 할 일) · 자금 전망(매출 입금, 확정) · 계약 대장 열.
--   · 세금계산서를 자동 발행하지 않는다 — 제안은 자동, 확정(발행)은 사람.

alter table public.documents
  add column if not exists billing_day smallint check (billing_day between 1 and 31),
  add column if not exists billing_amount numeric;
comment on column public.documents.billing_day is '정기 청구일(매월 며칠, 31=말일). 계약 기간 안에서 대시보드 다가오는 일정·자금 전망이 읽는다.';
comment on column public.documents.billing_amount is '정기 청구 금액(월). billing_day 와 함께 쓴다.';

create index if not exists documents_billing_idx
  on public.documents (company_id, billing_day) where billing_day is not null;
