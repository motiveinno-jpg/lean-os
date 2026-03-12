/**
 * OwnerView Electronic Signature Engine
 * 전자서명 요청 → 발송 → 열람 → 서명완료/거부/만료
 */

import { supabase } from './supabase';
import { logAudit } from './audit-log';

const db = supabase as any;

// ── Signature Status Constants ──
export const SIGNATURE_STATUS = [
  { value: 'pending', label: '대기', bg: 'bg-gray-500/10', text: 'text-gray-500', dot: 'bg-gray-400' },
  { value: 'sent', label: '발송', bg: 'bg-blue-500/10', text: 'text-blue-500', dot: 'bg-blue-400' },
  { value: 'viewed', label: '열람', bg: 'bg-yellow-500/10', text: 'text-yellow-600', dot: 'bg-yellow-400' },
  { value: 'signed', label: '서명완료', bg: 'bg-green-500/10', text: 'text-green-600', dot: 'bg-green-500' },
  { value: 'rejected', label: '거부', bg: 'bg-red-500/10', text: 'text-red-500', dot: 'bg-red-400' },
  { value: 'expired', label: '만료', bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-300' },
] as const;

export type SignatureStatusValue = typeof SIGNATURE_STATUS[number]['value'];

export function getSignatureStatusInfo(status: string) {
  return SIGNATURE_STATUS.find(s => s.value === status) || SIGNATURE_STATUS[0];
}

// ── Generate Sign Token ──
function generateSignToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  for (const byte of array) {
    token += chars[byte % chars.length];
  }
  return token;
}

// ── Create Signature Request ──
export async function createSignatureRequest(params: {
  companyId: string;
  documentId: string;
  title: string;
  signerName: string;
  signerEmail: string;
  signerPhone?: string;
  createdBy: string;
}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14); // 14-day expiry
  const signToken = generateSignToken();

  const { data, error } = await db
    .from('signature_requests')
    .insert({
      company_id: params.companyId,
      document_id: params.documentId,
      title: params.title,
      status: 'pending',
      signer_name: params.signerName,
      signer_email: params.signerEmail,
      signer_phone: params.signerPhone || null,
      sign_token: signToken,
      expires_at: expiresAt.toISOString(),
      created_by: params.createdBy,
    })
    .select()
    .single();

  if (error) throw error;

  await logAudit({
    company_id: params.companyId,
    user_id: params.createdBy,
    action: 'create',
    entity_type: 'signature',
    entity_id: data.id,
    entity_name: params.title,
    metadata: { signer_name: params.signerName, signer_email: params.signerEmail, document_id: params.documentId },
  });

  return data;
}

// ── Send Signature Email ──
export async function sendSignatureEmail(signatureRequestId: string): Promise<{ success: boolean; error?: string }> {
  const req = await getSignatureRequest(signatureRequestId);
  if (!req) return { success: false, error: '서명 요청을 찾을 수 없습니다.' };

  const origin = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'https://ownerview.co');
  const signUrl = `${origin}/sign?token=${req.sign_token}`;

  try {
    const { data, error } = await db.functions.invoke('send-signature-email', {
      body: {
        to: req.signer_email,
        signerName: req.signer_name,
        title: req.title,
        signUrl,
        expiresAt: req.expires_at,
      },
    });

    if (error) throw error;

    // Update status to sent
    await updateSignatureStatus(signatureRequestId, 'sent');
    return { success: true };
  } catch (err: any) {
    // Even if email fails, update status so the link is still usable
    await updateSignatureStatus(signatureRequestId, 'sent');
    return { success: false, error: `이메일 발송 실패 (서명 링크는 생성됨): ${err.message}` };
  }
}

// ── Get Signature Requests ──
export async function getSignatureRequests(companyId: string, status?: string) {
  let query = db
    .from('signature_requests')
    .select('*, documents(name, status)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ── Get Document Signatures ──
export async function getDocumentSignatures(documentId: string) {
  const { data, error } = await db
    .from('signature_requests')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ── Update Signature Status ──
export async function updateSignatureStatus(
  id: string,
  status: SignatureStatusValue,
  extraData?: Record<string, any>
) {
  const updates: Record<string, any> = {
    status,
    ...extraData,
  };

  // Auto-set timestamps based on status
  if (status === 'sent') {
    updates.sent_at = new Date().toISOString();
  } else if (status === 'viewed') {
    updates.viewed_at = new Date().toISOString();
  } else if (status === 'signed') {
    updates.signed_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('signature_requests')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Save Signature Data ──
export async function saveSignature(
  id: string,
  signatureData: {
    type: 'draw' | 'type' | 'upload';
    data: string; // base64 image data or typed name
  },
  ipAddress?: string
) {
  const { data, error } = await db
    .from('signature_requests')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signature_data: signatureData,
      ip_address: ipAddress || null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  await logAudit({
    company_id: data?.company_id || '',
    user_id: 'signer',
    action: 'sign',
    entity_type: 'signature',
    entity_id: id,
    entity_name: data?.title,
    metadata: { signature_type: signatureData.type, document_id: data?.document_id },
    ip_address: ipAddress,
  });

  // Auto-lock document when all signatures are collected
  if (data?.document_id) {
    const { data: allSigs } = await db
      .from('signature_requests')
      .select('id, status')
      .eq('document_id', data.document_id);

    const allSigned = (allSigs || []).length > 0 &&
      (allSigs || []).every((s: { status: string }) => s.status === 'signed');

    if (allSigned) {
      // Check document status — if not yet approved, approve + lock
      const { data: doc } = await db
        .from('documents')
        .select('id, status, company_id, deal_id')
        .eq('id', data.document_id)
        .single();

      if (doc) {
        if (doc.status !== 'approved' && doc.status !== 'locked') {
          // Auto-approve triggers pipeline (견적→계약, 계약→세금계산서)
          const { approveDocument } = await import('./documents');
          await approveDocument(doc.id, 'system', '전체 서명 완료로 자동 승인');
        }
        // Lock the document
        const { lockDocument } = await import('./documents');
        await lockDocument(doc.id, 'system');
      }
    }
  }

  return data;
}

// ── Cancel / Expire Signature ──
export async function cancelSignature(id: string) {
  const { data, error } = await db
    .from('signature_requests')
    .update({
      status: 'expired',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Apply Company Seal (직인 적용) ──
export async function applyCompanySeal(params: {
  documentId: string;
  companyId: string;
  appliedBy: string;
}): Promise<{ success: boolean; sealUrl?: string }> {
  const { documentId, companyId, appliedBy } = params;

  // 1. Check company seal_url exists
  const { data: company } = await db
    .from('companies')
    .select('id, name, seal_url')
    .eq('id', companyId)
    .single();

  if (!company?.seal_url) {
    throw new Error('직인 이미지가 등록되지 않았습니다. 설정에서 직인을 먼저 업로드하세요.');
  }

  // 2. Update document seal_applied flag
  await db
    .from('documents')
    .update({ seal_applied: true })
    .eq('id', documentId);

  // 3. Add seal record to signature_requests
  await db
    .from('signature_requests')
    .insert({
      company_id: companyId,
      document_id: documentId,
      title: '회사 직인 적용',
      status: 'signed',
      signer_name: company.name || '회사 직인',
      signer_email: 'seal@company',
      sign_token: generateSignToken(),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      signed_at: new Date().toISOString(),
      signature_data: { type: 'seal', data: company.seal_url },
      created_by: appliedBy,
    });

  return { success: true, sealUrl: company.seal_url };
}

// ── Expire Overdue Signatures ──
export async function expireOverdueSignatures(companyId?: string): Promise<number> {
  const now = new Date().toISOString();

  let query = db
    .from('signature_requests')
    .update({ status: 'expired' })
    .lt('expires_at', now)
    .in('status', ['pending', 'sent', 'viewed']);

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query.select('id, company_id');
  if (error) throw error;

  const expiredCount = (data || []).length;

  // Audit log each expired request
  for (const row of (data || [])) {
    await logAudit({
      company_id: row.company_id || companyId || '',
      user_id: 'system',
      action: 'update',
      entity_type: 'signature',
      entity_id: row.id,
      entity_name: '서명 요청 자동 만료',
      metadata: { reason: 'overdue', expired_at: now },
    });
  }

  return expiredCount;
}

// ── Get Single Signature Request ──
export async function getSignatureRequest(id: string) {
  const { data, error } = await db
    .from('signature_requests')
    .select('*, documents(name, status, content_json)')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}
