-- 전표 세부 프로젝트 귀속: set_voucher_deal 에 p_sub_deal_id 추가.
-- sub_deal 은 반드시 해당 deal(또는 그 부모)에 속해야 하며, deal 이 비면 sub_deal 도 null 강제(정합성).
-- 본문 ASCII (Management API 전송 손상 방지).

drop function if exists public.set_voucher_deal(uuid, uuid);

create or replace function public.set_voucher_deal(p_entry_id uuid, p_deal_id uuid, p_sub_deal_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_sub_deal_id is not null and not exists (
    select 1
    from sub_deals s
    join deals d on d.id = s.parent_deal_id
    where s.id = p_sub_deal_id
      and d.company_id = v_company
      and (p_deal_id is null or s.parent_deal_id = p_deal_id)
  ) then
    raise exception 'INVALID_SUB_DEAL';
  end if;
  update journal_entries
    set deal_id = p_deal_id,
        sub_deal_id = case when p_deal_id is null then null else p_sub_deal_id end,
        updated_at = now()
    where id = p_entry_id and company_id = v_company;
end;
$function$;
