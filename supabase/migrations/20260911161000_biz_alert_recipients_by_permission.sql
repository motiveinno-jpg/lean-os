begin;
--   경영 알림을 받는 사람 = 마스터 + 돈을 보는 권한자 (2026-09-11 사장님: 이 제품은 마스터와 멤버뿐이고 나머지는 권한).
--   종전엔 users.role in (owner, admin) 이라, 권한을 다 받은 사람이 역할이 직원이면 못 받고
--   권한이 없는 사람이 역할이 admin 이면 받았다. 본문은 그대로 두고 받는 사람 고르는 줄만 바꿨다.
CREATE OR REPLACE FUNCTION public.run_biz_alerts_for(p_company uuid, p_today date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      --   오늘 딱 N일을 넘긴 계산서 — 어제까지는 N일 미만이었으니 '새로 발생'만 알린다
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
        from users u
       where u.company_id = p_company
         and (coalesce(u.is_master, false)
              or exists (select 1 from member_permissions m where m.user_id = u.id
                          and (m.perm_key like '/bank%' or m.perm_key like '/finance%'
                               or m.perm_key like '/reports%' or m.perm_key = '/dashboard:finance')));
      update biz_alert_rules set last_fired_on = p_today where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$
;
commit;
