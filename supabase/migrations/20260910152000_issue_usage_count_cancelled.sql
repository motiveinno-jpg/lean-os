-- 현금영수증 월 발행 한도: 발행 뒤 취소한 건도 한 번 발행한 것이다 — 취소를 빼면 발행→취소 반복으로 한도를 무제한 넘길 수 있었다.
begin;
CREATE OR REPLACE FUNCTION public.get_monthly_issue_usage(p_company_id uuid)
 RETURNS TABLE(tax_count integer, cash_count integer, total_count integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH m AS (
    SELECT (to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') || '-01')::date AS month_start
  ),
  t AS (
    SELECT count(*)::int AS c FROM public.tax_invoices ti, m
     WHERE ti.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND ti.nts_issue_status = 'issued'
       AND ti.nts_issued_at >= (m.month_start::text || 'T00:00:00+09:00')::timestamptz
  ),
  c AS (
    SELECT count(*)::int AS c FROM public.cash_receipts cr, m
     WHERE cr.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND cr.source = 'codef'
       AND cr.status <> 'void'
       AND cr.issue_date >= m.month_start
  )
  SELECT t.c, c.c, (t.c + c.c) FROM t, c;
$function$;
commit;
