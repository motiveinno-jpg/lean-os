-- 세무사 메뉴 권한 — 회사가 부여 (2026-08-11 사장님: "회사에서 파트너 권한을 줄 수 있게,
--   권한 없으면 일반직원처럼 안 보이게"). 하드코딩 허용목록 대신 member_permissions 와 동일 모델.
--   키는 연결(link) 단위 — 같은 세무사라도 회사마다 다른 권한.
--   연결 생성 시 세무 기본 패키지(_seed_advisor_default_perms) 자동 부여, 재연결은 기존 부여 유지.
--   기존 활성 연결에도 백필 완료. 쓰기 정책 없음(RPC 전용) — advisor_ro_* 불필요.
--   (프로덕션 적용: 2026-08-11 MCP apply_migration 'advisor_permissions' — 전문 동일)

create table public.advisor_permissions (
  link_id uuid not null references public.advisor_company_links(id) on delete cascade,
  perm_key text not null,
  granted_at timestamptz not null default now(),
  primary key (link_id, perm_key)
);
alter table public.advisor_permissions enable row level security;
create policy ap_advisor_read on public.advisor_permissions
  for select to authenticated
  using (link_id in (
    select l.id from advisor_company_links l
    join tax_advisors a on a.id = l.advisor_id
    where a.auth_id = auth.uid()));
create policy ap_company_read on public.advisor_permissions
  for select to authenticated
  using (link_id in (select id from advisor_company_links where company_id = get_my_company_id()));

create or replace function public.set_advisor_permissions(p_link_id uuid, p_perm_keys text[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null or not is_company_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from advisor_company_links l where l.id = p_link_id and l.company_id = v_company) then
    raise exception 'forbidden';
  end if;
  delete from advisor_permissions where link_id = p_link_id;
  insert into advisor_permissions (link_id, perm_key)
  select p_link_id, k from unnest(coalesce(p_perm_keys, '{}')) as k group by k;
end $$;
revoke all on function public.set_advisor_permissions(uuid,text[]) from public, anon;
grant execute on function public.set_advisor_permissions(uuid,text[]) to authenticated;

create or replace function public.advisor_my_permissions()
returns setof text language sql stable security definer set search_path to 'public' as $$
  select ap.perm_key
  from advisor_active_company aac
  join tax_advisors a on a.auth_id = aac.auth_id and a.status = 'active'
  join advisor_company_links l on l.advisor_id = a.id
    and l.company_id = aac.company_id and l.status = 'active'
  join advisor_permissions ap on ap.link_id = l.id
  where aac.auth_id = auth.uid();
$$;
revoke all on function public.advisor_my_permissions() from public, anon;
grant execute on function public.advisor_my_permissions() to authenticated;

create or replace function public._seed_advisor_default_perms(p_link_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from advisor_permissions where link_id = p_link_id) then return; end if;
  insert into advisor_permissions (link_id, perm_key)
  select p_link_id, k from unnest(array[
    '/dashboard', '/dashboard:finance',
    '/collect', '/partners',
    '/tax-invoices', '/tax-invoices:sales', '/tax-invoices:purchase', '/tax-invoices:vat', '/tax-invoices:summary',
    '/e-invoices', '/cash-receipts', '/transactions',
    '/partners/reconciliation/voucher-entry', '/partners/reconciliation/sale-purchase',
    '/reports', '/partners/ledger',
    '/bank', '/cards', '/payments'
  ]) as k;
end $$;
revoke all on function public._seed_advisor_default_perms(uuid) from public, anon, authenticated;

create or replace function public.company_link_advisor(p_advisor_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id(); v_link uuid;
begin
  if v_company is null or not is_company_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from tax_advisors a where a.id = p_advisor_id and a.status = 'active') then
    raise exception 'advisor_not_active';
  end if;
  insert into advisor_company_links (advisor_id, company_id, status)
  values (p_advisor_id, v_company, 'active')
  on conflict (advisor_id, company_id) do update set status = 'active', revoked_at = null
  returning id into v_link;
  perform public._seed_advisor_default_perms(v_link);
end $$;

create or replace function public.operator_link_advisor(p_advisor_id uuid, p_company_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_link uuid;
begin
  if not is_platform_operator() then raise exception 'forbidden'; end if;
  insert into advisor_company_links (advisor_id, company_id, status)
  values (p_advisor_id, p_company_id, 'active')
  on conflict (advisor_id, company_id) do update set status = 'active', revoked_at = null
  returning id into v_link;
  perform public._seed_advisor_default_perms(v_link);
end $$;

do $$
declare r record;
begin
  for r in select id from advisor_company_links where status = 'active' loop
    perform public._seed_advisor_default_perms(r.id);
  end loop;
end $$;
