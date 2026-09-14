--   전국 공휴일 캐시 — 한국천문연구원 공식 공휴일(공공데이터포털 특일정보)을 받아 담는다.
--
--   지금까지 달력은 두 곳에서만 공휴일을 봤다: 코드에 손으로 적은 표(2027년까지)와
--   회사가 손입력한 holidays 표. 그래서 표에 없는 연도·신규 공휴일(2026 노동절·제헌절 등)이
--   통째로 빠졌다. 이 표는 공식 API 가 채우는 '전 회사 공용' 캐시다. company_id 가 없다 —
--   전국 공휴일은 회사마다 다르지 않다. 회사가 따로 지정하는 임시휴무는 기존 holidays 표에 남는다.

create table if not exists public.national_holidays (
  date date primary key,
  name text not null,
  is_holiday boolean not null default true,   -- 국경일 중 공휴일 아닌 것(제헌절 예전 등) 구분용
  source text not null default 'api',         -- 'api'(특일정보) | 'seed'(코드표 이관)
  updated_at timestamptz not null default now()
);

comment on table public.national_holidays is
  '전국 공휴일 캐시 — holidays-sync 엣지가 공공데이터포털 특일정보(getRestDeInfo)로 채운다. 전 회사 공용.';

alter table public.national_holidays enable row level security;

--   읽기는 로그인한 누구나(전국 공휴일은 비밀이 아니다). 쓰기는 service_role(엣지)만.
drop policy if exists national_holidays_read on public.national_holidays;
create policy national_holidays_read on public.national_holidays
  for select to authenticated using (true);
