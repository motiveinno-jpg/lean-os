-- 결재 양식 ↔ 기본 요청 유형 연결 (2026-08-18 사장님)
--   양식 관리에서 양식을 만들 때 '기본 유형'(경비 청구 등)을 지정하면, 새 요청에서 그 유형을 고를 때 이 양식이 나온다.
alter table public.approval_forms add column if not exists base_type text;
comment on column public.approval_forms.base_type is '이 양식이 대신하는 기본 요청 유형 (REQUEST_TYPE 키). null = 독립 양식';
create index if not exists idx_approval_forms_base_type on public.approval_forms(company_id, base_type) where is_active and base_type is not null;
