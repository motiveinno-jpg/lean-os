-- 재고 규칙형 자동화 1차 (2026-08-27 사장님 "시작해", docs/20260827_PLAN_inventory_rule_automation.md 결정 89)
--   lead_time_days: '곧 부족' = 현재고 ÷ 30일 평균 일 출고 < 리드타임 (기본 7일)
--   auto_suggest: 품목별 자동 제안 끄기(시즌성·수동 조정 중)
alter table public.products add column if not exists lead_time_days int not null default 7 check (lead_time_days >= 0);
alter table public.products add column if not exists auto_suggest boolean not null default true;
