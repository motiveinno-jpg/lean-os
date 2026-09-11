-- 설정 전수 점검 6차 — 장부 '읽기'에도 권한을 건다 (2026-09-11, 5차 쓰기 잠금의 후속).
--   5차 뒤에도 재무 권한이 없는 직원이 전표 2,115건·통장거래 7,727건을 전부 볼 수 있었다.
--   읽기는 화면을 조용히 비게 만들 수 있어, 장부를 읽는 곳을 전부 찾아 권한과 대조한 뒤 좁힌다.
--
--   대조 결과(코드 확인):
--     · 대시보드 금액 위젯 — /dashboard:finance + 메뉴 권한을 이미 확인하고 조회한다.
--     · 프로젝트 허브 — /bank·/tax-invoices 를 확인하고 조회한다.
--     · 결재의 반복결제 금액 갱신 — 정기지출(/payments) 화면에서만 돈다.
--     · 거래처 화면·통합검색 — 확인 없이 계산서를 읽는다. 그래서 계산서·정산은 /partners 도 허용한다.
--     · 설정 자금·통장 — 통장 잔고를 거래에서 계산한다. /settings:cash 도 허용한다.
--   전표와 통장거래는 재무 화면에서만 보므로 가장 좁게 잠근다.
--
--   ⚠️ 세무사(제휴 파트너)는 users 행이 없어 has_perm 이 언제나 false 다. 회사가 준 열람 권한
--      (advisor_my_permissions)으로 따로 받아 준다 — 안 그러면 세무사가 장부를 통째로 못 본다.
begin;

create or replace function public.can_read_ledger()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.can_write_ledger()
      or exists (
        select 1 from public.member_permissions m
        join public.users u on u.id = m.user_id
        where u.auth_id = auth.uid()
          and (m.perm_key like '/reports%' or m.perm_key = '/dashboard:finance'
            or m.perm_key like '/settings:cash%' or m.perm_key like '/settings:closing%'))
      or exists (
        select 1 from public.advisor_my_permissions() k
        where k like '/bank%' or k like '/cards%' or k like '/collect%' or k like '/tax-invoices%'
           or k like '/e-invoices%' or k like '/cash-receipts%' or k like '/partners/reconciliation%'
           or k like '/partners/ledger%' or k like '/finance%' or k like '/reports%'
           or k like '/payments%' or k like '/transactions%')
$$;
grant execute on function public.can_read_ledger() to authenticated;

--   계산서·정산은 거래처 화면과 프로젝트에서도 읽는다. 그 둘은 확인 없이 조회하므로 함께 받아 준다.
create or replace function public.can_read_invoices()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.can_read_ledger()
      or public.has_perm('/partners') or public.has_perm('/projecthub')
      or exists (select 1 from public.advisor_my_permissions() k where k like '/partners%' or k like '/projecthub%')
$$;
grant execute on function public.can_read_invoices() to authenticated;

-- 전표·전표줄·통장거래 — 재무 화면 전용
drop policy if exists journal_entries_read on public.journal_entries;
create policy journal_entries_read on public.journal_entries for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_read_ledger()));

drop policy if exists journal_lines_read on public.journal_lines;
create policy journal_lines_read on public.journal_lines for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_read_ledger()));

drop policy if exists bank_transactions_read on public.bank_transactions;
create policy bank_transactions_read on public.bank_transactions for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_read_ledger()));

-- 세금계산서·정산 — 거래처·프로젝트도 읽는다
drop policy if exists "Company members can view tax invoices" on public.tax_invoices;
create policy tax_invoices_read on public.tax_invoices for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_read_invoices()));

drop policy if exists invoice_settlements_read on public.invoice_settlements;
create policy invoice_settlements_read on public.invoice_settlements for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.can_read_invoices()));

commit;
