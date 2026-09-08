-- 전자계약 양식 관리에 '개인 양식' — 만든 사람에게만 보이는 양식 (2026-09-08).
--   회사 공용 양식(is_personal=false)은 종전대로 회사 전체가 본다.
--   개인 양식(is_personal=true)은 만든 사람(created_by = users.id)만 조회·수정·삭제한다.

alter table public.contract_templates
  add column if not exists is_personal boolean not null default false;

create index if not exists idx_contract_templates_personal
  on public.contract_templates (company_id, created_by)
  where is_personal;

-- 조회 격리: 기존 SELECT 정책들이 '같은 회사면 다 보임'이라 개인 양식이 회사원 전체에게 새는 것을
--   RESTRICTIVE 정책으로 한 겹 덧대 막는다(모든 SELECT 정책과 AND 로 결합).
--   개인 양식은 본인만, 그 외(회사 공용·표준)는 종전 그대로. 기존 행은 is_personal=false 라 영향 없음.
drop policy if exists contract_templates_personal_private on public.contract_templates;
create policy contract_templates_personal_private on public.contract_templates
  as restrictive for select
  using (is_personal = false or created_by = public.current_app_user_id());

-- 개인 양식은 관리자 권한 없이 본인이 직접 만들고 관리한다.
--   (회사 공용 양식은 종전 admin/has_perm 정책 그대로 — 아래 정책들은 permissive OR 로 더해진다)
drop policy if exists contract_templates_personal_insert on public.contract_templates;
create policy contract_templates_personal_insert on public.contract_templates
  for insert with check (
    is_personal = true and is_system = false
    and company_id = public.get_my_company_id()
    and created_by = public.current_app_user_id());

drop policy if exists contract_templates_personal_update on public.contract_templates;
create policy contract_templates_personal_update on public.contract_templates
  for update
  using (is_personal = true and created_by = public.current_app_user_id())
  with check (is_personal = true and created_by = public.current_app_user_id()
    and company_id = public.get_my_company_id());

drop policy if exists contract_templates_personal_delete on public.contract_templates;
create policy contract_templates_personal_delete on public.contract_templates
  for delete
  using (is_personal = true and created_by = public.current_app_user_id());
