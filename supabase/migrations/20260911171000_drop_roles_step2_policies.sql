-- 역할을 완전히 없앤다 — 2단계: 정책 19개를 마스터 + 권한으로 (2026-09-11 사장님).
--   각 표의 성격에 맞는 권한 키를 쓴다. 권한 그룹(권한을 나눠 주는 화면)만 마스터로 둔다.
begin;

--   회사 프로필 부가정보 (지원사업 신청서에 들어가는 회사 정보)
alter policy company_profile_ext_read on public.company_profile_ext
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:company-info'))
              or (select public.has_perm('/support-programs'))));
alter policy company_profile_ext_write on public.company_profile_ext
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:company-info'))
              or (select public.has_perm('/support-programs'))));
alter policy company_profile_ext_update on public.company_profile_ext
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:company-info'))
              or (select public.has_perm('/support-programs'))));

--   지원사업 담아 두기
alter policy gov_program_saved_read on public.gov_program_saved
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/support-programs'))));
alter policy gov_program_saved_write on public.gov_program_saved
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/support-programs'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/support-programs'))));

--   청구서
alter policy "System can manage invoices" on public.invoices
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/billing'))));

--   휴가 부여
alter policy leave_grants_insert on public.leave_grants
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/employees:leave'))
              or (select public.has_perm('/employees:employees'))));
alter policy leave_grants_update on public.leave_grants
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/employees:leave'))
              or (select public.has_perm('/employees:employees'))));
alter policy leave_grants_delete on public.leave_grants
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/employees:leave'))
              or (select public.has_perm('/employees:employees'))));

--   권한 그룹 — 권한을 나눠 주는 화면이라 마스터만
alter policy pg_insert on public.permission_groups
  with check (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()));
alter policy pg_update on public.permission_groups
  using (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()));
alter policy pg_delete on public.permission_groups
  using (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()));
alter policy pgm_insert on public.permission_group_members
  with check (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()));
alter policy pgm_delete on public.permission_group_members
  using (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()));
alter policy pgp_insert on public.permission_group_permissions
  with check (group_id in (select id from public.permission_groups
                            where company_id = (select public.get_my_company_id()))
              and (select public.is_company_manager()));
alter policy pgp_delete on public.permission_group_permissions
  using (group_id in (select id from public.permission_groups
                       where company_id = (select public.get_my_company_id()))
         and (select public.is_company_manager()));

--   구독·결제
alter policy "Owners can insert subscription" on public.subscriptions
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/billing'))));
alter policy "Owners can manage subscription" on public.subscriptions
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/billing'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/billing'))));

--   전표 계정 규칙 삭제
alter policy "delete own company voucher rules" on public.voucher_account_rules
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.can_write_ledger())));

commit;
