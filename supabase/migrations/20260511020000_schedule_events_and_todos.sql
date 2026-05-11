-- 일정 (캘린더 이벤트) + 투두 (할일)

-- 1) 캘린더 이벤트
CREATE TABLE IF NOT EXISTS public.schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','green','red','amber','violet','gray')),
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_events_company_start_idx
  ON public.schedule_events(company_id, start_at DESC);
CREATE INDEX IF NOT EXISTS schedule_events_user_idx
  ON public.schedule_events(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.schedule_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view shared or own events" ON public.schedule_events;
CREATE POLICY "view shared or own events"
  ON public.schedule_events FOR SELECT
  USING (
    company_id = public.get_my_company_id()
    AND (is_shared = true OR user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()))
  );

DROP POLICY IF EXISTS "manage own events" ON public.schedule_events;
CREATE POLICY "manage own events"
  ON public.schedule_events FOR ALL
  USING (
    company_id = public.get_my_company_id()
    AND user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

-- 2) 투두
CREATE TABLE IF NOT EXISTS public.schedule_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  priority int NOT NULL DEFAULT 1 CHECK (priority IN (0,1,2)),
  due_date date,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_todos_user_done_idx
  ON public.schedule_todos(user_id, done, position);
CREATE INDEX IF NOT EXISTS schedule_todos_due_idx
  ON public.schedule_todos(user_id, due_date) WHERE done = false;

ALTER TABLE public.schedule_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manage own todos" ON public.schedule_todos;
CREATE POLICY "manage own todos"
  ON public.schedule_todos FOR ALL
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()))
  WITH CHECK (
    user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    AND company_id = public.get_my_company_id()
  );

-- updated_at 트리거
CREATE OR REPLACE FUNCTION public.set_schedule_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_events_updated_at ON public.schedule_events;
CREATE TRIGGER trg_schedule_events_updated_at
  BEFORE UPDATE ON public.schedule_events
  FOR EACH ROW EXECUTE FUNCTION public.set_schedule_updated_at();

DROP TRIGGER IF EXISTS trg_schedule_todos_updated_at ON public.schedule_todos;
CREATE TRIGGER trg_schedule_todos_updated_at
  BEFORE UPDATE ON public.schedule_todos
  FOR EACH ROW EXECUTE FUNCTION public.set_schedule_updated_at();

COMMENT ON TABLE public.schedule_events IS '일정 — 캘린더 이벤트 (개인 + 회사 공유).';
COMMENT ON TABLE public.schedule_todos IS '투두 — 개인 할 일.';
