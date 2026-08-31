-- 세금 마감 "납부 완료" 체크 (2026-08-31 사장님 지시 — 브리핑 거짓 경로 후속 1/3).
--   세금 D-day 는 순수 달력 계산이라 이미 신고/납부해도 계속 떴다. 처리 사실은 회사 단위로
--   DB 에 남긴다(경영 요약의 localStorage 체크가 기기별로 어긋났던 전철을 밟지 않는다).
--   deadline_id = getUpcomingTaxDeadlines 항목 id (예: vat-2026-10-25, wht-2026-09-10) —
--   날짜가 키에 포함돼 다음 주기 마감은 새 키로 자동 재등장한다.
--   checked_by 는 users(id) FK (소유자 ID 규약 — auth.users 아님).
create table if not exists public.tax_deadline_checks (
  company_id uuid not null references public.companies(id) on delete cascade,
  deadline_id text not null,
  checked_by uuid references public.users(id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (company_id, deadline_id)
);

alter table public.tax_deadline_checks enable row level security;

-- 회사 공동 체크 — 구성원 누구나 체크/해제(재무 담당이 하는 가벼운 표시라 권한 세분화 안 함)
drop policy if exists tax_deadline_checks_company on public.tax_deadline_checks;
create policy tax_deadline_checks_company on public.tax_deadline_checks
  for all
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
