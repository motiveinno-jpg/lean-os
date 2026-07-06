-- 2026-07-06 보안 하드닝 — SECURITY DEFINER 함수 search_path 고정 (프로덕션 Management API 선적용, 재현용).
--   advisor: function_search_path_mutable. SECDEF 함수가 search_path 를 고정하지 않으면
--   호출 컨텍스트의 search_path 에 따라 객체 해석이 바뀔 수 있어(권한 상승 벡터) public, pg_temp 로 명시.
alter function public.fn_process_invoice_queue() set search_path = public, pg_temp;
alter function public.fn_queue_invoice_on_revenue_due() set search_path = public, pg_temp;
alter function public.get_company_plan_slug() set search_path = public, pg_temp;
alter function public.get_my_email() set search_path = public, pg_temp;
alter function public.has_min_plan(min_plan text) set search_path = public, pg_temp;
alter function public.increment_share_view_count(share_id_param uuid) set search_path = public, pg_temp;
alter function public.is_partner_user() set search_path = public, pg_temp;
alter function public.notify_share_feedback() set search_path = public, pg_temp;
