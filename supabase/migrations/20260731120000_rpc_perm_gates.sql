-- Migration: rpc_perm_gates
-- 역할 폐지 후속 — is_company_admin() 을 내부 인가로 쓰던 RPC 들에 권한 OR 추가 (2026-07-31).
--   앞선 master_only_role_removal 로 is_company_admin() 이 마스터 전용이 되면서,
--   권한을 받은 구성원이 쓰던 기능(전표 확정·연장근로 승인·우리측 서명·근태 보정 등)이
--   전부 "권한 없음"으로 막힌다. 정책과 같은 기준으로 도메인 권한을 OR 로 붙인다.
--
--   방식: 각 함수의 현재 정의(pg_get_functiondef)에서 is_company_admin() 호출을
--         (is_company_admin() OR has_perm('<도메인 키>')) 로 치환해 재생성. 본문 로직은 그대로.
--   제외: reset_company_data — 회사 데이터 초기화라 마스터 전용을 유지한다.

DO $$
DECLARE
  m record;
  v_def text;
  v_new text;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('approve_overtime',                 '/attendance:records'),
      ('reject_overtime',                  '/attendance:records'),
      ('mark_attendance_late',             '/attendance:records'),
      ('set_attendance_minutes',           '/attendance:records'),
      ('close_invoice_balance',            '/tax-invoices'),
      ('generate_voucher_drafts',          '/partners/reconciliation/voucher-entry'),
      ('post_bank_voucher',                '/partners/reconciliation/voucher-entry'),
      ('post_card_voucher',                '/partners/reconciliation/voucher-entry'),
      ('post_cash_voucher',                '/partners/reconciliation/voucher-entry'),
      ('post_invoice_voucher',             '/partners/reconciliation/voucher-entry'),
      ('save_manual_voucher',              '/partners/reconciliation/voucher-entry'),
      ('update_manual_voucher',            '/partners/reconciliation/voucher-entry'),
      ('set_voucher_deal',                 '/partners/reconciliation/voucher-entry'),
      ('voucher_confirm',                  '/partners/reconciliation/voucher-entry'),
      ('voucher_reject',                   '/partners/reconciliation/voucher-entry'),
      ('voucher_unconfirm',                '/partners/reconciliation/voucher-entry'),
      ('get_owner_dashboard_summary',      '/dashboard:finance'),
      ('get_owner_project_trend',          '/dashboard:finance'),
      ('get_recent_send_failures_summary', '/signatures'),
      ('list_send_failures_by_code',       '/signatures'),
      ('mark_failure_retried',             '/signatures'),
      ('submit_our_signature',             '/signatures'),
      ('submit_our_signature_bulk',        '/signatures'),
      ('submit_our_signature_for_request', '/signatures'),
      ('resend_quote_approval',            '/projecthub'),
      ('seed_korean_legal_holidays',       '/settings:attendance'),
      ('seed_legal_allowances',            '/settings:attendance')
    ) AS t(fname, perm_key)
  LOOP
    FOR v_def IN
      SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = m.fname
        AND pg_get_functiondef(p.oid) LIKE '%is_company_admin()%'
    LOOP
      -- public. 수식 호출과 비수식 호출이 섞여 있어(placeholder 로 한 번에 치환) 중첩 치환을 피한다.
      v_new := replace(v_def, 'public.is_company_admin()', '@@ADMIN_GATE@@');
      v_new := replace(v_new, 'is_company_admin()', '@@ADMIN_GATE@@');
      v_new := replace(v_new, '@@ADMIN_GATE@@',
        '(public.is_company_admin() OR public.has_perm(' || quote_literal(m.perm_key) || '))');
      EXECUTE v_new;
    END LOOP;
  END LOOP;
END $$;
