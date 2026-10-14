-- 연말정산 보안 보강 (2026-10-14, 보안 검토 BLOCK 1건)
--   current_employee_id() 는 회사를 가리지 않는다 → 옛 회사 직원 행이 남은 사람이 새 회사 담당자가 되면 옛 회사 행을
--   '본인 행'으로 열고 담당자 규칙으로 확정까지 할 수 있었다. 본인 행도 지금 회사 것만 + 가드에서 UPDATE 회사 확인.
--   함께: 직원이 다시 제출하면 지난 반려 사유를 지운다.

drop policy if exists year_end_settlements_select on public.year_end_settlements;
create policy year_end_settlements_select on public.year_end_settlements
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and (employee_id = (select public.current_employee_id())
         or (select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  );

drop policy if exists year_end_settlements_insert on public.year_end_settlements;
create policy year_end_settlements_insert on public.year_end_settlements
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and (employee_id = (select public.current_employee_id())
         or (select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  );

drop policy if exists year_end_settlements_update on public.year_end_settlements;
create policy year_end_settlements_update on public.year_end_settlements
  for update to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and (employee_id = (select public.current_employee_id())
         or (select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and (employee_id = (select public.current_employee_id())
         or (select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  );

create or replace function public.year_end_settlements_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_sys boolean := auth.uid() is null;   -- 서비스 키·DB 직접(크론 등) — 사람 규칙을 적용하지 않는다
        v_hr boolean; v_emp_co uuid; v_keep_by uuid;
begin
  if tg_op = 'INSERT' and not v_sys and new.company_id is distinct from public.get_my_company_id() then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    -- 다른 회사 행 금지(보안 검토 2026-10-14): 담당자 판정이 '지금 회사' 기준이라, 옛 회사 행까지 담당자로 고치는 길을 막는다
    if not v_sys and old.company_id is distinct from public.get_my_company_id() then
      raise exception '권한이 없습니다' using errcode = '42501';
    end if;
    new.company_id := old.company_id;
    new.employee_id := old.employee_id;
    new.year := old.year;
    new.created_at := old.created_at;
    -- 확정자 칸: 사용자 행이 지워져 FK 가 NULL 로 내리는 경우만 따른다(그 밖엔 old 로 되돌린다 — 무조건 되돌리면 사용자 삭제가 실패한다)
    v_keep_by := case when new.confirmed_by is null and old.confirmed_by is not null
                           and not exists (select 1 from public.users u where u.id = old.confirmed_by)
                      then null else old.confirmed_by end;
  else
    select e.company_id into v_emp_co from public.employees e where e.id = new.employee_id;
    if v_emp_co is distinct from new.company_id then raise exception '같은 회사 직원이 아닙니다' using errcode = '42501'; end if;
    new.created_at := now();
  end if;

  v_hr := v_sys or public.is_company_admin() or public.has_perm('/employees:salary');

  if not v_hr then
    if new.employee_id is distinct from public.current_employee_id() then
      raise exception '본인 연말정산만 고칠 수 있습니다' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status = 'confirmed' then
      raise exception '확정된 연말정산은 고칠 수 없습니다 — 담당자에게 확정 취소를 요청하세요' using errcode = '42501';
    end if;
    if new.status not in ('draft', 'submitted') then
      raise exception '작성·제출만 할 수 있습니다' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.payroll := '{}'::jsonb; new.result := '{}'::jsonb; new.return_reason := null;
      new.confirmed_by := null; new.confirmed_at := null;
    else
      new.payroll := old.payroll; new.result := old.result;
      -- 다시 제출하면 지난 반려 사유는 지운다(직원 화면에 옛 사유가 남지 않게)
      new.return_reason := case when new.status = 'submitted' then null else old.return_reason end;
      new.confirmed_by := v_keep_by; new.confirmed_at := old.confirmed_at;
    end if;
  else
    if new.status = 'confirmed' then
      if tg_op = 'INSERT' or old.status is distinct from 'confirmed' then
        new.confirmed_by := public.current_app_user_id();
        new.confirmed_at := now();
      else
        new.confirmed_by := v_keep_by;
        new.confirmed_at := old.confirmed_at;
      end if;
    else
      new.confirmed_by := null;
      new.confirmed_at := null;
    end if;
  end if;

  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    new.submitted_at := now();
  elsif tg_op = 'UPDATE' then
    new.submitted_at := old.submitted_at;
  else
    new.submitted_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.year_end_settlements_guard() from public, anon, authenticated;
