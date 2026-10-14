-- 통장 행 '없으면 만들기' 가 겹치면 두 번째가 23505 로 실패했다(통장 화면 이름·숨김·수집 토글을 연달아 누를 때).
--   유일 인덱스가 부분 인덱스(WHERE account_number IS NOT NULL)라 PostgREST upsert(on_conflict)가 추론하지 못해
--   앱이 '고치기 → 없으면 넣기' 두 번 왕복으로 짰고, 그 사이에 다른 요청이 넣으면 충돌한다.
--   NULL 은 유일 인덱스에서 서로 다른 값이라 WHERE 를 빼도 뜻이 같다 — 전체 인덱스로 바꿔 upsert 를 쓸 수 있게 한다.
create unique index if not exists bank_accounts_company_account_key on public.bank_accounts (company_id, account_number);
drop index if exists public.bank_accounts_company_account_uniq;
