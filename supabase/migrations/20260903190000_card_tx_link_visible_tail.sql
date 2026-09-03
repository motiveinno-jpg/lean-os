-- 카드 거래 ↔ 법인카드 자동 연결: 마스킹 카드번호의 "보이는 꼬리"로 맞춘다 (2026-09-03 사장님: 롯데카드 2923? 실제는 7923)
--   롯데(아멕스 15자리)는 "3792********923"처럼 뒤 3자리만 보인다. 종전 규칙(숫자만 남기고 오른쪽 4자리)은
--   앞자리 '2'를 끌어와 "2923"이라는 없는 번호를 만들었다. 이제 마지막 '*' 뒤의 숫자만 쓰고,
--   4자리 미만이면 등록된 카드번호의 끝부분과 맞춘다(like '%923').
create or replace function public.trg_link_card_tx()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_raw text;
  v_tail text;
begin
  if new.card_id is null then
    v_raw := coalesce(nullif(new.raw_data->'charge'->>'resUsedCard',''), nullif(new.raw_data->'approval'->>'resCardNo',''),
                      nullif(new.raw_data->>'cardNo',''), new.raw_data->'charge'->>'resCardNo', '');
    -- 마지막 마스크(*) 뒤의 숫자만 — 마스크가 없으면 전체 숫자의 오른쪽 4자리
    v_tail := regexp_replace(regexp_replace(v_raw, '^.*\*', ''), '[^0-9]', '', 'g');
    if v_tail = '' then v_tail := regexp_replace(v_raw, '[^0-9]', '', 'g'); end if;
    if length(v_tail) > 4 then v_tail := right(v_tail, 4); end if;
    if v_tail <> '' then
      if length(v_tail) = 4 then
        select id into new.card_id from public.corporate_cards where company_id = new.company_id and card_number = v_tail limit 1;
      else
        select id into new.card_id from public.corporate_cards
         where company_id = new.company_id and card_number is not null and card_number like '%' || v_tail
         order by length(card_number) desc limit 1;
      end if;
    end if;
    if new.card_id is null and new.card_name is not null then
      select id into new.card_id from public.corporate_cards where company_id = new.company_id and card_name = new.card_name limit 1;
    end if;
    if new.card_id is null and new.card_name is not null then
      v_tail := (regexp_match(new.card_name, '(\d{3,4})\s*$'))[1];
      if v_tail is not null then
        select id into new.card_id from public.corporate_cards
         where company_id = new.company_id and card_number is not null and card_number like '%' || v_tail
         order by length(card_number) desc limit 1;
      end if;
    end if;
  end if;
  return new;
end;
$function$;
