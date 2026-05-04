-- Migration: role_system_and_employee_invitations
-- Version: 20260304062942
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) 직원 초대 테이블
CREATE TABLE IF NOT EXISTS public.employee_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  email text NOT NULL,
  name text,
  role text DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
  invite_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  invited_by uuid REFERENCES public.users(id),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 2) RLS
ALTER TABLE public.employee_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_invitations_company_access" ON public.employee_invitations
  FOR ALL USING (company_id = public.get_my_company_id());

-- 3) Indexes
CREATE INDEX IF NOT EXISTS idx_employee_invitations_company ON public.employee_invitations(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_invitations_token ON public.employee_invitations(invite_token);
CREATE INDEX IF NOT EXISTS idx_employee_invitations_email ON public.employee_invitations(email);

-- 4) partner_invitations에 role 컬럼 추가 (없으면)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'partner_invitations' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.partner_invitations ADD COLUMN role text DEFAULT 'partner';
  END IF;
END $$;

-- 5) users 테이블에 avatar_url 추가 (프로필용)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE public.users ADD COLUMN avatar_url text;
  END IF;
END $$;
