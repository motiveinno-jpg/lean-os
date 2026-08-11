-- 세무사 파트너 포털 (2026-08-11 사장님)
--   구독사 ↔ 제휴 세무사 연결. 세무사는 회사 users 에 넣지 않는다(좌석 비과금 — 구조적 보장).
--   접근은 전부 SECURITY DEFINER RPC 경유(기존 RLS 정책 무수술). 읽기 전용.
--   흐름: 세무사 /advisor 가입(pending) → 운영자 승인(active) + 회사 연결 → 포털에서 조회.
--   (프로덕션 적용: 2026-08-11 MCP apply_migration 'tax_advisor_portal')

create table public.tax_advisors (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique not null,
  name text not null,
  office_name text,
  email text not null,
  phone text,
  specialty text,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
alter table public.tax_advisors enable row level security;
create policy tax_advisors_self_read on public.tax_advisors
  for select to authenticated using (auth_id = auth.uid());

create table public.advisor_company_links (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references public.tax_advisors(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (advisor_id, company_id)
);
create index advisor_company_links_company_idx on public.advisor_company_links (company_id);
alter table public.advisor_company_links enable row level security;
create policy acl_advisor_read on public.advisor_company_links
  for select to authenticated
  using (advisor_id in (select id from public.tax_advisors where auth_id = auth.uid()));
-- 회사 쪽에서 "연결된 세무사" 표시용
create policy acl_company_read on public.advisor_company_links
  for select to authenticated using (company_id = get_my_company_id());

-- ── 내부 게이트: 활성 세무사 + 활성 연결 ──
create or replace function public._advisor_gate(p_company_id uuid)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v_advisor uuid;
begin
  select a.id into v_advisor from tax_advisors a
   where a.auth_id = auth.uid() and a.status = 'active';
  if v_advisor is null then raise exception 'not_advisor'; end if;
  if not exists (select 1 from advisor_company_links l
                  where l.advisor_id = v_advisor and l.company_id = p_company_id and l.status = 'active') then
    raise exception 'not_linked';
  end if;
  return v_advisor;
end $$;
revoke all on function public._advisor_gate(uuid) from public, anon, authenticated;

-- ── 세무사: 가입/프로필 ──
create or replace function public.advisor_register(
  p_name text, p_office_name text default null, p_phone text default null, p_specialty text default null)
returns public.tax_advisors language plpgsql security definer set search_path to 'public' as $$
declare v_email text; v_row tax_advisors;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into tax_advisors (auth_id, name, office_name, email, phone, specialty)
  values (auth.uid(), trim(p_name), nullif(trim(coalesce(p_office_name,'')),''), coalesce(v_email,''),
          nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_specialty,'')),''))
  on conflict (auth_id) do update
    set name = excluded.name, office_name = excluded.office_name,
        phone = excluded.phone, specialty = excluded.specialty
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.advisor_register(text,text,text,text) from public, anon;
grant execute on function public.advisor_register(text,text,text,text) to authenticated;

-- ── 세무사: 연결 회사 목록 + 회사별 요약 ──
create or replace function public.advisor_my_companies()
returns table (
  link_id uuid, company_id uuid, company_name text, industry text, business_number text,
  representative text, linked_at timestamptz,
  month_sales numeric, month_purchase numeric, bank_balance numeric, employee_count bigint
) language plpgsql stable security definer set search_path to 'public' as $$
declare v_advisor uuid; v_from date := date_trunc('month', (now() at time zone 'Asia/Seoul'))::date;
begin
  select a.id into v_advisor from tax_advisors a where a.auth_id = auth.uid() and a.status = 'active';
  if v_advisor is null then raise exception 'not_advisor'; end if;
  return query
  select l.id, c.id, c.name, c.industry, c.business_number, c.representative, l.created_at,
    coalesce((select sum(ti.total_amount) from tax_invoices ti
       where ti.company_id = c.id and ti.type = 'sales' and ti.issue_date >= v_from), 0),
    coalesce((select sum(ti.total_amount) from tax_invoices ti
       where ti.company_id = c.id and ti.type = 'purchase' and ti.issue_date >= v_from), 0),
    coalesce((select sum(b.balance) from bank_accounts b where b.company_id = c.id), 0),
    (select count(*) from employees e where e.company_id = c.id
       and coalesce(e.status,'active') not in ('invited','inactive','resigned'))
  from advisor_company_links l
  join companies c on c.id = l.company_id
  where l.advisor_id = v_advisor and l.status = 'active'
  order by l.created_at;
end $$;
revoke all on function public.advisor_my_companies() from public, anon;
grant execute on function public.advisor_my_companies() to authenticated;

-- ── 세무사: 회사 개요(요약 카드용 jsonb) ──
create or replace function public.advisor_company_overview(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_from date := date_trunc('month', (now() at time zone 'Asia/Seoul'))::date;
  v_prev_from date := (date_trunc('month', (now() at time zone 'Asia/Seoul')) - interval '1 month')::date;
  v_q_from date := date_trunc('quarter', (now() at time zone 'Asia/Seoul'))::date;
  r jsonb;
begin
  perform public._advisor_gate(p_company_id);
  select jsonb_build_object(
    'company', (select jsonb_build_object('id', c.id, 'name', c.name, 'industry', c.industry,
        'business_number', c.business_number, 'representative', c.representative,
        'business_type', c.business_type, 'business_category', c.business_category, 'address', c.address)
      from companies c where c.id = p_company_id),
    'bank', jsonb_build_object(
      'total', coalesce((select sum(balance) from bank_accounts where company_id = p_company_id), 0),
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('bank', bank_name, 'number', account_number, 'balance', balance))
        from bank_accounts where company_id = p_company_id), '[]'::jsonb)),
    'month', jsonb_build_object(
      'sales', coalesce((select sum(total_amount) from tax_invoices where company_id = p_company_id and type='sales' and issue_date >= v_from), 0),
      'purchase', coalesce((select sum(total_amount) from tax_invoices where company_id = p_company_id and type='purchase' and issue_date >= v_from), 0)),
    'prev_month', jsonb_build_object(
      'sales', coalesce((select sum(total_amount) from tax_invoices where company_id = p_company_id and type='sales' and issue_date >= v_prev_from and issue_date < v_from), 0),
      'purchase', coalesce((select sum(total_amount) from tax_invoices where company_id = p_company_id and type='purchase' and issue_date >= v_prev_from and issue_date < v_from), 0)),
    'quarter_vat', jsonb_build_object(
      'sales_tax', coalesce((select sum(tax_amount) from tax_invoices where company_id = p_company_id and type='sales' and issue_date >= v_q_from), 0),
      'purchase_tax', coalesce((select sum(tax_amount) from tax_invoices where company_id = p_company_id and type='purchase' and issue_date >= v_q_from), 0)),
    'receivable', coalesce((select sum(total_amount - coalesce(settled_amount, 0)) from tax_invoices
      where company_id = p_company_id and type='sales' and coalesce(settlement_status,'') <> 'settled'
        and total_amount > coalesce(settled_amount, 0)), 0),
    'employees', jsonb_build_object(
      'count', (select count(*) from employees where company_id = p_company_id
         and coalesce(status,'active') not in ('invited','inactive','resigned')),
      'last_payroll_month', (select max(period_month) from payroll_items where company_id = p_company_id),
      'last_payroll_total', coalesce((select sum(net_pay) from payroll_items
         where company_id = p_company_id
           and period_month = (select max(period_month) from payroll_items where company_id = p_company_id)), 0)),
    'card_month_total', coalesce((select sum(amount) from card_transactions
      where company_id = p_company_id and transaction_date >= v_from), 0)
  ) into r;
  return r;
end $$;
revoke all on function public.advisor_company_overview(uuid) from public, anon;
grant execute on function public.advisor_company_overview(uuid) to authenticated;

-- ── 세무사: 세금계산서 목록 ──
create or replace function public.advisor_company_tax_invoices(
  p_company_id uuid, p_type text default null, p_from date default null, p_to date default null)
returns table (id uuid, issue_date date, inv_type text, counterparty_name text, item_name text,
  supply_amount numeric, tax_amount numeric, total_amount numeric, status text, settlement_status text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._advisor_gate(p_company_id);
  return query
  select t.id, t.issue_date, t.type, t.counterparty_name, t.item_name,
         t.supply_amount, t.tax_amount, t.total_amount, t.status, t.settlement_status
  from tax_invoices t
  where t.company_id = p_company_id
    and (p_type is null or t.type = p_type)
    and (p_from is null or t.issue_date >= p_from)
    and (p_to is null or t.issue_date <= p_to)
  order by t.issue_date desc, t.created_at desc
  limit 500;
end $$;
revoke all on function public.advisor_company_tax_invoices(uuid,text,date,date) from public, anon;
grant execute on function public.advisor_company_tax_invoices(uuid,text,date,date) to authenticated;

-- ── 세무사: 통장 거래 목록 ──
--   transaction_date 는 date 컬럼 — timestamptz 로 선언하면 42804 타입 불일치 (E2E 에서 잡음)
create or replace function public.advisor_company_bank_tx(
  p_company_id uuid, p_from date default null, p_to date default null, p_limit int default 200)
returns table (id uuid, transaction_date date, amount numeric, tx_type text,
  counterparty text, description text, bank_name text, balance_after numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._advisor_gate(p_company_id);
  return query
  select bt.id, bt.transaction_date, bt.amount, bt.type, bt.counterparty, bt.description,
         (select b.bank_name from bank_accounts b where b.id = bt.bank_account_id), bt.balance_after
  from bank_transactions bt
  where bt.company_id = p_company_id
    and (p_from is null or bt.transaction_date >= p_from)
    and (p_to is null or bt.transaction_date <= p_to)
  order by bt.transaction_date desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;
revoke all on function public.advisor_company_bank_tx(uuid,date,date,int) from public, anon;
grant execute on function public.advisor_company_bank_tx(uuid,date,date,int) to authenticated;

-- ── 세무사: 인건비(월별) — 원천세 신고용 ──
create or replace function public.advisor_company_payroll(p_company_id uuid, p_month text default null)
returns table (period_month text, employee_name text, base_salary numeric, national_pension numeric,
  health_insurance numeric, employment_insurance numeric, income_tax numeric, local_income_tax numeric,
  deductions_total numeric, net_pay numeric, status text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._advisor_gate(p_company_id);
  return query
  select pi.period_month, e.name, pi.base_salary, pi.national_pension, pi.health_insurance,
         pi.employment_insurance, pi.income_tax, pi.local_income_tax, pi.deductions_total, pi.net_pay, pi.status
  from payroll_items pi
  left join employees e on e.id = pi.employee_id
  where pi.company_id = p_company_id
    and (p_month is null or pi.period_month = p_month)
  order by pi.period_month desc, e.name
  limit 500;
end $$;
revoke all on function public.advisor_company_payroll(uuid,text) from public, anon;
grant execute on function public.advisor_company_payroll(uuid,text) to authenticated;

-- ── 운영자: 세무사 관리 ──
create or replace function public.operator_list_advisors()
returns table (id uuid, name text, office_name text, email text, phone text, specialty text,
  status text, created_at timestamptz, approved_at timestamptz, link_count bigint)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_platform_operator() then raise exception 'forbidden'; end if;
  return query
  select a.id, a.name, a.office_name, a.email, a.phone, a.specialty, a.status, a.created_at, a.approved_at,
    (select count(*) from advisor_company_links l where l.advisor_id = a.id and l.status = 'active')
  from tax_advisors a order by a.created_at desc;
end $$;

create or replace function public.operator_set_advisor_status(p_advisor_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_platform_operator() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'bad_status'; end if;
  update tax_advisors set status = p_status,
    approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end
  where id = p_advisor_id;
end $$;

create or replace function public.operator_link_advisor(p_advisor_id uuid, p_company_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_platform_operator() then raise exception 'forbidden'; end if;
  insert into advisor_company_links (advisor_id, company_id, status)
  values (p_advisor_id, p_company_id, 'active')
  on conflict (advisor_id, company_id) do update set status = 'active', revoked_at = null;
end $$;

create or replace function public.operator_unlink_advisor(p_link_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_platform_operator() then raise exception 'forbidden'; end if;
  update advisor_company_links set status = 'revoked', revoked_at = now() where id = p_link_id;
end $$;

create or replace function public.operator_advisor_links(p_advisor_id uuid)
returns table (id uuid, company_id uuid, company_name text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_platform_operator() then raise exception 'forbidden'; end if;
  return query
  select l.id, c.id, c.name, l.status, l.created_at
  from advisor_company_links l join companies c on c.id = l.company_id
  where l.advisor_id = p_advisor_id order by l.created_at desc;
end $$;

revoke all on function public.operator_list_advisors() from public, anon;
revoke all on function public.operator_set_advisor_status(uuid,text) from public, anon;
revoke all on function public.operator_link_advisor(uuid,uuid) from public, anon;
revoke all on function public.operator_unlink_advisor(uuid) from public, anon;
revoke all on function public.operator_advisor_links(uuid) from public, anon;
grant execute on function public.operator_list_advisors() to authenticated;
grant execute on function public.operator_set_advisor_status(uuid,text) to authenticated;
grant execute on function public.operator_link_advisor(uuid,uuid) to authenticated;
grant execute on function public.operator_unlink_advisor(uuid) to authenticated;
grant execute on function public.operator_advisor_links(uuid) to authenticated;
