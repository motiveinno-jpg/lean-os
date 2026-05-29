/**
 * OwnerView Electronic Signature Engine
 * 전자서명 요청 → 발송 → 열람 → 서명완료/거부/만료
 */

import { supabase } from './supabase';
import { logAudit } from './audit-log';
import { applySignerInputsToHtml } from './signature-fields';

const db = supabase as any;

// ── Email Send Failure Classification ──
// 발송 실패 사유를 사전 정의된 코드로 분류해 signature_send_failures 에 저장.
// 라벨 매핑은 signatures 페이지 패널에서 사람이 읽는 형태로 변환.
function classifyEmailError(err: unknown): string {
  const raw = (() => {
    if (!err) return '';
    if (typeof err === 'string') return err;
    const e = err as { message?: string; error?: string; status?: number };
    return e.message || e.error || String(err);
  })();
  const msg = raw.toLowerCase();
  if (!msg) return 'UNKNOWN';
  if (msg.includes('invalid email') || msg.includes('email format') || msg.includes('not a valid')) return 'INVALID_EMAIL';
  if (msg.includes('missing email') || msg.includes('no recipient') || msg.includes('empty')) return 'MISSING_EMAIL';
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnreset')) return 'SMTP_TIMEOUT';
  if (msg.includes('bounce') || msg.includes('user unknown') || msg.includes('mailbox') || msg.includes('does not exist')) return 'BOUNCED';
  if (msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403') || msg.includes('domain not verified')) return 'UNAUTHORIZED';
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota') || msg.includes('too many')) return 'RATE_LIMIT';
  return 'UNKNOWN';
}

// 발송 실패 로깅 — log_signature_send_failure RPC 래퍼.
// 로깅 자체 실패는 silent — 본 발송 흐름을 절대 깨지 않게 try/catch.
async function logSendFailure(args: {
  signatureRequestId: string | null;
  batchId: string | null;
  partnerId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  sendType: 'initial' | 'reminder' | 'bulk_initial';
  err: unknown;
}): Promise<void> {
  try {
    await db.rpc('log_signature_send_failure', {
      p_signature_request_id: args.signatureRequestId,
      p_batch_id: args.batchId,
      p_partner_id: args.partnerId,
      p_recipient_email: args.recipientEmail,
      p_recipient_name: args.recipientName,
      p_send_type: args.sendType,
      p_error_code: classifyEmailError(args.err),
      p_error_message: String((args.err as { message?: string })?.message ?? args.err ?? ''),
    });
  } catch {
    /* 로깅 자체 실패는 silent — 발송 흐름 보호 */
  }
}

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

  // 1회 자동 재시도 — Resend/SendGrid 의 일시적 rate-limit 또는 외부 timeout 흡수.
  // 일괄발송에서 동일 도메인 다건 동시 호출 시 1~2건이 일시 거부되는 패턴 대응.
  const invoke = async () =>
    db.functions.invoke('send-signature-email', {
      body: {
        to: req.signer_email,
        signerName: req.signer_name,
        title: req.title,
        signUrl,
        expiresAt: req.expires_at,
      },
    });

  let lastErr: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await invoke();
      if (error) throw error;
      await updateSignatureStatus(signatureRequestId, 'sent');
      return { success: true };
    } catch (err: any) {
      lastErr = err;
      if (attempt < 2) {
        // 짧은 백오프 (rate limit 해소 시간)
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  // 끝까지 실패 — 링크는 생성됐으므로 status='sent' 로 유지(기존 정책)
  await updateSignatureStatus(signatureRequestId, 'sent');
  // 실패 로깅 (signature_send_failures) — 단건/단체일괄/일반bulk 모두 sendSignatureEmail 한 곳에서 로깅.
  //   send_type 은 batch_id 유무로 자동 결정: 있으면 'bulk_initial' (단체 일괄), 없으면 'initial' (단건/일반).
  //   리마인더는 sendSignatureReminder 에서 별도 'reminder' 행 추가 로깅 (성공/실패 분기).
  //   중복 INSERT 방지를 위해 호출처에서는 추가 로깅하지 않음.
  void logSendFailure({
    signatureRequestId,
    batchId: (req as any).batch_id ?? null,
    partnerId: (req as any).partner_id ?? null,
    recipientEmail: req.signer_email,
    recipientName: req.signer_name ?? null,
    sendType: (req as any).batch_id ? 'bulk_initial' : 'initial',
    err: lastErr,
  });
  return { success: false, error: `이메일 발송 실패 (서명 링크는 생성됨, 재시도 필요): ${lastErr?.message || lastErr || '알 수 없는 오류'}` };
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
// 서명 이미지를 본문 스냅샷에 합성 — sig-box[data-role="을"] 우선, 없으면 본문 끝 append.
// 2026-05-28 signerInputs(라디오/조건부 텍스트) 가 있으면 본문 ?-prefix 토큰을 결과로 합성.
function buildSignedContractHtml(
  snapshotHtml: string | null | undefined,
  signatureData: { type: 'draw' | 'type' | 'upload'; data: string },
  signerName?: string | null,
  signerInputs?: Record<string, string> | null,
): string | null {
  if (!snapshotHtml) return null;
  // 1) 본문 토큰 합성 (signer_inputs 있을 때만 의미 있음 — 없으면 토큰 그대로 폴백)
  let html = snapshotHtml;
  if (signerInputs && Object.keys(signerInputs).length > 0) {
    // 동적 import 회피 — 같은 lib 폴더이므로 정적 import 사용
    html = applySignerInputsToHtml(html, signerInputs);
  }
  const signedAtKst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const sigInline = signatureData.type === 'type'
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;font-family:'Nanum Pen Script',cursive;font-size:28px;color:#111">${signatureData.data}</span>`
    : `<img src="${signatureData.data}" alt="서명" style="width:100%;height:100%;object-fit:contain"/>`;
  const sigBoxRe = /(<span class="sig-box" data-role="을"[^>]*>)([\s\S]*?)(<\/span>)/;
  if (sigBoxRe.test(html)) {
    return html.replace(sigBoxRe, `$1${sigInline}$3`);
  }
  const sigImgBlock = signatureData.type === 'type'
    ? `<div style="display:inline-block;font-family:'Nanum Pen Script',cursive;font-size:32px;padding:8px 16px;border-bottom:2px solid #111">${signatureData.data}</div>`
    : `<img src="${signatureData.data}" style="max-height:80px;max-width:200px;background:#fff;padding:4px"/>`;
  return html + `
<div style="margin-top:40px;text-align:right;page-break-inside:avoid">
  <div style="display:inline-block">
    <div style="font-size:11px;color:#6b7280;margin-bottom:4px">거래처 서명</div>
    ${sigImgBlock}
    <div style="font-size:10px;color:#9ca3af;margin-top:4px">${signerName || ''} · ${signedAtKst}</div>
  </div>
</div>`;
}

export async function saveSignature(
  id: string,
  signatureData: {
    type: 'draw' | 'type' | 'upload';
    data: string; // base64 image data or typed name
  },
  ipAddress?: string,
  // 2026-05-22 외부 서명 페이지(anon) 경로 — sign_token 있으면 SECDEF RPC 로 제출(RLS 우회).
  signToken?: string,
  // 2026-05-28 본문 라디오/조건부 텍스트 입력값 — 있으면 합성본 HTML 에도 반영하고 jsonb 컬럼에 저장.
  signerInputs?: Record<string, string> | null,
) {
  if (signToken) {
    // anon 경로: get_signature_request_by_token 으로 검증·스냅샷 조회 → submit_signature_by_token 으로 저장.
    const { data: ex } = await db.rpc('get_signature_request_by_token', { p_token: signToken });
    if (!ex) throw new Error('서명 요청을 찾을 수 없습니다');
    if (ex.status === 'signed') throw new Error('이미 서명 완료된 요청입니다');
    if (ex.expires_at && new Date(ex.expires_at) < new Date()) throw new Error('서명 요청이 만료되었습니다');
    const signedContractHtml = buildSignedContractHtml(ex.template_snapshot_html, signatureData, ex.signer_name, signerInputs);
    const { error } = await db.rpc('submit_signature_by_token', {
      p_token: signToken,
      p_signature_data: signatureData,
      p_signed_contract_html: signedContractHtml,
      p_signature_method: signatureData.type,
      p_signature_data_url: signatureData.data,
      p_ip: ipAddress || null,
    });
    if (error) throw error;
    // signer_inputs 저장 — 별도 SECDEF RPC(save_signer_inputs_by_token) 사용 (anon RLS UPDATE 우회).
    // 마이그레이션 미적용 시 best-effort fail (서명 자체는 이미 성공 — 입력값만 누락).
    if (signerInputs && Object.keys(signerInputs).length > 0) {
      try {
        await db.rpc('save_signer_inputs_by_token', { p_token: signToken, p_inputs: signerInputs });
      } catch (e) {
        console.warn('save_signer_inputs_by_token failed (RPC may not be deployed yet):', e);
      }
    }
    return { id: ex.id, status: 'signed' };
  }
  // Check if signature request exists and is not expired + 본문 스냅샷 같이 조회
  //   2026-05-21: 회수 흐름 통합 — template_snapshot_html 있으면 서명 이미지 합성하여 signed_contract_html 저장
  const { data: existing } = await db
    .from('signature_requests')
    .select('id, status, expires_at, recipient_name:signer_name, template_snapshot_html')
    .eq('id', id)
    .maybeSingle();

  if (!existing) throw new Error('서명 요청을 찾을 수 없습니다');
  if (existing.status === 'signed') throw new Error('이미 서명 완료된 요청입니다');
  if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
    throw new Error('서명 요청이 만료되었습니다');
  }

  // 서명 합성된 최종 계약서 HTML 생성 (template_snapshot_html 있을 때만)
  //   2026-05-21 sig-box 명시: 시스템 양식의 <span class="sig-box" data-role="을"> 안에 이미지 삽입.
  //   sig-box 없는 옛 양식 / 회사 커스텀 양식은 기존 append fallback 으로 호환.
  const signedAtIso = new Date().toISOString();
  const signedAtKst = new Date(signedAtIso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const sigInline = signatureData.type === 'type'
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;font-family:'Nanum Pen Script',cursive;font-size:28px;color:#111">${signatureData.data}</span>`
    : `<img src="${signatureData.data}" alt="서명" style="width:100%;height:100%;object-fit:contain"/>`;
  const sigBoxRe = /(<span class="sig-box" data-role="을"[^>]*>)([\s\S]*?)(<\/span>)/;
  let signedContractHtml: string | null = null;
  if (existing.template_snapshot_html) {
    // 2026-05-28 본문 ?-prefix 토큰(라디오/조건부 텍스트) 합성 — signerInputs 있을 때만 적용
    const tplHtml = signerInputs && Object.keys(signerInputs).length > 0
      ? applySignerInputsToHtml(existing.template_snapshot_html, signerInputs)
      : existing.template_snapshot_html;
    if (sigBoxRe.test(tplHtml)) {
      // 시스템 양식 — sig-box[data-role="을"] 안에 서명 삽입
      signedContractHtml = tplHtml.replace(sigBoxRe, `$1${sigInline}$3`);
    } else {
      // 옛 양식 / 커스텀 양식 — 본문 끝에 append (회귀 fallback)
      const sigImgBlock = signatureData.type === 'type'
        ? `<div style="display:inline-block;font-family:'Nanum Pen Script',cursive;font-size:32px;padding:8px 16px;border-bottom:2px solid #111">${signatureData.data}</div>`
        : `<img src="${signatureData.data}" style="max-height:80px;max-width:200px;background:#fff;padding:4px"/>`;
      signedContractHtml = tplHtml + `
<div style="margin-top:40px;text-align:right;page-break-inside:avoid">
  <div style="display:inline-block">
    <div style="font-size:11px;color:#6b7280;margin-bottom:4px">거래처 서명</div>
    ${sigImgBlock}
    <div style="font-size:10px;color:#9ca3af;margin-top:4px">${existing.recipient_name || ''} · ${signedAtKst}</div>
  </div>
</div>`;
    }
  }

  const { data, error } = await db
    .from('signature_requests')
    .update({
      status: 'signed',
      signed_at: signedAtIso,
      signature_data: signatureData,
      // 회수 흐름 통합: 분리 컬럼 + 합성본 (signed_contract_html 은 template_snapshot_html 있을 때만)
      signature_method: signatureData.type,
      signature_data_url: signatureData.data,
      signed_contract_html: signedContractHtml,
      // 2026-05-28 라디오/조건부 텍스트 입력값 — 없으면 null 유지
      ...(signerInputs && Object.keys(signerInputs).length > 0 ? { signer_inputs: signerInputs } : {}),
      ip_address: ipAddress || null,
    })
    .eq('id', id)
    .in('status', ['sent', 'viewed']) // viewed 상태에서도 서명 가능
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('서명 처리에 실패했습니다. 이미 처리된 요청일 수 있습니다.');

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
        .maybeSingle();

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

// ── Bulk Signature Requests (일괄 서명 요청) ──
export async function createBulkSignatureRequests(params: {
  companyId: string;
  documentId: string;
  title: string;
  signers: { name: string; email: string; phone?: string }[];
  createdBy: string;
  sendEmails?: boolean;
}): Promise<{ created: number; sent: number; failed: number; ids: string[] }> {
  const ids: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const signer of params.signers) {
    if (!signer.name?.trim() || !signer.email?.trim()) continue;
    try {
      const created = await createSignatureRequest({
        companyId: params.companyId,
        documentId: params.documentId,
        title: params.title,
        signerName: signer.name.trim(),
        signerEmail: signer.email.trim(),
        signerPhone: signer.phone?.trim() || undefined,
        createdBy: params.createdBy,
      });
      ids.push(created.id);

      if (params.sendEmails !== false) {
        const r = await sendSignatureEmail(created.id);
        if (r.success) sent += 1; else failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { created: ids.length, sent, failed, ids };
}

// ── 거래처(미가입 단체) 일괄 서명요청 ──
//   기존 단건 createSignatureRequest 코드경로를 그대로 호출(회귀 0)하고
//   partner_id / batch_id / batch_seq 만 추가로 채워 묶음을 식별한다.
//   변수 치환은 documents.fillVariables 재사용. send-signature-email 엣지는
//   sendSignatureEmail 한 곳에서만 호출 (엣지 무수정).
export type PartnerVarColumn = 'name'|'representative'|'contact_name'|'contact_email'|'contact_phone'|'business_number'|'address';

// 2026-05-22 단체 일괄발송 — 우리(갑) 직인을 발송 전 본문에 합성.
//   갑 sig-box[data-role="갑"] 우선, 없으면(자유 양식) 본문 끝 "수행기관(갑) 직인" 블록 append.
//   거래처는 받는 즉시 우리 도장이 찍힌 계약서를 보고, 을 서명만 하면 양방향 완성.
export function injectOurSeal(html: string | null | undefined, sealUrl: string, companyName?: string | null): string {
  if (!html || !sealUrl) return html || '';
  const sealImg = `<img src="${sealUrl}" alt="직인" style="width:64px;height:64px;object-fit:contain;display:inline-block"/>`;
  const gabBoxRe = /(<span class="sig-box" data-role="갑"[^>]*>)([\s\S]*?)(<\/span>)/;
  if (gabBoxRe.test(html)) {
    return html.replace(gabBoxRe, `$1${sealImg}$3`);
  }
  return html + `
<div style="margin-top:32px;text-align:right;page-break-inside:avoid">
  <div style="display:inline-block;text-align:center">
    <div style="font-size:11px;color:#6b7280;margin-bottom:4px">${companyName || '수행기관(갑)'} (인)</div>
    ${sealImg}
  </div>
</div>`;
}

// 2026-05-22 변수 토큰 정규화 — RichEditor 에서 {{단체명}} 입력 시 글자별 서식(span)이 끼어
//   {{</span><span ...>단체명</span>...}} 처럼 토큰이 HTML 태그로 분절되면 변수 치환이 실패함.
//   {{ ... }} 사이의 모든 HTML 태그·엔티티를 제거해 순수 변수명({{단체명}})으로 복구.
// 2026-05-28 ?-prefix 토큰({{?라디오:...}}, {{?텍스트:...}}) 보호 — `|` 와 `when=` 의미 보존.
//   라디오 옵션 사이 공백은 보존하되 연속 공백·줄바꿈만 단일 공백으로 압축.
export function normalizeVariableTokens(html: string): string {
  if (!html) return html;
  return html.replace(/\{\{([\s\S]*?)\}\}/g, (_m, inner) => {
    const stripped = String(inner)
      .replace(/<[^>]*>/g, "")          // HTML 태그 제거
      .replace(/&nbsp;/gi, " ")
      .replace(/&[a-zA-Z]+;|&#\d+;/g, ""); // 기타 엔티티 제거
    const trimmed = stripped.trim();
    // ?-prefix 토큰 (라디오/텍스트) 은 `|` / `when=` / 옵션 라벨 공백 보존
    if (trimmed.startsWith('?라디오') || trimmed.startsWith('?텍스트')) {
      const clean = trimmed.replace(/[ \t]*\r?\n[ \t]*/g, ' '); // 줄바꿈만 공백으로
      return `{{${clean}}}`;
    }
    return `{{${trimmed}}}`;
  });
}

// 2026-05-22 계약서 본문 표·이미지에 인라인 스타일 주입 — 외부 서명 페이지·메일·PDF 어디서나
//   표 테두리·이미지가 보이게. RichEditor 표는 style="min-width:..." 만 있어 테두리가 없으므로
//   기존 style 에 border 를 append (스킵하지 않음).
export function injectContractInlineStyles(html: string): string {
  if (!html) return html;
  const append = (attrs: string, base: string): string => {
    if (/style\s*=/i.test(attrs)) {
      return attrs.replace(/style\s*=\s*(["'])([\s\S]*?)\1/i, (_m, q, s) => `style=${q}${s};${base}${q}`);
    }
    return `${attrs} style="${base}"`;
  };
  // style 안의 특정 width 계열 속성만 골라 제거 (다른 색·padding 등은 보존)
  const stripWidthProps = (styleStr: string): string =>
    styleStr
      .replace(/(^|;)\s*(min-width|max-width|width)\s*:[^;]*/gi, '')
      .replace(/^\s*;+/, '')
      .replace(/;\s*;+/g, ';')
      .trim();
  const stripStyleAttrWidths = (attrs: string): string =>
    attrs.replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (_m, pre, q, s) => {
      const cleaned = stripWidthProps(s);
      return cleaned ? `${pre}${q}${cleaned}${q}` : '';
    });

  return html
    // 2026-05-28 RichEditor 가 <colgroup><col style="width:79px"> + <table style="min-width:179px"> +
    //   <td colwidth="0,0,79,0,0"> 같은 임의 컬럼 폭 메타데이터를 박아, 콘텐츠가 짧은 셀은 비대하고
    //   긴 셀("(주)한국중소벤처기업유통원")은 좁아서 3줄로 깨지는 현상.
    //   해결: 강제 폭 메타데이터(col style/width, table min/max/width, td colwidth) 전부 제거하고
    //   table-layout:auto + 한글 word-break:keep-all 로 콘텐츠 길이 기반 자동 분배 + 단어 안 깨짐.
    .replace(/<col\b([^>]*?)>/gi, (_m, attrs) => {
      const cleaned = String(attrs)
        .replace(/\sstyle\s*=\s*(["'])[^"']*\1/gi, '')
        .replace(/\swidth\s*=\s*(["'])[^"']*\1/gi, '');
      return `<col${cleaned}>`;
    })
    .replace(/<table([^>]*)>/gi, (_m, attrs) => {
      const noWidths = stripStyleAttrWidths(attrs);
      // 2026-05-28 표를 콘텐츠 합 폭만큼만 차지하게 + 페이지 가운데 정렬.
      //   width:100% 이면 짧은 셀("이태식")이 같은 컬럼의 긴 셀(긴 회사명) 폭 따라 비대해짐.
      //   fit-content + max-width:100% → 콘텐츠 자연 폭, 단 컨테이너 초과 시 100% 로 제한.
      return `<table${append(noWidths, "border-collapse:collapse;width:fit-content;max-width:100%;margin:12px auto;table-layout:auto;word-break:keep-all")}>`;
    })
    .replace(/<(td|th)([^>]*)>/gi, (_m, tag, attrs) => {
      // colwidth 속성(tiptap 메타) 제거 + style 안의 width 계열만 제거
      const noColwidth = String(attrs).replace(/\scolwidth\s*=\s*(["'])[^"']*\1/gi, '');
      const noWidths = stripStyleAttrWidths(noColwidth);
      // padding 8px → 6px·10px (세로 6 가로 10) 로 살짝 콤팩트 — 짧은 텍스트 셀 비대 느낌 완화.
      return `<${tag}${append(noWidths, "border:1px solid #cbd5e1;padding:6px 10px;vertical-align:top;word-break:keep-all")}>`;
    })
    .replace(/<img([^>]*)>/gi, (_m, attrs) => `<img${/style\s*=/i.test(attrs) ? attrs : `${attrs} style="max-width:100%;height:auto;display:block;margin:8px 0"`}>`);
}

export async function createBulkSignatureRequestsToOrgs(params: {
  companyId: string;
  createdBy: string;
  documentId: string;
  titleTemplate: string;
  expiresInDays?: number;
  partnerIds: string[];
  variableMap: Record<string, PartnerVarColumn>;
  commonVariables?: Record<string, string>;
  perPartnerOverrides?: Record<string /*partnerId*/, Record<string /*varName*/, string>>;
  sendEmails?: boolean;
  // 2026-05-22 발송 전 우리(갑) 직인을 본문에 미리 합성 (회사 seal_url 사용).
  applyOurSeal?: boolean;
  /**
   * chunk 완료마다 진행률 콜백 (100개+ 대량 발송 UI 진행률 바 용).
   *   done: 지금까지 처리한 행 수 (성공+실패 포함)
   *   total: 전체 행 수 (eligible 기준)
   *   sent: 이메일 발송 성공 누계
   *   failed: 발송 실패 누계
   */
  onProgress?: (info: { done: number; total: number; sent: number; failed: number }) => void;
}): Promise<{
  batchId: string;
  created: number;
  sent: number;
  failed: number;
  skipped: { partnerId: string; reason: string }[];
  errors: { partnerId: string; reason: string }[];
}> {
  const {
    companyId,
    createdBy,
    documentId,
    titleTemplate,
    partnerIds,
    variableMap,
    commonVariables = {},
    perPartnerOverrides = {},
    sendEmails = true,
    applyOurSeal = false,
    onProgress,
  } = params;

  const batchId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const skipped: { partnerId: string; reason: string }[] = [];
  const errors: { partnerId: string; reason: string }[] = [];
  let createdCount = 0;
  let sentCount = 0;
  let failedCount = 0;

  if (!partnerIds || partnerIds.length === 0) {
    return { batchId, created: 0, sent: 0, failed: 0, skipped, errors };
  }

  // documents.fillVariables 동적 import — 순환 방지
  const { fillVariables } = await import('./documents');

  // 본문 snapshot 저장용: documents.content_json 1회 조회 + 회사(갑) 정보 1회 조회
  //   2026-05-21 회수 흐름 통합: partner 별 변수 치환된 본문을 signature_requests.template_snapshot_html 저장
  //   → /sign 외부 페이지 + /contracts/signed 본문 표시 + saveSignature 합성 input 으로 사용
  const { data: docRow } = await db
    .from('documents')
    .select('content_json')
    .eq('id', documentId)
    .maybeSingle();
  const { data: companyRow } = await db
    .from('companies')
    .select('name, business_number, representative, address, seal_url')
    .eq('id', companyId)
    .maybeSingle();
  // 우리 직인 적용 — seal_url 있을 때만 (없으면 조용히 미적용)
  const ourSealUrl: string | null = applyOurSeal ? (companyRow?.seal_url || null) : null;

  // 1) 회사 격리 가드 + 데이터 한 번에 조회
  const { data: partners, error: pErr } = await db
    .from('partners')
    .select('id, name, representative, contact_name, contact_email, contact_phone, business_number, address')
    .eq('company_id', companyId)
    .in('id', partnerIds);

  if (pErr) throw pErr;

  const partnerMap = new Map<string, any>();
  for (const p of (partners || [])) partnerMap.set(p.id, p);

  // 2) 사전 차단: 조회 실패 / contact_email 누락
  const eligible: any[] = [];
  for (const pid of partnerIds) {
    const p = partnerMap.get(pid);
    if (!p) {
      skipped.push({ partnerId: pid, reason: '거래처를 찾을 수 없거나 회사에 속하지 않습니다.' });
      continue;
    }
    if (!p.contact_email || !String(p.contact_email).trim()) {
      skipped.push({ partnerId: pid, reason: '담당자 이메일이 등록되어 있지 않습니다.' });
      continue;
    }
    eligible.push(p);
  }

  // 3) chunk 5 동시성으로 처리 (RLS·이메일 한도 고려)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (params.expiresInDays ?? 14));
  const expiresIso = expiresAt.toISOString();

  const buildVars = (p: any): Record<string, string> => {
    const mapped: Record<string, string> = {};
    for (const [varName, col] of Object.entries(variableMap)) {
      if (!varName) continue;
      const v = p?.[col];
      mapped[varName] = v == null ? '' : String(v);
    }
    return { ...commonVariables, ...mapped, ...(perPartnerOverrides[p.id] || {}) };
  };

  // batch_seq 1-base (원 partnerIds 순서 보존)
  const seqMap = new Map<string, number>();
  partnerIds.forEach((id, idx) => seqMap.set(id, idx + 1));

  const runOne = async (p: any) => {
    try {
      const vars = buildVars(p);
      const renderedTitle = fillVariables({ t: titleTemplate } as any, vars).t as string;
      const created = await createSignatureRequest({
        companyId,
        documentId,
        title: renderedTitle || titleTemplate,
        signerName: p.contact_name || p.representative || p.name,
        signerEmail: String(p.contact_email).trim(),
        createdBy,
      });
      // 본문 snapshot: documents.content_json.body 의 토큰을 partner + company 데이터로 치환
      //   /sign 외부 페이지 fillBody 와 동일 매핑 (server-side mirror)
      let snapshotHtml: string | null = null;
      // 토큰 정규화 — 서식 span 으로 분절된 {{변수}} 복구 후 치환.
      const docBody = normalizeVariableTokens((docRow?.content_json as { body?: string } | null)?.body || '');
      if (typeof docBody === 'string' && docBody.trim()) {
        const c = companyRow || {};
        const pn = p;
        const replacements: Record<string, string> = {
          '갑_회사명': String(c.name || ''),
          '갑_사업자번호': String(c.business_number || ''),
          '갑_대표자': String(c.representative || ''),
          '갑_주소': String(c.address || ''),
          'company_name': String(c.name || ''),
          '을_회사명': String(pn.name || ''),
          '을_단체명': String(pn.name || ''),
          '을_사업자번호': String(pn.business_number || ''),
          '을_대표자': String(pn.representative || ''),
          '을_담당자': String(pn.contact_name || ''),
          '을_이메일': String(pn.contact_email || ''),
          '을_연락처': String(pn.contact_phone || ''),
          '을_전화': String(pn.contact_phone || ''),
          '을_주소': String(pn.address || ''),
          'partner_name': String(pn.name || ''),
          '갑': String(c.name || ''),
          '을': String(pn.name || ''),
          '회사명': String(pn.name || ''),
          '단체명': String(pn.name || ''),
          '사업자등록번호': String(pn.business_number || c.business_number || ''),
          '사업자번호': String(pn.business_number || c.business_number || ''),
          '대표자명': String(pn.representative || c.representative || ''),
          '대표자': String(pn.representative || c.representative || ''),
          '주소': String(pn.address || c.address || ''),
          '담당자': String(pn.contact_name || ''),
          '이메일': String(pn.contact_email || ''),
          '연락처': String(pn.contact_phone || ''),
          '전화': String(pn.contact_phone || ''),
          '전화번호': String(pn.contact_phone || ''),
          '날짜': new Date().toLocaleDateString('ko-KR'),
          '오늘': new Date().toLocaleDateString('ko-KR'),
          '계약일': new Date().toLocaleDateString('ko-KR'),
        };
        // 사용자가 변수 매핑 단계에서 지정한 값 우선 반영 (거래처 컬럼 / 공통값 / 개별 덮어쓰기).
        for (const [token, col] of Object.entries(variableMap || {})) {
          if (col) replacements[token] = String((pn as any)[col] ?? '');
        }
        for (const [token, val] of Object.entries(commonVariables)) {
          if (val) replacements[token] = val;
        }
        for (const [token, val] of Object.entries(perPartnerOverrides[p.id] || {})) {
          if (val) replacements[token] = val;
        }
        const filledText = docBody.replace(/\{\{?\s*([^}{\s]+?)\s*\}\}?/g, (full, key: string) => {
          const k = String(key).trim();
          if (k in replacements) return replacements[k];
          return full;
        });
        // text → HTML (개행 보존). 양식이 이미 HTML 이면 그대로.
        let html = /^\s*</.test(filledText)
          ? filledText
          : `<div style="white-space:pre-wrap;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.7;color:#111">${filledText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
        // 표·이미지 인라인 스타일 주입 (RichEditor 표는 min-width 만 있어 테두리 없음 → append).
        snapshotHtml = injectContractInlineStyles(html);
        // 발송 전 우리(갑) 직인 합성 — 거래처가 받는 즉시 우리 도장이 찍힌 계약서를 봄.
        if (ourSealUrl) {
          snapshotHtml = injectOurSeal(snapshotHtml, ourSealUrl, companyRow?.name);
        }
      }

      // partner_id/batch_id/batch_seq + 만료 + 본문 snapshot
      const { error: upErr } = await db
        .from('signature_requests')
        .update({
          partner_id: p.id,
          batch_id: batchId,
          batch_seq: seqMap.get(p.id) ?? null,
          expires_at: expiresIso,
          template_snapshot_html: snapshotHtml,
        })
        .eq('id', created.id);
      if (upErr) {
        // 23505 = 같은 batch 안 partner 중복 (uq_signature_requests_batch_partner)
        // 원행은 이미 생성됐으니 단건은 살려두고 errors 로 보고
        errors.push({ partnerId: p.id, reason: upErr.message || '배치 메타 업데이트 실패' });
        return;
      }
      createdCount += 1;

      if (sendEmails) {
        const r = await sendSignatureEmail(created.id);
        if (r.success) sentCount += 1;
        else {
          failedCount += 1;
          errors.push({ partnerId: p.id, reason: r.error || '이메일 발송 실패' });
        }
      }
    } catch (e: any) {
      errors.push({ partnerId: p.id, reason: e?.message || '서명 요청 생성 실패' });
    }
  };

  // 발송량 기반 chunk·간격 동적 조절 (2026-05-21, 504 인시던트 3차 후속).
  //   ≤50: chunk 5 / 1초 — 소량은 빠르게
  //   51~150: chunk 3 / 2초 — Resend/SendGrid 저tier 안전
  //   151~400: chunk 2 / 3초 — 외부 API rate-limit 회피, 400개 ≈ 10분 분산
  //   참고: 신규 trigger 추가 절대 금지 (504 재발 원인). 비동기 큐 신설 X (사용자 결정).
  const total = eligible.length;
  const CHUNK = total <= 50 ? 5 : total <= 150 ? 3 : 2;
  const INTERVAL_MS = total <= 50 ? 1000 : total <= 150 ? 2000 : 3000;
  let processed = 0;
  for (let i = 0; i < total; i += CHUNK) {
    const slice = eligible.slice(i, i + CHUNK);
    await Promise.allSettled(slice.map(runOne));
    processed += slice.length;
    onProgress?.({ done: processed, total, sent: sentCount, failed: failedCount });
    // chunk 사이 간격 — rate-limit 윈도 회피
    if (i + CHUNK < total) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  return {
    batchId,
    created: createdCount,
    sent: sentCount,
    failed: failedCount,
    skipped,
    errors,
  };
}

// 일괄 발송 진행도 (목록 뱃지·재시도 UI 용)
export async function getBatchProgress(batchId: string): Promise<{
  total: number;
  created: number;
  sent: number;
  viewed: number;
  signed: number;
  rejected: number;
  expired: number;
}> {
  const { data, error } = await db
    .from('signature_requests')
    .select('status')
    .eq('batch_id', batchId);
  if (error) throw error;
  const rows = (data || []) as { status: string }[];
  const total = rows.length;
  const c = { created: total, sent: 0, viewed: 0, signed: 0, rejected: 0, expired: 0 };
  for (const r of rows) {
    if (r.status === 'sent') c.sent += 1;
    else if (r.status === 'viewed') c.viewed += 1;
    else if (r.status === 'signed') c.signed += 1;
    else if (r.status === 'rejected') c.rejected += 1;
    else if (r.status === 'expired') c.expired += 1;
  }
  return { total, ...c };
}

// 같은 batch_id 안에서 실패한(미발송) partner_id 목록 (재시도 진입용)
export async function getFailedPartnersInBatch(batchId: string): Promise<{
  partnerIds: string[];
}> {
  const { data, error } = await db
    .from('signature_requests')
    .select('partner_id, status')
    .eq('batch_id', batchId)
    .in('status', ['pending']);
  if (error) throw error;
  const partnerIds = ((data || []) as { partner_id: string|null }[])
    .map((r) => r.partner_id)
    .filter((x): x is string => !!x);
  return { partnerIds };
}

// ── Send Signature Reminder (리마인더 발송) ──
export async function sendSignatureReminder(signatureRequestId: string): Promise<{ success: boolean; error?: string }> {
  const req = await getSignatureRequest(signatureRequestId);
  if (!req) return { success: false, error: '서명 요청을 찾을 수 없습니다.' };
  if (req.status === 'signed') return { success: false, error: '이미 서명이 완료되었습니다.' };
  if (req.status === 'expired' || req.status === 'cancelled') return { success: false, error: '만료/취소된 요청입니다.' };

  // 리마인더 최대 5회 제한
  const currentCount = (req as any).reminder_count || 0;
  if (currentCount >= 5) return { success: false, error: '리마인더 발송 횟수가 최대(5회)에 도달했습니다.' };

  const r = await sendSignatureEmail(signatureRequestId);

  // 리마인더 실패 — sendSignatureEmail 의 'initial'/'bulk_initial' 로깅과 별개로
  //   'reminder' send_type 행을 1건 추가. 패널에서 리마인더 실패 통계를 별도로 볼 수 있게 함.
  if (!r.success) {
    void logSendFailure({
      signatureRequestId,
      batchId: (req as any).batch_id ?? null,
      partnerId: (req as any).partner_id ?? null,
      recipientEmail: req.signer_email,
      recipientName: req.signer_name ?? null,
      sendType: 'reminder',
      err: r.error || '리마인더 발송 실패',
    });
  }

  // 리마인더 카운터 증가 + 감사 로그
  try {
    await db.from('signature_requests').update({
      reminder_count: ((req as any).reminder_count || 0) + 1,
      last_reminded_at: new Date().toISOString(),
    }).eq('id', signatureRequestId);
  } catch { /* schema may not have these columns yet — ignore */ }

  await logAudit({
    company_id: req.company_id,
    user_id: req.created_by || 'system',
    action: 'remind',
    entity_type: 'signature',
    entity_id: signatureRequestId,
    entity_name: req.title,
    metadata: { signer_email: req.signer_email, success: r.success },
  });

  return r;
}

export async function bulkSendReminders(signatureRequestIds: string[]): Promise<{ sent: number; failed: number }> {
  let sent = 0; let failed = 0;
  for (const id of signatureRequestIds) {
    const r = await sendSignatureReminder(id);
    if (r.success) sent += 1; else failed += 1;
  }
  return { sent, failed };
}

// ── Audit Log for a Document's Signatures ──
export async function getDocumentSignatureAudit(companyId: string, documentId: string) {
  // 문서에 연결된 모든 signature_requests 조회 후 각각의 audit log 머지
  const sigs = await getDocumentSignatures(documentId);
  const sigIds = sigs.map((s: any) => s.id);
  if (sigIds.length === 0) return [];

  const { data: logs } = await db
    .from('audit_logs')
    .select('*, users:user_id(name, email)')
    .eq('company_id', companyId)
    .eq('entity_type', 'signature')
    .in('entity_id', sigIds)
    .order('created_at', { ascending: false });

  return (logs || []).map((l: any) => {
    const sig = sigs.find((s: any) => s.id === l.entity_id);
    return { ...l, signer_name: sig?.signer_name, signer_email: sig?.signer_email };
  });
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

  // 서명 취소 후 연결된 문서를 draft 상태로 롤백
  if (data?.document_id) {
    await db
      .from('documents')
      .update({ status: 'draft' })
      .eq('id', data.document_id);
  }

  return data;
}

// ── Delete (영구 삭제) ── 취소(soft, status=expired)와 별개로 행을 완전 삭제.
//   RLS: signature_requests_delete (company_id = get_my_company_id()) 로 회사 격리.
export async function deleteSignatureRequest(id: string) {
  const { error } = await db
    .from('signature_requests')
    .delete()
    .eq('id', id);
  if (error) throw error;
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
    .maybeSingle();

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
    .maybeSingle();

  if (error) throw error;
  return data;
}
