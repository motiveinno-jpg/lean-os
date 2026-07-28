-- 구버전 요금제 행 삭제 (2026-07-28 사장님 지시)
--   Starter(49,000)·Pro(99,000)는 4월 요금제 개편 때 is_active=false 로 숨기기만 하고
--   행을 남겨뒀다. 운영자 시스템 현황 화면이 is_active 필터 없이 전부 뿌려서
--   "지운 요금제가 계속 보인다"는 혼란이 있었다.
--   현행 프로의 slug 는 'basic' 이라 구버전 'pro' 와 이름이 겹쳐 더 헷갈렸다.
--
--   활성 구독 0건 확인 후 삭제. subscriptions.plan_id 만 이 테이블을 참조하며
--   해당 플랜 참조는 0건이었다.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

delete from subscription_plans where slug in ('starter','pro');
