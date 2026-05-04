-- Migration: add_hr_attendance_leaves_signatures_notifications
-- Version: 20260304044815
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================================
-- 1. attendance_records
-- ============================================================
CREATE TABLE attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  date date NOT NULL,
  check_in timestamptz,
  check_out timestamptz,
  work_hours numeric(4,2),
  overtime_hours numeric(4,2) DEFAULT 0,
  status text DEFAULT 'present' CHECK (status IN ('present','late','absent','half_day','remote')),
  note text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);

-- ============================================================
-- 2. leave_requests
-- ============================================================
CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  leave_type text NOT NULL CHECK (leave_type IN ('annual','sick','personal','maternity','paternity','compensation')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(3,1) NOT NULL,
  reason text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 3. leave_balances
-- ============================================================
CREATE TABLE leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  year integer NOT NULL,
  total_days numeric(4,1) DEFAULT 15,
  used_days numeric(4,1) DEFAULT 0,
  remaining_days numeric(4,1) GENERATED ALWAYS AS (total_days - used_days) STORED,
  UNIQUE(employee_id, year)
);

-- ============================================================
-- 4. signature_requests
-- ============================================================
CREATE TABLE signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  title text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','sent','viewed','signed','rejected','expired')),
  signer_name text NOT NULL,
  signer_email text NOT NULL,
  signer_phone text,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz,
  signature_data jsonb,
  ip_address text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 5. notifications
-- ============================================================
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('deal_update','expense_request','contract_expiry','signature_request','payment_due','system')),
  title text NOT NULL,
  message text,
  entity_type text,
  entity_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 6. RLS Policies
-- ============================================================

-- attendance_records
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_records_select" ON attendance_records FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "attendance_records_insert" ON attendance_records FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "attendance_records_update" ON attendance_records FOR UPDATE TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "attendance_records_delete" ON attendance_records FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- leave_requests
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "leave_requests_insert" ON leave_requests FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "leave_requests_delete" ON leave_requests FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- leave_balances
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_balances_select" ON leave_balances FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "leave_balances_insert" ON leave_balances FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "leave_balances_update" ON leave_balances FOR UPDATE TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "leave_balances_delete" ON leave_balances FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- signature_requests
ALTER TABLE signature_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signature_requests_select" ON signature_requests FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "signature_requests_insert" ON signature_requests FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "signature_requests_update" ON signature_requests FOR UPDATE TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "signature_requests_delete" ON signature_requests FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (company_id = get_my_company_id());
CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "notifications_delete" ON notifications FOR DELETE TO authenticated USING (company_id = get_my_company_id());

-- ============================================================
-- 7. Indexes
-- ============================================================
CREATE INDEX idx_attendance_records_company ON attendance_records(company_id);
CREATE INDEX idx_attendance_records_employee_date ON attendance_records(employee_id, date);

CREATE INDEX idx_leave_requests_company ON leave_requests(company_id);
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);

CREATE INDEX idx_leave_balances_company_employee ON leave_balances(company_id, employee_id);

CREATE INDEX idx_signature_requests_company ON signature_requests(company_id);
CREATE INDEX idx_signature_requests_document ON signature_requests(document_id);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_company ON notifications(company_id);
