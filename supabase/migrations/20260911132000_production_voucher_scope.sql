-- 재고 '생산' 권한에 장부 전체 쓰기를 주지 않는다 (2026-09-11, 앞 두 마이그레이션의 마무리).
--   생산 화면이 장부를 건드리는 경로는 하나다 — AI 가 만든 생산 전표 초안을 확정·반려하는 것
--   (lib/production-voucher.ts 가 status='ai_suggested' 인 전표만 고친다).
--   그 하나 때문에 통장거래·계산서·계정과목까지 열어 줄 이유가 없다. 전표의 '초안' 상태에만 허용한다.
begin;

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
        or m.perm_key like '/transactions%'))
$$;

--   전표 수정만 예외를 둔다 — 생산 권한자는 AI 초안(ai_suggested)에 한해 손댈 수 있다.
drop policy if exists journal_entries_modify on public.journal_entries;
create policy journal_entries_modify on public.journal_entries for update to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.can_write_ledger())
              or (status = 'ai_suggested' and (select public.has_perm('/inventory/production')))))
  with check (company_id = (select public.get_my_company_id()));

commit;
