-- Migration: drop_referral_codes
-- 추천인 코드 기능 제거(2026-07-27). 앱 코드는 커밋 3b98886 에서 이미 삭제됨.
--
-- 배경: 코드 발급·조회만 있고 입력받는 경로가 없어(applyReferralCode 호출 0건)
--   referred_count·credit_earned 가 구조적으로 항상 0 인 미완성 기능이었다.
--   같은 목적은 sales_codes + sales_code_redemptions(20260727064252)가 대체한다
--   — 그쪽은 redemption 원장이 있어 중복 적용을 막을 수 있다.
--
-- 삭제 시점 상태: 1행(code=2MLUHNW4, company_id=c361afb9-8a52-4cac-add9-8992f0f7c09c,
--   referred_count=0, credit_earned=0, created_at=2026-06-11T04:53:33.803476+00).
--   외래키·뷰·함수·트리거 참조 0건, 자기 RLS 정책 2개뿐이라 CASCADE 없이 안전.

drop table if exists public.referral_codes;
