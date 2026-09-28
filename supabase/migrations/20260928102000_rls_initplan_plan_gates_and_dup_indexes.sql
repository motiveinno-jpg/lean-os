begin;
--   요금제 게이트·서비스 롤 정책이 current_setting/함수를 행마다 다시 부르던 것을 (select …) 로 감싸 한 번만 평가한다.
--   조건 자체는 그대로다.
alter policy "Plan gate: loans require pro" on public.loans
  with check ((select public.has_min_plan('pro')) or (select auth.role()) = 'service_role');
alter policy "Plan gate: tax_invoices require pro" on public.tax_invoices
  with check ((select public.has_min_plan('pro')) or (select auth.role()) = 'service_role');
alter policy "Plan gate: deals require starter" on public.deals
  with check ((select public.has_min_plan('starter')) or (select auth.role()) = 'service_role');
alter policy "Plan gate: partners require starter" on public.partners
  with check ((select public.has_min_plan('starter')) or (select auth.role()) = 'service_role');
alter policy "Plan gate: employees require starter" on public.employees
  with check ((select public.has_min_plan('starter')) or (select auth.role()) = 'service_role');
alter policy "Plan gate: signature_requests require starter" on public.signature_requests
  with check ((select public.has_min_plan('starter')) or (select auth.role()) = 'service_role');
alter policy "Service role can manage billing_events" on public.billing_events
  using ((select auth.role()) = 'service_role');
alter policy "Users can read own billing_events" on public.billing_events
  using (company_id = (select public.get_my_company_id()) or (select auth.role()) = 'service_role');
alter policy "Service role can insert sync logs" on public.sync_logs
  with check ((select auth.uid()) is not null);
alter policy "Service role manages automation_logs" on public.automation_logs
  using (((select auth.jwt()) ->> 'role') = 'service_role');

--   같은 열에 같은 인덱스가 두 벌 — 쓰기마다 두 번 갱신된다. 하나만 남긴다.
drop index if exists public.idx_document_files_company;
drop index if exists public.idx_document_files_document;
drop index if exists public.idx_documents_auto_type;
drop index if exists public.idx_documents_partner;
drop index if exists public.idx_emp_contracts_emp;
drop index if exists public.idx_salary_history_emp;
commit;
