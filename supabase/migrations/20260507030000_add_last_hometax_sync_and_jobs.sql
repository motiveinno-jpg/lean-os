-- Phase 1: Incremental Sync — 마지막 sync 시각 추적해서 그 이후 데이터만 가져옴.
-- 한국 세무 관행상 작성일자가 늦게 발행되는 세금계산서도 있어 30일 buffer 적용.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS last_hometax_sync_at timestamptz;

COMMENT ON COLUMN public.company_settings.last_hometax_sync_at IS
  'Incremental sync 기준 — 마지막 hometax sync 성공 시각. 다음 sync 시 이 시각 - 30일 ~ today 만 가져옴.';

-- Phase 2: Background Sync Jobs — 사용자가 페이지 떠나도 백그라운드에서 처리.
CREATE TABLE IF NOT EXISTS public.hometax_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  total_synced int NOT NULL DEFAULT 0,
  total_response int NOT NULL DEFAULT 0,
  result_per_month jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ month, synced, responseCount, status, errorMsg }]
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_progress jsonb,                                -- { done, total, label }
  triggered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hometax_sync_jobs_company_status_idx
  ON public.hometax_sync_jobs(company_id, status, created_at DESC);

ALTER TABLE public.hometax_sync_jobs ENABLE ROW LEVEL SECURITY;

-- RLS: 같은 회사 사용자만 자기 회사의 sync job 조회/생성.
DROP POLICY IF EXISTS "Company can read own sync jobs" ON public.hometax_sync_jobs;
CREATE POLICY "Company can read own sync jobs"
  ON public.hometax_sync_jobs
  FOR SELECT
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "Company can insert own sync jobs" ON public.hometax_sync_jobs;
CREATE POLICY "Company can insert own sync jobs"
  ON public.hometax_sync_jobs
  FOR INSERT
  WITH CHECK (company_id = public.get_my_company_id());

-- Worker edge function 이 service_role 로 update 하므로 별도 update 정책 불필요.

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_hometax_sync_jobs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hometax_sync_jobs_updated_at ON public.hometax_sync_jobs;
CREATE TRIGGER trg_hometax_sync_jobs_updated_at
  BEFORE UPDATE ON public.hometax_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_hometax_sync_jobs_updated_at();

-- Realtime publication 에 추가 — frontend 가 변경 구독 가능
ALTER PUBLICATION supabase_realtime ADD TABLE public.hometax_sync_jobs;

COMMENT ON TABLE public.hometax_sync_jobs IS
  '홈택스 동기화 백그라운드 작업 큐. 사용자 클릭 → INSERT → edge function 백그라운드 처리 → status/result 업데이트. Realtime 구독으로 진행 상황 표시.';
