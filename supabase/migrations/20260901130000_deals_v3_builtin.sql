-- 프로젝트 v3: 내장 열(담당·상태·마감·금액)의 사용자화 — 숨김/이름/전체 열 순서.
-- { hidden: ["amount"], labels: {"assignee":"책임자"}, order: ["status","assignee","견적",…] }
-- order 는 내장 키와 커스텀 컬럼 key 가 섞인 전체 순서. null = 기본(2026-09-01 사장님 "내장 열도 삭제·개명·이동").
-- RLS: deals 기존 정책(회사 격리) 그대로 적용 — 컬럼 추가라 새 정책 불필요.
alter table public.deals add column if not exists v3_builtin jsonb;
comment on column public.deals.v3_builtin is '프로젝트 v3 내장 열 사용자화(hidden/labels/order) — null = 기본 (2026-09-01)';
