-- 프로젝트 항목(project_items) 다중 담당 칸 추가 — 2026-09-01
--
-- 왜:
--   지금까지 project_items 에는 단일 담당 칸(assignee_id uuid) 하나만 있어
--   "담당자가 여러 명일 수도" (2026-09-01 사장님) 인 실제 업무를 담을 수 없었다.
--   한 항목에 두 명 이상을 걸면 뒤에 고른 사람이 앞 사람을 덮어써 기록이 사라진다.
--
-- assignee_ids 를 '단일 출처'로 갈아타지 않는 이유:
--   assignee_id 를 읽는 화면·경로가 이미 넓다 — 목록의 참여자 칸, 내 작업(내게 배정된 항목),
--   엑셀 내보내기, 칸반 그룹핑·필터. 이걸 한 번에 배열 기준으로 바꾸면 파급이 커
--   한 곳만 놓쳐도 "내 작업에서 사라짐" 같은 조용한 사고가 난다.
--   그래서 **대표 담당 규약**으로 안전하게 간다: assignee_ids 가 전체 담당,
--   assignee_id 는 그 배열의 첫 명(대표 담당)으로 계속 유지한다.
--   기존 화면은 손대지 않아도 그대로 동작하고, 새 화면만 배열을 읽는다.
--
-- 이 마이그레이션이 하는 것: 칸 추가 + 기존 단일 담당 백필. 그 외 변경 없음.
-- RLS·인덱스·트리거 변경 없음 (project_items 기존 정책·제약 그대로 승계).

alter table public.project_items
  add column if not exists assignee_ids uuid[] not null default '{}'::uuid[];

comment on column public.project_items.assignee_ids is
  '다중 담당(2026-09-01 사장님 ''담당자가 여러 명일 수도''). **assignee_id 는 대표 담당 = 이 배열의 첫 명** — 목록·내 작업·칸반 등 기존 화면 파급을 줄이려 이중 저장하며, 화면(TableV3 toggleAssignee)이 항상 둘을 같이 쓴다. followers uuid[] 와 같은 문법.';

-- 기존 단일 담당을 배열로 백필(빈 배열인 행만 — 재실행 안전)
update public.project_items
  set assignee_ids = array[assignee_id]
  where assignee_id is not null and assignee_ids = '{}'::uuid[];
