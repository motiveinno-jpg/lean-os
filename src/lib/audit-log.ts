/**
 * OwnerView Audit Log System
 * 전사적 데이터 변경 이력 추적
 */
import { supabase } from './supabase';

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'approve' | 'reject'
  | 'sign' | 'send' | 'lock' | 'unlock' | 'login' | 'export'
  | 'remind' | 'revoke' | 'view';

export interface AuditLogEntry {
  company_id: string;
  user_id: string;
  action: AuditAction;
  entity_type: string; // 'document', 'employee', 'deal', 'transaction', 'payment', 'signature', etc.
  entity_id: string;
  entity_name?: string;
  changes?: Record<string, { old: any; new: any }>;
  metadata?: Record<string, any>;
  ip_address?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function logAudit(entry: AuditLogEntry) {
  try {
    // user_id 는 UUID 컬럼이라 'system' 같은 문자열을 그대로 넣으면 22P02 (invalid uuid) 발생.
    // 비-UUID 값은 null 로 정규화하고 metadata.actor 로 보존.
    const safeUserId = UUID_RE.test(entry.user_id) ? entry.user_id : null;
    // 2026-05-22 audit_logs 실제 컬럼만 insert. entity_name/changes 는 컬럼 없음 → metadata 에 보존
    //   (기존 {...entry} spread 가 없는 컬럼을 넣어 'column does not exist' 반복 실패 → 504 가중).
    const { entity_name, changes, ...rest } = entry;
    const metadata = {
      ...(entry.metadata || {}),
      ...(safeUserId === null ? { actor: entry.user_id } : {}),
      ...(entity_name ? { entity_name } : {}),
      ...(changes ? { changes } : {}),
    };
    await supabase.from('audit_logs').insert({
      company_id: rest.company_id,
      user_id: safeUserId,
      action: rest.action,
      entity_type: rest.entity_type,
      entity_id: rest.entity_id,
      metadata,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Audit log failed:', err);
    // Never throw - audit logging should not block operations
  }
}
