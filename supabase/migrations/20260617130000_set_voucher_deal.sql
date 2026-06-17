-- 전표 ↔ 프로젝트(deal) 태그 (2026-06-17 핸드오프 v2 Phase 7)
--   save/update_manual_voucher 시그니처는 그대로 두고(다른 호출처 보호), 저장 후 별도 태그.
--   비용계정(account_type='expense') 라인이 v_deal_pnl 직접원가로 자동 집계됨.
create or replace function public.set_voucher_deal(p_entry_id uuid, p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
begin
  if v_company is null then
    raise exception 'NO_COMPANY';
  end if;
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_deal_id is not null and not exists (
    select 1 from deals d where d.id = p_deal_id and d.company_id = v_company
  ) then
    raise exception 'INVALID_DEAL';
  end if;
  update journal_entries
    set deal_id = p_deal_id, updated_at = now()
    where id = p_entry_id and company_id = v_company;
end;
$$;

grant execute on function public.set_voucher_deal(uuid, uuid) to authenticated;
