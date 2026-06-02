-- 카드 거래 자동 연결 — card_transactions.card_id 가 비어있으면 같은 회사의 corporate_cards 중
-- card_name 이 일치하는 카드로 자동 연결. CODEF 동기화(법인/개인 청구·승인내역)는 card_id 를
-- 채우지 않아 카드별 화면/대시보드에서 안 보이던 문제 해결.
-- 모든 INSERT 경로(엣지 sync, cron, 수동) 커버. card_id 가 이미 있으면 건드리지 않음.
create or replace function public.trg_link_card_tx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.card_id is null and new.card_name is not null then
    select id into new.card_id
    from public.corporate_cards
    where company_id = new.company_id and card_name = new.card_name
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists card_tx_autolink on public.card_transactions;
create trigger card_tx_autolink
  before insert on public.card_transactions
  for each row execute function public.trg_link_card_tx();
