-- 견적서 → 계약서 자동생성 링크 (2026-07-01, projecthub 수익형 양방향 흐름 Phase 1)
--   계약 documents 가 어느 견적 documents 에서 파생됐는지 역참조. 신규 컬럼 1개(회귀 0).
--   방향(매출/매입)은 기존 sub_deal_id 로 판정 — 추가 컬럼 불필요.
alter table public.documents
  add column if not exists source_document_id uuid references public.documents(id) on delete set null;

create index if not exists idx_documents_source_document_id
  on public.documents(source_document_id) where source_document_id is not null;
