-- 카드 사용내역 가맹점 사업자번호 보강 — 같은 회사·같은 가맹점명의 다른 거래에 번호가 있으면 그 번호를 쓴다.
--   카드사가 승인내역엔 번호를 안 주고 청구내역에만 주거나(롯데), 회차에 따라 빈 값으로 보내는 경우가 있어
--   같은 가맹점인데 어떤 거래는 번호·구분이 있고 어떤 거래는 비어 보였다.
--   모티브 실측: 빈 846건 중 146건이 이 규칙으로 풀린다. 해외 가맹점 474건은 원래 번호가 없고(구분 '해외'),
--   나머지는 카드사 자료 어디에도 번호가 없어 여기서는 못 채운다.
--   같은 이름에 번호가 여럿이면(체인점) 거래가 가장 많고 최근인 번호를 고른다.
SET statement_timeout = '120000';

create index if not exists card_transactions_company_merchant_name_idx
  on public.card_transactions (company_id, merchant_name);

create or replace function public.card_tx_bizno_from_same_merchant(p_company uuid, p_name text)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select c.merchant_bizno
  from public.card_transactions c
  where c.company_id = p_company
    and c.merchant_name = p_name
    and c.merchant_bizno ~ '^[0-9]{10}$'
  group by c.merchant_bizno
  order by count(*) desc, max(c.transaction_date) desc
  limit 1
$function$;

-- 1) 지금 있는 행을 한 번 채운다 (트리거를 걸기 전에 — 걸고 나서 돌리면 행마다 퍼뜨리기가 중복으로 돈다)
update public.card_transactions c
   set merchant_bizno = public.card_tx_bizno_from_same_merchant(c.company_id, c.merchant_name)
 where (c.merchant_bizno is null or c.merchant_bizno = '')
   and coalesce(c.merchant_name, '') <> ''
   and exists (
     select 1 from public.card_transactions b
      where b.company_id = c.company_id
        and b.merchant_name = c.merchant_name
        and b.merchant_bizno ~ '^[0-9]{10}$'
   );

-- 2) 새로 들어오는 행: 번호가 비어 있으면 같은 가맹점명에서 빌린다
create or replace function public.trg_card_tx_fill_bizno()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if (new.merchant_bizno is null or new.merchant_bizno = '') and coalesce(new.merchant_name, '') <> '' then
    new.merchant_bizno := public.card_tx_bizno_from_same_merchant(new.company_id, new.merchant_name);
  end if;
  return new;
end
$function$;

drop trigger if exists card_tx_fill_bizno on public.card_transactions;
create trigger card_tx_fill_bizno
  before insert or update of merchant_name on public.card_transactions
  for each row execute function public.trg_card_tx_fill_bizno();

-- 3) 어떤 행이 번호를 새로 얻으면(청구내역 재수집 등) 같은 가맹점명의 빈 행에도 퍼뜨린다
create or replace function public.trg_card_tx_spread_bizno()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if pg_trigger_depth() > 1 then return null; end if;   -- 퍼뜨리기가 퍼뜨리기를 부르지 않게
  if new.merchant_bizno ~ '^[0-9]{10}$'
     and coalesce(new.merchant_name, '') <> ''
     and (tg_op = 'INSERT' or old.merchant_bizno is distinct from new.merchant_bizno) then
    update public.card_transactions
       set merchant_bizno = new.merchant_bizno
     where company_id = new.company_id
       and merchant_name = new.merchant_name
       and (merchant_bizno is null or merchant_bizno = '')
       and id <> new.id;
  end if;
  return null;
end
$function$;

drop trigger if exists zy_card_tx_spread_bizno on public.card_transactions;
create trigger zy_card_tx_spread_bizno
  after insert or update of merchant_bizno on public.card_transactions
  for each row execute function public.trg_card_tx_spread_bizno();
