-- 요금제 표에서 쓰지 않는 옛 열과 값을 없앤다.
--   반기 결제(stripe_price_semiannual·semiannual_discount)와 max_employees 는 어느 코드도 읽지 않는다.
--   울트라의 list_price(220,000)는 옛 정가라 비운다.
alter table public.subscription_plans
  drop column if exists stripe_price_semiannual,
  drop column if exists semiannual_discount,
  drop column if exists max_employees;
update public.subscription_plans set list_price = null where list_price is not null;
