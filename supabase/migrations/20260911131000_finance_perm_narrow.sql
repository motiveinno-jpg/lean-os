-- 장부 쓰기 기준을 좁힌다 (2026-09-11, 같은 날 20260911130000 의 후속).
--   처음엔 '돈 다루는 화면'을 넓게 잡아 /inventory · /reports · /dashboard:finance 까지 넣었는데,
--   실측해 보니 재고·분석 권한만 있는 직원이 그대로 전표를 고칠 수 있었다. 그 화면들은 장부를 읽기만 한다.
--   장부를 실제로 고치는 화면만 남긴다. 다만 재고의 '생산'은 예외다 —
--   생산 전표 초안 승인(lib/production-voucher.ts)이 journal_entries 를 직접 고치는 유일한 재고 경로다.
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
        or m.perm_key like '/transactions%'
        or m.perm_key like '/inventory/production%'))
$$;
commit;
