-- 설정 전수 점검 5차 — 장부를 고치는 일에 권한을 건다 (2026-09-11).
--   실측: 재무 권한이 하나도 없는 직원 계정이 전표 2,115건·통장거래 7,727건·계산서 2,696건을
--   전부 보고, 전표·통장거래·계정과목·거래처를 고칠 수 있었다. 화면은 권한으로 가리지만 DB 가 안 막았다.
--
--   이번에는 **쓰기만** 잠근다. 읽기를 같이 좁히면 대시보드 위젯·프로젝트·결재처럼 장부를 곁다리로
--   읽는 화면이 조용히 비어 버릴 수 있어, 그쪽은 화면별로 확인한 뒤 따로 다룬다.
--   기준: 대표·관리자(is_company_manager) 또는 돈을 다루는 화면 권한을 하나라도 받은 사람.
begin;

--   권한 목록(PERMISSION_CATALOG)에서 money: true 로 표시된 화면들. 탭 키(/bank:accounts)도 같이 잡는다.
create or replace function public.has_any_finance_perm()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.member_permissions m
    join public.users u on u.id = m.user_id
    where u.auth_id = auth.uid()
      and (m.perm_key like '/bank%' or m.perm_key like '/cards%' or m.perm_key like '/collect%'
        or m.perm_key like '/tax-invoices%' or m.perm_key like '/e-invoices%' or m.perm_key like '/cash-receipts%'
        or m.perm_key like '/partners/reconciliation%' or m.perm_key like '/partners/ledger%'
        or m.perm_key like '/finance%' or m.perm_key like '/payments%' or m.perm_key like '/loans%'
        or m.perm_key like '/transactions%' or m.perm_key like '/reports%' or m.perm_key like '/inventory%'
        or m.perm_key = '/dashboard:finance'))
$$;
comment on function public.has_any_finance_perm() is '돈 다루는 화면 권한을 하나라도 받은 사람인가 — 장부 쓰기 기준';
grant execute on function public.has_any_finance_perm() to authenticated;

--   쓰기 기준 한 줄. 표마다 같은 말을 되풀이하지 않게 함수로 둔다.
create or replace function public.can_write_ledger()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.is_company_manager() or public.has_any_finance_perm()
$$;
grant execute on function public.can_write_ledger() to authenticated;

--   ALL 정책 하나를 '읽기는 회사 전체 / 쓰기는 권한자' 두 개로 가른다.
--   ⚠️ SECURITY DEFINER RPC(save_manual_voucher·post_* 등)는 표 소유자로 돌아 RLS 를 타지 않는다
--      (FORCE ROW LEVEL SECURITY 가 꺼져 있는 것을 확인했다). 전표 저장 경로는 그대로 동작한다.

-- 전표
drop policy if exists journal_entries_company on public.journal_entries;
create policy journal_entries_read on public.journal_entries for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy journal_entries_write on public.journal_entries for insert to authenticated
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy journal_entries_modify on public.journal_entries for update to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()))
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy journal_entries_remove on public.journal_entries for delete to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));

-- 전표 줄
drop policy if exists journal_lines_company on public.journal_lines;
create policy journal_lines_read on public.journal_lines for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy journal_lines_write on public.journal_lines for insert to authenticated
  with check ((company_id is null or company_id = (select public.get_my_company_id())) and (select public.can_write_ledger()));
create policy journal_lines_modify on public.journal_lines for update to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()))
  with check ((company_id is null or company_id = (select public.get_my_company_id())) and (select public.can_write_ledger()));
create policy journal_lines_remove on public.journal_lines for delete to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));

-- 통장 거래
drop policy if exists company_isolation on public.bank_transactions;
create policy bank_transactions_read on public.bank_transactions for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy bank_transactions_write on public.bank_transactions for insert to authenticated
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy bank_transactions_modify on public.bank_transactions for update to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()))
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy bank_transactions_remove on public.bank_transactions for delete to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));

-- 세금계산서 (읽기 정책은 이미 따로 있으니 ALL 만 쓰기로 좁힌다)
drop policy if exists "Company members can manage tax invoices" on public.tax_invoices;
create policy tax_invoices_write on public.tax_invoices for insert to authenticated
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy tax_invoices_modify on public.tax_invoices for update to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()))
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy tax_invoices_remove on public.tax_invoices for delete to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));

-- 정산
drop policy if exists invoice_settlements_company_access on public.invoice_settlements;
create policy invoice_settlements_read on public.invoice_settlements for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy invoice_settlements_write on public.invoice_settlements for insert to authenticated
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy invoice_settlements_modify on public.invoice_settlements for update to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()))
  with check (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));
create policy invoice_settlements_remove on public.invoice_settlements for delete to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_write_ledger()));

-- 계정과목 — 회계 설정 권한(/settings:chart)도 허용한다. 기본 계정(is_system)은 지우지 못하게 한다.
drop policy if exists chart_of_accounts_company on public.chart_of_accounts;
create policy chart_of_accounts_read on public.chart_of_accounts for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy chart_of_accounts_write on public.chart_of_accounts for insert to authenticated
  with check (company_id = (select public.get_my_company_id())
              and ((select public.can_write_ledger()) or (select public.has_perm('/settings:chart'))));
create policy chart_of_accounts_modify on public.chart_of_accounts for update to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.can_write_ledger()) or (select public.has_perm('/settings:chart'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.can_write_ledger()) or (select public.has_perm('/settings:chart'))));
create policy chart_of_accounts_remove on public.chart_of_accounts for delete to authenticated
  using (company_id = (select public.get_my_company_id())
         and coalesce(is_system, false) = false
         and ((select public.can_write_ledger()) or (select public.has_perm('/settings:chart'))));

-- 거래처 — 재무 권한 또는 거래처 화면 권한. 프로젝트·전자계약에서도 만들기 때문에 넓게 둔다.
drop policy if exists partners_company_access on public.partners;
create policy partners_read on public.partners for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy partners_write on public.partners for insert to authenticated
  with check (company_id = (select public.get_my_company_id())
              and ((select public.can_write_ledger()) or (select public.has_perm('/partners'))
                   or (select public.has_perm('/projecthub')) or (select public.has_perm('/signatures'))));
create policy partners_modify on public.partners for update to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.can_write_ledger()) or (select public.has_perm('/partners'))
              or (select public.has_perm('/projecthub')) or (select public.has_perm('/signatures'))))
  with check (company_id = (select public.get_my_company_id()));
create policy partners_remove on public.partners for delete to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.can_write_ledger()) or (select public.has_perm('/partners'))));

commit;
