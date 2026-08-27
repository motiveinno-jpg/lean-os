-- 거래처 신용 등급 (2026-08-27 ERP 3순위 ②) — 입금 지연 이력으로 자동 산정. 제안일 뿐, 거래 여부는 사람이.
--   결정 78 — 지연일 = 정산 통장 거래일 − 계산서 발행일(확정 정산). 미정산 계산서는 오늘 기준 경과일.
--   결정 79 — 등급: A 평균 지연 ≤30일·90일 초과 미수 없음 / B ≤45 / C ≤60 또는 60일 초과 미수 있음 / D 평균 >60 또는 90일 초과 미수 있음. 이력 0건이면 null(판단 불가).
--   결정 80 — 함수(security invoker) — 표를 두지 않는다. 정산·계산서가 바뀌면 바로 반영, RLS 는 원본 표 것을 그대로 탄다.
create or replace function public.get_partner_credit(p_company uuid default null)
returns table(partner_id uuid, settled_n int, avg_delay numeric, max_delay int, late_ratio numeric, open_amt numeric, open_over60 numeric, open_over90 numeric, oldest_open_days int, grade text)
language sql stable security invoker as $$
  with c as (select coalesce(p_company, public.get_my_company_id()) id),
  st as (
    select i.partner_id, (coalesce(b.transaction_date, s.created_at::date) - i.issue_date) as delay
      from invoice_settlements s join tax_invoices i on i.id = s.tax_invoice_id left join bank_transactions b on b.id = s.bank_transaction_id
     where s.company_id = (select id from c) and s.status = 'confirmed' and s.match_type <> 'adjustment' and i.type = 'sales' and i.partner_id is not null
  ),
  agg as (select partner_id, count(*)::int n, round(avg(delay), 1) avg_d, max(delay)::int max_d, round(avg(case when delay > 30 then 1 else 0 end), 2) late from st group by partner_id),
  op as (
    select partner_id,
           sum(total_amount - coalesce(settled_amount, 0)) amt,
           sum(case when (current_date - issue_date) > 60 then total_amount - coalesce(settled_amount, 0) else 0 end) over60,
           sum(case when (current_date - issue_date) > 90 then total_amount - coalesce(settled_amount, 0) else 0 end) over90,
           max(current_date - issue_date)::int oldest
      from tax_invoices where company_id = (select id from c) and type = 'sales' and status <> 'void' and journal_entry_id is not null and partner_id is not null
       and (total_amount - coalesce(settled_amount, 0)) > 1 group by partner_id
  ),
  u as (select partner_id from agg union select partner_id from op)
  select u.partner_id, coalesce(a.n, 0), a.avg_d, a.max_d, a.late, coalesce(o.amt, 0), coalesce(o.over60, 0), coalesce(o.over90, 0), o.oldest,
         case
           when coalesce(a.n, 0) = 0 and coalesce(o.amt, 0) <= 0 then null
           when coalesce(o.over90, 0) > 0 or coalesce(a.avg_d, 0) > 60 then 'D'
           when coalesce(o.over60, 0) > 0 or coalesce(a.avg_d, 0) > 45 then 'C'
           when coalesce(a.avg_d, 0) > 30 then 'B'
           when coalesce(a.n, 0) = 0 then 'B'
           else 'A'
         end
    from u left join agg a on a.partner_id = u.partner_id left join op o on o.partner_id = u.partner_id
$$;
grant execute on function public.get_partner_credit(uuid) to authenticated;
