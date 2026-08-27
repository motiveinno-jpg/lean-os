-- 퇴직금 추계 + 충당부채 전표 초안 (2026-08-27 인사 4차 G1·H3, 결정 97)
--   추계 = 평균임금(최근 3개월 발급 명세 총급여 ÷ 그 기간 일수, 없으면 약정 월급×3÷91) × 30 × 근속일/365. 1년 미만은 0(법정).
--   저장하지 않고 그때그때 계산한다(월 1 갱신보다 항상 최신). 전표는 추계 합계 − 확정 전표의 퇴직급여충당부채 잔액 **차액만**, 합계 한 줄(결정 55).
create or replace function public.estimate_retirement(p_company uuid, p_asof date default current_date, p_employee uuid default null)
returns table (employee_id uuid, name text, hire_date date, total_days int, gross3m numeric, days3m int, daily_wage numeric, estimate numeric, source text, manual numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_from date;
begin
  if p_company is null or p_company <> (select public.get_my_company_id()) then raise exception '권한 없음'; end if;
  v_from := (p_asof - interval '3 months')::date + 1;
  return query
  with emp as (
    select e.id, e.name, e.hire_date::date as hire_date, coalesce(e.salary, 0)::numeric as salary, coalesce(e.retirement_accrual, 0)::numeric as manual
      from employees e where e.company_id = p_company and (p_employee is null or e.id = p_employee)
       and (p_employee is not null or e.status in ('active','joined')) and e.hire_date is not null
  ), pay as (
    select pi.employee_id, sum(coalesce(pi.net_pay, 0) + coalesce(pi.deductions_total, 0))::numeric as gross, count(*)::int as months
      from payroll_items pi where pi.company_id = p_company and pi.status = 'issued'
       and pi.period_month >= to_char(v_from, 'YYYY-MM') and pi.period_month <= to_char(p_asof, 'YYYY-MM')
     group by pi.employee_id
  )
  select emp.id, emp.name, emp.hire_date,
         (p_asof - emp.hire_date + 1)::int as total_days,
         case when coalesce(pay.months, 0) >= 3 then pay.gross else emp.salary * 3 end as gross3m,
         (p_asof - v_from + 1)::int as days3m,
         round(case when coalesce(pay.months, 0) >= 3 then pay.gross else emp.salary * 3 end / greatest(1, (p_asof - v_from + 1)), 2) as daily_wage,
         case when (p_asof - emp.hire_date + 1) >= 365
              then round((case when coalesce(pay.months, 0) >= 3 then pay.gross else emp.salary * 3 end / greatest(1, (p_asof - v_from + 1))) * 30 * ((p_asof - emp.hire_date + 1)::numeric / 365))
              else 0 end as estimate,
         case when coalesce(pay.months, 0) >= 3 then '급여 명세 3개월' else '약정 월급' end as source,
         emp.manual
    from emp left join pay on pay.employee_id = emp.id
   order by emp.name;
end $$;
grant execute on function public.estimate_retirement(uuid, date, uuid) to authenticated;

alter table public.production_voucher_drafts drop constraint if exists production_voucher_drafts_kind_check;
alter table public.production_voucher_drafts add constraint production_voucher_drafts_kind_check
  check (kind = any (array['production'::text, 'cogs'::text, 'inventory'::text, 'payroll'::text, 'depreciation'::text, 'retirement'::text]));

create or replace function public.make_retirement_voucher_draft(p_company uuid, p_asof date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; a_exp uuid; a_liab uuid; v_est numeric := 0; v_bal numeric := 0; v_diff numeric; n int := 0; v_entry uuid; v_desc text; v_old record;
begin
  if p_company is null or p_company <> (select public.get_my_company_id()) then raise exception '권한 없음'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_exp  := public._acct_by(p_company, v_cfg, 'acct_retirement_expense', '퇴직급여');
  a_liab := public._acct_by(p_company, v_cfg, 'acct_retirement_liability', '퇴직급여충당부채');
  if a_exp is null or a_liab is null then raise exception '계정과목 매핑이 없습니다 — 퇴직급여·퇴직급여충당부채 계정을 정해 주세요'; end if;
  select coalesce(sum(r.estimate), 0), count(*) into v_est, n from public.estimate_retirement(p_company, p_asof) r;
  select coalesce(sum(l.credit - l.debit), 0) into v_bal from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_liab;
  v_diff := round(v_est - v_bal);
  if v_diff = 0 then return null; end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'retirement' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 퇴직급여충당 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'retirement' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  v_desc := format('퇴직급여충당부채 초안 %s 기준 · %s명 추계 ₩%s · 장부 ₩%s · 차액 ₩%s (개인별 금액 없음 · 확정은 사람)',
    p_asof, n, to_char(round(v_est), 'FM999,999,999,999'), to_char(round(v_bal), 'FM999,999,999,999'), to_char(v_diff, 'FM999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  if v_diff > 0 then
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_exp, v_diff, 0, '퇴직급여 (충당부채 전입)');
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_liab, 0, v_diff, '퇴직급여충당부채');
  else
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_liab, -v_diff, 0, '퇴직급여충당부채 환입');
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_exp, 0, -v_diff, '퇴직급여 (충당부채 환입)');
  end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'retirement', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', v_diff, 0, 0, v_desc);
  return v_entry;
end $$;
grant execute on function public.make_retirement_voucher_draft(uuid, date) to authenticated;
