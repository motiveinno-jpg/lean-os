-- 내 조건 — 화면별 조회 조건 저장 (2026-08-13 사장님 지시)
--
--   지시: "페이지를 나갔다가 오면 기존 검색값대로 보여주기보다 기본값을 보여주고,
--          내 조건 저장을 통해서 사용자 편의에 맞게 사용하는게 좋을것 같아"
--
--   그동안은 localStorage 에 마지막 조회값을 몰래 남겼다. 두 가지가 나빴다.
--     ① 나갔다 오면 지난번 조건이 그대로 떠서 **지금 보는 게 무슨 조건인지** 모른다.
--     ② 사장님은 PC 두 대로 일한다 — localStorage 는 따라가지 않는다.
--   그래서 **자동 기억은 없애고**, 사람이 이름을 붙여 저장한 것만 남긴다. 저장소는 DB 다.
--
--   개인 소유다(회사 공용 아님) — 같은 회사 사람끼리도 서로 안 보인다.
--   auth.uid() 로 직접 잠근다: users 조인이 없어 RLS 가 단순하고, 정책이 새는 틈이 없다.

create table if not exists public.saved_queries (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  --   화면 열쇠 — 'collect:card' 처럼 탭까지 구분한다. 조건 모양이 탭마다 다르기 때문.
  screen      text not null check (length(screen) between 1 and 60),
  name        text not null check (length(trim(name)) between 1 and 30),
  --   조건 본문 — 화면마다 칸이 달라 jsonb 로 받는다. 서버는 내용을 해석하지 않는다.
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

--   같은 화면에 같은 이름은 하나 — 다시 저장하면 덮어쓴다(upsert)
create unique index if not exists saved_queries_uniq
  on public.saved_queries (auth_id, screen, name);
create index if not exists saved_queries_lookup
  on public.saved_queries (auth_id, screen, created_at);

alter table public.saved_queries enable row level security;

drop policy if exists "own saved queries select" on public.saved_queries;
create policy "own saved queries select" on public.saved_queries
  for select using (auth_id = auth.uid());

drop policy if exists "own saved queries insert" on public.saved_queries;
create policy "own saved queries insert" on public.saved_queries
  for insert with check (auth_id = auth.uid());

drop policy if exists "own saved queries update" on public.saved_queries;
create policy "own saved queries update" on public.saved_queries
  for update using (auth_id = auth.uid()) with check (auth_id = auth.uid());

drop policy if exists "own saved queries delete" on public.saved_queries;
create policy "own saved queries delete" on public.saved_queries
  for delete using (auth_id = auth.uid());

comment on table public.saved_queries is
  '내 조건 — 화면별 조회 조건을 사람이 이름 붙여 저장한 것. 개인 소유(auth_id), 자동 저장 아님.';
