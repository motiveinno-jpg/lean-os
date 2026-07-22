-- billing_events.event_type CHECK 확장 — 코드가 실제 emit 하지만 CHECK 에서 거부되던 타입들 추가.
--   증상: cancel/webhook 의 billing_events insert 가 CHECK 위반으로 조용히 실패(감사 트레일 누락).
--   기존 허용값은 그대로 두고 코드 emit 값 합집합으로 확대(데이터 변경 없음, 제약만 완화).
alter table public.billing_events drop constraint if exists billing_events_event_type_check;
alter table public.billing_events add constraint billing_events_event_type_check
  check (event_type = any (array[
    -- 기존 허용
    'payment_success','payment_failed','plan_changed','subscription_created',
    'subscription_canceled','subscription_paused','subscription_resumed','refund',
    'trial_started','trial_ended','seat_changed',
    -- 코드가 실제 emit (누락되어 있던 것)
    'checkout_completed','feedback_received','invoice_paid','payment_confirm_failed',
    'payment_confirmed','subscription_cancel_requested','subscription_deleted','subscription_ended',
    'subscription_updated',
    -- 내부 운영
    'internal_plan_restored'
  ]));
