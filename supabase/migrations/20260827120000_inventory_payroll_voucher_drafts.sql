-- ── ERP 공백 ② — 재고자산 맞추기 · 급여 전표 자동 초안 (2026-08-27 사장님 "추천 순서대로")
--   docs/20260827_PLAN_erp_gaps.md ②. 생산·매출원가 초안(production_voucher_drafts)과 같은 틀:
--   초안(ai_suggested)까지 자동, 확정은 사람(재무 › 전표 현황 › 처리할 것). 확정하면 _trg_production_draft_status 가 초안 행을 confirmed 로.
--
--   결정 54 — 재고자산 초안 = 기말 층 원가 가치(_stock_value_asof) − 확정 전표 장부 잔액 → 차액만 전표.
--             구매가 비용으로 갔든 자산으로 갔든, 매출원가 초안이 있든 없든 기말 재고자산 계정이 실물 가치와 맞는다.
--             분류: 생산 층이 있으면 제품(150), 자재구성의 구성품이면 원재료(153), 그 밖은 상품(146). 상대 계정 = 제품·상품매출원가 / 원재료비.
--   결정 55 — 급여 초안 = 발급된 급여명세(payroll_items status issued)의 **합계만**: 차) 직원급여(총급여) / 대) 예수금(4대보험·소득세·기타 공제) / 대) 미지급금(실지급).
--             개인별 금액은 전표에 싣지 않는다(권한 누수 방지). 회사 부담분 4대보험은 명세에 없어 빼고, 적요에 적는다.
--             통장에서 급여가 나가면 '통장 줄 처리 › 일반전표'에서 미지급금을 고른다(적요에 안내).
--   결정 56 — 월 1일 새벽 주기(run_production_voucher_cycles)에 지난달 재고자산·급여 초안을 같이 만든다. 이미 확정된 기간이면 건너뛴다.

alter table public.production_voucher_drafts drop constraint if exists production_voucher_drafts_kind_check;
alter table public.production_voucher_drafts add constraint production_voucher_drafts_kind_check
  check (kind = any (array['production'::text, 'cogs'::text, 'inventory'::text, 'payroll'::text]));

-- 어느 날짜 기준 품목별 재고 가치 — 층 입고 원가 합 − 그날까지의 출고 원가 합
create or replace function public._stock_value_asof(p_company uuid, p_asof date)
returns table(product_id uuid, value numeric) language sql stable as $$
  select p.product_id, coalesce(li.v, 0) - coalesce(mo.v, 0)
    from (select distinct product_id from public.stock_cost_layers where company_id = p_company) p
    left join (select product_id, sum(qty_in * unit_cost) v from public.stock_cost_layers where company_id = p_company and layer_date <= p_asof group by 1) li on li.product_id = p.product_id
    left join (select product_id, sum(cost_amount) v from public.stock_move_costs where company_id = p_company and moved_at <= p_asof group by 1) mo on mo.product_id = p.product_id
$$;

create or replace function public.make_inventory_voucher_draft(p_company uuid, p_asof date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; a_prod uuid; a_goods uuid; a_mat uuid; a_cogs_p uuid; a_cogs_g uuid; a_matcost uuid;
  t_p numeric := 0; t_g numeric := 0; t_m numeric := 0; b_p numeric := 0; b_g numeric := 0; b_m numeric := 0;
  d_p numeric; d_g numeric; d_m numeric; v_entry uuid; v_desc text; v_old record;
begin
  if p_company is null or p_asof is null then raise exception '기준일이 없습니다'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_prod    := public._acct_by(p_company, v_cfg, 'acct_product', '제품');
  a_goods   := public._acct_by(p_company, v_cfg, 'acct_goods', '상품');
  a_mat     := public._acct_by(p_company, v_cfg, 'acct_material', '원재료');
  a_cogs_p  := public._acct_by(p_company, v_cfg, 'acct_cogs_product', '제품매출원가');
  a_cogs_g  := public._acct_by(p_company, v_cfg, 'acct_cogs_goods', '상품매출원가');
  a_matcost := public._acct_by(p_company, v_cfg, 'acct_material_cost', '원재료비');
  if a_prod is null or a_goods is null or a_mat is null or a_cogs_p is null or a_cogs_g is null or a_matcost is null then
    raise exception '계정과목 매핑이 없습니다 — 제품·상품·원재료·제품매출원가·상품매출원가·원재료비 계정을 정해 주세요';
  end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'inventory' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 재고자산 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'inventory' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;

  with made as (select distinct product_id from stock_cost_layers where company_id = p_company and source = 'produce'),
       comp as (select distinct component_id as product_id from product_boms where company_id = p_company),
       v as (select * from public._stock_value_asof(p_company, p_asof))
  select coalesce(sum(case when v.product_id in (select product_id from made) then v.value end), 0),
         coalesce(sum(case when v.product_id not in (select product_id from made) and v.product_id in (select product_id from comp) then v.value end), 0),
         coalesce(sum(case when v.product_id not in (select product_id from made) and v.product_id not in (select product_id from comp) then v.value end), 0)
    into t_p, t_m, t_g from v;

  select coalesce(sum(l.debit - l.credit), 0) into b_p from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_prod;
  select coalesce(sum(l.debit - l.credit), 0) into b_g from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_goods;
  select coalesce(sum(l.debit - l.credit), 0) into b_m from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_mat;

  d_p := round(t_p - b_p); d_g := round(t_g - b_g); d_m := round(t_m - b_m);
  if abs(d_p) < 1 and abs(d_g) < 1 and abs(d_m) < 1 then return null; end if;

  v_desc := format('재고자산 맞추기 %s · 기말 제품 ₩%s / 상품 ₩%s / 원재료 ₩%s · 장부와 차액 ₩%s',
    p_asof, to_char(round(t_p), 'FM999,999,999,999'), to_char(round(t_g), 'FM999,999,999,999'), to_char(round(t_m), 'FM999,999,999,999'),
    to_char(d_p + d_g + d_m, 'FM999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  --   차액 > 0: 자산이 장부보다 크다 → 차) 재고자산 / 대) 원가.  차액 < 0: 차) 원가 / 대) 재고자산
  if abs(d_p) >= 1 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
    (p_company, v_entry, a_prod, greatest(d_p, 0), greatest(-d_p, 0), '제품 기말 맞춤'), (p_company, v_entry, a_cogs_p, greatest(-d_p, 0), greatest(d_p, 0), '제품 기말 맞춤'); end if;
  if abs(d_g) >= 1 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
    (p_company, v_entry, a_goods, greatest(d_g, 0), greatest(-d_g, 0), '상품 기말 맞춤'), (p_company, v_entry, a_cogs_g, greatest(-d_g, 0), greatest(d_g, 0), '상품 기말 맞춤'); end if;
  if abs(d_m) >= 1 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
    (p_company, v_entry, a_mat, greatest(d_m, 0), greatest(-d_m, 0), '원재료 기말 맞춤'), (p_company, v_entry, a_matcost, greatest(-d_m, 0), greatest(d_m, 0), '원재료 기말 맞춤'); end if;

  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'inventory', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', d_p + d_g + d_m, 0, 0, v_desc);
  return v_entry;
end $$;

create or replace function public.make_payroll_voucher_draft(p_company uuid, p_month text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; a_sal uuid; a_wh uuid; a_pay uuid;
  n int := 0; gross numeric := 0; wh numeric := 0; net numeric := 0; other numeric := 0;
  v_last date; v_entry uuid; v_desc text; v_old record;
begin
  if p_company is null or p_month !~ '^\d{4}-\d{2}$' then raise exception '월(YYYY-MM)이 올바르지 않습니다'; end if;
  v_last := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_sal := public._acct_by(p_company, v_cfg, 'acct_salary', '직원급여');
  a_wh  := public._acct_by(p_company, v_cfg, 'acct_withholding', '예수금');
  a_pay := public._acct_by(p_company, v_cfg, 'acct_salary_payable', '미지급금');
  if a_sal is null or a_wh is null or a_pay is null then
    raise exception '계정과목 매핑이 없습니다 — 직원급여·예수금·미지급금 계정을 정해 주세요';
  end if;
  select count(*), coalesce(sum(coalesce(net_pay, 0) + coalesce(deductions_total, 0)), 0),
         coalesce(sum(coalesce(national_pension, 0) + coalesce(health_insurance, 0) + coalesce(long_term_care_insurance, 0) + coalesce(employment_insurance, 0) + coalesce(income_tax, 0) + coalesce(local_income_tax, 0)), 0),
         coalesce(sum(coalesce(net_pay, 0)), 0)
    into n, gross, wh, net
    from payroll_items where company_id = p_company and period_month = p_month and status = 'issued';
  if n = 0 then return null; end if;
  other := gross - wh - net;   -- 명세의 기타 공제(가불·식대 등) — 예수금으로
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'payroll' and status = 'confirmed' and period_to = v_last) then
    raise exception '% 급여 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_month;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'payroll' and period_to = v_last loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  gross := round(gross); wh := round(wh); net := round(net); other := round(other);
  v_desc := format('급여 초안 %s · %s명 · 총급여 ₩%s · 공제 ₩%s · 실지급 ₩%s (회사 부담 4대보험은 명세에 없어 빠짐 · 통장 지급 시 미지급금으로 처리)',
    p_month, n, to_char(gross, 'FM999,999,999,999'), to_char(wh + other, 'FM999,999,999,999'), to_char(net, 'FM999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, v_last, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_sal, gross, 0, '급여 ' || p_month || ' (' || n || '명)');
  if wh + other > 0 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_wh, 0, wh + other, '4대보험·소득세·기타 공제 예수'); end if;
  if net > 0 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_pay, 0, net, '급여 미지급 — 통장 지급 시 미지급금으로'); end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'payroll', date_trunc('month', v_last)::date, v_last, v_entry, '{}', gross, 0, 0, v_desc);
  return v_entry;
end $$;

create or replace function public.make_my_inventory_voucher_draft(p_asof date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.make_inventory_voucher_draft(public.get_my_company_id(), p_asof);
end $$;
create or replace function public.make_my_payroll_voucher_draft(p_month text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.make_payroll_voucher_draft(public.get_my_company_id(), p_month);
end $$;
revoke all on function public.make_inventory_voucher_draft(uuid, date) from public, anon, authenticated;
revoke all on function public.make_payroll_voucher_draft(uuid, text) from public, anon, authenticated;
grant execute on function public.make_my_inventory_voucher_draft(date) to authenticated;
grant execute on function public.make_my_payroll_voucher_draft(text) to authenticated;

-- 주기: 월 1일이면 지난달 재고자산·급여 초안도 만든다 (결정 56). 생산·매출원가 주기는 그대로.
create or replace function public.run_production_voucher_cycles()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Seoul')::date; v_y date; v_from date; v_cycle text; n int := 0;
begin
  v_y := v_today - 1;
  for r in select cs.company_id, coalesce(cs.settings->'production_voucher'->>'cycle', 'month') as cycle from company_settings cs loop
    if extract(day from v_today) = 1 then
      begin if public.make_inventory_voucher_draft(r.company_id, v_y) is not null then n := n + 1; end if; exception when others then null; end;
      begin if public.make_payroll_voucher_draft(r.company_id, to_char(v_y, 'YYYY-MM')) is not null then n := n + 1; end if; exception when others then null; end;
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
