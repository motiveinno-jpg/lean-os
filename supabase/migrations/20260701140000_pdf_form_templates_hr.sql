-- HR 양식 PDF 지원 — pdf_form_templates.doc_type 에 'hr_form' 허용 (2026-07-01)
--   기존 견적/계약(quote/contract) 인프라를 인사 양식으로 확장. 데이터 불변, 제약만 완화.
--   HR 양식은 '활성 1개' 개념 없이 다중 저장(is_active=false 유지) → 기존 부분 유니크 인덱스와 무충돌.

alter table public.pdf_form_templates drop constraint if exists pdf_form_templates_doc_type_check;
alter table public.pdf_form_templates
  add constraint pdf_form_templates_doc_type_check
  check (doc_type in ('quote', 'contract', 'hr_form'));
