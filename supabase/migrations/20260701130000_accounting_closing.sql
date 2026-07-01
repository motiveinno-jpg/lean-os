-- 회계마감시점 + 기초잔액 (2026-07-01)
--   회사가 '이 시점까지는 결산 끝났다'는 마감일과, 그 시점의 기초 수치(통장잔액·누적손익)를 입력.
--   목적: 마감일 이전의 세금계산서/통장/카드 원자료를 다시 끌어오지 않아 프로그램이 무거워지는 것 방지.
--   미설정 시 데이터 수집은 최대 2년 전까지만(코드에서 floor 적용).
--   기초잔액은 리포트가 마감 이전 구간에서도 잔액 연속성을 갖도록 하는 기준점.
--   신규 테이블만 추가(기존 불변 → 회귀 0). 회사스코프 RLS. 회사당 1행.

create table if not exists public.accounting_closing (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  closing_date          date,                       -- 이 날짜 '까지' 결산 완료(이전 자료 재수집 안 함). null=미설정
  opening_bank_balance  numeric not null default 0, -- 마감시점 통장 잔액(기초)
  opening_cumulative_net numeric not null default 0,-- 마감시점 누적 순손익(기초)
  note                  text,
  updated_by            uuid references public.users(id) on delete set null,
  updated_at            timestamptz not null default now()
);

alter table public.accounting_closing enable row level security;
drop policy if exists accounting_closing_company on public.accounting_closing;
create policy accounting_closing_company on public.accounting_closing
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 데이터 수집 시작일 하한(floor) 계산용 헬퍼.
--   floor = max(closing_date+1일, today-2년). 수집 로직(codef-sync)이 startDate 를 이 값 미만으로 못 내려가게 clamp.
create or replace function public.data_sync_floor(p_company uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((select closing_date + 1 from public.accounting_closing where company_id = p_company), '1900-01-01'::date),
    (current_date - interval '2 years')::date
  );
$$;
