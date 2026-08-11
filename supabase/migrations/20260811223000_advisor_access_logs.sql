-- 세무사 열람 감사 로그 (2026-08-11) — "우리 장부 언제 봤나"를 회사가 확인·방어할 수 있게.
--   advisor_enter_company(본앱 진입) 시 1행 적재. 조회 RPC(포털 요약 등)는 과도 로깅이라 제외 —
--   본앱 진입이 실질 열람 세션의 시작점이다. 같은 회사 10분 내 재진입은 중복 기록 안 함.
--   (프로덕션 적용: 2026-08-11 MCP apply_migration 'advisor_access_logs' + execute_sql 후속 — 전문 동일)
create table public.advisor_access_logs (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references public.tax_advisors(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  accessed_at timestamptz not null default now()
);
create index advisor_access_logs_company_idx on public.advisor_access_logs (company_id, accessed_at desc);
alter table public.advisor_access_logs enable row level security;
create policy aal_company_read on public.advisor_access_logs
  for select to authenticated using (company_id = get_my_company_id());
create policy aal_advisor_read on public.advisor_access_logs
  for select to authenticated
  using (advisor_id in (select id from tax_advisors where auth_id = auth.uid()));

create or replace function public.advisor_enter_company(p_company_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_advisor uuid;
begin
  v_advisor := public._advisor_gate(p_company_id);
  insert into advisor_active_company (auth_id, company_id, updated_at)
  values (auth.uid(), p_company_id, now())
  on conflict (auth_id) do update set company_id = excluded.company_id, updated_at = now();
  if not exists (
    select 1 from advisor_access_logs
    where advisor_id = v_advisor and company_id = p_company_id
      and accessed_at > now() - interval '10 minutes'
  ) then
    insert into advisor_access_logs (advisor_id, company_id) values (v_advisor, p_company_id);
  end if;
end $$;
revoke all on function public.advisor_enter_company(uuid) from public, anon;
grant execute on function public.advisor_enter_company(uuid) to authenticated;

-- 회사용 열람 이력 조회 — 세무사 이름 포함 (tax_advisors 는 본인 RLS 라 SECDEF 로 이름만 노출)
create or replace function public.company_advisor_access_logs(p_limit int default 20)
returns table (accessed_at timestamptz, advisor_name text, office_name text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null then raise exception 'forbidden'; end if;
  return query
  select l.accessed_at, a.name, a.office_name
  from advisor_access_logs l join tax_advisors a on a.id = l.advisor_id
  where l.company_id = v_company
  order by l.accessed_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke all on function public.company_advisor_access_logs(int) from public, anon;
grant execute on function public.company_advisor_access_logs(int) to authenticated;
