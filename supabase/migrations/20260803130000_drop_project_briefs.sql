-- 프로젝트 브리핑을 규칙(무료)으로 확정 — AI 캐시 테이블 제거 (2026-08-03 사장님 지시:
--   "AI로 더 자세히는 지워줘. 비용이 안 드는 규칙으로만 진행").
--   생성 0행 · AI 호출 0회 상태에서 삭제하므로 잃는 데이터 없음.
--   엣지 함수 project-brief 는 빈 응답(410) 스텁으로 대체했다 — MCP 에 삭제 API 가 없어서.
drop table if exists public.project_briefs;
