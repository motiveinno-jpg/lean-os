-- 레거시 naive timestamp → timestamptz 일괄 전환 (2026-07-29, 이미 MCP 로 prod 적용 — 기록용)
--   증상: 운영자 분석 표에서 오늘 가입한 드림세무회계(17:05 KST)가 "오늘 신규회사 0".
--   원인: 초기 테이블들의 시각 컬럼이 timestamp WITHOUT time zone (UTC 벽시계 저장).
--         `at time zone 'Asia/Seoul'` 이 이런 컬럼을 "이미 KST"로 역해석해 9시간을
--         거꾸로 빼 어제로 분류. 화면 JS 파싱(무TZ 문자열=로컬 해석)도 동일하게 어긋남.
--   수정: 저장값 전부 UTC 벽시계 확인(드림세무회계 08:05 저장 = 17:05 KST 실가입 일치) 후
--         `using col at time zone 'UTC'` 로 의미 보존 전환. 뷰 의존성 0 확인.
--         전환 후 기존 KST 변환식(platform_analytics·signup_funnel·usage_stats)과
--         클라이언트 Date 파싱이 전부 자동으로 올바르게 동작 — 함수 수정 불필요.
alter table public.companies             alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.users                 alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.employees             alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.deals                 alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.deal_nodes            alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.deal_cost_schedule    alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.deal_cost_schedule    alter column approved_at type timestamptz using approved_at at time zone 'UTC';
alter table public.deal_revenue_schedule alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.deal_revenue_schedule alter column received_at type timestamptz using received_at at time zone 'UTC';
alter table public.transactions          alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.transactions          alter column updated_at  type timestamptz using updated_at  at time zone 'UTC';
alter table public.transaction_matches   alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.vendors               alter column created_at  type timestamptz using created_at  at time zone 'UTC';
alter table public.cash_snapshot         alter column updated_at  type timestamptz using updated_at  at time zone 'UTC';
notify pgrst, 'reload schema';
