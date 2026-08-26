-- 생산 주기 전표 초안 (결정 33, 2026-08-26 사장님 "추천대로")
--   주기(일/주/월(기본)/안 함)가 끝나면 그 기간의 생산·자재 투입·불량 폐기 문서를 **일반전표(대체) 초안 1장**으로 합친다.
--   · 초안 = journal_entries status 'ai_suggested' (재무제표는 확정만 읽으므로 장부에 안 들어간다). 확정은 사람.
--   · 차변 제품 = 대변 원재료 = 자재 실투입 금액(이동평균, 없으면 매입단가). 대차가 맞아야 전표다 —
--     완제품 단가(사람 입력)와 다르면 적요에 차이를 적는다(비용 계정은 안 만든다).
--   · 불량 폐기(불량 보류 창고 disposal): 차변 재고자산감모손실 / 대변 제품.
--   · 대기 초안은 회사당 하나 — 다음 주기가 와도 새로 만들지 않고 기간을 늘려 갈아끼운다.
--   · 문서 journal_entry_id 는 **확정될 때** 채운다(초안 단계에서 묶으면 cancelStockDoc 이 막힌다). 반려되면 다음 초안이 다시 집는다.
--   · 설정은 company_settings.settings->'production_voucher' {cycle, acct_product, acct_material, acct_scrap}. 계정이 비면 이름(제품·원재료·재고자산감모손실)으로 찾는다.

create table if not exists public.production_voucher_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','confirmed','rejected')),
  doc_ids uuid[] not null default '{}',
  amount_material numeric not null default 0,
  amount_product_valued numeric not null default 0,
  amount_scrap numeric not null default 0,
  skipped_lines int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists production_voucher_drafts_company_idx on public.production_voucher_drafts(company_id, status);
alter table public.production_voucher_drafts enable row level security;
drop policy if exists production_voucher_drafts_company on public.production_voucher_drafts;
create policy production_voucher_drafts_company on public.production_voucher_drafts for select
  using (company_id = (select public.get_my_company_id()));
--   쓰기는 함수(security definer)만 — 사람이 직접 줄을 만들지 않는다.

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
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' loop
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
  insert into production_voucher_drafts (company_id, period_from, period_to, journal_entry_id, doc_ids, amount_material, amount_product_valued, amount_scrap, skipped_lines)
  values (p_company, v_from, p_to, v_entry, v_docs, v_mat, v_prod, v_scrap, v_skipped);
  return v_entry;
end $$;
revoke all on function public.make_production_voucher_draft(uuid, date, date) from public, anon;
--   회사 사람만 자기 회사 것을 부른다 — 함수 안에서 회사를 다시 확인한다
create or replace function public.make_my_production_voucher_draft(p_from date, p_to date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '회사가 없습니다'; end if;
  return public.make_production_voucher_draft(v_company, p_from, p_to);
end $$;
grant execute on function public.make_my_production_voucher_draft(date, date) to authenticated;

--   확정되면 문서에 전표를 묶고, 반려되면 초안만 반려로(문서는 풀려 다음 초안이 다시 집는다)
create or replace function public._trg_production_draft_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_draft record;
begin
  if new.status is distinct from old.status then
    select * into v_draft from production_voucher_drafts where journal_entry_id = new.id and status = 'draft' limit 1;
    if found then
      if new.status = 'confirmed' then
        update stock_docs set journal_entry_id = new.id where id = any(v_draft.doc_ids) and journal_entry_id is null;
        update production_voucher_drafts set status = 'confirmed', updated_at = now() where id = v_draft.id;
      elsif new.status = 'rejected' then
        update production_voucher_drafts set status = 'rejected', updated_at = now() where id = v_draft.id;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists journal_entries_production_draft on public.journal_entries;
create trigger journal_entries_production_draft after update of status on public.journal_entries
  for each row execute function public._trg_production_draft_status();

--   주기 마감 — 매일 06:00 KST(21:00 UTC). 어제로 주기가 끝난 회사만.
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
    begin
      if public.make_production_voucher_draft(r.company_id, v_from, v_y) is not null then n := n + 1; end if;
    exception when others then null;   -- 계정 매핑 없음 등 — 다음 회사로. 화면이 알려 준다.
    end;
  end loop;
  return n;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'production-voucher-daily';
    perform cron.schedule('production-voucher-daily', '0 21 * * *', 'select public.run_production_voucher_cycles()');
  end if;
end $$;
