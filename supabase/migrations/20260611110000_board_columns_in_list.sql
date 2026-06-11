-- 2026-06-11 메인 리스트 vs 상세 컬럼 분리.
--   in_list=true 컬럼만 프로젝트 메인 리스트에 표시. 상세(서브아이템 표)는 전체 컬럼 표시.
--   기존 데이터: 회사별 첫 배치 insert(기본 5컬럼)만 in_list=true 로 마킹, 상세에서 추가돼 샌 컬럼은 false 유지.
alter table public.board_columns add column if not exists in_list boolean not null default false;
update public.board_columns b set in_list = true
  where b.in_list = false
    and b.created_at = (select min(b2.created_at) from public.board_columns b2 where b2.company_id = b.company_id);
