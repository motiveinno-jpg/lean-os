-- Add JSONB columns used by EmployeeDetailPanel (onboarding_docs, admin_notes, employment_history)
-- Nullable, no default. Code falls back null -> {} / [].
-- RLS unchanged: existing employees row policies cover these columns.
alter table public.employees
  add column if not exists onboarding_docs jsonb,
  add column if not exists admin_notes jsonb,
  add column if not exists employment_history jsonb;
