-- 데이터 초기화 기능 제거 (2026-08-10 사장님 지시: "데이터 초기화는 없애자, 회사 삭제만 놔둬")
--
-- 화면(설정 > 시스템 > 데이터 관리)과 함께 서버 함수도 제거한다.
-- 이 함수는 session_replication_role 을 쓰는데 운영 postgres 롤에 그 권한이 없어
-- 어차피 실행하면 실패할 상태였다(2026-08-10 확인). 완전 삭제는 master_delete_company 가 맡는다.

drop function if exists public.reset_company_data(uuid);
