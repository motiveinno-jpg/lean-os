-- 법인카드 번호는 "카드사가 보여 주는 꼬리"만 저장한다. 롯데·아멕스는 3자리, 그 외는 4자리.
--   2026-09-03 롯데카드 한 장이 사람이 아는 실제 번호(7923)로 손수 고쳐져 나머지 롯데카드(120·241, 3자리)와
--   형식이 달랐다. 앞으로는 어떤 경로(수집·직접 입력·수정)로 들어와도 같은 규칙으로 맞춘다.
create or replace function public.corporate_cards_normalize_number()
returns trigger
language plpgsql
as $$
declare
  v_digits text;
  v_keep int;
begin
  if new.card_number is null then return new; end if;
  v_digits := regexp_replace(new.card_number, '[^0-9]', '', 'g');
  if v_digits = '' then new.card_number := null; return new; end if;
  v_keep := case when new.card_company in ('롯데', '롯데카드', '아멕스', 'AMEX') then 3 else 4 end;
  new.card_number := right(v_digits, v_keep);
  return new;
end;
$$;
drop trigger if exists trg_corporate_cards_normalize_number on public.corporate_cards;
create trigger trg_corporate_cards_normalize_number
  before insert or update of card_number, card_company on public.corporate_cards
  for each row execute function public.corporate_cards_normalize_number();

-- 기존 행도 같은 규칙으로. 자동 이름("롯데카드 7923")은 보이는 꼬리 표기("롯데카드 *923")로 맞춘다.
update public.corporate_cards
   set card_number = right(regexp_replace(card_number, '[^0-9]', '', 'g'), 3),
       card_name = case when card_name ~ ('^롯데카드 [0-9]{4}$') then '롯데카드 *' || right(regexp_replace(card_number, '[^0-9]', '', 'g'), 3) else card_name end
 where card_company in ('롯데', '롯데카드', '아멕스', 'AMEX')
   and length(regexp_replace(coalesce(card_number,''), '[^0-9]', '', 'g')) > 3;
