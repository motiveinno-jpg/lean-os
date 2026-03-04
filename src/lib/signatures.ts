/**
 * LeanOS Electronic Signature Engine
 * 전자서명 요청 → 발송 → 열람 → 서명완료/거부/만료
 */

import { supabase } from './supabase';

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
      expires_at: expiresAt.toISOString(),
      created_by: params.createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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
