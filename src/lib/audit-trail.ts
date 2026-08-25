import { logRead } from "@/lib/log-read";
/**
 * OwnerView Audit Trail Certificate Engine
 * 전자서명 감사추적인증서 — 생성, 기록, 조회, HTML 인증서 생성
 */

import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ── Types ──

export type AuditAction =
  | 'document_created'
  | 'signing_requested'
  | 'email_sent'
  | 'document_opened'
  | 'document_viewed'
  | 'signature_drawn'
  | 'signature_typed'
  | 'signature_uploaded'
  | 'signature_submitted'
  | 'document_completed'
  | 'document_locked'
  | 'sending_cancelled'; // 열람 전 발송 취소 (2026-08-19)

export interface AuditTrailEntry {
  action: AuditAction;
  timestamp: string; // ISO 8601
  actor: string; // name or email
  ip?: string;
  userAgent?: string;
  details?: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  document_created: '문서 생성',
  signing_requested: '서명 요청',
  email_sent: '이메일 발송',
  document_opened: '문서 열람',
  document_viewed: '문서 확인',
  signature_drawn: '서명 입력 (직접 그리기)',
  signature_typed: '서명 입력 (텍스트)',
  signature_uploaded: '서명 입력 (도장/직인 첨부)',
  signature_submitted: '서명 제출',
  document_completed: '서명 완료',
  document_locked: '문서 잠금',
  sending_cancelled: '발송 취소 (열람 전)',
};

// ── Log Audit Trail ──

export async function logAuditTrail(
  packageId: string,
  entry: AuditTrailEntry,
): Promise<void> {
  // 2026-05-26 best-effort — 감사추적 실패가 서명/본문 렌더를 막지 않게(외부 anon RLS 0행 등).
  if (!packageId) return;
  // 1. Fetch current package record
  const { data: pkg, error: fetchError } = await db
    .from('hr_contract_packages')
    .select('id, notes')
    .eq('id', packageId)
    .maybeSingle();

  if (fetchError || !pkg) {
    console.warn('감사추적 기록 스킵 — 패키지 조회 불가:', packageId);
    return;
  }

  // 2. Parse existing notes as JSON — may contain { audit_trail: [...], ...other }
  let notesObj: Record<string, unknown> = {};
  if (pkg.notes) {
    try {
      const parsed = JSON.parse(pkg.notes);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        notesObj = parsed;
      } else if (Array.isArray(parsed)) {
        // Legacy: notes was a plain array — migrate into keyed object
        notesObj = { audit_trail: parsed };
      } else {
        // Primitive value (string/number) — preserve as "text"
        notesObj = { text: String(parsed) };
      }
    } catch {
      // Not valid JSON — preserve raw string
      notesObj = { text: pkg.notes };
    }
  }

  // 3. Append entry
  const trail: AuditTrailEntry[] = Array.isArray(notesObj.audit_trail)
    ? (notesObj.audit_trail as AuditTrailEntry[])
    : [];

  trail.push({
    action: entry.action,
    timestamp: entry.timestamp || new Date().toISOString(),
    actor: entry.actor,
    ...(entry.ip ? { ip: entry.ip } : {}),
    ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
    ...(entry.details ? { details: entry.details } : {}),
  });

  notesObj.audit_trail = trail;

  // 4. Update DB
  const { error: updateError } = await db
    .from('hr_contract_packages')
    .update({ notes: JSON.stringify(notesObj) })
    .eq('id', packageId);

  if (updateError) {
    throw new Error(`감사추적 기록 실패 — DB 업데이트 오류: ${updateError.message}`);
  }
}
