-- Production-grade hometax sync — lock 으로 동시 호출 차단 + retry 로 timeout/CF-00016 자동 보완.

-- in_progress: atomic CAS lock. step 처리 중인 job 의 동시 호출 차단.
-- last_lock_at: lock 획득 시각. 5분+ 지나면 worker 죽었다고 간주 + lock 자동 해제.
ALTER TABLE public.hometax_sync_jobs
  ADD COLUMN IF NOT EXISTS in_progress boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_lock_at timestamptz;

-- 인덱스 — cron-tick 이 빠르게 active job 찾도록.
CREATE INDEX IF NOT EXISTS hometax_sync_jobs_active_idx
  ON public.hometax_sync_jobs(status, in_progress, updated_at)
  WHERE status IN ('pending', 'running');

COMMENT ON COLUMN public.hometax_sync_jobs.in_progress IS
  'atomic lock — step 처리 중이면 true. cron 또는 다른 호출이 동시 처리 시도 시 즉시 종료. 5분+ 지나면 stale 로 간주.';

-- result_per_month 의 각 entry 에 retry_count 추가 (코드 측에서 관리).
-- DB 레벨에선 jsonb 라 schema 강제 못 함. 코드가 retry_count 0~3 으로 관리.
