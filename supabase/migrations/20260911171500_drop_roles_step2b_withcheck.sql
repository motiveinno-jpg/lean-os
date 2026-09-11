-- 2단계 보완 — alter policy 에 using 만 주면 with check 는 옛 식이 남는다 (2026-09-11).
begin;
alter policy leave_grants_update on public.leave_grants
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/employees:leave'))
              or (select public.has_perm('/employees:employees'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/employees:leave'))
              or (select public.has_perm('/employees:employees'))));
alter policy company_profile_ext_update on public.company_profile_ext
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:company-info'))
              or (select public.has_perm('/support-programs'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:company-info'))
              or (select public.has_perm('/support-programs'))));
commit;
