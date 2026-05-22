-- 2026-05-22 거래처원장 완전 제거 (사장님 결정) — 라우트·진입점 삭제 후 RPC DROP.
--   호출처: /partners/ledger/page.tsx 단 1곳뿐이었고 해당 라우트 삭제됨 → 호출 0.
--   다른 RPC/뷰 의존성 없음 확인.

DROP FUNCTION IF EXISTS public.get_partner_ledger(text, date, date);
