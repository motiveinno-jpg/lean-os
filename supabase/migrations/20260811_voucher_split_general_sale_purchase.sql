-- 전표를 일반전표 / 매입매출전표로 가른다 (2026-08-11 사장님 지시).
--   가르는 기준은 하나 — 부가세가 붙는 거래인가.
--   기존 전표는 전부 general 로 채워 화면에 보이는 값이 달라지지 않게 한다.
alter table public.journal_entries
  add column if not exists entry_kind text not null default 'general',
  add column if not exists vat_type text,
  add column if not exists supply_amount numeric,
  add column if not exists vat_amount numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_entry_kind_chk') then
    alter table public.journal_entries
      add constraint journal_entries_entry_kind_chk
      check (entry_kind in ('general', 'sale_purchase'));
  end if;
end $$;

comment on column public.journal_entries.entry_kind is
  'general = 일반전표(통장·대체·결산) / sale_purchase = 매입매출전표(세금계산서·카드·현금영수증)';
comment on column public.journal_entries.vat_type is
  '부가세 유형 코드 — 매출 11·12·13·17·22 / 매입 51·53·54·57·61. 이 값이 분개와 신고서를 함께 정한다';
comment on column public.journal_entries.supply_amount is '공급가액 — 매입매출전표에서만 채운다';
comment on column public.journal_entries.vat_amount is '부가세액 — 매입매출전표에서만 채운다(불공제·면세는 0)';

create index if not exists journal_entries_vat_idx
  on public.journal_entries (company_id, entry_date, vat_type)
  where entry_kind = 'sale_purchase';

-- 예전 '전표입력' 권한자는 갈라진 새 메뉴도 그대로 쓸 수 있어야 한다(쓰던 화면을 잃지 않게).
insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
select mp.company_id, mp.user_id, '/partners/reconciliation/sale-purchase', mp.granted_by, now()
from public.member_permissions mp
where mp.perm_key = '/partners/reconciliation/voucher-entry'
  and not exists (
    select 1 from public.member_permissions x
    where x.user_id = mp.user_id
      and x.perm_key = '/partners/reconciliation/sale-purchase'
  );
