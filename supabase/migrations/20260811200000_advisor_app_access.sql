-- 세무사의 오너뷰 본앱 진입 (2026-08-11 사장님: "클릭하면 아예 오너뷰로 들어가서 확인")
--   ① advisor_active_company: 세무사가 지금 열람 중인 회사 (advisor_enter_company RPC 로만 변경)
--   ② get_my_company_id() 폴백: users 행이 없으면 "활성 세무사 + 활성 연결 + 선택 회사"로 해석
--      → 본앱의 모든 회사격리 RLS SELECT 가 그대로 동작 (기존 사용자 경로는 첫 분기 그대로 — 무영향)
--   ③ 안전장치(핵심): 폴백만 열면 회사격리-only 쓰기 정책 ~157개가 세무사에게 열린다(실측).
--      is_advisor_session() 이면 모든 public RLS 테이블에 INSERT/UPDATE/DELETE 를 막는
--      RESTRICTIVE 정책(advisor_ro_ins/upd/del, 총 633개 생성됨)을 일괄 생성 — DB 차원 읽기 전용.
--      (예외 allowlist: active_sessions·user_consents — 세션 가드/약관 동의는 본인 행이라 허용)
--   ④ 회사 쪽 RPC: company_list_advisors / company_my_advisors / company_link_advisor /
--      company_unlink_advisor — 회사설정 "세무 파트너" 섹션(관리자·마스터 게이트).
--   되돌리기: advisor_ro_% 정책 일괄 drop + get_my_company_id 원본 복원
--     (원본: SELECT company_id FROM users WHERE auth_id = auth.uid() LIMIT 1).
--   검증: rls-smoke 4/4 PASS(employee/owner bootstrap 정상), 기존 사용자 경로 무영향.
--   (프로덕션 적용: 2026-08-11 MCP apply_migration 'advisor_app_access' — 전문 동일)

create table public.advisor_active_company (
  auth_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.advisor_active_company enable row level security;
create policy aac_self_read on public.advisor_active_company
  for select to authenticated using (auth_id = auth.uid());

create or replace function public.is_advisor_session()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null
     and not exists (select 1 from users u where u.auth_id = auth.uid())
     and exists (
       select 1 from advisor_active_company aac
       join tax_advisors a on a.auth_id = aac.auth_id and a.status = 'active'
       join advisor_company_links l on l.advisor_id = a.id
         and l.company_id = aac.company_id and l.status = 'active'
       where aac.auth_id = auth.uid());
$$;

create or replace function public.advisor_enter_company(p_company_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public._advisor_gate(p_company_id);
  insert into advisor_active_company (auth_id, company_id, updated_at)
  values (auth.uid(), p_company_id, now())
  on conflict (auth_id) do update set company_id = excluded.company_id, updated_at = now();
end $$;
revoke all on function public.advisor_enter_company(uuid) from public, anon;
grant execute on function public.advisor_enter_company(uuid) to authenticated;

create or replace function public.get_my_company_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select company_id from users where auth_id = auth.uid() limit 1),
    (select aac.company_id
       from advisor_active_company aac
       join tax_advisors a on a.auth_id = aac.auth_id and a.status = 'active'
       join advisor_company_links l on l.advisor_id = a.id
         and l.company_id = aac.company_id and l.status = 'active'
      where aac.auth_id = auth.uid() limit 1)
  );
$$;

do $$
declare r record;
begin
  for r in
    select c.relname as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('active_sessions', 'user_consents')
  loop
    execute format('create policy advisor_ro_ins on public.%I as restrictive for insert to authenticated with check (not (select public.is_advisor_session()))', r.t);
    execute format('create policy advisor_ro_upd on public.%I as restrictive for update to authenticated using (not (select public.is_advisor_session()))', r.t);
    execute format('create policy advisor_ro_del on public.%I as restrictive for delete to authenticated using (not (select public.is_advisor_session()))', r.t);
  end loop;
end $$;

create or replace function public.company_list_advisors()
returns table (id uuid, name text, office_name text, specialty text, email text, phone text, linked boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null or not is_company_admin() then raise exception 'forbidden'; end if;
  return query
  select a.id, a.name, a.office_name, a.specialty, a.email, a.phone,
    exists (select 1 from advisor_company_links l where l.advisor_id = a.id and l.company_id = v_company and l.status = 'active')
  from tax_advisors a where a.status = 'active' order by a.created_at;
end $$;

create or replace function public.company_my_advisors()
returns table (link_id uuid, advisor_id uuid, name text, office_name text, specialty text, email text, phone text, linked_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null then raise exception 'forbidden'; end if;
  return query
  select l.id, a.id, a.name, a.office_name, a.specialty, a.email, a.phone, l.created_at
  from advisor_company_links l join tax_advisors a on a.id = l.advisor_id
  where l.company_id = v_company and l.status = 'active' and a.status = 'active'
  order by l.created_at;
end $$;

create or replace function public.company_link_advisor(p_advisor_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null or not is_company_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from tax_advisors a where a.id = p_advisor_id and a.status = 'active') then
    raise exception 'advisor_not_active';
  end if;
  insert into advisor_company_links (advisor_id, company_id, status)
  values (p_advisor_id, v_company, 'active')
  on conflict (advisor_id, company_id) do update set status = 'active', revoked_at = null;
end $$;

create or replace function public.company_unlink_advisor(p_link_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null or not is_company_admin() then raise exception 'forbidden'; end if;
  update advisor_company_links set status = 'revoked', revoked_at = now()
  where id = p_link_id and company_id = v_company;
end $$;

revoke all on function public.company_list_advisors() from public, anon;
revoke all on function public.company_my_advisors() from public, anon;
revoke all on function public.company_link_advisor(uuid) from public, anon;
revoke all on function public.company_unlink_advisor(uuid) from public, anon;
grant execute on function public.company_list_advisors() to authenticated;
grant execute on function public.company_my_advisors() to authenticated;
grant execute on function public.company_link_advisor(uuid) to authenticated;
grant execute on function public.company_unlink_advisor(uuid) to authenticated;
