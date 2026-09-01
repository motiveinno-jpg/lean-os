-- Migration: 계약 서명 완료 시 판매전표 자동 발행 중단 (2026-09-01 사장님)
--
-- 사장님: "수집·전표에서 직접 전표처리하지 않은 한 (매입매출전표가) 자동으로 생기지 않게 해야 돼."
-- 8/31 에 들어간 auto_voucher_on_signed 트리거(quote_approvals → auto_voucher_for_signed_quote)는
-- 양측 서명 완료 즉시 확정(confirmed) 판매전표 + 세금계산서 초안을 사람 확인 없이 만든다 —
-- 전표는 사람이 직접 처리한 것만 생겨야 한다는 원칙과 충돌해 트리거를 끈다.
--
-- · 함수(auto_voucher_for_signed_quote)는 그대로 둔다 — 되살릴 때는
--   `alter table public.quote_approvals enable trigger auto_voucher_on_signed;` 한 줄.
-- · 이 경로로 만들어진 전표는 아직 0건(reference_type='quote_approval' 없음 — 2026-09-01 실측)이라 정정 없음.
-- · 버린 안: 함수 안 feature 게이트를 전용 플래그로 교체 — 200줄 함수 재정의가 필요해
--   트리거 스위치가 더 작고 가역적이다.

alter table public.quote_approvals disable trigger auto_voucher_on_signed;
