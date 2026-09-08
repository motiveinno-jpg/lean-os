-- 카드 순서 바꾸기 (2026-09-08 사장님) — 지금은 등록일 역순 고정이라 사용자가 못 바꾼다.
--   sort_order(작을수록 위) 를 추가하고, 기존 카드는 현재 보이는 순서(created_at desc)를 그대로 번호로 굳힌다.
alter table public.corporate_cards add column if not exists sort_order integer;

with ranked as (
  select id, row_number() over (partition by company_id order by created_at desc) - 1 as rn
  from public.corporate_cards
)
update public.corporate_cards c set sort_order = ranked.rn
from ranked where ranked.id = c.id and c.sort_order is null;

create index if not exists idx_corporate_cards_company_order on public.corporate_cards (company_id, sort_order);

-- 순서 일괄 저장 — 본인 회사 카드만. id 배열 순서대로 0,1,2… 로 매긴다.
create or replace function public.reorder_corporate_cards(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.get_my_company_id();
begin
  if v_company is null then raise exception 'no company' using errcode='42501'; end if;
  update public.corporate_cards c
     set sort_order = pos.ord
    from (select id, ordinality - 1 as ord from unnest(p_ids) with ordinality as t(id, ordinality)) pos
   where c.id = pos.id and c.company_id = v_company;   -- 회사 격리: 남의 회사 카드는 안 건드린다
end $$;
revoke all on function public.reorder_corporate_cards(uuid[]) from public, anon;
grant execute on function public.reorder_corporate_cards(uuid[]) to authenticated;
