-- realtime CPU 스파이크 완화 (2026-06-17 간헐 504 진단)
--   bank_transactions(5,482행)·card_transactions(2,912행)는 CODEF 동기화 때 수천 건이
--   insert/update 되는데, supabase_realtime publication 에 들어 있어 변경마다 WAL 디코딩이
--   일어나 micro 컴퓨트 CPU 를 포화시킴(118k+ 디코딩) → 간헐 connection/worker startup 타임아웃 → 504.
--   구독 페이지(bank/cards)는 정상 동작하되 '라이브 푸시'만 중단(데이터는 쿼리로 로드, 포커스 시 갱신).
--   되돌리려면 ALTER PUBLICATION ... ADD TABLE 로 복구.
alter publication supabase_realtime drop table public.bank_transactions;
alter publication supabase_realtime drop table public.card_transactions;
