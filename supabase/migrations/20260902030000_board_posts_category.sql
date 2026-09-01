-- 게시판 글 분류(카테고리) 칸 1개 추가
--
-- History (실사 2026-09-01)
--   board_posts 에는 분류 칸이 아예 없었다. 화면의 '종류' 필터는 저장된 값이 아니라
--   pinned / poll_question 유무 / attachments 유무에서 만들어 낸 파생값뿐이라,
--   "매뉴얼", "교육자료" 같은 사람이 정하는 갈래를 담을 곳이 없다.
--
-- 왜 지금 (결정 147)
--   드팜므 문의 — 사내 매뉴얼을 어디에 두느냐. 게시판을 매뉴얼 저장소로 쓰려면
--   글을 갈래로 나눠 찾을 수 있어야 한다.
--
-- 기존 데이터 처리
--   전부 null(미분류) 그대로 둔다. 백필 없음 — 옛 글을 기계가 억지로 분류하지 않는다.
--   분류가 필요한 글은 사람이 글을 고칠 때 고른다.
--
-- RLS: 변경 없음. 기존 board_posts 정책(회사 격리)을 그대로 승계한다.

alter table public.board_posts
  add column if not exists category text;  -- null = 미분류(기존 글 전부). 값은 화면이 제한한다(공지/매뉴얼/교육자료/자유)

-- check 제약을 두지 않는 이유:
--   회사마다 갈래 이름을 늘리는 2차(카테고리 사전)를 열어두기 위해서다.
--   DB 에 값 목록을 박아두면 회사별 확장 때 마이그레이션이 또 필요하고,
--   그 사이 화면과 DB 목록이 어긋난다. 지금 단계의 제한은 화면(select)이 맡는다.

create index if not exists board_posts_category_idx on public.board_posts (company_id, category);

comment on column public.board_posts.category is
  '사내 매뉴얼 요구(드팜므 문의, 결정 147) — 게시판을 매뉴얼 저장소로 쓰기 위한 분류. null=미분류(소급 없음)';
