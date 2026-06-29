-- 회사 양식 PDF 오버레이 — 양식 템플릿 마스터 (2026-06-29)
--   회사가 올린 견적/계약 PDF를 배경으로 보존하고 동적 필드만 좌표에 오버레이.
--   신규 테이블만 추가(기존 불변 → 회귀 0). 회사스코프 RLS + 회사·doc_type당 활성 1개.

create table if not exists public.pdf_form_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  doc_type    text not null check (doc_type in ('quote','contract')),
  file_path   text not null,                 -- form-templates 버킷 경로: {company_id}/{template_id}.pdf
  page_count  int  not null default 1,
  page_sizes  jsonb,                          -- [{w,h}(pt)] 페이지별
  fields      jsonb not null default '[]'::jsonb,  -- [{key,label,page,x,y,w,h(0~1),align,font_size,kind}]
  is_active   boolean not null default false,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_pdf_form_templates_company on public.pdf_form_templates (company_id, doc_type);
-- 회사·doc_type 당 활성 양식 1개만
create unique index if not exists uq_pdf_form_templates_active
  on public.pdf_form_templates (company_id, doc_type) where is_active;

alter table public.pdf_form_templates enable row level security;
drop policy if exists pdf_form_templates_company on public.pdf_form_templates;
create policy pdf_form_templates_company on public.pdf_form_templates
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 스토리지 버킷 (private) + 회사 폴더 격리 정책 (경로 첫 세그먼트 = company_id)
insert into storage.buckets (id, name, public)
  values ('form-templates', 'form-templates', false)
  on conflict (id) do nothing;
drop policy if exists form_templates_company on storage.objects;
create policy form_templates_company on storage.objects
  for all
  using (bucket_id = 'form-templates' and (storage.foldername(name))[1] = public.get_my_company_id()::text)
  with check (bucket_id = 'form-templates' and (storage.foldername(name))[1] = public.get_my_company_id()::text);
