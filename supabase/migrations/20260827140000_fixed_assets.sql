-- ── ERP 공백 ⑤ 고정자산 — 자산 등록 → 월 감가상각 전표 초안 (2026-08-27 사장님 "추천 순서대로") docs/20260827_PLAN_erp_gaps.md ⑤
--   결정 65 — 새 표 fixed_assets / fixed_asset_depreciations. 옛 vault_assets(0건, 계정 연결 없음, 사이드바에서 내림)는 손대지 않는다.
--   결정 66 — 상각: 정액(기본) = (취득가 − 잔존가) ÷ 내용월수, 정률 = 장부가 × 2 ÷ 내용월수(이중체감). 누계는 취득가 − 잔존가를 넘지 않는다.
--   결정 67 — 월 감가상각은 한 달에 전표 하나(자산별 줄) — 초안(ai_suggested) → 사람이 확정(재무 › 전표 현황). 초안 틀은 production_voucher_drafts kind 'depreciation'.
--             누계액은 **확정된** 전표의 줄만 센다 — 반려·초안은 누계에 안 들어간다.
--   결정 68 — 계정: 자산별로 정하되 비면 분류 기본값(비품 212/213, 차량 208/209, 기계 206/207, 건물 202/203, 구축물 204/205, 공구 210/211,
--             소프트웨어 240/무형은 누계 없이 자산 직접 차감·비용 840, 기타 212/213). 비용 계정 기본 '감가상각비'(코드 높은 것).
--   결정 69 — 처분(disposed)은 상각을 멈춘다. 처분 손익 전표는 사람이 일반전표로(자동화하지 않는다 — 매각가·부가세가 얽힌다).

create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  category text not null default 'equipment' check (category in ('equipment','vehicle','machine','software','building','structure','tool','other')),
  asset_account_id uuid references public.chart_of_accounts(id),
  accum_account_id uuid references public.chart_of_accounts(id),
  expense_account_id uuid references public.chart_of_accounts(id),
  acquired_on date not null,
  cost numeric not null check (cost >= 0),
  salvage numeric not null default 0 check (salvage >= 0),
  useful_months int not null check (useful_months > 0),
  method text not null default 'straight' check (method in ('straight','declining')),
  depr_start_month text not null,
  status text not null default 'active' check (status in ('active','disposed')),
  disposed_on date,
  disposal_amount numeric,
  memo text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fixed_assets_company_idx on public.fixed_assets(company_id, status);
alter table public.fixed_assets enable row level security;
drop policy if exists company_isolation on public.fixed_assets;
create policy company_isolation on public.fixed_assets for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.fixed_assets;
create policy advisor_ro_ins on public.fixed_assets for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.fixed_assets;
create policy advisor_ro_upd on public.fixed_assets for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.fixed_assets;
create policy advisor_ro_del on public.fixed_assets for delete to authenticated using (not (select public.is_advisor_session()));

create table if not exists public.fixed_asset_depreciations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  asset_id uuid not null references public.fixed_assets(id) on delete cascade,
  month text not null,
  amount numeric not null,
  journal_entry_id uuid references public.journal_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (asset_id, month, journal_entry_id)
);
create index if not exists fixed_asset_depr_asset_idx on public.fixed_asset_depreciations(asset_id, month);
alter table public.fixed_asset_depreciations enable row level security;
drop policy if exists company_isolation on public.fixed_asset_depreciations;
create policy company_isolation on public.fixed_asset_depreciations for all using (company_id = (select public.get_my_company_id()));

alter table public.production_voucher_drafts drop constraint if exists production_voucher_drafts_kind_check;
alter table public.production_voucher_drafts add constraint production_voucher_drafts_kind_check
  check (kind = any (array['production'::text, 'cogs'::text, 'inventory'::text, 'payroll'::text, 'depreciation'::text]));

-- 분류별 기본 계정 코드 (자산 / 누계 / 비용)
create or replace function public._fa_default_codes(p_category text)
returns table(asset_code text, accum_code text, expense_code text) language sql immutable as $$
  select case p_category when 'vehicle' then '208' when 'machine' then '206' when 'building' then '202' when 'structure' then '204' when 'tool' then '210' when 'software' then '240' else '212' end,
         case p_category when 'vehicle' then '209' when 'machine' then '207' when 'building' then '203' when 'structure' then '205' when 'tool' then '211' when 'software' then null else '213' end,
         case p_category when 'software' then '840' else null end
$$;

/** 확정된 상각 누계 — 반려·초안은 안 센다 */
create or replace function public._fa_accumulated(p_asset uuid, p_before_month text)
returns numeric language sql stable as $$
  select coalesce(sum(d.amount), 0) from public.fixed_asset_depreciations d join public.journal_entries e on e.id = d.journal_entry_id
   where d.asset_id = p_asset and d.month < p_before_month and e.status = 'confirmed'
$$;

create or replace function public.make_depreciation_voucher_draft(p_company uuid, p_month text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_last date; v_old record; a record; v_entry uuid; v_desc text; n int := 0; total numeric := 0;
  acc numeric; remaining numeric; amt numeric; a_exp uuid; a_acc uuid; a_asset uuid; codes record;
begin
  if p_company is null or p_month !~ '^\d{4}-\d{2}$' then raise exception '월(YYYY-MM)이 올바르지 않습니다'; end if;
  v_last := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'depreciation' and status = 'confirmed' and period_to = v_last) then
    raise exception '% 감가상각 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_month;
  end if;
  --   이 달의 초안·반려분은 갈아 끼운다 (상각 줄도 같이)
  for v_old in select * from production_voucher_drafts where company_id = p_company and kind = 'depreciation' and status in ('draft', 'rejected') and period_to = v_last loop
    if v_old.journal_entry_id is not null then
      delete from fixed_asset_depreciations where journal_entry_id = v_old.journal_entry_id;
      delete from journal_entries where id = v_old.journal_entry_id and status in ('ai_suggested', 'rejected');
    end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;

  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, v_last, '감가상각 ' || p_month, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;

  for a in select * from fixed_assets f where f.company_id = p_company and f.status = 'active' and f.depr_start_month <= p_month
             and (f.disposed_on is null or f.disposed_on > v_last) order by f.acquired_on, f.name loop
    acc := public._fa_accumulated(a.id, p_month);
    remaining := a.cost - a.salvage - acc;
    if remaining <= 0 then continue; end if;
    if a.method = 'declining' then amt := least(remaining, (a.cost - acc) * 2.0 / a.useful_months);
    else amt := least(remaining, (a.cost - a.salvage) / a.useful_months); end if;
    amt := round(amt);
    if amt <= 0 then continue; end if;
    select * into codes from public._fa_default_codes(a.category);
    a_exp := a.expense_account_id;
    if a_exp is null and codes.expense_code is not null then select id into a_exp from chart_of_accounts where company_id = p_company and code = codes.expense_code limit 1; end if;
    if a_exp is null then select id into a_exp from chart_of_accounts where company_id = p_company and name = '감가상각비' order by code desc limit 1; end if;
    a_acc := a.accum_account_id;
    if a_acc is null and codes.accum_code is not null then select id into a_acc from chart_of_accounts where company_id = p_company and code = codes.accum_code limit 1; end if;
    if a_acc is null then
      --   무형(소프트웨어 등)은 누계액 없이 자산을 직접 줄인다
      a_asset := a.asset_account_id;
      if a_asset is null then select id into a_asset from chart_of_accounts where company_id = p_company and code = codes.asset_code limit 1; end if;
      a_acc := a_asset;
    end if;
    if a_exp is null or a_acc is null then raise exception '% — 감가상각비·누계액 계정을 찾지 못했습니다 (계정과목표에 감가상각비·감가상각누계액이 있는지 확인)', a.name; end if;
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
      (p_company, v_entry, a_exp, amt, 0, a.name || ' 감가상각'), (p_company, v_entry, a_acc, 0, amt, a.name || ' 감가상각');
    insert into fixed_asset_depreciations (company_id, asset_id, month, amount, journal_entry_id) values (p_company, a.id, p_month, amt, v_entry);
    n := n + 1; total := total + amt;
  end loop;
  if n = 0 then delete from journal_entries where id = v_entry; return null; end if;
  v_desc := format('감가상각 초안 %s · 자산 %s건 · ₩%s', p_month, n, to_char(total, 'FM999,999,999,999'));
  update journal_entries set description = v_desc where id = v_entry;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'depreciation', date_trunc('month', v_last)::date, v_last, v_entry, '{}', total, 0, 0, v_desc);
  return v_entry;
end $$;

create or replace function public.make_my_depreciation_voucher_draft(p_month text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.make_depreciation_voucher_draft(public.get_my_company_id(), p_month);
end $$;
revoke all on function public.make_depreciation_voucher_draft(uuid, text) from public, anon, authenticated;
grant execute on function public.make_my_depreciation_voucher_draft(text) to authenticated;

-- 주기: 월 1일 지난달 감가상각도
create or replace function public.run_production_voucher_cycles()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Seoul')::date; v_y date; v_from date; v_cycle text; n int := 0;
begin
  v_y := v_today - 1;
  for r in select cs.company_id, coalesce(cs.settings->'production_voucher'->>'cycle', 'month') as cycle from company_settings cs loop
    if extract(day from v_today) = 1 then
      begin if public.make_inventory_voucher_draft(r.company_id, v_y) is not null then n := n + 1; end if; exception when others then null; end;
      begin if public.make_payroll_voucher_draft(r.company_id, to_char(v_y, 'YYYY-MM')) is not null then n := n + 1; end if; exception when others then null; end;
      begin if public.make_depreciation_voucher_draft(r.company_id, to_char(v_y, 'YYYY-MM')) is not null then n := n + 1; end if; exception when others then null; end;
    end if;
    v_cycle := r.cycle;
    if v_cycle = 'none' then continue;
    elsif v_cycle = 'day' then v_from := v_y;
    elsif v_cycle = 'week' then if extract(isodow from v_today) <> 1 then continue; end if; v_from := v_y - 6;
    else if extract(day from v_today) <> 1 then continue; end if; v_from := date_trunc('month', v_y)::date;
    end if;
    begin if public.make_production_voucher_draft(r.company_id, v_from, v_y) is not null then n := n + 1; end if; exception when others then null; end;
    begin if public.make_cogs_voucher_draft(r.company_id, v_from, v_y) is not null then n := n + 1; end if; exception when others then null; end;
  end loop;
  return n;
end $$;

-- 새 메뉴 권한 백필 — 대표·관리자에게 /finance/assets (전례: 20260821110000_support_programs_permission_backfill)
insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
select u.company_id, u.id, '/finance/assets', null, now()
from public.users u
where u.company_id is not null and u.role in ('owner', 'admin')
  and not exists (select 1 from public.member_permissions x where x.user_id = u.id and x.perm_key = '/finance/assets');
