-- 무료 요금제 통장·카드 합산 3개 제한 (2026-08-11 사장님 확정)
-- 신규 INSERT 만 차단 — 기존 초과 연결은 유지(grandfather).
create or replace function public.enforce_free_account_limit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_slug text; v_cnt int;
begin
  select effective_plan_slug into v_slug from public.get_company_entitlement(new.company_id);
  if coalesce(v_slug, 'free') <> 'free' then
    return new;
  end if;
  select (select count(*) from public.bank_accounts ba where ba.company_id = new.company_id)
       + (select count(*) from public.corporate_cards cc where cc.company_id = new.company_id)
    into v_cnt;
  if v_cnt >= 3 then
    raise exception '무료 요금제는 통장·카드를 합쳐 3개까지 연결할 수 있습니다. 오너뷰 요금제로 업그레이드하면 무제한으로 연결됩니다.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_free_account_limit_bank on public.bank_accounts;
create trigger trg_free_account_limit_bank
  before insert on public.bank_accounts
  for each row execute function public.enforce_free_account_limit();

drop trigger if exists trg_free_account_limit_card on public.corporate_cards;
create trigger trg_free_account_limit_card
  before insert on public.corporate_cards
  for each row execute function public.enforce_free_account_limit();
