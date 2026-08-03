import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
/**
 * OwnerView Document Pipeline Engine
 * 템플릿 → 변수 채움 → 수정 → 승인 → 잠금
 */

import { supabase } from './supabase';
import { logAudit } from './audit-log';
import type { Json } from '@/types/models';
import { sanitizeAiContractHtml } from './sanitize-html';

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
  const today = todayKst().replace(/-/g, '/'); // YYYY/MM/DD (UTC)
  const data = logRead('lib/documents:data', await supabase
    .from('documents')
    .select('document_number')
    .eq('company_id', companyId)
    .like('document_number', `${today}-%`));
  let maxN = 0;
  for (const r of (data || [])) {
    const m = String((r as any).document_number || '').match(/-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${today}-${maxN + 1}`;
}

// ── 프로젝트 템플릿 행 → 견적서 ──
//   '매출 · 청구' 템플릿의 한 줄에서 바로 견적서를 만든다(2026-08-03 사장님: "입력은 무조건
//   템플릿으로"). 문서 자체는 기존 편집기가 그대로 맡고, 여기서는 껍데기만 만들어 연결한다.
const QUOTE_SKELETON = {
  title: "견적서",
  sections: [
    { title: "견적 정보", content: "공급자: {{회사명}} (대표: {{대표자명}})\n수신: {{거래처명}}\n견적일자: {{견적일자}}\n유효기간: {{유효기간}}" },
    { title: "견적 품목", content: "[품목 테이블]\n\n※ 품목은 문서 생성 후 품목 편집 테이블에서 추가해 주세요.\n각 품목의 공급가액, 세액(10%), 합계가 자동 계산됩니다." },
    { title: "거래 조건", content: "납품 조건: {{납품조건}}\n결제 조건: {{결제조건}}\n\n※ 상기 금액은 부가가치세 별도 금액이며, 세금계산서를 발행합니다." },
  ],
};

export async function createQuoteForDeal(params: {
  companyId: string; dealId: string; userId: string; name: string;
}): Promise<{ id: string; document_number: string | null }> {
  const { data, error } = await supabase.from("documents").insert({
    company_id: params.companyId,
    deal_id: params.dealId,
    sub_deal_id: null,
    name: params.name,
    status: "draft",
    document_number: await nextQuoteNumber(params.companyId),
    content_type: "invoice",
    content_json: QUOTE_SKELETON as unknown as Json,
    version: 1,
    created_by: params.userId,
  }).select("id, document_number").single();
  if (error) throw new Error(error.message);
  return data as any;
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
  const template = logRead('lib/documents:template', await supabase
    .from('doc_templates')
    .select('*')
    .eq('id', params.templateId)
    .maybeSingle());

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

// AI 참모 첨부문서 기반 계약서 — 외부 발송 없이 전자계약 > 양식 관리(contract_templates)에
// 회사 양식으로 저장한다. 문서함(documents)은 파일 보관함 전용으로 단순화돼 documents 에
// 넣으면 확인할 화면이 없다(2026-08-03 사장님 제보). 원본 파일/추출 텍스트는 저장하지 않고,
// 사용자가 확인한 정제 HTML과 출처 파일명(감사로그)만 보존한다.
export async function createAiContractDraft(params: {
  companyId: string;
  createdBy: string;
  name: string;
  bodyHtml: string;
  variables?: string[];
  sourceFiles?: string[];
}) {
  const body = sanitizeAiContractHtml(params.bodyHtml).trim();
  if (!body) throw new Error('계약서 본문이 비어 있습니다.');
  // AI 는 {{변수}} 이중 중괄호로 쓰지만 계약 양식 렌더러(renderTemplateWithVariables)는
  // {변수} 단일 중괄호 규약 — 저장 시 변환해야 발송 때 치환된다.
  const singleBraceBody = body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '{$1}');
  const sourceFiles = (params.sourceFiles || [])
    .map((name) => String(name).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180))
    .filter(Boolean)
    .slice(0, 3);
  const variables = Array.from(new Set((params.variables || [])
    .map((name) => String(name).replace(/[{}]/g, '').trim().slice(0, 60))
    .filter(Boolean)))
    .slice(0, 50);
  const name = params.name.trim().replace(/^\[AI 초안\]\s*/, '').slice(0, 100);
  if (!name) throw new Error('계약서 이름이 비어 있습니다.');

  const { data, error } = await supabase.from('contract_templates').insert({
    company_id: params.companyId,
    name: `[AI 초안] ${name}`,
    body_html: singleBraceBody,
    file_type: 'html',
    variables,
    sort_order: 100,
    is_system: false,
    created_by: params.createdBy,
  } as never).select().single();
  if (error) throw error;

  await logAudit({
    company_id: params.companyId,
    user_id: params.createdBy,
    action: 'create',
    entity_type: 'contract_template',
    entity_id: (data as any).id,
    entity_name: (data as any).name,
    metadata: { source: 'ai_attachment_draft', source_files: sourceFiles },
  });
  return data;
}

// ── Fill template variables ──
// 변수명을 공백·률/율 정규화해서 매칭 (예: "수습기간 시작일" → "{{수습기간시작일}}" 도 치환됨)
export function normalizeVarName(s: string): string {
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

// ── doc_templates(섹션형 양식) → documents(재사용 계약서 문서) 변환 ──
//   전자계약 발송 플로우(InviteModal/OrgBulkWizard)는 documents 테이블만 읽는다.
//   "양식 관리"(doc_templates)에 등록해도 발송 목록엔 안 뜨던 문제(2026-07-13) 해결책 —
//   선택 시 최초 1회 실제 documents 행으로 변환("실체화")하고, 이후엔 동일 이름 문서를 재사용.
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function docTemplateToHtml(tpl: { name: string; content_json?: any }): string {
  const cj = tpl.content_json || {};
  const title = cj.title || tpl.name;
  let html = `<p style="text-align: center;"><strong><span style="font-size: 18pt;">${escapeHtml(title)}</span></strong></p><p>&nbsp;</p>`;
  for (const sec of (cj.sections || []) as { title?: string; content?: string }[]) {
    if (sec.title) html += `<p><strong>${escapeHtml(sec.title)}</strong></p>`;
    const lines = String(sec.content || "").split("\n");
    for (const line of lines) html += `<p>${line.trim() ? escapeHtml(line) : "&nbsp;"}</p>`;
    html += "<p>&nbsp;</p>";
  }
  return html;
}

// 같은 회사에 동일 이름 documents 행이 이미 있으면 재사용(중복 생성 방지), 없으면 신규 생성.
export async function materializeDocTemplate(companyId: string, tpl: { name: string; type?: string; content_json?: any }) {
  const existing = logRead('lib/documents:existing', await supabase
    .from("documents")
    .select("*")
    .eq("company_id", companyId)
    .eq("name", tpl.name)
    .maybeSingle());
  if (existing) return existing;

  const body = docTemplateToHtml(tpl);
  const { data, error } = await supabase
    .from("documents")
    .insert({
      company_id: companyId,
      name: tpl.name,
      content_json: { body } as unknown as Json,
      auto_classified_type: "contract",
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// contract_templates(계약 양식) → documents 행 실체화 (2026-07-23 전자계약 양식 통합 Phase 2).
//   materializeDocTemplate 의 contract_templates 판. body_html 을 그대로 documents.content_json.body 에.
export async function materializeContractTemplate(
  companyId: string,
  tpl: { id?: string; name: string; body_html?: string | null; body_markdown?: string | null },
) {
  const body = tpl.body_html || tpl.body_markdown || "";
  // 기존 실체화 문서는 양식 id(content_json.source_template_id)로 찾는다 — 이름 매칭만으로는
  //   양식관리에서 이름을 바꾸는 순간 연결이 끊겨 사본이 중복 생성되고 옛 이름이 남았다(2026-08-03 사장님).
  let existing: any = null;
  if (tpl.id) {
    const rows = logRead('lib/documents:existing-ct', await supabase
      .from("documents")
      .select("*")
      .eq("company_id", companyId)
      .contains("content_json", { source_template_id: tpl.id })
      .limit(1));
    existing = (rows as any[])?.[0] || null;
  }
  if (!existing) {
    const rows = logRead('lib/documents:existing-ct-name', await supabase
      .from("documents")
      .select("*")
      .eq("company_id", companyId)
      .eq("name", tpl.name)
      .limit(1));
    existing = (rows as any[])?.[0] || null;
  }

  const contentJson = { ...(existing?.content_json as Record<string, unknown> | null || {}), body, ...(tpl.id ? { source_template_id: tpl.id } : {}) };
  if (existing) {
    // 양식 이름·본문 변경을 사본에 반영 — 이미 발송된 건은 signature_requests 가 자체 스냅샷을 들고 있어 안전.
    const curBody = (existing.content_json as any)?.body ?? "";
    const linked = (existing.content_json as any)?.source_template_id;
    if (existing.name !== tpl.name || curBody !== body || (tpl.id && linked !== tpl.id)) {
      const { data: updated } = await supabase
        .from("documents")
        .update({ name: tpl.name, content_json: contentJson as unknown as Json })
        .eq("id", existing.id)
        .select()
        .single();
      return updated ?? existing;
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      company_id: companyId,
      name: tpl.name,
      content_json: contentJson as unknown as Json,
      auto_classified_type: "contract",
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Save document revision ──
export async function saveRevision(params: {
  documentId: string;
  authorId: string;
  contentJson: Json;
  comment?: string;
}) {
  // Get current version
  const doc = logRead('lib/documents:doc', await supabase
    .from('documents')
    .select('version')
    .eq('id', params.documentId)
    .maybeSingle());

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
  const doc = logRead('lib/documents:doc', await supabase.from('documents').select('deal_id, name, company_id').eq('id', documentId).maybeSingle());

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
  const doc = logRead('lib/documents:doc', await supabase.from('documents').select('deal_id, name, company_id').eq('id', documentId).maybeSingle());

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
