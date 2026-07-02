-- 카드 생성 시 미연결 거래 소급 연결 (2026-07-02, QA 발견 레이스 수정)
--   배경: card_approval sync 가 거래를 card_name="롯데카드"(CARD_CODES[org])로 먼저 insert 하는데,
--   그 시점에 해당 corporate_cards 행이 아직 없으면 BEFORE INSERT autolink(trg_link_card_tx)가
--   빈손 → card_id null. 카드가 나중에 생겨도 기존 거래는 안 붙어 카드별 화면에서 누락(28건 발견).
--   해결: corporate_cards INSERT 후, 같은 회사의 미연결 거래 중 이름 또는 카드번호(끝4) 일치분을 소급 연결.
--   (한 번 backfill 로 처리한 기존 28건과 동일 규칙 — 앞으로 모든 신규 카드에 자동 적용)

create or replace function public.card_backlink_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.card_transactions t
     set card_id = new.id
   where t.company_id = new.company_id
     and t.card_id is null
     and (
       t.card_name = new.card_name
       or (new.card_number is not null and (regexp_match(t.card_name, '(\d{4})\s*$'))[1] = new.card_number)
     );
  return new;
end;
$$;

drop trigger if exists trg_card_backlink_on_insert on public.corporate_cards;
create trigger trg_card_backlink_on_insert
  after insert on public.corporate_cards
  for each row execute function public.card_backlink_on_insert();
