-- 스냅샷의 '이번 달 매출' 이 수정세금계산서를 정상 발행분과 섞어 세던 것 분리 (2026-08-07)
--
-- 증상: 2026-08 브리핑에 "세금계산서 3건 / 매출 -374원" 이 떴다. 계산은 틀리지 않았지만,
--   그 3건은 전부 7/29 발행분을 8/3 에 중복(duplicate) 사유로 취소한 수정세금계산서였다.
--   정상 발행은 0건인데 '발행 3건' 으로 보이고, 매출이 음수로 나와 읽는 사람이 오해한다.
--
-- 수정: 발행 건수·금액을 정상 발행분(original_invoice_id is null)과
--   수정·취소분(original_invoice_id 있음)으로 나눠서 함께 준다. 순액(net)은 그대로 유지.
--   최근 12개월 매출도 같은 이유로 정상/수정 분리 값을 함께 담는다.
--
-- ⚠️ 이 파일은 '운영에 배포돼 있던 정의' 를 그대로 옮긴 뒤 위 집계만 바꾼 것이다.
--   (레포의 20260722220000 버전은 company·revenue_last_12m 이 없는 구버전이라 그걸 기준으로
--    재정의하면 기능이 사라진다. DB 함수는 git 이 충돌을 알려주지 않으므로 반드시 현재
--    정의를 읽고 그 위에 얹을 것.)

create or replace function public.copilot_company_snapshot(p_company_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  now_ts timestamptz := now();
  month_start date := (date_trunc('month', (now() at time zone 'Asia/Seoul')))::date;
  v_cash numeric := 0;
  v_income numeric := 0;
  v_expense numeric := 0;
  v_ar numeric := 0;
  v_headcount int := 0;
  v_pending_approvals int := 0;
  v_pending_payments int := 0;
  v_deals_active int := 0;
  v_deals_pending int := 0;
  v_contracts_pending int := 0;
  v_inv_cnt int := 0;
  v_inv_amt numeric := 0;
  v_inv_mod_cnt int := 0;
  v_inv_mod_amt numeric := 0;
  v_co record;
  v_first_activity date;
  v_rev12 jsonb;
  v_rev12_total numeric := 0;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.users where auth_id = auth.uid() and company_id = p_company_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(sum(balance), 0) into v_cash
    from public.bank_accounts where company_id = p_company_id;

  select coalesce(sum(amount) filter (where type = 'income'), 0),
         coalesce(sum(amount) filter (where type = 'expense'), 0)
    into v_income, v_expense
    from public.bank_transactions
   where company_id = p_company_id and transaction_date >= month_start;

  select coalesce(sum(greatest(total_amount - coalesce(settled_amount, 0), 0)), 0) into v_ar
    from public.tax_invoices
   where company_id = p_company_id and type = 'sales' and status <> 'cancelled';

  select count(*) into v_headcount
    from public.employees where company_id = p_company_id and status in ('active', 'joined');

  select count(*) into v_pending_approvals
    from public.approval_requests where company_id = p_company_id and status = 'pending';

  select count(*) into v_pending_payments
    from public.payment_queue where company_id = p_company_id and status = 'pending';

  select count(*) filter (where status = 'active'),
         count(*) filter (where status = 'pending')
    into v_deals_active, v_deals_pending
    from public.deals where company_id = p_company_id;

  select count(*) into v_contracts_pending
    from public.signature_requests
   where company_id = p_company_id and status in ('sent', 'viewed')
     and created_at > now() - interval '30 days';

  -- 정상 발행분과 수정·취소분을 분리해서 센다.
  select count(*) filter (where original_invoice_id is null),
         coalesce(sum(total_amount) filter (where original_invoice_id is null), 0),
         count(*) filter (where original_invoice_id is not null),
         coalesce(sum(total_amount) filter (where original_invoice_id is not null), 0)
    into v_inv_cnt, v_inv_amt, v_inv_mod_cnt, v_inv_mod_amt
    from public.tax_invoices
   where company_id = p_company_id and type = 'sales' and status <> 'cancelled'
     and issue_date >= month_start;

  -- 회사 프로필 — 추천·비교 질문의 근거값
  select name, business_number, industry, business_type, address, created_at
    into v_co from public.companies where id = p_company_id;

  -- 설립 시기 추정: 가장 이른 실제 활동(세금계산서 발행/수신) — 없으면 계정 생성일
  select min(issue_date) into v_first_activity
    from public.tax_invoices where company_id = p_company_id;

  -- 최근 12개월 매출(세금계산서 발행일 기준) — 규모·성장 판단용
  select coalesce(jsonb_agg(jsonb_build_object(
           'month', m, 'amount', amt, 'issued_amount', issued_amt, 'modification_amount', mod_amt
         ) order by m), '[]'::jsonb),
         coalesce(sum(amt), 0)
    into v_rev12, v_rev12_total
  from (
    select to_char(issue_date, 'YYYY-MM') as m,
           sum(total_amount) as amt,
           coalesce(sum(total_amount) filter (where original_invoice_id is null), 0) as issued_amt,
           coalesce(sum(total_amount) filter (where original_invoice_id is not null), 0) as mod_amt
      from public.tax_invoices
     where company_id = p_company_id and type = 'sales' and status <> 'cancelled'
       and issue_date >= (month_start - interval '11 months')
     group by 1
  ) t;

  return jsonb_build_object(
    'as_of_kst', to_char(now_ts at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    'month', to_char(month_start, 'YYYY-MM'),
    -- 회사가 어떤 곳인지 (추천·비교 질문에서 이 값만 근거로 쓸 것)
    'company', jsonb_build_object(
      'name', v_co.name,
      'business_number', v_co.business_number,
      'industry', v_co.industry,
      'business_type', v_co.business_type,
      'address', v_co.address,
      'headcount', v_headcount,
      'first_activity_date', v_first_activity,
      'account_created_at', to_char(v_co.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
      'note', '업종·업태·주소가 비어 있으면 회사 설정에 입력되지 않은 것 — 비어 있으면 추측하지 말 것'
    ),
    'cash', jsonb_build_object('bank_balance', v_cash),
    'this_month', jsonb_build_object(
      'bank_income', v_income, 'bank_expense', v_expense, 'bank_net', v_income - v_expense,
      'sales_invoice_count', v_inv_cnt, 'sales_invoice_amount', v_inv_amt,
      'sales_invoice_modification_count', v_inv_mod_cnt,
      'sales_invoice_modification_amount', v_inv_mod_amt,
      'sales_invoice_net_amount', v_inv_amt + v_inv_mod_amt,
      'note', '입출금은 통장(CODEF) 기준, 매출은 세금계산서 발행일 기준. '
              || 'sales_invoice_count/amount 는 정상 발행분만이고, modification_* 은 '
              || '수정·취소 세금계산서(금액 음수)다. 발행 건수를 물으면 정상 발행분으로 답하고, '
              || 'net 이 음수면 그 달에 취소분만 있었다는 뜻이니 그대로 설명할 것'
    ),
    'revenue_last_12m', jsonb_build_object(
      'by_month', v_rev12, 'total', v_rev12_total,
      'note', '매출 세금계산서 발행일 기준 합계 — 발행하지 않은 매출은 빠져 있다. '
              || 'amount 는 순액이고 issued_amount(정상 발행)·modification_amount(수정·취소) 로 나뉜다'
    ),
    'receivables', jsonb_build_object('tax_invoice_outstanding', v_ar),
    'people', jsonb_build_object('headcount', v_headcount),
    'todo', jsonb_build_object(
      'pending_approvals', v_pending_approvals,
      'pending_payments', v_pending_payments,
      'contracts_awaiting_signature_30d', v_contracts_pending
    ),
    'sales', jsonb_build_object('deals_active', v_deals_active, 'deals_pending', v_deals_pending),
    'tax', jsonb_build_object(
      'invoices_issued_this_month', v_inv_cnt,
      'invoice_modifications_this_month', v_inv_mod_cnt
    )
  );
end;
$function$;

revoke execute on function public.copilot_company_snapshot(uuid) from anon;
grant execute on function public.copilot_company_snapshot(uuid) to authenticated;
