-- 무료 한도 안내문을 80자 안으로 — 화면의 friendlyError 가 긴 한글 메시지를 일반 폴백("알 수 없는 오류")으로 바꿔 버린다.
SET statement_timeout = '60000';

create or replace function public.enforce_free_account_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_slug text; v_cnt int;
begin
  if not coalesce(new.sync_enabled, true) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.sync_enabled, true) then return new; end if;
  select effective_plan_slug into v_slug from public.get_company_entitlement(new.company_id);
  if coalesce(v_slug, 'free') <> 'free' then
    return new;
  end if;
  select (select count(*) from public.bank_accounts ba where ba.company_id = new.company_id and ba.sync_enabled)
       + (select count(*) from public.corporate_cards cc where cc.company_id = new.company_id and cc.sync_enabled)
    into v_cnt;
  if v_cnt >= 3 then
    raise exception '무료 요금제는 통장·카드 합쳐 3개까지 수집합니다. 다른 것을 끄거나 요금제를 올려 주세요.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
