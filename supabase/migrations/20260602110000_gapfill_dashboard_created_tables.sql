-- 갭필: 대시보드/MCP로만 만들어져 마이그레이션 이력이 없던 테이블 4개 (2026-07-30 로컬 환경 구축 중 발견)
--   partner_aliases · invoice_settlements · document_files · document_folders
--   prod 실스키마(컬럼·제약·RLS)를 그대로 옮김. 전부 IF NOT EXISTS — prod 에선 no-op.
--   타임스탬프는 최초 참조(20260602120000_delete_document_rpc) 직전으로 배치해 빈 DB 부트스트랩 순서를 보장.
--   이후 마이그레이션의 alter(예: 20260611170000 adjustment_reason)는 add column if not exists 라 충돌 없음.

create table if not exists public.document_folders (
  id uuid default gen_random_uuid() not null primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  parent_id uuid references public.document_folders(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.document_files (
  id uuid default gen_random_uuid() not null primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  deal_id uuid,
  vault_doc_id uuid,
  folder_id uuid references public.document_folders(id) on delete set null,
  file_name text not null,
  file_url text not null,
  file_size bigint default 0,
  mime_type text,
  storage_path text,
  bucket text default 'document-files',
  category text,
  tags text[] default '{}',
  version integer default 1,
  parent_file_id uuid references public.document_files(id) on delete set null,
  uploaded_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.partner_aliases (
  id uuid default gen_random_uuid() not null primary key,
  company_id uuid not null,
  partner_id uuid not null references public.partners(id) on delete cascade,
  alias text not null,
  source text default 'manual' not null check (source in ('rule','ai','manual')),
  confidence numeric,
  match_count integer default 0 not null,
  created_at timestamptz default now() not null
);

create table if not exists public.invoice_settlements (
  id uuid default gen_random_uuid() not null primary key,
  company_id uuid not null,
  bank_transaction_id uuid references public.bank_transactions(id) on delete cascade,
  tax_invoice_id uuid not null references public.tax_invoices(id) on delete cascade,
  amount numeric not null,
  match_type text default 'one_to_one' not null,
  match_source text default 'rule' not null,
  status text default 'suggested' not null check (status in ('suggested','confirmed','rejected','needs_review')),
  confidence numeric,
  reason text,
  created_by uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- RLS — prod 와 동일 (회사 격리)
alter table public.document_folders enable row level security;
alter table public.document_files enable row level security;
alter table public.partner_aliases enable row level security;
alter table public.invoice_settlements enable row level security;

do $gap$ begin
  if not exists (select 1 from pg_policies where tablename='document_folders' and policyname='document_folders_company') then
    create policy document_folders_company on public.document_folders for all
      using (company_id = (select get_my_company_id()));
  end if;
  if not exists (select 1 from pg_policies where tablename='document_files' and policyname='document_files_company') then
    create policy document_files_company on public.document_files for all
      using (company_id = (select get_my_company_id()));
  end if;
  if not exists (select 1 from pg_policies where tablename='partner_aliases' and policyname='partner_aliases_company_access') then
    create policy partner_aliases_company_access on public.partner_aliases for all
      using (company_id = (select get_my_company_id()))
      with check (company_id = (select get_my_company_id()));
  end if;
  if not exists (select 1 from pg_policies where tablename='invoice_settlements' and policyname='invoice_settlements_company_access') then
    create policy invoice_settlements_company_access on public.invoice_settlements for all
      using (company_id = (select get_my_company_id()))
      with check (company_id = (select get_my_company_id()));
  end if;
end $gap$;

-- 컬럼 갭필 — 정산 컬럼들도 대시보드에서 추가돼 이력이 없었다(로컬 부트스트랩 시 함수/인덱스 검증 실패).
alter table public.tax_invoices add column if not exists settled_amount numeric default 0 not null;
alter table public.tax_invoices add column if not exists settlement_status text default 'open' not null;
alter table public.bank_transactions add column if not exists settled_amount numeric default 0 not null;
alter table public.bank_transactions add column if not exists settlement_status text default 'open' not null;
