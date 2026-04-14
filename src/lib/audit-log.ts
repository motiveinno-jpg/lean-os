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

export async function logAudit(entry: AuditLogEntry) {
  try {
    await (supabase as any).from('audit_logs').insert({
      ...entry,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Audit log failed:', err);
    // Never throw - audit logging should not block operations
  }
}

export async function getAuditLogs(params: {
  companyId: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: AuditAction;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}) {
  let query = (supabase as any)
    .from('audit_logs')
    .select('*, profiles:user_id(email, display_name)')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.entityType) query = query.eq('entity_type', params.entityType);
  if (params.entityId) query = query.eq('entity_id', params.entityId);
  if (params.userId) query = query.eq('user_id', params.userId);
  if (params.action) query = query.eq('action', params.action);
  if (params.fromDate) query = query.gte('created_at', params.fromDate);
  if (params.toDate) query = query.lte('created_at', params.toDate);

  query = query.range(params.offset || 0, (params.offset || 0) + (params.limit || 50) - 1);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Helper to format audit action in Korean
export function formatAuditAction(action: AuditAction): string {
  const map: Record<AuditAction, string> = {
    create: '생성', update: '수정', delete: '삭제',
    approve: '승인', reject: '반려', sign: '서명',
    send: '발송', lock: '잠금', unlock: '잠금해제',
    login: '로그인', export: '내보내기',
    remind: '리마인드', revoke: '취소', view: '조회',
  };
  return map[action] || action;
}

export function formatEntityType(type: string): string {
  const map: Record<string, string> = {
    document: '문서', employee: '직원', deal: '딜/프로젝트',
    transaction: '거래', payment: '결제', signature: '서명',
    tax_invoice: '세금계산서', partner: '거래처', approval: '결재',
    closing: '월마감', vault_account: '구독계정', vault_asset: '자산',
    contract: '계약서', expense: '경비', leave: '휴가',
  };
  return map[type] || type;
}
