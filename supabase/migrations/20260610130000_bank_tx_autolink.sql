-- 2026-06-10 은행 거래 계좌 자동연결 — codef_bank 거래 중 bank_account_id 가 null 인데
--   raw_data.resAccount(전체 계좌번호)가 등록 bank_accounts.account_number 와 일치하는 건을 연결.
-- 발견: 366건 미연결(전부 codef_bank), 그중 288건이 '소상공인자부담'(잔액 1.56억) 것 →
--   해당 계좌가 거래 0건으로 표시되던 문제. 회사 전체 합계는 영향 없으나 계좌별 화면이 불완전.
-- 카드 card_tx_autolink 패턴 미러.

-- 1) 자동연결 함수 + BEFORE INSERT 트리거 (재발 방지)
create or replace function public.bank_tx_autolink()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_acct uuid;
  v_res  text;
begin
  -- 이미 연결됐으면(동기화가 직접 set 한 경우) 그대로
  if new.bank_account_id is not null then
    return new;
  end if;
  v_res := coalesce(new.raw_data->>'resAccount', new.raw_data->>'account', new.raw_data->>'accountNo');
  if v_res is null or v_res = '' then
    return new;
  end if;
  select id into v_acct
    from public.bank_accounts
   where company_id = new.company_id
     and account_number = v_res
   limit 1;
  if v_acct is not null then
    new.bank_account_id := v_acct;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bank_tx_autolink on public.bank_transactions;
create trigger trg_bank_tx_autolink
  before insert on public.bank_transactions
  for each row execute function public.bank_tx_autolink();

-- 2) 기존 미연결 건 백필
update public.bank_transactions bt
   set bank_account_id = ba.id
  from public.bank_accounts ba
 where bt.bank_account_id is null
   and ba.company_id = bt.company_id
   and ba.account_number = coalesce(bt.raw_data->>'resAccount', bt.raw_data->>'account', bt.raw_data->>'accountNo')
   and coalesce(bt.raw_data->>'resAccount', bt.raw_data->>'account', bt.raw_data->>'accountNo') is not null
   and coalesce(bt.raw_data->>'resAccount', bt.raw_data->>'account', bt.raw_data->>'accountNo') <> '';
