-- 입고 줄에 로트·유통기한 (2026-09-21, 랜딩 문구 대조 🟠 → 기능으로 참으로)
--
-- History
--   · 재고는 '움직인 기록(stock_moves)의 합'이고 원가는 입고분(층, stock_cost_layers)마다 선입선출로 나간다(결정 3·FIFO).
--   · 업종 페이지(식품 제조, 2026-09-16)가 "로트와 유통기한까지 재고에 함께 남깁니다 · 기한이 가까운 것부터 띄웁니다" 라고 적었는데
--     입고 줄에 그 칸이 없었다.
--
-- 기준
--   · 로트·유통기한은 **입고 줄(stock_moves)** 에 남긴다 — 층이 move 를 가리키므로 "어느 입고분이 남았나(qty_left)" 와 그대로 이어진다.
--     새 표를 만들지 않는다. 선입선출은 이미 먼저 들어온 층부터 나가므로 기한 순서와 대체로 같다(입고 순 ≠ 기한 순인 예외는 실사·정정으로).
--   · 칸은 양식 고치기에서 켠 회사만 본다(form_layouts 'lot'·'expiry', 기본 꺼짐) — 유통기한이 없는 업종은 화면이 그대로다.
--   · 창고관리 현재고에는 **남아 있는 층 중 가장 이른 유통기한** 과 D-n 이 뜬다. 지난 것은 '기한 지남', 30일 안은 '기한 임박'.
--   · 판매 출고 줄에는 적지 않는다 — 어느 층이 나갔는지는 stock_move_costs.layers 가 이미 안다.

alter table public.stock_moves
  add column if not exists lot_no text,
  add column if not exists expiry_date date;
comment on column public.stock_moves.lot_no is '입고 묶음(로트) 번호 — 입고 줄에만. 양식에서 칸을 켠 회사만 적는다.';
comment on column public.stock_moves.expiry_date is '이 입고분의 유통기한 — 창고관리가 남은 층(qty_left>0) 중 가장 이른 날을 띄운다.';

create index if not exists stock_moves_expiry_idx
  on public.stock_moves (company_id, product_id, expiry_date) where expiry_date is not null;
