-- AI 대표 참모(owner-copilot) — 회사 스코프 읽기전용 스냅샷 RPC.
--   LLM 에 임의 쿼리/tool 을 주지 않고, 서버가 이 고정 집계만 만들어 컨텍스트로 전달(격리·안전).
--   ⚠️ 민감정보 금지: 계좌번호·주민번호·원문 없음. 집계 수치 + 사업체명(거래처) 수준만.
--   SECURITY DEFINER + search_path 고정 + 호출자 회사 검증(IDOR 가드, service_role 은 우회).
create or replace function public.copilot_company_snapshot(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
  v_tax_issued_month int := 0;
begin
  -- IDOR 가드: 인증 사용자는 자기 회사만. service_role(auth.uid NULL)은 허용.
  if auth.uid() is not null
     and not exists (select 1 from public.users where auth_id = auth.uid() and company_id = p_company_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(sum(balance), 0) into v_cash
    from public.bank_accounts where company_id = p_company_id;

  select coalesce(sum(amount) filter (where amount > 0), 0),
         coalesce(sum(abs(amount)) filter (where amount < 0 or type = 'expense'), 0)
    into v_income, v_expense
    from public.transactions
   where company_id = p_company_id and transaction_date >= month_start;

  select coalesce(sum(total_amount), 0) into v_ar
    from public.tax_invoices
   where company_id = p_company_id and type = 'sales'
     and status in ('issued', 'unmatched', 'modified');

  select count(*) into v_headcount
    from public.employees where company_id = p_company_id and status in ('active', 'joined');

  select count(*) into v_pending_approvals
    from public.doc_approvals where company_id = p_company_id and status = 'pending';

  select count(*) into v_pending_payments
    from public.payment_queue where company_id = p_company_id and status = 'pending';

  select count(*) filter (where status = 'active'),
         count(*) filter (where status = 'pending')
    into v_deals_active, v_deals_pending
    from public.deals where company_id = p_company_id;

  select count(*) into v_contracts_pending
    from public.signature_requests
   where company_id = p_company_id and status in ('sent', 'viewed');

  select count(*) into v_tax_issued_month
    from public.tax_invoices
   where company_id = p_company_id and nts_issue_status = 'issued'
     and nts_issued_at >= (month_start::timestamptz);

  return jsonb_build_object(
    'as_of_kst', to_char(now_ts at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    'month', to_char(month_start, 'YYYY-MM'),
    'cash', jsonb_build_object('bank_balance', v_cash),
    'this_month', jsonb_build_object('income', v_income, 'expense', v_expense, 'net', v_income - v_expense),
    'receivables', jsonb_build_object('tax_invoice_outstanding', v_ar),
    'people', jsonb_build_object('headcount', v_headcount),
    'todo', jsonb_build_object(
      'pending_approvals', v_pending_approvals,
      'pending_payments', v_pending_payments,
      'contracts_awaiting_signature', v_contracts_pending
    ),
    'sales', jsonb_build_object('deals_active', v_deals_active, 'deals_pending', v_deals_pending),
    'tax', jsonb_build_object('invoices_issued_this_month', v_tax_issued_month)
  );
end;
$$;

revoke execute on function public.copilot_company_snapshot(uuid) from anon;
grant execute on function public.copilot_company_snapshot(uuid) to authenticated;
