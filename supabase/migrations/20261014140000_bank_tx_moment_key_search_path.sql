-- bank_tx_moment_key(text) search_path 고정 — 2026-10-14 보안 advisor function_search_path_mutable 해소
--
-- 왜: 20261014120000_bank_tx_same_moment_dedupe.sql 에서 만든 함수에 search_path 가 없어 advisor 경고가 났다.
--     (그 파일은 다른 PC 작업분이라 고치지 않고 새 파일로 얹는다.)
--
-- 규칙: search_path = '' — 본문은 split_part 와 || 만 쓴다. pg_catalog 는 search_path 가 비어도 항상 먼저 찾으므로 결과가 같다.
--       IMMUTABLE·PARALLEL SAFE·결과값은 그대로라 표현식 인덱스 idx_bank_tx_moment_key 를 다시 만들 필요가 없다.
--       쓰는 곳(같이 확인함): 인덱스 idx_bank_tx_moment_key, 트리거 함수 bank_tx_skip_same_moment(), run_daily_reconciliation().
--
-- 기존 데이터: 바꾸지 않는다.
-- 버린 안: create or replace 로 본문을 다시 쓰기 — 남의 파일 정의를 복제하게 되고, 바뀌는 건 설정 한 줄뿐이다.
--          / search_path = public, pg_temp — 본문이 public 객체를 안 쓴다. 비우는 쪽이 가장 좁다.

alter function public.bank_tx_moment_key(text) set search_path = '';
