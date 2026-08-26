-- 이익관리 Phase 3 — 원가 재평가(결정 39) · 매출원가·손실 주기 초안(결정 41) (2026-08-26)
--   · stock_cost_revaluations: 품목·일자·새 단가·사유. 재계산이 그 날 남은 층을 새 단가로 갈아끼우고 차액(평가손익)을 effect 에 적는다.
--     단가 없는 층(기초 원가 미입력)은 '기초 원가 입력'으로 같은 표를 쓴다 — 옛 단가가 없으면 차액 0.
--   · make_cogs_voucher_draft: 기간 판매 출고 원가(반품 차감) → 차변 제품매출원가/상품매출원가 · 대변 제품/상품.
--     폐기·감모 → 재고자산감모손실, 샘플·증정 → 견본비, 재평가 손실 → 재고자산평가손실(이익은 계정 없으면 적요에만).
--     이미 확정된 매출원가 초안 기간의 출고는 다시 집지 않는다. 대기 초안은 kind 별로 하나.
--   · 제품/상품 구분 = 생산 층이 한 번이라도 있으면 제품, 아니면 상품.

create table if not exists public.stock_cost_revaluations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  reval_date date not null,
  unit_cost numeric not null check (unit_cost >= 0),
  reason text not null default 'reval' check (reason in ('opening','reval_market','reval_adjust','other')),
  note text null,
  status text not null default 'active' check (status in ('active','cancelled')),
  effect_amount numeric not null default 0,
  effect_qty numeric not null default 0,
  created_by uuid null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz null
);
create index if not exists stock_cost_revaluations_idx on public.stock_cost_revaluations(company_id, product_id, reval_date);
alter table public.stock_cost_revaluations enable row level security;
drop policy if exists stock_cost_revaluations_company on public.stock_cost_revaluations;
create policy stock_cost_revaluations_company on public.stock_cost_revaluations for select using (company_id = (select public.get_my_company_id()));

--   :write 권한 확인 — 마스터이거나 /inventory/profit:write 를 받은 사람
create or replace function public._can_write_profit() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.auth_id = auth.uid() and coalesce(u.is_master, false))
      or exists (select 1 from users u join member_permissions mp on mp.user_id = u.id where u.auth_id = auth.uid() and mp.perm_key = '/inventory/profit:write');
$$;

create or replace function public.add_cost_revaluation(p_product uuid, p_date date, p_unit_cost numeric, p_reason text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id uuid; v_uid uuid;
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '회사가 없습니다'; end if;
  if not public._can_write_profit() then raise exception '원가 재평가 권한이 없습니다(이익관리 › 원가 방법·재계산·재평가)'; end if;
  if not exists (select 1 from products where id = p_product and company_id = v_company) then raise exception '품목이 없습니다'; end if;
  select id into v_uid from users where auth_id = auth.uid() limit 1;
  insert into stock_cost_revaluations (company_id, product_id, reval_date, unit_cost, reason, note, created_by)
  values (v_company, p_product, p_date, p_unit_cost, coalesce(p_reason, 'reval_adjust'), nullif(trim(p_note), ''), v_uid) returning id into v_id;
  perform public.rebuild_stock_costs(v_company);
  return v_id;
end $$;
grant execute on function public.add_cost_revaluation(uuid, date, numeric, text, text) to authenticated;
create or replace function public.cancel_cost_revaluation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  v_company := public.get_my_company_id();
  if not public._can_write_profit() then raise exception '원가 재평가 권한이 없습니다'; end if;
  update stock_cost_revaluations set status = 'cancelled', cancelled_at = now() where id = p_id and company_id = v_company and status = 'active';
  perform public.rebuild_stock_costs(v_company);
end $$;
grant execute on function public.cancel_cost_revaluation(uuid) to authenticated;

-- ── 재계산 v2 — 재평가 반영 ──
create or replace function public.rebuild_stock_costs(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_method text; r record; l record; rv record;
  v_unit numeric; v_need numeric; v_cost numeric; v_costed numeric; v_uncosted numeric; v_used jsonb; v_avg numeric; v_take numeric;
  v_mat_cost numeric; v_prod_qty numeric; v_seq int := 0; n_layers int := 0; n_costs int := 0; v_has_mtl boolean;
  v_eff numeric; v_eff_qty numeric;
  v_revals refcursor; v_rv_pending boolean := false; v_rv record;
begin
  if p_company is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('stock_costs:' || p_company::text));
  select coalesce(settings->'costing'->>'method', 'fifo') into v_method from company_settings where company_id = p_company;
  v_method := coalesce(v_method, 'fifo');
  delete from stock_move_costs where company_id = p_company;
  delete from stock_cost_layers where company_id = p_company;
  update stock_cost_revaluations set effect_amount = 0, effect_qty = 0 where company_id = p_company;

  open v_revals for select id, product_id, reval_date, unit_cost from stock_cost_revaluations where company_id = p_company and status = 'active' order by reval_date, created_at;
  fetch v_revals into v_rv; v_rv_pending := found;

  for r in
    select m.id, m.product_id, m.qty, m.unit_price, m.moved_at, m.overhead_unit, d.reason, d.id as doc_id
      from stock_moves m join stock_docs d on d.id = m.doc_id
     where m.company_id = p_company and d.status = 'active'
     order by m.moved_at, case when d.reason = 'consume' then 0 when d.reason = 'produce' then 1 else 2 end, d.created_at, m.created_at, m.id
  loop
    --   그 날 이전(및 그 날)의 재평가를 먼저 적용 — 그 날 출고부터 새 단가가 나간다
    while v_rv_pending and v_rv.reval_date <= r.moved_at loop
      select coalesce(sum(qty_left * (v_rv.unit_cost - coalesce(unit_cost, v_rv.unit_cost))), 0), coalesce(sum(qty_left), 0) into v_eff, v_eff_qty
        from stock_cost_layers where company_id = p_company and product_id = v_rv.product_id and qty_left > 0;
      update stock_cost_layers set unit_cost = v_rv.unit_cost where company_id = p_company and product_id = v_rv.product_id and qty_left > 0;
      update stock_cost_revaluations set effect_amount = round(v_eff), effect_qty = v_eff_qty where id = v_rv.id;
      fetch v_revals into v_rv; v_rv_pending := found;
    end loop;

    if r.reason = 'move' then continue; end if;
    v_seq := v_seq + 1;
    if r.qty > 0 then
      if r.reason = 'produce' then
        select exists(select 1 from stock_docs dd where dd.original_doc_id = r.doc_id and dd.reason = 'consume' and dd.status = 'active') into v_has_mtl;
        if v_has_mtl then
          select coalesce(sum(c.cost_amount), 0) into v_mat_cost
            from stock_move_costs c join stock_moves mm on mm.id = c.move_id join stock_docs dd on dd.id = mm.doc_id
           where dd.original_doc_id = r.doc_id and dd.reason = 'consume' and dd.status = 'active';
          select coalesce(sum(qty), 0) into v_prod_qty from stock_moves where doc_id = r.doc_id and qty > 0;
          v_unit := case when v_prod_qty > 0 then v_mat_cost / v_prod_qty + coalesce(r.overhead_unit, 0) else null end;
        else
          v_unit := case when r.unit_price is not null then r.unit_price + coalesce(r.overhead_unit, 0) else null end;
        end if;
      elsif r.reason in ('purchase', 'opening') then
        v_unit := r.unit_price;
      else
        select sum(qty_left * unit_cost) / nullif(sum(qty_left), 0) into v_avg
          from stock_cost_layers where company_id = p_company and product_id = r.product_id and qty_left > 0 and unit_cost is not null;
        if v_avg is null then select cost_price into v_avg from products where id = r.product_id; end if;
        v_unit := v_avg;
      end if;
      insert into stock_cost_layers (company_id, product_id, move_id, layer_date, seq, qty_in, qty_left, unit_cost, source)
      values (p_company, r.product_id, r.id, r.moved_at, v_seq, r.qty, r.qty, v_unit, r.reason);
      n_layers := n_layers + 1;
    elsif r.qty < 0 then
      v_need := -r.qty; v_cost := 0; v_costed := 0; v_uncosted := 0; v_used := '[]'::jsonb; v_avg := null;
      if v_method = 'avg' then
        select sum(qty_left * unit_cost) / nullif(sum(qty_left), 0) into v_avg
          from stock_cost_layers where company_id = p_company and product_id = r.product_id and qty_left > 0 and unit_cost is not null;
      end if;
      for l in select id, qty_left, unit_cost, layer_date, source from stock_cost_layers
                where company_id = p_company and product_id = r.product_id and qty_left > 0 order by layer_date, seq loop
        exit when v_need <= 0;
        v_take := least(l.qty_left, v_need);
        update stock_cost_layers set qty_left = qty_left - v_take where id = l.id;
        v_need := v_need - v_take;
        if l.unit_cost is null and v_avg is null then
          v_uncosted := v_uncosted + v_take;
        else
          v_costed := v_costed + v_take;
          v_cost := v_cost + v_take * coalesce(v_avg, l.unit_cost);
          v_used := v_used || jsonb_build_object('layer_id', l.id, 'date', l.layer_date, 'source', l.source, 'qty', v_take, 'unit_cost', coalesce(v_avg, l.unit_cost));
        end if;
      end loop;
      if v_need > 0 then v_uncosted := v_uncosted + v_need; end if;
      insert into stock_move_costs (move_id, company_id, product_id, moved_at, reason, qty, cost_amount, qty_costed, qty_uncosted, unit_cost, method, layers)
      values (r.id, p_company, r.product_id, r.moved_at, r.reason, r.qty, round(v_cost, 4), v_costed, v_uncosted,
              case when v_costed > 0 then round(v_cost / v_costed, 4) else null end, v_method, v_used);
      n_costs := n_costs + 1;
    end if;
  end loop;
  --   마지막 출고 뒤의 재평가
  while v_rv_pending loop
    select coalesce(sum(qty_left * (v_rv.unit_cost - coalesce(unit_cost, v_rv.unit_cost))), 0), coalesce(sum(qty_left), 0) into v_eff, v_eff_qty
      from stock_cost_layers where company_id = p_company and product_id = v_rv.product_id and qty_left > 0;
    update stock_cost_layers set unit_cost = v_rv.unit_cost where company_id = p_company and product_id = v_rv.product_id and qty_left > 0;
    update stock_cost_revaluations set effect_amount = round(v_eff), effect_qty = v_eff_qty where id = v_rv.id;
    fetch v_revals into v_rv; v_rv_pending := found;
  end loop;
  close v_revals;

  insert into stock_cost_state (company_id, method, computed_at, layers, costs, uncosted_moves)
  values (p_company, v_method, now(), n_layers, n_costs, (select count(*) from stock_move_costs where company_id = p_company and qty_uncosted > 0))
  on conflict (company_id) do update set method = excluded.method, computed_at = excluded.computed_at, layers = excluded.layers, costs = excluded.costs, uncosted_moves = excluded.uncosted_moves;
  return jsonb_build_object('layers', n_layers, 'costs', n_costs, 'method', v_method);
end $$;

-- ── 매출원가·손실 초안 ──
alter table public.production_voucher_drafts add column if not exists kind text not null default 'production' check (kind in ('production','cogs'));
alter table public.production_voucher_drafts add column if not exists amount_cogs numeric not null default 0;
alter table public.production_voucher_drafts add column if not exists amount_loss numeric not null default 0;
alter table public.production_voucher_drafts add column if not exists memo text null;

create or replace function public._acct_by(p_company uuid, p_cfg jsonb, p_key text, p_name text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := nullif(p_cfg->>p_key, '')::uuid;
  if v is null then select id into v from chart_of_accounts where company_id = p_company and name = p_name order by code desc limit 1; end if;
  return v;
end $$;

create or replace function public.make_cogs_voucher_draft(p_company uuid, p_from date, p_to date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; a_cogs_p uuid; a_cogs_g uuid; a_prod uuid; a_goods uuid; a_scrap uuid; a_reval uuid; a_sample uuid;
  v_old record; v_from date := p_from; v_entry uuid; v_desc text;
  cogs_p numeric := 0; cogs_g numeric := 0; scrap_p numeric := 0; scrap_g numeric := 0; smp_p numeric := 0; smp_g numeric := 0; rev_p numeric := 0; rev_g numeric := 0; rev_gain numeric := 0;
  v_unc int := 0; v_lines int := 0;
begin
  if p_company is null or p_from is null or p_to is null or p_from > p_to then raise exception '기간이 올바르지 않습니다'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_cogs_p := public._acct_by(p_company, v_cfg, 'acct_cogs_product', '제품매출원가');
  a_cogs_g := public._acct_by(p_company, v_cfg, 'acct_cogs_goods', '상품매출원가');
  a_prod   := public._acct_by(p_company, v_cfg, 'acct_product', '제품');
  a_goods  := public._acct_by(p_company, v_cfg, 'acct_goods', '상품');
  a_scrap  := public._acct_by(p_company, v_cfg, 'acct_scrap', '재고자산감모손실');
  a_reval  := public._acct_by(p_company, v_cfg, 'acct_reval', '재고자산평가손실');
  a_sample := public._acct_by(p_company, v_cfg, 'acct_sample', '견본비');
  if a_cogs_p is null or a_cogs_g is null or a_prod is null or a_goods is null then
    raise exception '계정과목 매핑이 없습니다 — 제품매출원가·상품매출원가·제품·상품 계정을 정해 주세요';
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'cogs' loop
    v_from := least(v_from, v_old.period_from);
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;

  --   기간 안 출고 원가 — 이미 확정된 매출원가 초안 기간은 뺀다. 제품/상품 = 생산 층 유무.
  with made as (select distinct product_id from stock_cost_layers where company_id = p_company and source = 'produce'),
  mc as (
    select c.*, (c.product_id in (select product_id from made)) as is_product
      from stock_move_costs c
     where c.company_id = p_company and c.moved_at between v_from and p_to
       and not exists (select 1 from production_voucher_drafts d where d.company_id = p_company and d.kind = 'cogs' and d.status = 'confirmed' and c.moved_at between d.period_from and d.period_to)
  ),
  rev as (
    select m.id as move_id, m.product_id, m.qty, l.unit_cost, m.moved_at, (m.product_id in (select product_id from made)) as is_product
      from stock_moves m join stock_docs d on d.id = m.doc_id left join stock_cost_layers l on l.move_id = m.id
     where m.company_id = p_company and d.status = 'active' and d.reason in ('sale', 'return_in') and m.qty > 0 and m.moved_at between v_from and p_to
       and not exists (select 1 from production_voucher_drafts x where x.company_id = p_company and x.kind = 'cogs' and x.status = 'confirmed' and m.moved_at between x.period_from and x.period_to)
  )
  select
    coalesce(sum(case when reason = 'sale' and is_product then cost_amount end), 0) - coalesce((select sum(qty * coalesce(unit_cost, 0)) from rev where is_product), 0),
    coalesce(sum(case when reason = 'sale' and not is_product then cost_amount end), 0) - coalesce((select sum(qty * coalesce(unit_cost, 0)) from rev where not is_product), 0),
    coalesce(sum(case when reason in ('disposal', 'count', 'fix') and is_product then cost_amount end), 0),
    coalesce(sum(case when reason in ('disposal', 'count', 'fix') and not is_product then cost_amount end), 0),
    coalesce(sum(case when reason in ('sample', 'gift') and is_product then cost_amount end), 0),
    coalesce(sum(case when reason in ('sample', 'gift') and not is_product then cost_amount end), 0),
    coalesce(sum(case when qty_uncosted > 0 then 1 end), 0)
    into cogs_p, cogs_g, scrap_p, scrap_g, smp_p, smp_g, v_unc from mc;
  --   재평가 손익(기간) — 손실만 전표, 이익은 적요에
  select coalesce(sum(case when effect_amount < 0 and product_id in (select product_id from stock_cost_layers where company_id = p_company and source = 'produce') then -effect_amount end), 0),
         coalesce(sum(case when effect_amount < 0 and product_id not in (select product_id from stock_cost_layers where company_id = p_company and source = 'produce') then -effect_amount end), 0),
         coalesce(sum(case when effect_amount > 0 then effect_amount end), 0)
    into rev_p, rev_g, rev_gain
    from stock_cost_revaluations where company_id = p_company and status = 'active' and reval_date between v_from and p_to;
  cogs_p := round(cogs_p); cogs_g := round(cogs_g); scrap_p := round(scrap_p); scrap_g := round(scrap_g); smp_p := round(smp_p); smp_g := round(smp_g); rev_p := round(rev_p); rev_g := round(rev_g);
  if cogs_p + cogs_g + scrap_p + scrap_g + smp_p + smp_g + rev_p + rev_g = 0 then return null; end if;

  v_desc := format('매출원가 초안 %s ~ %s · 매출원가 ₩%s', v_from, p_to, to_char(cogs_p + cogs_g, 'FM999,999,999,999'));
  if scrap_p + scrap_g > 0 then v_desc := v_desc || format(' · 폐기·감모 ₩%s', to_char(scrap_p + scrap_g, 'FM999,999,999,999')); end if;
  if smp_p + smp_g > 0 then v_desc := v_desc || format(' · 샘플·증정 ₩%s', to_char(smp_p + smp_g, 'FM999,999,999,999')); end if;
  if rev_p + rev_g > 0 then v_desc := v_desc || format(' · 재고 평가손실 ₩%s', to_char(rev_p + rev_g, 'FM999,999,999,999')); end if;
  if rev_gain > 0 then v_desc := v_desc || format(' · 재평가 이익 ₩%s 은 전표에 넣지 않음(환입 계정 확인)', to_char(rev_gain, 'FM999,999,999,999')); end if;
  if v_unc > 0 then v_desc := v_desc || format(' · 원가 미확정 출고 %s줄은 빠짐', v_unc); end if;

  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_to, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  if cogs_p <> 0 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_cogs_p, greatest(cogs_p, 0), greatest(-cogs_p, 0), '제품 매출원가'), (p_company, v_entry, a_prod, greatest(-cogs_p, 0), greatest(cogs_p, 0), '제품 매출원가'); end if;
  if cogs_g <> 0 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_cogs_g, greatest(cogs_g, 0), greatest(-cogs_g, 0), '상품 매출원가'), (p_company, v_entry, a_goods, greatest(-cogs_g, 0), greatest(cogs_g, 0), '상품 매출원가'); end if;
  if scrap_p > 0 and a_scrap is not null then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_scrap, scrap_p, 0, '폐기·감모(제품)'), (p_company, v_entry, a_prod, 0, scrap_p, '폐기·감모(제품)'); end if;
  if scrap_g > 0 and a_scrap is not null then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_scrap, scrap_g, 0, '폐기·감모(상품)'), (p_company, v_entry, a_goods, 0, scrap_g, '폐기·감모(상품)'); end if;
  if smp_p > 0 and a_sample is not null then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_sample, smp_p, 0, '샘플·증정(제품)'), (p_company, v_entry, a_prod, 0, smp_p, '샘플·증정(제품)'); end if;
  if smp_g > 0 and a_sample is not null then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_sample, smp_g, 0, '샘플·증정(상품)'), (p_company, v_entry, a_goods, 0, smp_g, '샘플·증정(상품)'); end if;
  if rev_p > 0 and a_reval is not null then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_reval, rev_p, 0, '재고 평가손실(제품)'), (p_company, v_entry, a_prod, 0, rev_p, '재고 평가손실(제품)'); end if;
  if rev_g > 0 and a_reval is not null then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_reval, rev_g, 0, '재고 평가손실(상품)'), (p_company, v_entry, a_goods, 0, rev_g, '재고 평가손실(상품)'); end if;
  select count(*) into v_lines from journal_lines where entry_id = v_entry;
  if v_lines = 0 then delete from journal_entries where id = v_entry; return null; end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'cogs', v_from, p_to, v_entry, '{}', cogs_p + cogs_g, scrap_p + scrap_g + smp_p + smp_g + rev_p + rev_g, v_unc, v_desc);
  return v_entry;
end $$;
revoke all on function public.make_cogs_voucher_draft(uuid, date, date) from public, anon;
create or replace function public.make_my_cogs_voucher_draft(p_from date, p_to date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.make_cogs_voucher_draft(public.get_my_company_id(), p_from, p_to);
end $$;
grant execute on function public.make_my_cogs_voucher_draft(date, date) to authenticated;

--   생산 초안은 kind 'production' 만 건드린다(옛 함수는 kind 없이 status='draft' 전부를 지웠다)
create or replace function public.make_production_voucher_draft(p_company uuid, p_from date, p_to date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; v_acct_product uuid; v_acct_material uuid; v_acct_scrap uuid;
  v_defect uuid; v_old record; v_from date := p_from;
  v_docs uuid[]; v_mat numeric := 0; v_prod numeric := 0; v_scrap numeric := 0; v_skipped int := 0;
  v_entry uuid; v_desc text; v_n int;
begin
  if p_company is null or p_from is null or p_to is null or p_from > p_to then raise exception '기간이 올바르지 않습니다'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_acct_product := nullif(v_cfg->>'acct_product','')::uuid;
  v_acct_material := nullif(v_cfg->>'acct_material','')::uuid;
  v_acct_scrap := nullif(v_cfg->>'acct_scrap','')::uuid;
  if v_acct_product is null then select id into v_acct_product from chart_of_accounts where company_id = p_company and name = '제품' order by code limit 1; end if;
  if v_acct_material is null then select id into v_acct_material from chart_of_accounts where company_id = p_company and name = '원재료' order by code limit 1; end if;
  if v_acct_scrap is null then select id into v_acct_scrap from chart_of_accounts where company_id = p_company and name = '재고자산감모손실' order by code limit 1; end if;
  if v_acct_product is null or v_acct_material is null or v_acct_scrap is null then
    raise exception '계정과목 매핑이 없습니다 — 제품·원재료·재고자산감모손실 계정을 정해 주세요';
  end if;
  select id into v_defect from warehouses where company_id = p_company and code = 'DEFECT' limit 1;

  --   대기 초안이 있으면 기간을 합치고 옛 초안(전표 포함)을 지운다 — 대기 초안은 언제나 하나
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'production' loop
    v_from := least(v_from, v_old.period_from);
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;

  --   대상 문서 — 활성, 전표 없음, 기간 안. 폐기는 불량 보류 창고 것만.
  select array_agg(d.id) into v_docs from stock_docs d
   where d.company_id = p_company and d.status = 'active' and d.journal_entry_id is null
     and d.doc_date between v_from and p_to
     and (d.reason in ('produce','consume') or (d.reason = 'disposal' and v_defect is not null and d.warehouse_id = v_defect));
  if v_docs is null or array_length(v_docs, 1) is null then return null; end if;

  --   금액 — 자재 실투입(이동평균 > 매입단가), 완제품 평가(단가 입력 > 이동평균), 폐기(단가 > 이동평균). 값이 없는 줄은 센다.
  with mv as (
    select m.qty, m.unit_price, m.amount, m.product_id, d.reason,
           coalesce(m.unit_price, ac.avg_cost, p.cost_price) as price
      from stock_moves m join stock_docs d on d.id = m.doc_id
      left join v_stock_avg_cost ac on ac.company_id = m.company_id and ac.product_id = m.product_id
      left join products p on p.id = m.product_id
     where m.doc_id = any(v_docs)
  )
  select coalesce(sum(case when reason = 'consume' then abs(qty) * coalesce(price, 0) end), 0),
         coalesce(sum(case when reason = 'produce' then qty * coalesce(price, 0) end), 0),
         coalesce(sum(case when reason = 'disposal' then abs(qty) * coalesce(price, 0) end), 0),
         count(*) filter (where price is null)
    into v_mat, v_prod, v_scrap, v_skipped from mv;
  v_mat := round(v_mat); v_prod := round(v_prod); v_scrap := round(v_scrap);
  if v_mat = 0 and v_scrap = 0 then return null; end if;

  v_desc := format('생산 전표 초안 %s ~ %s · 문서 %s건', v_from, p_to, array_length(v_docs, 1));
  if v_prod <> v_mat then v_desc := v_desc || format(' · 완제품 평가액 ₩%s(자재비와 차이 ₩%s)', to_char(v_prod, 'FM999,999,999,999'), to_char(v_prod - v_mat, 'FM999,999,999,999')); end if;
  if v_skipped > 0 then v_desc := v_desc || format(' · 단가 없는 줄 %s', v_skipped); end if;

  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_to, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  if v_mat > 0 then
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
      (p_company, v_entry, v_acct_product, v_mat, 0, format('완제품 입고 %s~%s', v_from, p_to)),
      (p_company, v_entry, v_acct_material, 0, v_mat, format('자재 투입 %s~%s', v_from, p_to));
  end if;
  if v_scrap > 0 then
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
      (p_company, v_entry, v_acct_scrap, v_scrap, 0, '불량 폐기'),
      (p_company, v_entry, v_acct_product, 0, v_scrap, '불량 폐기');
  end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_material, amount_product_valued, amount_scrap, skipped_lines)
  values (p_company, 'production', v_from, p_to, v_entry, v_docs, v_mat, v_prod, v_scrap, v_skipped);
  return v_entry;
end $$;

--   주기 마감에 매출원가 초안도 함께
create or replace function public.run_production_voucher_cycles()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Seoul')::date; v_y date; v_from date; v_cycle text; n int := 0;
begin
  v_y := v_today - 1;
  for r in select cs.company_id, coalesce(cs.settings->'production_voucher'->>'cycle', 'month') as cycle from company_settings cs loop
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
