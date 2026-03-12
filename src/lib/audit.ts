import { supabase } from './supabase';

// ── Audit Log Entry ──
export async function logAudit(params: {
  companyId: string;
  userId?: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson?: any;
  afterJson?: any;
  metadata?: any;
}) {
  const { error } = await supabase.from('audit_logs').insert({
    company_id: params.companyId,
    user_id: params.userId ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    before_json: params.beforeJson ?? null,
    after_json: params.afterJson ?? null,
    metadata: params.metadata ?? null,
  });
  if (error) throw error;
}

// ── Query Audit Logs ──
export async function getAuditLogs(
  companyId: string,
  filters?: {
    entityType?: string;
    entityId?: string;
    action?: string;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }
) {
  let query = supabase
    .from('audit_logs')
    .select('*, users(name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(filters?.limit ?? 100);

  if (filters?.entityType) query = query.eq('entity_type', filters.entityType);
  if (filters?.entityId) query = query.eq('entity_id', filters.entityId);
  if (filters?.action) query = query.eq('action', filters.action);
  if (filters?.userId) query = query.eq('user_id', filters.userId);
  if (filters?.dateFrom) query = query.gte('created_at', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('created_at', filters.dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ── Entity Change History ──
export async function getEntityHistory(
  companyId: string,
  entityType: string,
  entityId: string
) {
  return getAuditLogs(companyId, { entityType, entityId });
}
