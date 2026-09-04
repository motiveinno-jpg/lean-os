-- 샘플 회사 체험 — 가입 직후 통장·카드를 연결하기 전에도 대시보드·수집·근태·일정 화면이 차 있게,
--   원본 회사(sample_company_source, 처음엔 QA 시드 회사)의 자료를 새 회사로 복사한다.
--   설계 원칙(실제 사용자로는 테스트할 수 없으므로 "실패해도 계정은 멀쩡"이 최우선):
--   1) 한 트랜잭션 — 한 표라도 실패하면 아무것도 남지 않는다(부분 삽입 없음).
--   2) 복사한 행은 전부 sample_data_rows 장부에 남긴다 — 지우기는 장부만 본다.
--   3) 실제 데이터가 조금이라도 있거나(통장·카드·거래·계산서·금융 연결) 이미 샘플이 있으면 넣지 않는다.
--   4) 금융 연결(codef_connected_id)이 생기는 순간 트리거가 샘플을 치운다. 그 정리가 실패해도 연결은 막지 않고
--      error_logs 에 남긴다(화면의 '샘플 지우기'로 다시 시도).
--   5) 무료 요금제 통장·카드 3개 제한(enforce_free_account_limit)에 맞춰 통장 2·카드 1만 복사한다.
--   6) 날짜는 원본의 마지막 거래일이 이번 주에 오도록 7일 단위로 옮긴다(요일 보존).
--   기능 게이트 feature_on('sample_company', company) — 이 파일은 켜지 않는다. 검증 뒤 따로 켠다.
SET statement_timeout = '120000';

-- ── 장부·원본 지정 ──
create table if not exists public.sample_data_rows (
  company_id uuid not null references public.companies(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, table_name, row_id)
);
create index if not exists sample_data_rows_company_idx on public.sample_data_rows (company_id);
alter table public.sample_data_rows enable row level security;
drop policy if exists sample_data_rows_select_company on public.sample_data_rows;
create policy sample_data_rows_select_company on public.sample_data_rows
  for select using (company_id = (select public.get_my_company_id()));
-- 쓰기는 아래 security definer 함수만(정책 없음 = 거부)

create table if not exists public.sample_company_source (
  id int primary key default 1 check (id = 1),
  company_id uuid not null references public.companies(id),
  note text
);
alter table public.sample_company_source enable row level security;
insert into public.sample_company_source (id, company_id, note)
values (1, '4d2157e8-35a2-4a78-8c6d-c774475ab110', 'QA 시드 회사 — 여기 자료가 새 회사의 샘플이 된다')
on conflict (id) do nothing;

-- ── 상태 조회(배너용) ──
create or replace function public.sample_company_status(p_company uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rows int; v_since timestamptz; v_on boolean;
begin
  if not exists (select 1 from public.users u where u.auth_id = auth.uid() and u.company_id = p_company) then
    return jsonb_build_object('active', false, 'allowed', false);
  end if;
  select count(*), min(created_at) into v_rows, v_since from public.sample_data_rows where company_id = p_company;
  v_on := coalesce(public.feature_on('sample_company', p_company), false);
  return jsonb_build_object(
    'active', v_rows > 0,
    'rows', v_rows,
    'since', v_since,
    'allowed', v_on
      and v_rows = 0
      and not exists (select 1 from public.company_settings cs where cs.company_id = p_company and coalesce(cs.codef_connected_id, '') <> '')
      and not exists (select 1 from public.bank_accounts where company_id = p_company)
      and not exists (select 1 from public.corporate_cards where company_id = p_company)
      and not exists (select 1 from public.bank_transactions where company_id = p_company)
      and not exists (select 1 from public.card_transactions where company_id = p_company)
      and not exists (select 1 from public.tax_invoices where company_id = p_company)
  );
end
$function$;

-- ── 샘플 넣기 ──
create or replace function public.sample_company_seed(p_company uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid; v_master boolean; v_name text; v_email text;
  v_src uuid; v_anchor date; v_shift interval := interval '0 days';
  v_n_partners int := 0; v_n_accounts int := 0; v_n_cards int := 0; v_n_banktx int := 0; v_n_cardtx int := 0;
  v_n_invoices int := 0; v_n_employees int := 0; v_n_att int := 0; v_n_sched int := 0; v_n_annc int := 0;
  v_n_board int := 0; v_n_fixed int := 0; v_n_recur int := 0;
begin
  -- 누가: 이 회사의 마스터만
  select u.id, coalesce(u.is_master, false), u.name, u.email into v_uid, v_master, v_name, v_email
    from public.users u where u.auth_id = auth.uid() and u.company_id = p_company limit 1;
  if v_uid is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not v_master then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not coalesce(public.feature_on('sample_company', p_company), false) then raise exception 'FEATURE_OFF' using errcode = 'P0001'; end if;
  if exists (select 1 from public.sample_data_rows where company_id = p_company) then raise exception 'SAMPLE_EXISTS' using errcode = 'P0001'; end if;
  if exists (select 1 from public.company_settings cs where cs.company_id = p_company and coalesce(cs.codef_connected_id, '') <> '') then
    raise exception 'CONNECTED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bank_accounts where company_id = p_company)
     or exists (select 1 from public.corporate_cards where company_id = p_company)
     or exists (select 1 from public.bank_transactions where company_id = p_company)
     or exists (select 1 from public.card_transactions where company_id = p_company)
     or exists (select 1 from public.tax_invoices where company_id = p_company) then
    raise exception 'HAS_DATA' using errcode = 'P0001';
  end if;
  select company_id into v_src from public.sample_company_source where id = 1;
  if v_src is null or v_src = p_company then raise exception 'NO_SOURCE' using errcode = 'P0001'; end if;

  -- 날짜 옮기기: 원본 마지막 거래일 → 이번 주(요일 보존, 7일 단위)
  select max(transaction_date) into v_anchor from public.bank_transactions where company_id = v_src;
  if v_anchor is not null and v_anchor < current_date then
    v_shift := make_interval(days => ((current_date - v_anchor) / 7) * 7);
  end if;

  -- 동일 트랜잭션 안에서만 쓰는 임시 매핑(옛 id → 새 id)
  create temp table _smap (tbl text, old_id uuid, new_id uuid, primary key (tbl, old_id)) on commit drop;

  -- 1) 거래처
  create temp table _s_partners on commit drop as
    select p.*, gen_random_uuid() as new_id from public.partners p where p.company_id = v_src;
  insert into public.partners (id, company_id, name, type, classification, business_number, representative, contact_name, contact_email, contact_phone,
      address, bank_name, account_number, tags, notes, is_active, preferred_invoice_day, default_expense_category, company_name, business_type, business_item, is_dormant)
  select new_id, p_company, name, type, classification, business_number, representative, contact_name, null, null,
      address, bank_name, account_number, tags, notes, coalesce(is_active, true), preferred_invoice_day, default_expense_category, company_name, business_type, business_item, false
  from _s_partners;
  insert into _smap select 'partners', id, new_id from _s_partners;
  get diagnostics v_n_partners = row_count;

  -- 2) 통장(2개) · 3) 카드(1개) — 무료 요금제 한도 3개 안
  create temp table _s_accounts on commit drop as
    select a.*, gen_random_uuid() as new_id from public.bank_accounts a where a.company_id = v_src and a.is_hidden = false
    order by a.is_primary desc nulls last, a.created_at limit 2;
  insert into public.bank_accounts (id, company_id, bank_name, account_number, alias, role, balance, is_primary, is_hidden, memo)
  select new_id, p_company, bank_name, account_number, coalesce(alias, bank_name) || ' (샘플)', role, balance, is_primary, false, memo from _s_accounts;
  insert into _smap select 'bank_accounts', id, new_id from _s_accounts;
  get diagnostics v_n_accounts = row_count;

  create temp table _s_cards on commit drop as
    select c.*, gen_random_uuid() as new_id from public.corporate_cards c where c.company_id = v_src and coalesce(c.is_active, true)
    order by c.created_at limit 1;
  insert into public.corporate_cards (id, company_id, card_name, card_number, card_company, holder_name, monthly_limit, is_active, payment_day, billing_day, card_type, memo)
  select new_id, p_company, card_name, card_number, card_company, holder_name, monthly_limit, true, payment_day, billing_day, card_type, memo from _s_cards;
  insert into _smap select 'corporate_cards', id, new_id from _s_cards;
  get diagnostics v_n_cards = row_count;

  -- 4) 통장 거래 — 복사한 통장의 것만. 전표·딜·계산서·카드 연결은 끊고 들어간다(그쪽 표는 복사하지 않으므로)
  create temp table _s_banktx on commit drop as
    select t.*, gen_random_uuid() as new_id from public.bank_transactions t
    where t.company_id = v_src and t.bank_account_id in (select id from _s_accounts);
  insert into public.bank_transactions (id, company_id, bank_account_id, transaction_date, amount, balance_after, type, counterparty, description, memo,
      classification, category, is_fixed_cost, mapping_status, source, is_auto_transfer, partner_id, settled_amount, settlement_status, tags)
  select s.new_id, p_company, (select new_id from _smap where tbl = 'bank_accounts' and old_id = s.bank_account_id),
      s.transaction_date + v_shift, s.amount, s.balance_after, s.type, s.counterparty, s.description, s.memo,
      s.classification, s.category, s.is_fixed_cost, case when s.mapping_status = 'manual_mapped' then 'auto_mapped' else coalesce(s.mapping_status, 'unmapped') end, 'sample', s.is_auto_transfer,
      (select new_id from _smap where tbl = 'partners' and old_id = s.partner_id), 0, 'open', s.tags
  from _s_banktx s;
  insert into _smap select 'bank_transactions', id, new_id from _s_banktx;
  get diagnostics v_n_banktx = row_count;

  -- 5) 카드 거래 — 복사한 카드의 것만. external_id 는 전역 유일이라 비운다
  create temp table _s_cardtx on commit drop as
    select t.*, gen_random_uuid() as new_id from public.card_transactions t
    where t.company_id = v_src and t.card_id in (select id from _s_cards);
  insert into public.card_transactions (id, company_id, card_id, transaction_date, approval_number, merchant_name, merchant_category, amount, currency, installments,
      category, classification, is_fixed_cost, is_deductible, mapping_status, source, memo, card_name, tags, merchant_bizno, transaction_time)
  select s.new_id, p_company, (select new_id from _smap where tbl = 'corporate_cards' and old_id = s.card_id),
      s.transaction_date + v_shift, s.approval_number, s.merchant_name, s.merchant_category, s.amount, s.currency, s.installments,
      s.category, s.classification, s.is_fixed_cost, s.is_deductible, case when s.mapping_status = 'manual_mapped' then 'auto_mapped' else coalesce(s.mapping_status, 'unmapped') end, 'sample', s.memo, s.card_name, s.tags,
      case when s.merchant_bizno ~ '^[0-9]{10}$' then s.merchant_bizno else null end, s.transaction_time
  from _s_cardtx s;
  insert into _smap select 'card_transactions', id, new_id from _s_cardtx;
  get diagnostics v_n_cardtx = row_count;

  -- 6) 세금계산서 — 국세청 발행 상태·승인번호는 비운다(진짜 발행 이력이 아니다)
  create temp table _s_invoices on commit drop as
    select i.*, gen_random_uuid() as new_id from public.tax_invoices i where i.company_id = v_src;
  insert into public.tax_invoices (id, company_id, type, counterparty_name, counterparty_bizno, supply_amount, tax_amount, total_amount, issue_date, status,
      partner_id, label, expense_category, source, counterparty_business_type, counterparty_business_item, nts_issue_status, item_name, settled_amount, settlement_status,
      tax_kind, counterparty_representative, counterparty_address, doc_kind, items)
  select s.new_id, p_company, s.type, s.counterparty_name, s.counterparty_bizno, s.supply_amount, s.tax_amount, s.total_amount, s.issue_date + v_shift, s.status,
      (select new_id from _smap where tbl = 'partners' and old_id = s.partner_id), s.label, s.expense_category, 'sample', s.counterparty_business_type, s.counterparty_business_item,
      'not_requested', s.item_name, 0, 'open', s.tax_kind, s.counterparty_representative, s.counterparty_address, s.doc_kind, coalesce(s.items, '[]'::jsonb)
  from _s_invoices s;
  insert into _smap select 'tax_invoices', id, new_id from _s_invoices;
  get diagnostics v_n_invoices = row_count;

  -- 7) 직원 — 계정 연결(user_id)·연락처·서명·서류는 비운다
  create temp table _s_employees on commit drop as
    select e.*, gen_random_uuid() as new_id from public.employees e where e.company_id = v_src and e.user_id is distinct from (select id from public.users where company_id = v_src and is_master limit 1);
  insert into public.employees (id, company_id, name, salary, hire_date, status, department, position, contract_type, is_4_insurance, job_title, job_grade, employment_type,
      contract_start_date, contract_end_date, employee_number, job_role, working_hours, meal_allowance_included, non_taxable_amount, work_start_time, work_end_time)
  select new_id, p_company, name, salary, hire_date, status, department, position, contract_type, is_4_insurance, job_title, job_grade, employment_type,
      contract_start_date, contract_end_date, employee_number, job_role, working_hours, meal_allowance_included, non_taxable_amount, work_start_time, work_end_time
  from _s_employees;
  insert into _smap select 'employees', id, new_id from _s_employees;
  get diagnostics v_n_employees = row_count;

  -- 8) 근태 — 복사한 직원의 것만, 날짜는 같은 요일로 옮긴다
  create temp table _s_att on commit drop as
    select a.*, gen_random_uuid() as new_id from public.attendance_records a
    where a.company_id = v_src and a.employee_id in (select id from _s_employees);
  insert into public.attendance_records (id, company_id, employee_id, date, check_in, check_out, work_hours, overtime_hours, status, note, attendance_type,
      is_late, late_minutes, regular_minutes, overtime_minutes, night_minutes, holiday_minutes, is_holiday, auto_clocked_out)
  select s.new_id, p_company, (select new_id from _smap where tbl = 'employees' and old_id = s.employee_id), s.date + v_shift, s.check_in + v_shift, s.check_out + v_shift,
      s.work_hours, s.overtime_hours, s.status, s.note, s.attendance_type,
      s.is_late, s.late_minutes, s.regular_minutes, s.overtime_minutes, s.night_minutes, s.holiday_minutes, s.is_holiday, coalesce(s.auto_clocked_out, false)
  from _s_att s;
  insert into _smap select 'attendance_records', id, new_id from _s_att;
  get diagnostics v_n_att = row_count;

  -- 9) 일정 — 만든 사람은 새 회사 마스터, 알림 이력은 비운다
  create temp table _s_sched on commit drop as
    select e.*, gen_random_uuid() as new_id from public.schedule_events e where e.company_id = v_src;
  insert into public.schedule_events (id, company_id, user_id, title, description, start_at, end_at, all_day, color, is_shared, completed, visibility,
      target_user_ids, target_departments, priority, position, attachments, recurrence, reminders, reminders_sent)
  select s.new_id, p_company, v_uid, s.title, s.description, s.start_at + v_shift, s.end_at + v_shift, s.all_day, s.color, s.is_shared, s.completed, 'company',
      '{}'::uuid[], '{}'::text[], s.priority, s.position, '[]'::jsonb, s.recurrence, null, '[]'::jsonb
  from _s_sched s;
  insert into _smap select 'schedule_events', id, new_id from _s_sched;
  get diagnostics v_n_sched = row_count;

  -- 10) 공지 · 11) 게시판 — 글쓴이는 새 회사 마스터
  create temp table _s_annc on commit drop as
    select a.*, gen_random_uuid() as new_id from public.announcements a where a.company_id = v_src;
  insert into public.announcements (id, company_id, title, content, category, pinned, author_email, author_name, created_at, updated_at)
  select s.new_id, p_company, s.title, s.content, s.category, s.pinned, v_email, v_name, s.created_at + v_shift, s.updated_at + v_shift from _s_annc s;
  insert into _smap select 'announcements', id, new_id from _s_annc;
  get diagnostics v_n_annc = row_count;

  create temp table _s_board on commit drop as
    select b.*, gen_random_uuid() as new_id from public.board_posts b where b.company_id = v_src;
  insert into public.board_posts (id, company_id, author_id, author_name, author_email, title, content, pinned, created_at, updated_at, event_date,
      poll_question, poll_options, attachments, poll_multi, poll_anonymous, poll_deadline, category)
  select s.new_id, p_company, v_uid, v_name, v_email, s.title, s.content, s.pinned, s.created_at + v_shift, s.updated_at + v_shift, s.event_date + v_shift,
      s.poll_question, coalesce(s.poll_options, '[]'::jsonb), '[]'::jsonb, s.poll_multi, s.poll_anonymous, s.poll_deadline + v_shift, s.category
  from _s_board s;
  insert into _smap select 'board_posts', id, new_id from _s_board;
  get diagnostics v_n_board = row_count;

  -- 12) 고정비 · 13) 정기 지출
  create temp table _s_fixed on commit drop as
    select f.*, gen_random_uuid() as new_id from public.fixed_costs f where f.company_id = v_src;
  insert into public.fixed_costs (id, company_id, name, amount, payment_day, category, is_recurring, start_date, end_date, note)
  select new_id, p_company, name, amount, payment_day, category, is_recurring, start_date, end_date, note from _s_fixed;
  insert into _smap select 'fixed_costs', id, new_id from _s_fixed;
  get diagnostics v_n_fixed = row_count;

  create temp table _s_recur on commit drop as
    select r.*, gen_random_uuid() as new_id from public.recurring_payments r where r.company_id = v_src;
  insert into public.recurring_payments (id, company_id, name, amount, category, recipient_name, recipient_account, recipient_bank, bank_account_id, frequency,
      day_of_month, is_active, next_due_date)
  select s.new_id, p_company, s.name, s.amount, s.category, s.recipient_name, s.recipient_account, s.recipient_bank,
      (select new_id from _smap where tbl = 'bank_accounts' and old_id = s.bank_account_id), s.frequency, s.day_of_month, s.is_active, s.next_due_date + v_shift
  from _s_recur s;
  insert into _smap select 'recurring_payments', id, new_id from _s_recur;
  get diagnostics v_n_recur = row_count;

  -- 장부 — 여기 적힌 것만 '샘플'이다
  insert into public.sample_data_rows (company_id, table_name, row_id) select p_company, tbl, new_id from _smap;

  return jsonb_build_object(
    'shift_days', extract(day from v_shift),
    'partners', v_n_partners, 'bank_accounts', v_n_accounts, 'corporate_cards', v_n_cards, 'bank_transactions', v_n_banktx,
    'card_transactions', v_n_cardtx, 'tax_invoices', v_n_invoices, 'employees', v_n_employees, 'attendance_records', v_n_att,
    'schedule_events', v_n_sched, 'announcements', v_n_annc, 'board_posts', v_n_board, 'fixed_costs', v_n_fixed, 'recurring_payments', v_n_recur
  );
end
$function$;

-- ── 샘플 지우기(내부) — 장부의 행만, 참조하는 다른 표는 카탈로그를 보고 먼저 끊는다 ──
create or replace function public.sample_company_clear_internal(p_company uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tbl text; v_ids uuid[]; v_deleted int; v_total int := 0; r record;
  v_order text[] := array['recurring_payments','fixed_costs','board_posts','announcements','schedule_events','attendance_records','employees',
                          'tax_invoices','card_transactions','bank_transactions','corporate_cards','bank_accounts','partners'];
begin
  foreach v_tbl in array v_order loop
    select array_agg(row_id) into v_ids from public.sample_data_rows where company_id = p_company and table_name = v_tbl;
    if v_ids is null or array_length(v_ids, 1) is null then continue; end if;
    -- 이 표를 참조하는 모든 외래키: 비울 수 있는 칸은 null 로, 필수 칸이면 그 행을 지운다(샘플에 매달린 자료)
    for r in
      select c.conrelid::regclass::text as ref_tbl, a.attname as ref_col, a.attnotnull as notnull
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = ('public.' || v_tbl)::regclass
        and array_length(c.conkey, 1) = 1
    loop
      if r.notnull then
        execute format('delete from %s where %I = any($1)', r.ref_tbl, r.ref_col) using v_ids;
      else
        execute format('update %s set %I = null where %I = any($1)', r.ref_tbl, r.ref_col, r.ref_col) using v_ids;
      end if;
    end loop;
    execute format('delete from public.%I where id = any($1) and company_id = $2', v_tbl) using v_ids, p_company;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    delete from public.sample_data_rows where company_id = p_company and table_name = v_tbl;
  end loop;
  delete from public.sample_data_rows where company_id = p_company;
  return jsonb_build_object('deleted', v_total);
end
$function$;

-- 화면용 — 이 회사의 마스터만
create or replace function public.sample_company_clear(p_company uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_master boolean;
begin
  select coalesce(u.is_master, false) into v_master from public.users u where u.auth_id = auth.uid() and u.company_id = p_company limit 1;
  if v_master is null or not v_master then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return public.sample_company_clear_internal(p_company);
end
$function$;

-- 금융 연결이 생기면 샘플을 치운다 — 정리가 실패해도 연결은 막지 않는다
create or replace function public.trg_company_settings_sample_clear()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(new.codef_connected_id, '') <> '' and coalesce(old.codef_connected_id, '') = ''
     and exists (select 1 from public.sample_data_rows where company_id = new.company_id) then
    begin
      perform public.sample_company_clear_internal(new.company_id);
    exception when others then
      begin
        insert into public.error_logs (company_id, source, message, context)
        values (new.company_id, 'sample_company', '금융 연결 뒤 샘플 자동 정리 실패: ' || sqlerrm, jsonb_build_object('sqlstate', sqlstate));
      exception when others then null; end;
    end;
  end if;
  return new;
end
$function$;
drop trigger if exists zz_company_settings_sample_clear on public.company_settings;
create trigger zz_company_settings_sample_clear
  after update of codef_connected_id on public.company_settings
  for each row execute function public.trg_company_settings_sample_clear();

-- 권한: 화면은 status·seed·clear 만, 내부 정리는 트리거(소유자)만
revoke all on function public.sample_company_status(uuid) from public, anon;
revoke all on function public.sample_company_seed(uuid) from public, anon;
revoke all on function public.sample_company_clear(uuid) from public, anon;
revoke all on function public.sample_company_clear_internal(uuid) from public, anon, authenticated;
grant execute on function public.sample_company_status(uuid) to authenticated;
grant execute on function public.sample_company_seed(uuid) to authenticated;
grant execute on function public.sample_company_clear(uuid) to authenticated;
