-- 정기 지출 '자동 추천' — '미등록'(이건 정기결제가 아니다) 판단을 **회사 단위**로 남긴다.
--   2026-08-24 사장님 지적: "정기지출 · 직원마다 다르게 뜸"
--   원인: 미등록 판단이 그 사람 브라우저의 localStorage(`recurring-dismissed-{companyId}`) 에만 있었다.
--     · 사장님이 "정기결제 아님"으로 치운 후보가 **직원 화면에는 그대로** 떴다.
--     · 같은 사람도 PC·브라우저를 바꾸면 다시 봤다.
--     · '처리할 것 N건' 띠는 이 판단을 아예 안 빼서 띠 숫자와 목록 건수가 어긋났다.
--   회사가 함께 쓰는 판단이므로 DB 로 옮긴다. 기존 테이블·데이터는 건드리지 않는다(추가만).
create table if not exists public.recurring_dismissals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  --   후보 식별 키 = '거래처|금액(1,000원 단위 반올림)' — 감지 로직(detectRecurringFromBankTx)과 **같은 규칙**.
  --   규칙이 갈리면 치운 후보가 다시 뜬다.
  match_key text not null,
  dismissed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, match_key)
);

create index if not exists idx_recurring_dismissals_company
  on public.recurring_dismissals(company_id);

alter table public.recurring_dismissals enable row level security;

--   형제 테이블(recurring_payments)과 같은 정책 짝 — 회사 격리 + 세무사 열람 세션은 읽기만
drop policy if exists recurring_dismissals_company on public.recurring_dismissals;
create policy recurring_dismissals_company on public.recurring_dismissals for all
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.recurring_dismissals;
create policy advisor_ro_ins on public.recurring_dismissals for insert
  with check (not (select public.is_advisor_session()));

drop policy if exists advisor_ro_upd on public.recurring_dismissals;
create policy advisor_ro_upd on public.recurring_dismissals for update
  using (not (select public.is_advisor_session()));

drop policy if exists advisor_ro_del on public.recurring_dismissals;
create policy advisor_ro_del on public.recurring_dismissals for delete
  using (not (select public.is_advisor_session()));

comment on table public.recurring_dismissals is
  '정기 지출 자동 추천에서 "정기결제 아님"으로 치운 후보 (회사 공통, 2026-08-24). match_key = 거래처|금액(천원 반올림)';
