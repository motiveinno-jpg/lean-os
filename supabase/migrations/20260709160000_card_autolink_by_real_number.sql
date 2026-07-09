-- 카드 거래 autolink — 실제 카드번호(raw_data) 우선 매칭 (2026-07-09)
--   배경: CODEF 가 개별 거래에 카드명(resCardName)을 안 줄 때 sync 가 카드사 이름("BC카드" 등)으로
--   대체 저장 → 여러 실제 카드 거래가 같은 이름을 갖고, 이름 기준 autolink 가 번호없는 껍데기 카드
--   하나에 몰아 연결(카드별 거래 섞임). 지난 번호매칭(card_autolink_by_number)은 card_name 끝4로만
--   봐서 이름이 "BC카드"면 무력.
--   조치: raw_data 의 실제 카드번호(cardNo / approval.resCardNo / charge.resCardNo) 끝4 를
--   최우선으로 corporate_cards.card_number 에 매칭 → 이름이 issuer fallback 이어도 올바른 카드로 연결.
create or replace function public.trg_link_card_tx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last4 text;
begin
  if new.card_id is null then
    -- 1) 실제 카드번호(raw_data) 끝4 우선 — 이름과 무관하게 올바른 카드로 연결.
    --    청구내역은 charge.resUsedCard 에 전체 마스킹 카드번호("5298****6953")가 들어있음(가장 신뢰).
    v_last4 := right(regexp_replace(coalesce(
      nullif(new.raw_data->'charge'->>'resUsedCard', ''),
      nullif(new.raw_data->'approval'->>'resCardNo', ''),
      nullif(new.raw_data->>'cardNo', ''),
      new.raw_data->'charge'->>'resCardNo', ''), '[^0-9]', '', 'g'), 4);
    if v_last4 is not null and length(v_last4) = 4 then
      select id into new.card_id
      from public.corporate_cards
      where company_id = new.company_id and card_number = v_last4
      limit 1;
    end if;
    -- 2) 이름 정확 일치
    if new.card_id is null and new.card_name is not null then
      select id into new.card_id
      from public.corporate_cards
      where company_id = new.company_id and card_name = new.card_name
      limit 1;
    end if;
    -- 3) 이름 끝4자리(이름을 바꾼 카드 대응)
    if new.card_id is null and new.card_name is not null then
      v_last4 := (regexp_match(new.card_name, '(\d{4})\s*$'))[1];
      if v_last4 is not null then
        select id into new.card_id
        from public.corporate_cards
        where company_id = new.company_id and card_number = v_last4
        limit 1;
      end if;
    end if;
  end if;
  return new;
end;
$$;
