-- 결재 양식 빌더 (2026-07-01, 플렉스식 커스텀 결재 양식)
--   회사가 직접 결재 양식(이름·분류·커스텀 필드·내용 템플릿·결재선 단계)을 만들어 새 요청에서 선택.
--   approval_requests 에 form_id + custom_fields 추가로 커스텀 필드 값 저장.

create table if not exists public.approval_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  -- 커스텀 필드: [{ key, label, type('text'|'number'|'date'|'select'|'textarea'), required, options[] }]
  fields jsonb not null default '[]'::jsonb,
  content_template text,
  -- 결재선 단계: [{ stage, name, approver_type('role'|'user'), approver_role, approver_user_ids[], required_count }]
  stages jsonb not null default '[]'::jsonb,
  allow_requester_edit boolean not null default true,
  use_attachment boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_approval_forms_company on public.approval_forms(company_id) where is_active;

alter table public.approval_forms enable row level security;

drop policy if exists approval_forms_select on public.approval_forms;
create policy approval_forms_select on public.approval_forms
  for select using (company_id = public.get_my_company_id());

drop policy if exists approval_forms_write on public.approval_forms;
create policy approval_forms_write on public.approval_forms
  for all
  using (company_id = public.get_my_company_id() and public.is_company_admin())
  with check (company_id = public.get_my_company_id() and public.is_company_admin());

alter table public.approval_requests add column if not exists form_id uuid references public.approval_forms(id) on delete set null;
alter table public.approval_requests add column if not exists custom_fields jsonb not null default '{}'::jsonb;
