-- 내 조건에 ★ 기본 — 화면을 열 때 자동으로 걸릴 조건 (2026-08-13 사장님 지시)
--
--   지시: "내조건에서 설정하면 그값이 기본값이 되게".
--   ★ '지난번 검색값'을 몰래 기억하는 것과는 다르다 — **사람이 정한 값**이라 늘 같은 데서 시작한다.
--   아무것도 안 정했으면 최근 1개월(화면 기본값)이다.

alter table public.saved_queries
  add column if not exists is_default boolean not null default false;

--   화면마다 기본은 하나뿐 — 두 개면 어느 것이 걸릴지 사람이 못 고른다
create unique index if not exists saved_queries_one_default
  on public.saved_queries (auth_id, screen) where is_default;

comment on column public.saved_queries.is_default is
  '★ 기본 — 화면을 열 때 자동으로 걸리는 조건. 화면(screen)마다 하나.';
