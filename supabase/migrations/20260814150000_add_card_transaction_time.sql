-- 카드 거래에 결제 승인 시각(transaction_time) 추가 + 기존 수집분 소급 복원
--
-- History / 판단 근거 (2026-08-14)
--   지금까지 카드 거래는 transaction_date(날짜)만 저장했다. CODEF 승인내역 응답에는
--   결제 시각이 같이 오는데 버려지고 있어서, 같은 날 같은 가맹점 건을 사람이 구분할 수 없었다.
--
--   시각 소스 후보를 세 개 검토했고 그 중 하나는 폐기했다:
--     ① raw_data->'approval'->>'resUsedTime'  (승인내역) — 채택. prod 401건 보유.
--     ② raw_data->>'usedTime'                  (수집기 평면 필드) — 채택하되 실효 0건.
--        값이 있는 401건은 ①과 같은 행이고, 나머지 1436건은 빈 문자열이다.
--        청구내역만 내려온 건은 카드사가 시각을 아예 주지 않는다.
--     ③ split_part(external_id,'_',5)          — ✗ 폐기.
--        external_id 형식은 codef_card_{카드}_{날짜}_{승인번호}_{가맹점}_{금액} 이라
--        5번째 조각은 시각이 아니라 승인번호다. prod 에서 이 조각이 6자리인 80건을
--        검사한 결과 80건 전부 approval_number 와 문자열이 동일했고, 그 중 72건은
--        시/분/초 범위를 벗어나 ::time 캐스팅 자체가 실패한다(= update 문 전체 실패).
--        남는 8건은 "우연히 00~23시 범위에 든 승인번호"일 뿐이라, 저장하면 승인번호가
--        결제시각으로 둔갑해 조용히 오염된다. 그래서 소스에서 제외한다.
--
--   시각을 못 채운 건은 추정하지 않고 null 로 둔다 — 화면에서 날짜만 보여주면 된다.
--
-- 적용 시점: 즉시. 기존 데이터는 아래 update 로 소급 복원(401건).
-- RLS: 컬럼 추가뿐이라 기존 card_transactions 정책 그대로. 신규 정책 없음.
-- 인덱스: 시각 단독 조회 화면이 없어 만들지 않는다.

alter table public.card_transactions
  add column if not exists transaction_time time;

comment on column public.card_transactions.transaction_time is
  '결제 승인 시각(HHMMSS, 카드사 승인내역 원본). 청구내역만 있는 건은 시각 미제공이라 null — 날짜만 신뢰.';

-- 소급 복원. transaction_time is null 조건이 있어 재실행해도 안전하다.
update public.card_transactions t
set transaction_time = (
      substr(s.v, 1, 2) || ':' || substr(s.v, 3, 2) || ':' || substr(s.v, 5, 2)
    )::time
from (
  select id,
    case
      when raw_data->'approval'->>'resUsedTime' ~ '^\d{6}$'
        then raw_data->'approval'->>'resUsedTime'
      when raw_data->>'usedTime' ~ '^\d{6}$'
        then raw_data->>'usedTime'
    end as v
  from public.card_transactions
  where source = 'codef_card'
    and transaction_time is null
) s
where t.id = s.id
  and s.v is not null
  -- 6자리라도 시/분/초 범위를 벗어나면 캐스팅이 실패하므로 건드리지 않는다(null 유지).
  and substr(s.v, 1, 2)::int between 0 and 23
  and substr(s.v, 3, 2)::int between 0 and 59
  and substr(s.v, 5, 2)::int between 0 and 59;
