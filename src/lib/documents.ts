/**
 * OwnerView Document Pipeline Engine
 * 템플릿 → 변수 채움 → 수정 → 승인 → 잠금
 */

import { supabase } from './supabase';
import { logAudit } from './audit-log';
import type { Json } from '@/types/models';

// ── Document types ──
export const DOC_TYPES = [
  { value: 'contract', label: '계약서' },
  { value: 'contract_service', label: '용역계약서' },
  { value: 'contract_sales', label: '매매계약서' },
  { value: 'contract_outsource', label: '업무위탁계약서' },
  { value: 'contract_labor', label: '근로계약서' },
  { value: 'contract_lease', label: '임대차계약서' },
  { value: 'contract_partnership', label: '파트너십계약서' },
  { value: 'invoice', label: '견적서' },
  { value: 'quote', label: '제안서' },
  { value: 'sow', label: '업무기술서(SOW)' },
  { value: 'nda', label: '비밀유지계약(NDA)' },
  { value: 'approval_doc', label: '품의서' },
  { value: 'expense_report', label: '지출결의서' },
  { value: 'mou', label: '양해각서(MOU)' },
] as const;

export const DOC_STATUS = {
  draft: { label: '초안', bg: 'bg-gray-500/10', text: 'text-gray-400' },
  review: { label: '검토중', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  approved: { label: '승인', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  executed: { label: '체결', bg: 'bg-green-500/10', text: 'text-green-400' },
  locked: { label: '잠금', bg: 'bg-purple-500/10', text: 'text-purple-400' },
} as const;

// ── 견적No. 고정 채번 (YYYY/MM/DD-N, 회사·날짜 단위) ──
//   생성 시 document_number 에 영구 저장 → 문서함·PDF·견적서 메뉴 어디서나 동일 번호.
//   날짜는 created_at 표시(UTC slice)와 일치시키려 UTC 기준. 같은 날 최대 N+1 부여(최신=큰 번호).
export async function nextQuoteNumber(companyId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/'); // YYYY/MM/DD (UTC)
  const { data } = await supabase
    .from('documents')
    .select('document_number')
    .eq('company_id', companyId)
    .like('document_number', `${today}-%`);
  let maxN = 0;
  for (const r of (data || [])) {
    const m = String((r as any).document_number || '').match(/-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${today}-${maxN + 1}`;
}

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
    .maybeSingle();

  if (!template) throw new Error('템플릿을 찾을 수 없습니다');

  // 견적서(invoice/quote) 양식이면 고정 채번 부여(계약서 등은 null)
  const tType = (template as any).type || null;
  const documentNumber = (tType === 'invoice' || tType === 'quote') ? await nextQuoteNumber(params.companyId) : null;

  const { data, error } = await supabase
    .from('documents')
    .insert({
      company_id: params.companyId,
      template_id: params.templateId,
      deal_id: params.dealId || null,
      name: params.name,
      status: 'draft',
      document_number: documentNumber,
      // 양식 type 을 content_type 으로 보존 — 누락 시 편집기가 무조건 'contract'(텍스트)로 fallback 되어
      // 견적서(quote/invoice) 양식도 품목·단가·부가세 표가 안 뜨던 문제 수정.
      content_type: tType,
      content_json: template.content_json,
      version: 1,
      created_by: params.createdBy,
    })
    .select()
    .single();

  if (error) throw error;

  await logAudit({
    company_id: params.companyId,
    user_id: params.createdBy,
    action: 'create',
    entity_type: 'document',
    entity_id: data.id,
    entity_name: data.name,
    metadata: { source: 'template', template_id: params.templateId },
  });

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

  await logAudit({
    company_id: params.companyId,
    user_id: params.createdBy,
    action: 'create',
    entity_type: 'document',
    entity_id: data.id,
    entity_name: data.name,
    metadata: { source: 'blank', type: params.type },
  });

  return data;
}

// ── Fill template variables ──
// 변수명을 공백·률/율 정규화해서 매칭 (예: "수습기간 시작일" → "{{수습기간시작일}}" 도 치환됨)
function normalizeVarName(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/률/g, '율')
    .toLowerCase();
}

export function fillVariables(
  contentJson: Record<string, any>,
  variables: Record<string, string>
): Record<string, any> {
  const str = JSON.stringify(contentJson);
  const escape = (v: string) => v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

  // 1) 변수 사전 — 직접 키 + 정규화된 키 둘 다 등록
  const dict: Record<string, string> = {};
  for (const [k, v] of Object.entries(variables)) {
    if (!k) continue;
    dict[k] = v;
    dict[normalizeVarName(k)] = v;
  }

  // 2) 본문 안의 모든 {{...}} 를 찾아 직접 매칭 → 실패 시 정규화 매칭
  const filled = str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, rawName: string) => {
    const direct = dict[rawName];
    if (direct !== undefined) return escape(direct);
    const norm = normalizeVarName(rawName);
    const fuzzy = dict[norm];
    if (fuzzy !== undefined) return escape(fuzzy);
    return whole; // 매칭 실패 시 원래 placeholder 유지
  });

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
    .maybeSingle();

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
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function approveDocument(documentId: string, approverId: string, comment?: string) {
  // doc_approvals.approver_id 는 NOT NULL UUID. 비-UUID(예: 'system' 자동 승인) 면 doc_approvals 기록은 생략하고 status 만 갱신.
  const isUuid = _UUID_RE.test(approverId);
  if (isUuid) {
    await supabase.from('doc_approvals').insert({
      document_id: documentId,
      approver_id: approverId,
      status: 'approved',
      comment: comment || null,
      signed_at: new Date().toISOString(),
    });
  }

  await supabase.from('documents').update({ status: 'approved' }).eq('id', documentId);

  // Dispatch business event if deal is linked
  const { data: doc } = await supabase.from('documents').select('deal_id, name, company_id').eq('id', documentId).maybeSingle();

  await logAudit({
    company_id: doc?.company_id || '',
    user_id: approverId,
    action: 'approve',
    entity_type: 'document',
    entity_id: documentId,
    entity_name: doc?.name,
    metadata: { comment, auto: !isUuid },
  });

  if (doc?.deal_id) {
    const { dispatchBusinessEvent } = await import('./business-events');
    await dispatchBusinessEvent({
      dealId: doc.deal_id,
      eventType: 'document_approved',
      userId: isUuid ? approverId : null,
      referenceId: documentId,
      referenceTable: 'documents',
      summary: { title: doc.name },
    });

    // Trigger deal pipeline (견적→계약, 계약→세금계산서+스케줄)
    // 자동 승인(approverId 가 UUID 가 아님)인 경우, downstream insert(documents.created_by UUID NOT NULL 등)에서 실패하므로 스킵.
    if (doc.company_id && isUuid) {
      const { onDocumentApproved } = await import('./deal-pipeline');
      await onDocumentApproved({
        documentId,
        companyId: doc.company_id,
        approverId,
      });
    }
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
  const { data: doc } = await supabase.from('documents').select('deal_id, name, company_id').eq('id', documentId).maybeSingle();

  await logAudit({
    company_id: doc?.company_id || '',
    user_id: lockerId || 'system',
    action: 'lock',
    entity_type: 'document',
    entity_id: documentId,
    entity_name: doc?.name,
  });

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
