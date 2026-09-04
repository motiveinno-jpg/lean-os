-- 카드 거래 중복 방지: 가맹점명은 '앞부분'으로 비교한다.
--   같은 결제가 승인내역("쿠팡(주)/쿠팡(클라우드)")과 청구내역("쿠팡(주)-쿠팡(주)")으로 표기가 달라 들어와
--   card_tx_prevent_dup 의 완전 일치 비교를 빠져나갔고, 청구내역엔 승인번호가 없어 external_id 도 달라 두 줄이 쌓였다
--   (모티브 BC카드 2026-07 20쌍). 앞부분 = '/' 앞, 없으면 마지막 '-' 앞, 공백 제거.
SET statement_timeout = '60000';

create or replace function public.card_merchant_key(t text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select replace(
    case
      when position('/' in coalesce(t,'')) > 0 then split_part(t, '/', 1)
      when position('-' in coalesce(t,'')) > 0 then regexp_replace(t, '-[^-]*$', '')
      else coalesce(t,'')
    end, ' ', '')
$function$;

create or replace function public.card_tx_prevent_dup()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if exists (
    select 1 from public.card_transactions c
    where c.company_id = new.company_id
      and c.transaction_date = new.transaction_date
      and c.amount = new.amount
      and public.card_merchant_key(c.merchant_name) = public.card_merchant_key(new.merchant_name)
      and (
        coalesce(c.approval_number, '') = coalesce(new.approval_number, '')
        or coalesce(c.approval_number, '') = ''
        or coalesce(new.approval_number, '') = ''
      )
  ) then
    return null;
  end if;
  return new;
end;
$function$;
