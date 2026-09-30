-- 카드 승인내역의 '전체 취소' 줄 정리 — 모티브 56줄.
--   취소를 따로 주지 않는 카드사는 원래 승인 줄에 resCancelYN=1 만 붙여 보낸다. 금액이 양수 그대로라
--   '[취소] …' 줄이 취소된 결제를 지출로 잡았다(가승인 택시비·100원 인증 등). codef-sync 는 이제 이런 줄을 넣지 않는다.
--   지우는 것: [취소] · 양수 · cancelYN=1 이고, 같은 승인번호에 음수 줄이 없는 것(음수 줄이 있으면 이 줄이 결제 자리라 합이 0).
--   전표·사람 손(매핑한 사람·메모·영수증·딜·사용자·태그)·통장 연결이 하나라도 있으면 멈춘다.
begin;
do $$
declare v_n int; v_touched int;
begin
  create temp table _cancel_rows on commit drop as
  select c.id, c.journal_entry_id, c.mapped_by, c.memo, c.receipt_url, c.deal_id, c.used_by_employee_id, c.tags
    from public.card_transactions c
   where c.company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
     and c.merchant_name like '[취소]%' and c.amount > 0 and c.raw_data->>'cancelYN' = '1'
     and not exists (select 1 from public.card_transactions o
                      where o.company_id = c.company_id and o.approval_number = c.approval_number and o.id <> c.id and o.amount < 0);
  select count(*) into v_n from _cancel_rows;
  select count(*) into v_touched from _cancel_rows
   where journal_entry_id is not null or mapped_by is not null or coalesce(memo, '') <> '' or receipt_url is not null
      or deal_id is not null or used_by_employee_id is not null or coalesce(array_length(tags, 1), 0) > 0
      or exists (select 1 from public.bank_transactions b where b.card_transaction_id = _cancel_rows.id);
  if v_n <> 56 or v_touched > 0 then
    raise exception 'unexpected rows: % (touched %)', v_n, v_touched;
  end if;
  delete from public.card_transactions where id in (select id from _cancel_rows);
  get diagnostics v_n = row_count;
  if v_n <> 56 then raise exception 'deleted % rows, expected 56', v_n; end if;
end $$;
commit;
