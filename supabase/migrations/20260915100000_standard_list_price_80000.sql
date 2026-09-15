-- 오너뷰(standard) 정상가 80,000원 — 화면에 취소선으로 보이고, 실제 청구는 base_price 39,000원 그대로.
--   list_price 는 20260723160000 에서 만든 '정상가(취소선 표시용)' 칸. 20260908110000 에서 옛 값을 비웠고
--   이번에 오너뷰 값만 채운다. 결제 계산(Stripe·토스)은 base_price 만 읽는다.
update public.subscription_plans set list_price = 80000 where slug = 'standard';
