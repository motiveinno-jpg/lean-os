/**
 * LeanOS Document Pipeline Engine
 * 템플릿 → 변수 채움 → 수정 → 승인 → 잠금
 */

import { supabase } from './supabase';
import type { Json } from '@/types/database';

// ── Document types ──
export const DOC_TYPES = [
  { value: 'contract', label: '계약서' },
  { value: 'invoice', label: '견적서' },
  { value: 'quote', label: '제안서' },
  { value: 'sow', label: '업무기술서(SOW)' },
  { value: 'nda', label: '비밀유지계약(NDA)' },
] as const;

export const DOC_STATUS = {
  draft: { label: '초안', bg: 'bg-gray-500/10', text: 'text-gray-400' },
  review: { label: '검토중', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  approved: { label: '승인', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  executed: { label: '체결', bg: 'bg-green-500/10', text: 'text-green-400' },
  locked: { label: '잠금', bg: 'bg-purple-500/10', text: 'text-purple-400' },
} as const;

// ── Create document from template ──
export async function createFromTemplate(params: {
  companyId: string;
  templateId: string;
  dealId?: string;
  name: string;
  createdBy: string;
}) {
  // Fetch template
  const { data: template } = await supabase
    .from('doc_templates')
    .select('*')
    .eq('id', params.templateId)
    .single();

  if (!template) throw new Error('템플릿을 찾을 수 없습니다');

  const { data, error } = await supabase
    .from('documents')
    .insert({
      company_id: params.companyId,
      template_id: params.templateId,
      deal_id: params.dealId || null,
      name: params.name,
      status: 'draft',
      content_json: template.content_json,
      version: 1,
      created_by: params.createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Create blank document ──
export async function createBlankDocument(params: {
  companyId: string;
  dealId?: string;
  name: string;
  type: string;
  createdBy: string;
}) {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      company_id: params.companyId,
      deal_id: params.dealId || null,
      name: params.name,
      status: 'draft',
      content_json: { type: params.type, sections: [], metadata: {} } as unknown as Json,
      version: 1,
      created_by: params.createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Fill template variables ──
export function fillVariables(
  contentJson: Record<string, any>,
  variables: Record<string, string>
): Record<string, any> {
  const str = JSON.stringify(contentJson);
  let filled = str;
  for (const [key, value] of Object.entries(variables)) {
    filled = filled.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return JSON.parse(filled);
}

// ── Save document revision ──
export async function saveRevision(params: {
  documentId: string;
  authorId: string;
  contentJson: Json;
  comment?: string;
}) {
  // Get current version
  const { data: doc } = await supabase
    .from('documents')
    .select('version')
    .eq('id', params.documentId)
    .single();

  const newVersion = (doc?.version || 0) + 1;

  // Save revision
  await supabase.from('doc_revisions').insert({
    document_id: params.documentId,
    author_id: params.authorId,
    changes_json: params.contentJson,
    comment: params.comment || null,
    version: newVersion,
  });

  // Update document
  await supabase.from('documents').update({
    content_json: params.contentJson,
    version: newVersion,
  }).eq('id', params.documentId);
}

// ── Submit for review ──
export async function submitForReview(documentId: string) {
  const { error } = await supabase
    .from('documents')
    .update({ status: 'review' })
    .eq('id', documentId);
  if (error) throw error;
}

// ── Approve document ──
export async function approveDocument(documentId: string, approverId: string, comment?: string) {
  await supabase.from('doc_approvals').insert({
    document_id: documentId,
    approver_id: approverId,
    status: 'approved',
    comment: comment || null,
    signed_at: new Date().toISOString(),
  });

  await supabase.from('documents').update({ status: 'approved' }).eq('id', documentId);

  // Dispatch business event if deal is linked
  const { data: doc } = await supabase.from('documents').select('deal_id, name').eq('id', documentId).single();
  if (doc?.deal_id) {
    const { dispatchBusinessEvent } = await import('./business-events');
    await dispatchBusinessEvent({
      dealId: doc.deal_id,
      eventType: 'document_approved',
      userId: approverId,
      referenceId: documentId,
      referenceTable: 'documents',
      summary: { title: doc.name },
    });
  }
}

// ── Lock document (executed + locked) ──
export async function lockDocument(documentId: string, lockerId?: string) {
  const { error } = await supabase
    .from('documents')
    .update({
      status: 'locked',
      locked_at: new Date().toISOString(),
    })
    .eq('id', documentId);
  if (error) throw error;

  // Dispatch business event if deal is linked
  const { data: doc } = await supabase.from('documents').select('deal_id, name').eq('id', documentId).single();
  if (doc?.deal_id && lockerId) {
    const { dispatchBusinessEvent } = await import('./business-events');
    await dispatchBusinessEvent({
      dealId: doc.deal_id,
      eventType: 'document_locked',
      userId: lockerId,
      referenceId: documentId,
      referenceTable: 'documents',
      summary: { title: doc.name },
    });
  }
}
