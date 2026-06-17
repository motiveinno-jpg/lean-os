-- 카드 수동 전표처리 + 회사별 category→계정 매핑 (2026-06-17 A1)
--   회사마다 카드 처리 계정이 달라 per-company 매핑. 자동 기장이 아니라 내역을 남기고
--   사용자가 매핑(기본 계정)을 보고 수동으로 전표 생성. 매핑은 처리하며 학습(remember).
--   함수 본문 ASCII (한글 인코딩 손상 방지).

-- 1) 회사별 카드 category -> 계정과목 매핑
create table if not exists public.card_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null,
  account_id uuid not null references public.chart_of_accounts(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (company_id, category)
);
alter table public.card_account_mappings enable row level security;
drop policy if exists card_account_mappings_rw on public.card_account_mappings;
create policy card_account_mappings_rw on public.card_account_mappings
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 2) 카드거래 전표처리 연결 표시
alter table public.card_transactions
  add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;

-- 3) 카드 1건 -> 수동 전표 생성 (차)지정계정 / 대)보통예금), deal_id 승계, 매핑 학습(옵션)
create or replace function public.post_card_voucher(p_card_tx_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_card record;
  v_cash uuid;
  v_entry uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not public.is_company_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_card from card_transactions where id = p_card_tx_id and company_id = v_company;
  if v_card.id is null then raise exception 'NOT_FOUND'; end if;
  if v_card.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  if v_card.amount is null or v_card.amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then
    raise exception 'INVALID_ACCOUNT';
  end if;
  select id into v_cash from chart_of_accounts where company_id = v_company and code = '101';
  if v_cash is null then raise exception 'NO_CASH_ACCOUNT'; end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_type, voucher_no, created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, v_card.transaction_date, coalesce(v_card.merchant_name, ''), 'manual', 'confirmed', true, v_card.deal_id,
    'cash_out',
    (select coalesce(max(voucher_no), 0) + 1 from journal_entries where company_id = v_company and entry_date = v_card.transaction_date),
    v_uid, v_uid, v_uid, now()
  ) returning id into v_entry;

  insert into journal_lines (entry_id, company_id, account_id, debit, credit, description)
  values
    (v_entry, v_company, p_account_id, v_card.amount, 0, coalesce(v_card.merchant_name, '')),
    (v_entry, v_company, v_cash, 0, v_card.amount, coalesce(v_card.merchant_name, ''));

  update card_transactions
    set journal_entry_id = v_entry, mapping_status = 'mapped', mapped_by = v_uid, mapped_at = now()
    where id = p_card_tx_id;

  if p_remember and coalesce(v_card.category, '') <> '' then
    insert into card_account_mappings (company_id, category, account_id, updated_at)
    values (v_company, v_card.category, p_account_id, now())
    on conflict (company_id, category) do update set account_id = excluded.account_id, updated_at = now();
  end if;

  return v_entry;
end;
$$;

grant execute on function public.post_card_voucher(uuid, uuid, boolean) to authenticated;
