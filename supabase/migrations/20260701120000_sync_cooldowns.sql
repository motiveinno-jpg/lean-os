-- 데이터 수집 버튼 30분 쿨타임 — 회사 공유 상태 (2026-07-01)
--   세금계산서/통장/카드/AI전체매칭 등 비용이 드는 수집을 반복 클릭하는 것을 막는다.
--   회사 단위로 마지막 실행 시각을 저장 → 팀원 누가 눌러도 30분간 전원에게 비활성 표시.
--   신규 테이블만 추가(기존 불변 → 회귀 0). 회사스코프 RLS.

create table if not exists public.sync_cooldowns (
  company_id  uuid not null references public.companies(id) on delete cascade,
  sync_type   text not null check (sync_type in ('hometax','bank','card','match')),
  last_run_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (company_id, sync_type)
);

alter table public.sync_cooldowns enable row level security;
drop policy if exists sync_cooldowns_company on public.sync_cooldowns;
create policy sync_cooldowns_company on public.sync_cooldowns
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 클릭 시 원자적 upsert. (동시 클릭에도 마지막 실행 시각을 now() 로 갱신)
create or replace function public.record_sync_run(p_sync_type text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_now timestamptz := now();
begin
  if v_company is null then
    raise exception 'no company for current user';
  end if;
  insert into public.sync_cooldowns (company_id, sync_type, last_run_at, updated_at)
    values (v_company, p_sync_type, v_now, v_now)
  on conflict (company_id, sync_type)
    do update set last_run_at = excluded.last_run_at, updated_at = excluded.updated_at;
  return v_now;
end;
$$;
