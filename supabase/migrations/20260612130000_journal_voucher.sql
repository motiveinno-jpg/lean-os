-- AI 전표(분개) 자동처리 — 핸드오프 ownerview-ai-voucher-handoff.md 구현 (2026-06-12).
--   조사 판정 B: 전표 테이블 부재 → §4 권장 스키마로 신설. src/lib/ledger.ts 의 기존
--   클라이언트 구조(journal_entries/journal_lines/chart_of_accounts)와 컬럼 합치.
--   원칙(§3/§5): AI/규칙은 ai_suggested 초안만 생성. confirmed 는 voucher_confirm RPC(사람 승인)로만.
--   하드 가드: 차대변 균형 / linked_settlement 중복 / 마감(locked) 월 차단 / 관리자 권한.
--   RLS: 회사격리 = get_my_company_id() 헬퍼만 (인라인 users 서브쿼리 금지 게이트 준수).
--   함수 본문은 ASCII only (한글은 주석/시드 데이터에만 — 전송 손상 게이트).

-- ── 1. 계정과목 ──
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  parent_id uuid references public.chart_of_accounts(id) on delete set null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);
alter table public.chart_of_accounts enable row level security;
drop policy if exists chart_of_accounts_company on public.chart_of_accounts;
create policy chart_of_accounts_company on public.chart_of_accounts
  for all to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- ── 2. 전표 헤더 ──
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  entry_date date not null,
  description text not null default '',
  reference_type text,
  reference_id uuid,
  -- AI/HITL fields (handoff section 4)
  source text not null default 'manual' check (source in ('manual','rule','ai')),
  status text not null default 'confirmed' check (status in ('ai_suggested','confirmed','rejected')),
  confidence numeric,
  reason text,
  linked_invoice_id uuid references public.tax_invoices(id) on delete set null,
  linked_bank_tx_id uuid references public.bank_transactions(id) on delete set null,
  linked_settlement_id uuid references public.invoice_settlements(id) on delete set null,
  created_by uuid,
  approved_by uuid,
  is_approved boolean not null default false,
  reviewed_by uuid,
  reviewed_at timestamptz,
  -- 전표입력 핸드오프(§3-5): 일자별 순번 + 전표 구분(출금/입금/대체)
  voucher_no integer,
  voucher_type text check (voucher_type is null or voucher_type in ('cash_out','cash_in','transfer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_journal_entries_company_status on public.journal_entries (company_id, status, entry_date desc);
create index if not exists idx_journal_entries_voucher_no on public.journal_entries (company_id, entry_date, voucher_no);
-- 같은 정산 건의 이중 전표 차단 (반려 제외) — handoff section 5 duplicate guard
create unique index if not exists uq_journal_entries_settlement
  on public.journal_entries (linked_settlement_id)
  where linked_settlement_id is not null and status <> 'rejected';
alter table public.journal_entries enable row level security;
drop policy if exists journal_entries_company on public.journal_entries;
create policy journal_entries_company on public.journal_entries
  for all to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- ── 3. 전표 라인 (차변/대변) ──
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  company_id uuid,
  account_id uuid not null references public.chart_of_accounts(id),
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  description text not null default '',
  partner_id uuid references public.partners(id) on delete set null,
  check (not (debit > 0 and credit > 0))
);
create index if not exists idx_journal_lines_entry on public.journal_lines (entry_id);

-- 라인 company_id 자동 채움 (lib/ledger.ts 가 company_id 없이 insert 하는 것 호환)
create or replace function public.journal_lines_fill_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    select je.company_id into new.company_id from journal_entries je where je.id = new.entry_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_journal_lines_fill_company on public.journal_lines;
create trigger trg_journal_lines_fill_company
  before insert on public.journal_lines
  for each row execute function public.journal_lines_fill_company();

alter table public.journal_lines enable row level security;
drop policy if exists journal_lines_company on public.journal_lines;
create policy journal_lines_company on public.journal_lines
  for all to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id is null or company_id = public.get_my_company_id());

-- ── 4. 기본 계정과목 시드 (기존 전 회사) — 데이터 한글은 평문 SQL(함수 본문 아님) ──
insert into public.chart_of_accounts (company_id, code, name, account_type, is_system)
select c.id, v.code, v.name, v.t, true
from public.companies c
cross join (values
  ('101', '보통예금', 'asset'),
  ('108', '외상매출금', 'asset'),
  ('135', '부가세대급금', 'asset'),
  ('136', '선납세금', 'asset'),
  ('251', '외상매입금', 'liability'),
  ('255', '부가세예수금', 'liability'),
  ('401', '매출', 'revenue'),
  ('901', '잡이익', 'revenue'),
  ('501', '매입', 'expense'),
  ('831', '지급수수료', 'expense'),
  ('980', '잡손실', 'expense')
) as v(code, name, t)
on conflict (company_id, code) do nothing;

-- ── 5. 전표 초안 생성 엔진 (rule 기반 1단계 — 확정 정산 → 균형 분개 초안) ──
--   AI/규칙은 무조건 status='ai_suggested' 로만 저장 (자동 확정 경로 없음).
create or replace function public.generate_voucher_drafts(p_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_acct_cash uuid; v_acct_ar uuid; v_acct_ap uuid;
  v_acct_prepaid_tax uuid; v_acct_fee uuid; v_acct_misc_loss uuid; v_acct_misc_gain uuid;
  v_s record;
  v_entry_id uuid;
  v_edate date;
  v_debit_acct uuid; v_credit_acct uuid;
  v_created integer := 0;
begin
  if v_company is null then
    raise exception 'NO_COMPANY';
  end if;
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select id into v_acct_cash from chart_of_accounts where company_id = v_company and code = '101';
  select id into v_acct_ar from chart_of_accounts where company_id = v_company and code = '108';
  select id into v_acct_ap from chart_of_accounts where company_id = v_company and code = '251';
  select id into v_acct_prepaid_tax from chart_of_accounts where company_id = v_company and code = '136';
  select id into v_acct_fee from chart_of_accounts where company_id = v_company and code = '831';
  select id into v_acct_misc_loss from chart_of_accounts where company_id = v_company and code = '980';
  select id into v_acct_misc_gain from chart_of_accounts where company_id = v_company and code = '901';
  if v_acct_cash is null or v_acct_ar is null or v_acct_ap is null then
    raise exception 'CHART_NOT_SEEDED';
  end if;

  for v_s in
    select s.id, s.amount, s.match_type, s.match_source, s.confidence, s.adjustment_reason,
           s.bank_transaction_id, s.tax_invoice_id, s.created_at,
           i.type as inv_type, i.counterparty_name, i.partner_id, i.total_amount as inv_total,
           b.transaction_date, b.counterparty as tx_counterparty, b.amount as tx_amount
    from invoice_settlements s
    join tax_invoices i on i.id = s.tax_invoice_id
    left join bank_transactions b on b.id = s.bank_transaction_id
    where s.company_id = v_company
      and s.status = 'confirmed'
      and s.amount > 0
      and not exists (
        select 1 from journal_entries je
        where je.linked_settlement_id = s.id and je.status <> 'rejected'
      )
    order by coalesce(b.transaction_date, s.created_at::date) desc
    limit greatest(1, least(p_limit, 100))
  loop
    v_edate := coalesce(v_s.transaction_date, v_s.created_at::date);

    if v_s.match_type = 'adjustment' then
      if v_s.inv_type = 'sales' then
        v_debit_acct := case v_s.adjustment_reason
          when 'withholding_tax' then coalesce(v_acct_prepaid_tax, v_acct_misc_loss)
          when 'fee' then coalesce(v_acct_fee, v_acct_misc_loss)
          else v_acct_misc_loss end;
        v_credit_acct := v_acct_ar;
      else
        v_debit_acct := v_acct_ap;
        v_credit_acct := coalesce(v_acct_misc_gain, v_acct_misc_loss);
      end if;
    elsif v_s.inv_type = 'sales' then
      v_debit_acct := v_acct_cash;  -- (Dr) cash
      v_credit_acct := v_acct_ar;   -- (Cr) accounts receivable
    else
      v_debit_acct := v_acct_ap;    -- (Dr) accounts payable
      v_credit_acct := v_acct_cash; -- (Cr) cash
    end if;

    insert into journal_entries (
      company_id, entry_date, description,
      source, status, confidence, reason,
      linked_invoice_id, linked_bank_tx_id, linked_settlement_id,
      reference_type, reference_id
    ) values (
      v_company, v_edate, coalesce(v_s.counterparty_name, ''),
      'rule', 'ai_suggested', coalesce(v_s.confidence, 1),
      format('settlement=%s | type=%s/%s | invoice_total=%s | settled=%s | tx=%s %s | adj=%s',
        v_s.id, v_s.inv_type, v_s.match_type, v_s.inv_total, v_s.amount,
        coalesce(v_s.transaction_date::text, '-'), coalesce(v_s.tx_counterparty, '-'),
        coalesce(v_s.adjustment_reason, '-')),
      v_s.tax_invoice_id, v_s.bank_transaction_id, v_s.id,
      'settlement', v_s.id
    ) returning id into v_entry_id;

    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
    values
      (v_entry_id, v_company, v_debit_acct, v_s.amount, 0, v_s.partner_id),
      (v_entry_id, v_company, v_credit_acct, 0, v_s.amount, v_s.partner_id);

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created);
end;
$$;

-- ── 6. 승인/반려/되돌리기 RPC — 사람만 확정 가능 + 하드 가드 ──
create or replace function public.voucher_confirm(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_e record;
  v_debit numeric; v_credit numeric;
begin
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_e.status <> 'ai_suggested' then
    raise exception 'INVALID_STATUS';
  end if;

  -- hard guard 1: balanced entry (sum debit = sum credit > 0)
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_debit, v_credit
  from journal_lines where entry_id = p_entry_id;
  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'UNBALANCED';
  end if;

  -- hard guard 2: locked accounting period
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  -- hard guard 3: duplicate settlement voucher
  if v_e.linked_settlement_id is not null and exists (
    select 1 from journal_entries je
    where je.linked_settlement_id = v_e.linked_settlement_id
      and je.id <> p_entry_id and je.status = 'confirmed'
  ) then
    raise exception 'DUPLICATE_SETTLEMENT';
  end if;

  update journal_entries
  set status = 'confirmed', is_approved = true,
      approved_by = v_uid, reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;
end;
$$;

create or replace function public.voucher_reject(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_e record;
begin
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status not in ('ai_suggested','confirmed') then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;
  -- confirmed (already booked) cannot be voided inside a locked period
  if v_e.status = 'confirmed' and exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;
  update journal_entries
  set status = 'rejected', is_approved = false,
      reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;
end;
$$;

-- ── 7. 수동 전표 저장 (전표입력 화면) — DB 레벨 차대 균형 검증 + 마감 차단 + 일자별 순번 ──
--   handoff section 6: front-only validation is not enough — balance is enforced here.
--   p_lines: [{account_id, debit, credit, partner_id, memo}]
create or replace function public.save_manual_voucher(
  p_entry_date date,
  p_voucher_type text,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_entry_id uuid;
  v_no integer;
  v_line jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_d numeric; v_c numeric;
  v_acct uuid;
begin
  if v_company is null then
    raise exception 'NO_COMPANY';
  end if;
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_voucher_type is null or p_voucher_type not in ('cash_out','cash_in','transfer') then
    raise exception 'INVALID_TYPE';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'NEED_TWO_LINES';
  end if;

  -- hard guard: locked accounting period
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(p_entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  -- validate lines + totals (one side per line, account must belong to company)
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((v_line->>'debit')::numeric, 0);
    v_c := coalesce((v_line->>'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or (v_d > 0 and v_c > 0) or (v_d = 0 and v_c = 0) then
      raise exception 'INVALID_LINE_AMOUNT';
    end if;
    v_acct := (v_line->>'account_id')::uuid;
    if v_acct is null or not exists (select 1 from chart_of_accounts a where a.id = v_acct and a.company_id = v_company) then
      raise exception 'INVALID_ACCOUNT';
    end if;
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;
  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'UNBALANCED';
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select coalesce(max(voucher_no), 0) + 1 into v_no
  from journal_entries where company_id = v_company and entry_date = p_entry_date;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, p_entry_date, coalesce(p_description, ''), 'manual', 'confirmed', true,
    v_no, p_voucher_type, v_uid, v_uid, v_uid, now()
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (
      v_entry_id, v_company,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid
    );
  end loop;

  return v_entry_id;
end;
$$;

-- 되돌리기: confirmed -> ai_suggested (감사 필드 보존, 마감 월 차단)
create or replace function public.voucher_unconfirm(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_e record;
begin
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status <> 'confirmed' then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;
  update journal_entries
  set status = 'ai_suggested', is_approved = false, updated_at = now()
  where id = p_entry_id;
end;
$$;
