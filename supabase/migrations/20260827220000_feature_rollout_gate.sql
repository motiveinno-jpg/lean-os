-- 기능 롤아웃 게이트 (2026-08-27 사장님: "모티브 오너뷰는 메인(테스트 병행). 다른 회사 데이터는 건드리지 말고, 메인에 먼저 배포 → 문제 없으면 전체.
--   시연용 데이터 마이그레이션도 모티브에만.")
--   결정 86 — 회사 데이터를 만드는 자동화(크론·백필·시드)는 feature_on(feature, company) 을 통과해야 돈다. company_id null 행 = 전체 배포.
--   전체 배포 = 사장님 확인 뒤 `insert into feature_rollout (feature) values ('…')` 한 줄. UI 코드는 전 회사가 같이 받지만 데이터는 만들지 않는다.
create table if not exists public.feature_rollout (
  feature text not null,
  company_id uuid references public.companies(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  unique (feature, company_id)
);
alter table public.feature_rollout enable row level security;
drop policy if exists no_client on public.feature_rollout;
create policy no_client on public.feature_rollout for all using (false);
create or replace function public.feature_on(p_feature text, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.feature_rollout f where f.feature = p_feature and (f.company_id is null or f.company_id = p_company))
$$;
revoke all on function public.feature_on(text, uuid) from public, anon, authenticated;

insert into public.feature_rollout (feature, company_id, note) values
  ('closing_drafts', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '월 1일 재고자산·급여·감가상각 초안 — 메인 먼저'),
  ('contract_invoice_drafts', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '계약 회차 예정일 → 발행 대기'),
  ('biz_alerts', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '조건형 경영 알림'),
  ('fixed_assets_menu', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '재무 › 고정자산 권한 백필')
on conflict do nothing;

create or replace function public.run_production_voucher_cycles()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Seoul')::date; v_y date; v_from date; v_cycle text; n int := 0;
begin
  v_y := v_today - 1;
  for r in select cs.company_id, coalesce(cs.settings->'production_voucher'->>'cycle', 'month') as cycle from company_settings cs loop
    if extract(day from v_today) = 1 and public.feature_on('closing_drafts', r.company_id) then
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
create or replace function public.make_contract_invoice_drafts()
returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  for c in select distinct company_id from documents where content_json ? 'paymentSchedule' loop
    if not public.feature_on('contract_invoice_drafts', c.company_id) then continue; end if;
    begin n := n + public.make_contract_invoice_drafts_for(c.company_id, v_today); exception when others then null; end;
  end loop;
  return n;
end $$;
create or replace function public.run_biz_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  for c in select distinct company_id from biz_alert_rules where enabled loop
    if not public.feature_on('biz_alerts', c.company_id) then continue; end if;
    begin n := n + public.run_biz_alerts_for(c.company_id, v_today); exception when others then null; end;
  end loop;
  return n;
end $$;

-- 다른 회사 관리자에게 백필했던 고정자산 권한은 되돌린다 (메인 먼저)
delete from public.member_permissions where perm_key = '/finance/assets' and granted_by is null and company_id <> 'c361afb9-8a52-4cac-add9-8992f0f7c09c' and granted_at::date = current_date;
