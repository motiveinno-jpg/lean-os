-- 커넥션 점유 방지 가드 (2026-06-08, 인프라 1단계)
-- service_role 에 statement_timeout 이 없어(null) 서버 API(admin client)의 느린 쿼리가
-- 무한히 연결을 점유할 수 있었음 → 슬롯/리소스 고갈 위험. 보수적 상한 부여.
-- 참고: anon=3s, authenticated=8s, authenticator=8s 는 기존값(유지).
-- prod 에는 Management API 로 이미 반영됨. 이 파일은 repo 기록/재현용.

alter role service_role set statement_timeout = '60s';
alter role service_role set idle_in_transaction_session_timeout = '120s';
alter role authenticator set idle_in_transaction_session_timeout = '120s';
