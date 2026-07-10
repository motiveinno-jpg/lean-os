-- 세금계산서 과세유형 (2026-07-10 직원 QA 그랜터) — 과세/영세율/면세 선택.
--   taxable(과세, 기본) / zero_rated(영세율, 세액 0) / exempt(면세, 세액 0 — 계산서).
--   문서 제목: 과세=전자세금계산서, 영세율=영세율전자세금계산서, 면세=전자계산서.
alter table public.tax_invoices add column if not exists tax_kind text not null default 'taxable';
