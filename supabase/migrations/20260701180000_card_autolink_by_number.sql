-- 카드 거래 autolink 개선 — 이름 정확일치 우선, 미매칭 시 카드번호(끝4)로 매칭 (2026-07-01)
--   배경: 기존 트리거는 card_name 정확일치로만 연결. 사용자가 corporate_cards.card_name 을 바꾸면
--   CODEF 거래(card_name="롯데카드 2120")가 이름 불일치로 그 카드에 안 붙던 문제.
--   card_name 끝의 4자리를 뽑아 corporate_cards.card_number 로도 매칭 → 이름 변경 카드도 거래가 붙는다.
--   (중복 카드 생성은 클라이언트 자동등록의 번호 dedup + 이 번호매칭으로 함께 방지)

create or replace function public.trg_link_card_tx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last4 text;
begin
  if new.card_id is null and new.card_name is not null then
    -- 1) 이름 정확 일치 우선
    select id into new.card_id
    from public.corporate_cards
    where company_id = new.company_id and card_name = new.card_name
    limit 1;
    -- 2) 미매칭이면 카드번호(끝 4자리)로 매칭 — 이름 바꾼 카드도 거래가 붙도록
    if new.card_id is null then
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
