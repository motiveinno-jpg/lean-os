-- Migration: add_feedback_notification_trigger
-- Version: 20260307080751
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- When feedback is submitted on a shared document, notify the share creator
CREATE OR REPLACE FUNCTION notify_share_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_share record;
  v_doc record;
  v_decision_label text;
BEGIN
  -- Get share and document info
  SELECT ds.*, d.name as doc_name, d.company_id
  INTO v_share
  FROM document_shares ds
  JOIN documents d ON d.id = ds.document_id
  WHERE ds.id = NEW.share_id;

  IF v_share IS NULL OR v_share.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map decision to Korean
  v_decision_label := CASE NEW.decision
    WHEN 'approved' THEN '승인'
    WHEN 'hold' THEN '보류'
    WHEN 'rejected' THEN '거절'
    ELSE NEW.decision
  END;

  -- Create notification for the share creator
  INSERT INTO notifications (
    user_id, company_id, type, title, message, link, is_read
  ) VALUES (
    v_share.created_by,
    v_share.company_id,
    'document',
    '문서 피드백 수신',
    COALESCE(NEW.responder_name, '외부 수신자') || '님이 "' || v_share.doc_name || '" 문서에 ' || v_decision_label || ' 피드백을 보냈습니다.',
    '/documents?id=' || v_share.document_id::text,
    false
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_share_feedback_notify
  AFTER INSERT ON document_share_feedback
  FOR EACH ROW
  EXECUTE FUNCTION notify_share_feedback();
