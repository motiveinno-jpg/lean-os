-- 2026-05-22 카드 청구서 0원 해결 — card_transactions.card_id 전건 NULL 백필.
--   CODEF 카드 sync 가 거래를 적재하나 card_id 연결을 안 함(bank_transactions.bank_account_id 와 동일 패턴).
--   card_transactions.card_name 과 corporate_cards.card_name 이 동일 문자열로 적재됨 → 정확 일치로 매칭.
--   회사격리(company_id 일치) + 멱등(card_id IS NULL 만). 동명 중복 0건 확인 후 적용.

UPDATE card_transactions ct
   SET card_id = cc.id
  FROM corporate_cards cc
 WHERE ct.card_id IS NULL
   AND ct.company_id = cc.company_id
   AND ct.card_name = cc.card_name;
