-- 2026-05-22 전체 데이터 초기화 hang 수정 — 서버측 일괄 삭제 RPC.
--   기존: 클라이언트가 테이블별 단건 거대 DELETE → delete 트리거(잔액재계산·realtime)·FK CASCADE 로 hang.
--   해결: SECDEF RPC 1회. session_replication_role='replica'(트랜잭션 한정)로 FK·트리거 우회 →
--         순서 걱정 없이 빠르게 삭제. 회사격리(is_company_admin + p_company_id=get_my_company_id).
--   ⚠️ companies 레코드 자체는 보존(부가필드 초기화는 클라이언트). owner/admin users 보존.

CREATE OR REPLACE FUNCTION public.reset_company_data(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- company_id 컬럼으로 직접 삭제하는 테이블 (FK 순서 무관 — replica 모드)
  v_direct text[] := ARRAY[
    'deal_files','deal_classifications','certificate_logs','tax_invoice_queue','expense_approvals',
    'document_notifications','billing_events','feedback','finance_access_logs','audit_logs',
    'auto_discovery_results','ai_pending_actions','ai_interactions','growth_targets',
    'bank_transactions','card_transactions','bank_classification_rules','payment_queue',
    'deal_cost_schedule','expense_requests','financial_items','vault_docs',
    'doc_approvals','quote_tracking','signature_requests','document_shares','tax_invoices','documents',
    'chat_channels','partner_invitations','deals','loans','recurring_payments','routing_rules',
    'payment_batches','contract_archives','hr_contract_packages','closing_checklists','partners',
    'bank_accounts','corporate_cards','approval_requests','approval_policies',
    'automation_credentials','automation_logs','automation_runs','sync_jobs','hometax_sync_log',
    'company_integrations','monthly_financials','treasury_positions','vault_assets','vault_accounts',
    'invoices','transactions','doc_templates','programs','notifications','vendors','cash_snapshot',
    'employee_invitations','employees'
  ];
  t text;
BEGIN
  -- 회사격리 + 권한
  IF p_company_id IS NULL OR p_company_id <> get_my_company_id() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT is_company_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  -- FK·트리거 우회 (트랜잭션 한정 — 함수 종료 시 자동 복구)
  PERFORM set_config('session_replication_role', 'replica', true);

  -- ── 손자/자식 (company_id 없음 — 부모 JOIN) : 부모(DIRECT) 삭제 전에 먼저 ──
  -- chat 손자/자식
  DELETE FROM chat_reactions WHERE message_id IN (
    SELECT cm.id FROM chat_messages cm WHERE cm.channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id));
  DELETE FROM chat_mentions      WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  DELETE FROM chat_files         WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  DELETE FROM chat_action_cards  WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  DELETE FROM chat_messages      WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  DELETE FROM chat_events        WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  DELETE FROM chat_members       WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  DELETE FROM chat_participants  WHERE channel_id IN (SELECT id FROM chat_channels WHERE company_id = p_company_id);
  -- deals 자식
  DELETE FROM deal_milestones        WHERE deal_id IN (SELECT id FROM deals WHERE company_id = p_company_id);
  DELETE FROM deal_assignments       WHERE deal_id IN (SELECT id FROM deals WHERE company_id = p_company_id);
  DELETE FROM deal_revenue_schedule  WHERE deal_id IN (SELECT id FROM deals WHERE company_id = p_company_id);
  DELETE FROM deal_nodes             WHERE deal_id IN (SELECT id FROM deals WHERE company_id = p_company_id);
  DELETE FROM sub_deals              WHERE parent_deal_id IN (SELECT id FROM deals WHERE company_id = p_company_id);
  -- approval / documents / document_shares 자식
  DELETE FROM approval_steps WHERE request_id IN (SELECT id FROM approval_requests WHERE company_id = p_company_id);
  DELETE FROM doc_revisions  WHERE document_id IN (SELECT id FROM documents WHERE company_id = p_company_id);
  DELETE FROM doc_approvals  WHERE document_id IN (SELECT id FROM documents WHERE company_id = p_company_id);
  DELETE FROM hr_contract_package_items WHERE document_id IN (SELECT id FROM documents WHERE company_id = p_company_id);
  DELETE FROM document_share_feedback WHERE share_id IN (SELECT id FROM document_shares WHERE company_id = p_company_id);
  DELETE FROM document_share_views    WHERE share_id IN (SELECT id FROM document_shares WHERE company_id = p_company_id);
  -- loans / closing / treasury / payment_batches / transactions 자식
  DELETE FROM loan_payments            WHERE loan_id IN (SELECT id FROM loans WHERE company_id = p_company_id);
  DELETE FROM closing_checklist_items  WHERE checklist_id IN (SELECT id FROM closing_checklists WHERE company_id = p_company_id);
  DELETE FROM treasury_transactions    WHERE position_id IN (SELECT id FROM treasury_positions WHERE company_id = p_company_id);
  DELETE FROM payroll_items            WHERE batch_id IN (SELECT id FROM payment_batches WHERE company_id = p_company_id);
  DELETE FROM transaction_matches      WHERE transaction_id IN (SELECT id FROM transactions WHERE company_id = p_company_id);

  -- ── DIRECT (company_id) — 동적, %I 식별자 안전 ──
  FOREACH t IN ARRAY v_direct LOOP
    EXECUTE format('DELETE FROM %I WHERE company_id = $1', t) USING p_company_id;
  END LOOP;

  -- ── 멤버 정리: employee/partner users 회사 소속 끊기 (owner/admin 보존) ──
  UPDATE users SET company_id = NULL
   WHERE company_id = p_company_id AND role IN ('employee', 'partner');

  -- 트리거 복구 (PERFORM local=true 라 자동이지만 명시)
  PERFORM set_config('session_replication_role', 'origin', true);

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_company_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_company_data(uuid) TO authenticated;

COMMENT ON FUNCTION public.reset_company_data(uuid) IS
  '전체 데이터 초기화 — SECDEF, 회사격리(admin), session_replication_role=replica 로 FK·트리거 우회 일괄 삭제. companies 레코드·owner/admin users 보존.';
