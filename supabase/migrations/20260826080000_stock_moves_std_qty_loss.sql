-- 생산 로스·불량 (결정 29, 2026-08-26 사장님 "추천대로")
--   자재 투입 줄에 표준 투입(std_qty)을 같이 남긴다. 로스 = qty − std_qty. 별도 로스 문서 없음 — 자재 투입 문서 하나가 진실.
--   기존 줄은 null = "표준=실투입"(로스 0)으로 읽는다. 지어내지 않는다.
--   불량은 '불량 보류' 창고(code DEFECT)로 들어간다 — 새 상태 칸이 아니라 창고라서 현재고·실사·이동평균이 그대로 안다(결정 30).
alter table public.stock_moves add column if not exists std_qty numeric null;
alter table public.stock_moves add column if not exists loss_reason text null check (loss_reason is null or loss_reason in ('spill','scrap','bad_material','other'));
comment on column public.stock_moves.std_qty is '자재 투입 줄의 표준 투입(BOM×투입 기준). 로스 = qty − std_qty. null = 로스 기록 없음';
comment on column public.stock_moves.loss_reason is '로스 원인 — spill 흘림 / scrap 자투리 / bad_material 불량 자재 / other 기타';
