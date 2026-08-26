-- 이익관리 Phase 1 — 입고 층·출고 원가 (결정 36·37·38·42, 2026-08-26 사장님 "추천대로")
--   · stock_cost_layers: 입고 한 줄 = 층 {품목, 일자, 들어온 수량, 남은 수량, 단가, 원천}
--   · stock_move_costs: 출고 한 줄의 확정 원가 {원가, 확정 수량, 미확정 수량, 어느 층에서 얼마}
--   · rebuild_stock_costs(회사): 회사 전체를 일자순으로 다시 계산(층·출고 원가 전부 새로). 회사 단위 잠금.
--     원가 방법 = company_settings.settings->costing->>'method' ('fifo' 기본 | 'avg' 이동평균).
--   · 생산 입고 단가 = 짝 자재 투입(MTL) 확정 원가 합 ÷ 그 문서 입고 수량(양품+불량) + 단위당 노무·경비(완성 때 snapshot: stock_moves.overhead_unit).
--     MTL 이 없으면 사람이 넣은 단가(+노무·경비). 층이 없는 출고는 지어내지 않고 미확정으로 남긴다.
--   · 창고 이동은 원가 사건이 아니다. 반품·조정 입고는 그 시점 남은 층의 평균(없으면 품목 매입가, 그것도 없으면 null).
--   · 트리거: stock_moves 삽입/삭제(문장 단위), stock_docs 상태 변경 → 그 회사 재계산. cron 02:00 KST 전체.
--   · v_stock_avg_cost 는 층 기반(남은 층의 가중평균 = 현재고 평가)으로 다시 정의. 기존 화면이 그대로 읽는다.

alter table public.products add column if not exists overhead_per_unit numeric not null default 0;
comment on column public.products.overhead_per_unit is '완제품 1개당 노무·경비 — 생산 원가에 얹는다(급여대장 연동 안 함, 권한 누수 방지). 바꾸면 그 뒤 완성 기록부터';
alter table public.stock_moves add column if not exists overhead_unit numeric null;
comment on column public.stock_moves.overhead_unit is '완성 기록 때의 단위당 노무·경비 snapshot(생산 입고 줄만)';

create table if not exists public.stock_cost_layers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  move_id uuid not null references public.stock_moves(id) on delete cascade,
  layer_date date not null,
  seq int not null,
  qty_in numeric not null,
  qty_left numeric not null,
  unit_cost numeric null,
  source text not null,
  created_at timestamptz not null default now()
);
create index if not exists stock_cost_layers_product_idx on public.stock_cost_layers(company_id, product_id, layer_date, seq);
create table if not exists public.stock_move_costs (
  move_id uuid primary key references public.stock_moves(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null,
  moved_at date not null,
  reason text not null,
  qty numeric not null,
  cost_amount numeric not null default 0,
  qty_costed numeric not null default 0,
  qty_uncosted numeric not null default 0,
  unit_cost numeric null,
  method text not null,
  layers jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);
create index if not exists stock_move_costs_company_idx on public.stock_move_costs(company_id, moved_at);
create table if not exists public.stock_cost_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  method text not null,
  computed_at timestamptz not null default now(),
  layers int not null default 0,
  costs int not null default 0,
  uncosted_moves int not null default 0
);
alter table public.stock_cost_layers enable row level security;
alter table public.stock_move_costs enable row level security;
alter table public.stock_cost_state enable row level security;
drop policy if exists stock_cost_layers_company on public.stock_cost_layers;
create policy stock_cost_layers_company on public.stock_cost_layers for select using (company_id = (select public.get_my_company_id()));
drop policy if exists stock_move_costs_company on public.stock_move_costs;
create policy stock_move_costs_company on public.stock_move_costs for select using (company_id = (select public.get_my_company_id()));
drop policy if exists stock_cost_state_company on public.stock_cost_state;
create policy stock_cost_state_company on public.stock_cost_state for select using (company_id = (select public.get_my_company_id()));

create or replace function public.rebuild_stock_costs(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_method text; r record; l record;
  v_unit numeric; v_need numeric; v_cost numeric; v_costed numeric; v_uncosted numeric; v_used jsonb; v_avg numeric; v_take numeric;
  v_mat_cost numeric; v_prod_qty numeric; v_seq int := 0; n_layers int := 0; n_costs int := 0; v_has_mtl boolean;
begin
  if p_company is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('stock_costs:' || p_company::text));
  select coalesce(settings->'costing'->>'method', 'fifo') into v_method from company_settings where company_id = p_company;
  v_method := coalesce(v_method, 'fifo');
  delete from stock_move_costs where company_id = p_company;
  delete from stock_cost_layers where company_id = p_company;

  for r in
    select m.id, m.product_id, m.qty, m.unit_price, m.moved_at, m.overhead_unit, d.reason, d.id as doc_id
      from stock_moves m join stock_docs d on d.id = m.doc_id
     where m.company_id = p_company and d.status = 'active'
     order by m.moved_at,
              case when d.reason = 'consume' then 0 when d.reason = 'produce' then 1 else 2 end,   -- 같은 날엔 자재가 먼저 나가야 제품 원가가 선다
              d.created_at, m.created_at, m.id
  loop
    if r.reason = 'move' then continue; end if;
    v_seq := v_seq + 1;
    if r.qty > 0 then
      -- ── 입고 층 ──
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
        --   반품 입고·조정(+)·취소로 되돌아온 것: 그 시점 남은 층의 평균, 없으면 품목 매입가
        select sum(qty_left * unit_cost) / nullif(sum(qty_left), 0) into v_avg
          from stock_cost_layers where company_id = p_company and product_id = r.product_id and qty_left > 0 and unit_cost is not null;
        if v_avg is null then select cost_price into v_avg from products where id = r.product_id; end if;
        v_unit := v_avg;
      end if;
      insert into stock_cost_layers (company_id, product_id, move_id, layer_date, seq, qty_in, qty_left, unit_cost, source)
      values (p_company, r.product_id, r.id, r.moved_at, v_seq, r.qty, r.qty, v_unit, r.reason);
      n_layers := n_layers + 1;
    elsif r.qty < 0 then
      -- ── 출고 원가 ──
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
      if v_need > 0 then v_uncosted := v_uncosted + v_need; end if;   -- 층이 모자란다(재고 음수·기초 원가 없음) — 지어내지 않는다
      insert into stock_move_costs (move_id, company_id, product_id, moved_at, reason, qty, cost_amount, qty_costed, qty_uncosted, unit_cost, method, layers)
      values (r.id, p_company, r.product_id, r.moved_at, r.reason, r.qty, round(v_cost, 4), v_costed, v_uncosted,
              case when v_costed > 0 then round(v_cost / v_costed, 4) else null end, v_method, v_used);
      n_costs := n_costs + 1;
    end if;
  end loop;

  insert into stock_cost_state (company_id, method, computed_at, layers, costs, uncosted_moves)
  values (p_company, v_method, now(), n_layers, n_costs, (select count(*) from stock_move_costs where company_id = p_company and qty_uncosted > 0))
  on conflict (company_id) do update set method = excluded.method, computed_at = excluded.computed_at, layers = excluded.layers, costs = excluded.costs, uncosted_moves = excluded.uncosted_moves;
  return jsonb_build_object('layers', n_layers, 'costs', n_costs, 'method', v_method);
end $$;
revoke all on function public.rebuild_stock_costs(uuid) from public, anon;

create or replace function public.rebuild_my_stock_costs()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.rebuild_stock_costs(public.get_my_company_id());
end $$;
grant execute on function public.rebuild_my_stock_costs() to authenticated;

-- 문서 저장·취소가 곧 재계산 (결정 42). 문장 단위 — 줄 여러 개를 한 번에 넣어도 한 번만 돈다.
create or replace function public._trg_stock_moves_rebuild_ins() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from new_rows loop perform public.rebuild_stock_costs(c); end loop;
  return null;
end $$;
create or replace function public._trg_stock_moves_rebuild_del() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from old_rows loop perform public.rebuild_stock_costs(c); end loop;
  return null;
end $$;
drop trigger if exists stock_moves_rebuild_ins on public.stock_moves;
create trigger stock_moves_rebuild_ins after insert on public.stock_moves referencing new table as new_rows for each statement execute function public._trg_stock_moves_rebuild_ins();
drop trigger if exists stock_moves_rebuild_del on public.stock_moves;
create trigger stock_moves_rebuild_del after delete on public.stock_moves referencing old table as old_rows for each statement execute function public._trg_stock_moves_rebuild_del();
create or replace function public._trg_stock_docs_rebuild() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.doc_date is distinct from old.doc_date then perform public.rebuild_stock_costs(new.company_id); end if;
  return null;
end $$;
drop trigger if exists stock_docs_rebuild on public.stock_docs;
create trigger stock_docs_rebuild after update of status, doc_date on public.stock_docs for each row execute function public._trg_stock_docs_rebuild();

-- 현재고 평가 = 남은 층의 가중평균 (층 기반으로 재정의 — 기존 화면은 그대로 읽는다)
drop view if exists public.v_stock_avg_cost;
create view public.v_stock_avg_cost with (security_invoker = true) as
  select company_id, product_id,
         sum(qty_left * unit_cost) / nullif(sum(qty_left), 0) as avg_cost,
         sum(qty_left) as priced_qty
    from public.stock_cost_layers
   where qty_left > 0 and unit_cost is not null
   group by company_id, product_id;

-- 밤 02:00 KST(17:00 UTC) 전체 정합 재계산
create or replace function public.run_stock_cost_rebuild_all() returns int language plpgsql security definer set search_path = public as $$
declare c uuid; n int := 0;
begin
  for c in select distinct company_id from stock_moves loop
    begin perform public.rebuild_stock_costs(c); n := n + 1; exception when others then null; end;
  end loop;
  return n;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'stock-cost-rebuild-daily';
    perform cron.schedule('stock-cost-rebuild-daily', '0 17 * * *', 'select public.run_stock_cost_rebuild_all()');
  end if;
end $$;

-- 첫 켜기 — 지금 있는 회사 전부 1회
select public.run_stock_cost_rebuild_all();
