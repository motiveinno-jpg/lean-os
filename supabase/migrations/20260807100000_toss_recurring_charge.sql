-- 토스페이먼츠 자동결제 2단계 — 정기 청구 상태 컬럼 + 매일 청구 cron (2026-08-07).
--   토스는 Stripe 와 달리 구독을 대신 굴려주지 않는다. 청구 시점·재시도·미납 판정을 우리가 한다.
--   청구 시점의 진실은 subscriptions.current_period_end 다(성공해야 다음 주기로 밀린다).

alter table public.subscriptions
  add column if not exists payment_retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_payment_error text;

-- 이번 주기 청구 대상 조회용 — 대상이 적어도 매일 도는 쿼리라 인덱스를 둔다.
create index if not exists idx_subscriptions_toss_due
  on public.subscriptions (current_period_end)
  where payment_provider = 'toss';

-- 매일 02:10 KST(= 17:10 UTC) 청구 스윕.
--   ⚠️ 서비스 키를 파일에 적지 않는다 — 이미 도는 bank-sync-tick 의 헤더에서 그대로 읽어 쓴다.
DO $$
DECLARE v_cmd text; v_tok text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'bank-sync-tick';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION '기준이 될 bank-sync-tick 작업을 찾을 수 없습니다 — 토큰을 가져올 곳이 없습니다';
  END IF;
  v_tok := (regexp_match(v_cmd, 'Bearer ([A-Za-z0-9._\-]+)'))[1];
  IF v_tok IS NULL THEN
    RAISE EXCEPTION 'bank-sync-tick 에서 토큰을 찾지 못했습니다';
  END IF;

  PERFORM cron.unschedule('toss-charge-daily') FROM cron.job WHERE jobname = 'toss-charge-daily';

  PERFORM cron.schedule('toss-charge-daily', '10 17 * * *', format($f$
  SELECT net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/toss-charge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer %s'
    ),
    body := '{"mode":"due"}'::jsonb,
    timeout_milliseconds := 180000
  );
  $f$, v_tok));
END $$;
