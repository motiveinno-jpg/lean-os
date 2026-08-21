-- 공고 수집 준비 — upsert 가능한 인덱스 + 수집 이력 (2026-08-21)
--
-- 1) 유니크 인덱스를 부분(partial)에서 일반으로 바꾼다.
--    AS_IS  `unique (source, external_id) where external_id is not null`
--    문제   PostgREST 의 upsert(on_conflict=source,external_id)는 WHERE 절을 붙이지 않아
--           **부분 인덱스를 추론하지 못한다** → "no unique or exclusion constraint matching" 로 수집이 통째로 실패한다.
--    TO_BE  `unique (source, external_id)` 일반 인덱스.
--    안전한가 — 그렇다. Postgres 는 NULL 을 서로 다른 값으로 보므로 external_id 가 없는 행은
--           여러 개 있어도 충돌하지 않는다. 부분 조건이 애초에 필요 없었다.
--
-- 2) 수집 이력 gov_sync_log — 언제 무엇을 몇 건 받았는지. 실패해도 남겨야 원인을 본다.
--    수집 함수는 이 표를 **쿨타임**(30분)에도 쓴다 — 누구나 부를 수 있는 함수라 연타를 막는다.

drop index if exists public.gov_programs_source_ext_uk;
create unique index if not exists gov_programs_source_ext_uk
  on public.gov_programs (source, external_id);

create table if not exists public.gov_sync_log (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  fetched     int,      -- 원천에서 받은 건수
  upserted    int,      -- 우리 표에 넣은 건수
  closed      int,      -- 마감 처리한 건수
  message     text
);

create index if not exists gov_sync_log_source_idx on public.gov_sync_log (source, started_at desc);

comment on table public.gov_sync_log is
  '지원사업 공고 수집 이력 (2026-08-21). 쿨타임 판정에도 쓴다 — 마지막 성공 30분 안이면 다시 안 받는다.';

alter table public.gov_sync_log enable row level security;

--   회사 자료가 아니라 플랫폼 운영 기록이다. 읽기는 로그인한 사람 누구나(화면에 '마지막 수집' 표시),
--   쓰기는 service_role(수집 함수)만 — 앱에는 쓰기 경로가 없다.
drop policy if exists gov_sync_log_read on public.gov_sync_log;
create policy gov_sync_log_read on public.gov_sync_log
  for select to authenticated using (true);

drop policy if exists gov_sync_log_no_write_ins on public.gov_sync_log;
create policy gov_sync_log_no_write_ins on public.gov_sync_log
  as restrictive for insert to authenticated with check (false);
drop policy if exists gov_sync_log_no_write_upd on public.gov_sync_log;
create policy gov_sync_log_no_write_upd on public.gov_sync_log
  as restrictive for update to authenticated using (false);
drop policy if exists gov_sync_log_no_write_del on public.gov_sync_log;
create policy gov_sync_log_no_write_del on public.gov_sync_log
  as restrictive for delete to authenticated using (false);
