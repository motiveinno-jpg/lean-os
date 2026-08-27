-- 조건형 경영 알림 (2026-08-27 ERP 3순위 ①) — 사용자가 켜는 조건 4종, 매일 08:00 KST 평가 → 대표·관리자 알림(notifications → 웹푸시 트리거 그대로)
--   결정 75 — 조건 4종: 현금 잔액 < 월 고정비 × N개월 / 미수 N일 초과 새로 발생 / 미지급 N일 초과 새로 발생 / 어제 ₩N 이상 출금.
--             월 고정비 = 정기 지출(활성·월) + 고정비 표. 계산서 기준은 연령표와 같다(전표처리·미정산).
--   결정 76 — 같은 규칙은 하루 한 번(last_fired_on). 미수·미지급은 '오늘 딱 N일을 넘긴 것'만 — 매일 같은 것을 또 알리지 않는다.
--   결정 77 — 받는 사람 = 대표·관리자. 직원에게는 안 간다(재무 정보).
create table if not exists public.biz_alert_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('cash_runway','ar_overdue','ap_overdue','big_outflow')),
  threshold numeric not null,
  enabled boolean not null default true,
  last_fired_on date,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, kind)
);
alter table public.biz_alert_rules enable row level security;
drop policy if exists company_isolation on public.biz_alert_rules;
create policy company_isolation on public.biz_alert_rules for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.biz_alert_rules;
create policy advisor_ro_ins on public.biz_alert_rules for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.biz_alert_rules;
create policy advisor_ro_upd on public.biz_alert_rules for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.biz_alert_rules;
create policy advisor_ro_del on public.biz_alert_rules for delete to authenticated using (not (select public.is_advisor_session()));

create or replace function public.run_biz_alerts_for(p_company uuid, p_today date)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_bal numeric; v_fixed numeric; v_cnt int; v_amt numeric; v_title text; v_msg text; v_link text; v_fire boolean;
begin
  for r in select * from biz_alert_rules where company_id = p_company and enabled and (last_fired_on is null or last_fired_on < p_today) loop
    v_fire := false; v_title := null; v_msg := null; v_link := null;
    if r.kind = 'cash_runway' then
      select coalesce(sum(balance), 0) into v_bal from bank_accounts where company_id = p_company and coalesce(is_hidden, false) = false;
      select coalesce((select sum(amount) from recurring_payments where company_id = p_company and is_active and coalesce(frequency, 'monthly') = 'monthly'), 0)
           + coalesce((select sum(amount) from fixed_costs where company_id = p_company and coalesce(is_recurring, true) and (end_date is null or end_date >= p_today)), 0) into v_fixed;
      if v_fixed > 0 and v_bal < v_fixed * r.threshold then
        v_fire := true; v_title := format('현금 잔액이 고정비 %s개월치 아래입니다', r.threshold);
        v_msg := format('통장 잔액 ₩%s · 월 고정비 ₩%s → 약 %s개월치. 자금 전망을 확인하세요.', to_char(v_bal, 'FM999,999,999,999'), to_char(v_fixed, 'FM999,999,999,999'), round(v_bal / v_fixed, 1));
        v_link := '/reports/outlook';
      end if;
    elsif r.kind in ('ar_overdue', 'ap_overdue') then
      select count(*), coalesce(sum(total_amount - coalesce(settled_amount, 0)), 0) into v_cnt, v_amt
        from tax_invoices where company_id = p_company and type = case when r.kind = 'ar_overdue' then 'sales' else 'purchase' end
         and status <> 'void' and journal_entry_id is not null and (total_amount - coalesce(settled_amount, 0)) > 1
         and issue_date = p_today - r.threshold::int;
      if v_cnt > 0 then
        v_fire := true;
        v_title := format('%s %s일 초과 %s건 새로 발생', case when r.kind = 'ar_overdue' then '미수금' else '미지급금' end, r.threshold::int, v_cnt);
        v_msg := format('오늘로 발행 %s일을 넘긴 %s 계산서 %s건 · ₩%s. 거래처 원장 연령표에서 확인하세요.', r.threshold::int, case when r.kind = 'ar_overdue' then '매출' else '매입' end, v_cnt, to_char(v_amt, 'FM999,999,999,999'));
        v_link := case when r.kind = 'ar_overdue' then '/partners/ledger?type=sales' else '/partners/ledger?type=purchase' end;
      end if;
    elsif r.kind = 'big_outflow' then
      select count(*), coalesce(sum(abs(amount)), 0) into v_cnt, v_amt from bank_transactions
       where company_id = p_company and type = 'expense' and transaction_date = p_today - 1 and abs(amount) >= r.threshold and ledger_excluded_reason is null;
      if v_cnt > 0 then
        v_fire := true; v_title := format('어제 ₩%s 이상 출금 %s건', to_char(r.threshold, 'FM999,999,999,999'), v_cnt);
        v_msg := format('합계 ₩%s. 통장 › 거래내역에서 어떤 건인지 확인하세요.', to_char(v_amt, 'FM999,999,999,999'));
        v_link := '/bank?tab=transactions';
      end if;
    end if;
    if v_fire then
      insert into notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, created_at, link)
      select p_company, u.id, 'system', v_title, v_msg, 'biz_alert', r.id, false, now(), v_link
        from users u where u.company_id = p_company and u.role in ('owner', 'admin');
      update biz_alert_rules set last_fired_on = p_today where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.run_biz_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  for c in select distinct company_id from biz_alert_rules where enabled loop
    begin n := n + public.run_biz_alerts_for(c.company_id, v_today); exception when others then null; end;
  end loop;
  return n;
end $$;
create or replace function public.run_my_biz_alerts()
returns int language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.run_biz_alerts_for(public.get_my_company_id(), (now() at time zone 'Asia/Seoul')::date);
end $$;
revoke all on function public.run_biz_alerts_for(uuid, date) from public, anon, authenticated;
revoke all on function public.run_biz_alerts() from public, anon, authenticated;
grant execute on function public.run_my_biz_alerts() to authenticated;
select cron.schedule('biz-alerts-morning', '0 23 * * *', $$select public.run_biz_alerts()$$);
