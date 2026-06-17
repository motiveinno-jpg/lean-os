-- 카드거래 중복 INSERT 차단 (2026-06-17, 카드 동기화 재중복 방지)
--   원인: codef-sync 의 external_id 가 불안정(approvalNo||totalSynced 카운터, usedTime) → 재동기화마다
--   같은 거래가 새 external_id 로 INSERT 되어 중복 누적(2912 중 505 중복 정리함).
--   edge 배포 없이 DB 레벨에서 내용 기준(회사·일자·금액·가맹점·승인번호) 동일 행 INSERT 를 스킵.
--   upsert 의 UPDATE 경로(external_id 일치)는 BEFORE INSERT 가 발화 안 하므로 정상 갱신됨.
create or replace function public.card_tx_prevent_dup()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.card_transactions c
    where c.company_id = new.company_id
      and c.transaction_date = new.transaction_date
      and c.amount = new.amount
      and coalesce(c.merchant_name, '') = coalesce(new.merchant_name, '')
      and coalesce(c.approval_number, '') = coalesce(new.approval_number, '')
  ) then
    return null; -- content-duplicate: skip insert (no error)
  end if;
  return new;
end;
$$;

drop trigger if exists trg_card_tx_prevent_dup on public.card_transactions;
create trigger trg_card_tx_prevent_dup
  before insert on public.card_transactions
  for each row execute function public.card_tx_prevent_dup();
