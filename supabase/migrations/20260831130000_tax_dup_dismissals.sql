-- 중복 의심 세금계산서 '중복 아님' 확인을 서버로 (2026-08-31 낡은정보 스윕 P4).
--   종전엔 localStorage(기기별) — 경리가 확인한 건이 대표 화면엔 계속 경고로 뜨고, PC 를 바꾸면
--   전부 부활했다. 회사 단위 판단이므로 회사 단위로 저장한다(recurring_dismissals 와 동일 사상).
create table if not exists public.tax_dup_dismissals (
  company_id uuid not null references public.companies(id) on delete cascade,
  dup_key text not null,
  dismissed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, dup_key)
);

alter table public.tax_dup_dismissals enable row level security;

drop policy if exists tax_dup_dismissals_company on public.tax_dup_dismissals;
create policy tax_dup_dismissals_company on public.tax_dup_dismissals
  for all
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
