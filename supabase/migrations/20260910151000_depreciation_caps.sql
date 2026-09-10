-- 감가상각 초안: 누계 상한에 초안을 포함하고, 처분한 달까지 상각한다.
--   초안을 여러 달 만들어 두고 한꺼번에 확정하면 누계가 취득가−잔존가를 넘겼고, 처분한 달은 한 푼도 상각하지 않았다.
begin;
/** 상각 누계 — 확정분 + 아직 확정 전인 초안. 초안만 쌓아 두고 나중에 한꺼번에 확정하면 취득가를 넘겨 상각되던 것 */
create or replace function public._fa_accumulated(p_asset uuid, p_before_month text)
returns numeric language sql stable as $$
  select coalesce(sum(d.amount), 0) from public.fixed_asset_depreciations d join public.journal_entries e on e.id = d.journal_entry_id
   where d.asset_id = p_asset and d.month < p_before_month and e.status in ('confirmed', 'ai_suggested')
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

  -- 처분한 달까지 상각(월할) — disposed_on 이 이 달 안이면 포함
  for a in select * from fixed_assets f where f.company_id = p_company and f.status = 'active' and f.depr_start_month <= p_month
             and (f.disposed_on is null or f.disposed_on >= to_date(p_month || '-01', 'YYYY-MM-DD')) order by f.acquired_on, f.name loop
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

commit;
