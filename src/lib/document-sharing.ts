import { logRead } from "@/lib/log-read";
/**
 * Document Sharing — 공개 열람 링크 + 열람 추적 + 피드백
 */
import { supabase } from './supabase';
const db = supabase;

// ── Create Share Link ──

export async function createDocumentShare(params: {
  documentId: string;
  companyId: string;
  createdBy: string;
  allowFeedback?: boolean;
  expiresInDays?: number;
}): Promise<{ shareToken: string; shareUrl: string }> {
  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
    : null;

  const { data, error } = await db
    .from('document_shares')
    .insert({
      document_id: params.documentId,
      company_id: params.companyId,
      created_by: params.createdBy,
      allow_feedback: params.allowFeedback ?? true,
      expires_at: expiresAt,
    })
    .select('share_token')
    .single();

  if (error) throw error;
  const token = data.share_token;
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return { shareToken: token, shareUrl: `${base}/share?token=${token}` };
}

// ── Get Share by Token (public) ──

export async function getShareByToken(token: string) {
  const { data, error } = await db
    .from('document_shares')
    .select('*, documents(*, companies(name, representative, address, phone, business_number, seal_url))')
    .eq('share_token', token)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;

  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  return data;
}

// ── Record View ──

export async function recordShareView(shareId: string) {
  // Increment counter
  // 2026-07-20: 빌더에는 .catch 가 없어(thenable, Promise 아님) 기존 코드는 매 호출 TypeError
  //   → 조회수·열람로그가 전멸했었음. 에러는 결과 객체로 받는다. (db.raw 도 supabase-js 에 없는 API)
  const { error: rpcErr } = await db.rpc('increment_share_view_count', { share_id_param: shareId });
  if (rpcErr) {
    // Fallback: 직접 +1 (RPC 실패 시에만 — 원자성은 낮지만 조회수 성격상 허용)
    const { data: cur } = await db.from('document_shares').select('view_count').eq('id', shareId).maybeSingle();
    await db.from('document_shares')
      .update({ view_count: (cur?.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', shareId);
  }

  // Log the view
  await db.from('document_share_views').insert({
    share_id: shareId,
    viewed_at: new Date().toISOString(),
  });
}

// ── Submit Feedback ──

export async function submitShareFeedback(params: {
  shareId: string;
  decision: 'approved' | 'hold' | 'rejected';
  comment?: string;
  responderName?: string;
  responderEmail?: string;
}) {
  const { data, error } = await db
    .from('document_share_feedback')
    .insert({
      share_id: params.shareId,
      decision: params.decision,
      comment: params.comment || null,
      responder_name: params.responderName || null,
      responder_email: params.responderEmail || null,
    })
    .select()
    .single();

  if (error) throw error;

  // 피드백 알림 발송 (비동기, 실패해도 피드백 저장은 유지)
  notifyFeedbackReceived(params.shareId, params.decision, params.responderName, params.comment).catch(console.error);

  return data;
}

// ── Notify document owner about feedback ──

async function notifyFeedbackReceived(
  shareId: string,
  decision: 'approved' | 'hold' | 'rejected',
  responderName?: string,
  comment?: string,
) {
  // Get share → document → creator info
  const share = logRead('lib/document-sharing:share', await db
    .from('document_shares')
    .select('id, company_id, documents(id, name, created_by, content_json, deal_id)')
    .eq('id', shareId)
    .single());

  if (!share?.documents) return;
  const doc = share.documents as any;

  // Get creator email
  const creator = logRead('lib/document-sharing:creator', await db
    .from('employees')
    .select('name, email')
    .eq('id', doc.created_by)
    .single());

  if (!creator?.email) return;

  const decisionLabel = { approved: '승인', hold: '보류', rejected: '거절' }[decision];

  // Send notification email via Edge Function
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    await fetch(`${supabaseUrl}/functions/v1/send-feedback-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        recipientEmail: creator.email,
        recipientName: creator.name,
        documentName: doc.name,
        decision: decisionLabel,
        responderName: responderName || '익명',
        comment: comment || '',
      }),
    });
  } catch { /* fail silently */ }

  // Record notification — 실패해도 흐름 유지 (2026-07-20: 빌더 .catch 는 TypeError 라
  //   이 지점에서 함수가 죽어 아래 승인 파이프라인 트리거까지 전멸했었음)
  const { error: notifErr } = await db.from('document_notifications').insert({
    company_id: share.company_id,
    document_id: doc.id,
    event_type: 'feedback_received',
    recipient_email: creator.email,
    metadata: { decision, responderName, comment },
  });
  if (notifErr) console.error('document_notifications insert 실패:', notifErr.message);

  // 승인 피드백 시 → 파이프라인 자동 트리거
  if (decision === 'approved' && doc.deal_id) {
    try {
      const { onDocumentApproved } = await import('./deal-pipeline');
      await onDocumentApproved({
        documentId: doc.id,
        companyId: share.company_id,
        approverId: doc.created_by,
      });
    } catch (err) {
      console.error('Auto pipeline trigger failed:', err);
    }
  }
}

// ── Get Shares for a Document ──

export async function getDocumentShares(documentId: string) {
  const data = logRead('lib/document-sharing:data', await db
    .from('document_shares')
    .select('*, document_share_feedback(*)')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false }));
  return data || [];
}

// ── Send Share Email ──

export async function sendShareEmail(params: {
  email: string;
  recipientName?: string;
  documentName: string;
  shareUrl: string;
  senderName?: string;
  companyName?: string;
  message?: string;
}): Promise<{ success: boolean; error?: string; fallbackMailto?: string }> {
  const { email, recipientName, documentName, shareUrl, senderName, companyName, message } = params;

  // Try Edge Function first
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-share-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(params),
      });
      if (res.ok) return { success: true };
      const errBody = await res.json().catch(() => ({}));
      console.error('send-share-email error:', errBody);
    }
  } catch {
    // Edge Function not available — use mailto fallback
  }

  // Fallback: generate mailto link with formatted body
  const subject = `[${companyName || 'OwnerView'}] ${documentName} 검토 요청`;
  const body = `${recipientName || '담당자'}님 안녕하세요.

${senderName ? `${senderName} (${companyName || ''})` : companyName || ''}입니다.

${documentName}을(를) 보내드립니다.
아래 링크에서 문서를 확인하시고 검토 부탁드립니다.

▶ 문서 확인: ${shareUrl}

${message ? `[메시지]\n${message}\n` : ''}감사합니다.

─────────────────
${companyName || 'OwnerView'}
${senderName || ''}`;

  const mailto = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { success: false, error: '자동 발송 불가 — 메일 앱으로 열기', fallbackMailto: mailto };
}

// ── Deactivate Share ──

export async function deactivateShare(shareId: string) {
  const { error } = await db
    .from('document_shares')
    .update({ is_active: false })
    .eq('id', shareId);
  if (error) throw error;
}
