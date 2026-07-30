-- Migration: drop_feedback (2026-07-28, 사장님 지시 "피드백 코드 없애버려")
-- 배경: 피드백 입력구가 요금제 화면 구석에 숨어 있어 아무도 못 찾음 — 적재 0건.
--   고객 의견 수집은 고객센터(support_tickets) 단일 창구로 일원화.
--   앱 코드(billing 탭·운영자 페이지·메뉴·개요 인박스)는 같은 커밋에서 제거됨.
-- 삭제 시점 상태: 0행, 인바운드 FK 0건, 참조 함수 0건 — CASCADE 불필요.
drop table if exists public.feedback;
