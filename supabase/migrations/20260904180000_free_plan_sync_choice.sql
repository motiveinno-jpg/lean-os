-- 무료 요금제 통장·카드 3개 제한을 "행 개수"가 아니라 "수집하는 것"의 개수로 바꾼다.
--   종전: 인증서로 계좌 10개가 넘어오면 은행이 돌려준 순서대로 앞 3개만 bank_accounts 에 남고 나머지는 버려졌다.
--   그런데 거래내역은 계좌 행이 없어도 전부 들어와(계좌 없는 거래) 제한이 새고, 어떤 3개를 쓸지 고를 수도 없었다.
--   변경: 계좌·카드는 전부 목록에 두고 sync_enabled 로 "수집하는 것"을 표시한다. 무료는 켜진 것이 3개를 넘지 못한다.
--   수집(codef-sync)은 sync_enabled=false 인 계좌·카드의 거래를 가져오지 않는다. 사용자는 통장·카드 화면에서 무엇을 켤지 고른다.
SET statement_timeout = '120000';

alter table public.bank_accounts add column if not exists sync_enabled boolean not null default true;
alter table public.corporate_cards add column if not exists sync_enabled boolean not null default true;

create or replace function public.enforce_free_account_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_slug text; v_cnt int;
begin
  -- 수집을 끄는 변경(true→false)이나 수집 안 하는 행의 삽입은 제한과 무관
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
    raise exception '무료 요금제는 통장·카드를 합쳐 3개까지 수집할 수 있습니다. 통장·카드 화면에서 수집할 것을 고르거나, 오너뷰 요금제로 업그레이드하면 무제한으로 연결됩니다.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_free_account_limit_bank on public.bank_accounts;
create trigger trg_free_account_limit_bank
  before insert or update of sync_enabled on public.bank_accounts
  for each row execute function public.enforce_free_account_limit();

drop trigger if exists trg_free_account_limit_card on public.corporate_cards;
create trigger trg_free_account_limit_card
  before insert or update of sync_enabled on public.corporate_cards
  for each row execute function public.enforce_free_account_limit();

-- 화면용: 이 회사가 무료인지와 켜진 수집 수 — 통장·카드 화면의 "3개 중 N개" 표시
create or replace function public.free_sync_quota(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_slug text; v_used int;
begin
  if not exists (select 1 from public.users u where u.auth_id = auth.uid() and u.company_id = p_company) then
    return jsonb_build_object('free', false, 'limit', null, 'used', 0);
  end if;
  select effective_plan_slug into v_slug from public.get_company_entitlement(p_company);
  select (select count(*) from public.bank_accounts where company_id = p_company and sync_enabled)
       + (select count(*) from public.corporate_cards where company_id = p_company and sync_enabled) into v_used;
  return jsonb_build_object('free', coalesce(v_slug, 'free') = 'free', 'limit', case when coalesce(v_slug, 'free') = 'free' then 3 else null end, 'used', v_used);
end
$function$;
revoke all on function public.free_sync_quota(uuid) from public, anon;
grant execute on function public.free_sync_quota(uuid) to authenticated;
