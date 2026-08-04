-- 대시보드 위젯 그리드(선택·배치)를 계정 단위로 동기화 (2026-08-04 사장님: "다른 컴퓨터에서 로그인해도 위젯 편집 적용되게")
-- 기존 dashboard_widgets(레거시 board-context 형식)와 충돌하지 않도록 별도 컬럼.
-- 형식: { [storageKey]: { layout: [...], active: [...], layout_mig, active_mig, saved_at } }
-- RLS 변경 없음 — user_preferences 는 이미 본인 행(user_id = auth.uid()) 정책 4종 보유.
alter table public.user_preferences add column if not exists dashboard_grid jsonb;
