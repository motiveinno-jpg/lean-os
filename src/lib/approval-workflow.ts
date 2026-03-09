/**
 * OwnerView Multi-Step Approval Workflow Engine
 * 다단계 결재 워크플로우 엔진 — 정책 기반 자동 라우팅 + 단계별 승인/반려
 */

import { supabase } from './supabase';
import { logAudit } from './audit';
import { createQueueEntry } from './payment-queue';
import { resolveBank } from './routing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export type RequestType =
  | 'expense'
  | 'payment'
  | 'leave'
  | 'overtime'
  | 'purchase'
  | 'contract'
  | 'travel'
  | 'card_expense'
  | 'equipment'
  | 'approval_doc'
  | 'expense_report'
  | 'custom';

export interface ApprovalPolicy {
  id: string;
  company_id: string;
  name: string;
  document_type: string;
  stages: ApprovalStageConfig[];
  auto_approve_below: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalStageConfig {
  stage: number;
  name: string;
  approver_role: string; // e.g. 'manager', 'director', 'ceo'
  required_count?: number; // how many approvers needed (default 1)
}

export interface ApprovalRequest {
  id: string;
  company_id: string;
  policy_id: string;
  request_type: string;
  request_id: string;
  requester_id: string;
  title: string;
  amount: number;
  description?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  current_stage: number;
  total_stages: number;
  attachments: string[];
  created_at: string;
  updated_at?: string;
}

export interface ApprovalStep {
  id: string;
  request_id: string;
  stage: number;
  stage_name: string;
  approver_id: string;
  approver_name?: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  comment: string;
  decided_at: string | null;
  created_at: string;
}

// ── Request Type Labels ──

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  expense: '경비 청구',
  payment: '결제 요청',
  leave: '휴가 신청',
  overtime: '초과근무',
  purchase: '구매 요청',
  contract: '계약 체결',
  travel: '출장 신청',
  card_expense: '법인카드 사용',
  equipment: '장비 요청',
  approval_doc: '품의서',
  expense_report: '지출결의서',
  custom: '기타',
};

// ══════════════════════════════════════════════
// Policy Management
// ══════════════════════════════════════════════

/**
 * Get all approval policies for a company
 */
export async function getApprovalPolicies(companyId: string): Promise<ApprovalPolicy[]> {
  const { data, error } = await db
    .from('approval_policies')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ApprovalPolicy[];
}

/**
 * Create or update an approval policy
 */
export async function upsertApprovalPolicy(
  policy: Partial<ApprovalPolicy> & {
    company_id: string;
    name: string;
    document_type: string;
    stages: ApprovalStageConfig[];
  }
): Promise<ApprovalPolicy> {
  const row: Record<string, unknown> = {
    company_id: policy.company_id,
    name: policy.name,
    document_type: policy.document_type,
    stages: policy.stages,
    auto_approve_below: policy.auto_approve_below ?? 0,
    is_active: policy.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (policy.id) {
    row.id = policy.id;
  }

  const { data, error } = await db
    .from('approval_policies')
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  return data as ApprovalPolicy;
}

/**
 * Delete an approval policy
 */
export async function deleteApprovalPolicy(policyId: string): Promise<void> {
  const { error } = await db
    .from('approval_policies')
    .delete()
    .eq('id', policyId);
  if (error) throw error;
}

// ══════════════════════════════════════════════
// Approval Request Lifecycle
// ══════════════════════════════════════════════

/**
 * Create a new approval request.
 * Auto-matches policy by document_type, auto-approves if below threshold,
 * otherwise creates approval steps for each stage.
 */
export async function createApprovalRequest(params: {
  companyId: string;
  requestType: RequestType;
  requestId?: string;
  requesterId: string;
  title: string;
  amount?: number;
  description?: string;
  attachments?: string[];
}): Promise<ApprovalRequest> {
  const amount = params.amount ?? 0;

  // Find matching active policy for this request type
  const { data: policies } = await db
    .from('approval_policies')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('document_type', params.requestType)
    .eq('is_active', true)
    .limit(1);

  const policy = policies?.[0] as ApprovalPolicy | undefined;

  // If no policy found, try a "default" fallback
  let matchedPolicy = policy;
  if (!matchedPolicy) {
    const { data: defaultPolicies } = await db
      .from('approval_policies')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('document_type', 'default')
      .eq('is_active', true)
      .limit(1);
    matchedPolicy = defaultPolicies?.[0] as ApprovalPolicy | undefined;
  }

  const stages: ApprovalStageConfig[] = matchedPolicy?.stages || [
    { stage: 1, name: '최종 승인', approver_role: 'ceo', required_count: 1 },
  ];

  const totalStages = stages.length;

  // Check auto-approve threshold
  const autoApproveBelow = matchedPolicy?.auto_approve_below ?? 0;
  const isAutoApproved = autoApproveBelow > 0 && amount < autoApproveBelow;

  // Create the request
  const { data: request, error: reqError } = await db
    .from('approval_requests')
    .insert({
      company_id: params.companyId,
      policy_id: matchedPolicy?.id ?? null,
      request_type: params.requestType,
      request_id: params.requestId ?? null,
      requester_id: params.requesterId,
      title: params.title,
      amount,
      description: params.description ?? null,
      status: isAutoApproved ? 'approved' : 'pending',
      current_stage: isAutoApproved ? totalStages : 1,
      total_stages: totalStages,
      attachments: params.attachments ?? [],
    })
    .select()
    .single();
  if (reqError) throw reqError;

  // If auto-approved, log and return
  if (isAutoApproved) {
    await logAudit({
      companyId: params.companyId,
      userId: params.requesterId,
      entityType: 'approval_request',
      entityId: request.id,
      action: 'auto_approved',
      afterJson: { amount, threshold: autoApproveBelow },
    });
    return request as ApprovalRequest;
  }

  // Create approval steps for each stage
  for (const stageConfig of stages) {
    // Find potential approvers for this role in the company
    const approverRole = stageConfig.approver_role;
    const requiredCount = stageConfig.required_count ?? 1;

    const { data: approvers } = await db
      .from('users')
      .select('id, name')
      .eq('company_id', params.companyId)
      .eq('role', approverRole)
      .limit(requiredCount);

    const approverList = approvers || [];

    // If no approvers found for this role, try 'ceo' or 'admin' as fallback
    if (approverList.length === 0) {
      const { data: fallbackApprovers } = await db
        .from('users')
        .select('id, name')
        .eq('company_id', params.companyId)
        .in('role', ['ceo', 'admin', 'owner'])
        .limit(requiredCount);
      approverList.push(...(fallbackApprovers || []));
    }

    // Create a step for each approver (or a placeholder if no approvers)
    if (approverList.length > 0) {
      for (const approver of approverList) {
        await db
          .from('approval_steps')
          .insert({
            request_id: request.id,
            stage: stageConfig.stage,
            stage_name: stageConfig.name,
            approver_id: approver.id,
            status: stageConfig.stage === 1 ? 'pending' : 'pending',
          });
      }
    } else {
      // No approvers found - create a placeholder step
      await db
        .from('approval_steps')
        .insert({
          request_id: request.id,
          stage: stageConfig.stage,
          stage_name: stageConfig.name,
          approver_id: params.requesterId, // requester becomes approver as fallback
          status: 'pending',
        });
    }
  }

  // Log audit
  await logAudit({
    companyId: params.companyId,
    userId: params.requesterId,
    entityType: 'approval_request',
    entityId: request.id,
    action: 'created',
    afterJson: { title: params.title, amount, requestType: params.requestType, totalStages },
  });

  return request as ApprovalRequest;
}

/**
 * Approve a single step.
 * If all steps in current stage are approved, advance to next stage or mark request approved.
 */
export async function approveStep(
  stepId: string,
  approverId: string,
  comment?: string
): Promise<void> {
  // Get the step
  const { data: step, error: stepErr } = await db
    .from('approval_steps')
    .select('*')
    .eq('id', stepId)
    .single();
  if (stepErr || !step) throw new Error('결재 단계를 찾을 수 없습니다.');

  // Verify the approver matches
  if (step.approver_id !== approverId) {
    throw new Error('이 결재의 승인 권한이 없습니다.');
  }

  if (step.status !== 'pending') {
    throw new Error('이미 처리된 결재 단계입니다.');
  }

  // Mark step as approved
  const now = new Date().toISOString();
  const { error: updateErr } = await db
    .from('approval_steps')
    .update({
      status: 'approved',
      comment: comment || null,
      decided_at: now,
    })
    .eq('id', stepId);
  if (updateErr) throw updateErr;

  // Get the request
  const { data: request } = await db
    .from('approval_requests')
    .select('*')
    .eq('id', step.request_id)
    .single();
  if (!request) throw new Error('결재 요청을 찾을 수 없습니다.');

  // Check if all steps in current stage are approved
  const { data: stageSteps } = await db
    .from('approval_steps')
    .select('*')
    .eq('request_id', step.request_id)
    .eq('stage', step.stage);

  const allApproved = (stageSteps || []).every((s: any) => s.status === 'approved');

  if (allApproved) {
    // Check if there's a next stage
    const nextStage = step.stage + 1;
    const { data: nextSteps } = await db
      .from('approval_steps')
      .select('*')
      .eq('request_id', step.request_id)
      .eq('stage', nextStage);

    if (nextSteps && nextSteps.length > 0) {
      // Advance to next stage
      await db
        .from('approval_requests')
        .update({ current_stage: nextStage, updated_at: now })
        .eq('id', step.request_id);
    } else {
      // All stages complete - mark request approved
      await db
        .from('approval_requests')
        .update({
          status: 'approved',
          current_stage: step.stage,
          updated_at: now,
        })
        .eq('id', step.request_id);

      // Auto-queue to payment if expense/payment/purchase type
      const reqType = request.request_type;
      if (['expense', 'payment', 'purchase'].includes(reqType)) {
        const amount = Number(request.amount || 0);
        if (amount > 0) {
          try {
            const bank = await resolveBank(request.company_id, reqType === 'purchase' ? 'purchase' : 'expense');
            await createQueueEntry({
              companyId: request.company_id,
              approvalRequestId: request.id,
              amount,
              description: `[승인#${request.id.substring(0, 8)}] ${request.title}`,
              costType: reqType === 'purchase' ? 'purchase' : 'expense',
              dealBankAccountId: bank?.id || null,
            });
          } catch {
            // Payment queue creation failure should not block approval
          }
        }
      }
    }
  }

  // Log audit
  await logAudit({
    companyId: request.company_id,
    userId: approverId,
    entityType: 'approval_step',
    entityId: stepId,
    action: 'approved',
    afterJson: { stage: step.stage, comment, requestId: step.request_id },
  });
}

/**
 * Reject a step. This rejects the entire request.
 */
export async function rejectStep(
  stepId: string,
  approverId: string,
  comment: string
): Promise<void> {
  // Get the step
  const { data: step, error: stepErr } = await db
    .from('approval_steps')
    .select('*')
    .eq('id', stepId)
    .single();
  if (stepErr || !step) throw new Error('결재 단계를 찾을 수 없습니다.');

  // Verify the approver matches
  if (step.approver_id !== approverId) {
    throw new Error('이 결재의 반려 권한이 없습니다.');
  }

  if (step.status !== 'pending') {
    throw new Error('이미 처리된 결재 단계입니다.');
  }

  const now = new Date().toISOString();

  // Mark step as rejected
  await db
    .from('approval_steps')
    .update({
      status: 'rejected',
      comment,
      decided_at: now,
    })
    .eq('id', stepId);

  // Mark entire request as rejected
  const { data: request } = await db
    .from('approval_requests')
    .select('*')
    .eq('id', step.request_id)
    .single();

  await db
    .from('approval_requests')
    .update({
      status: 'rejected',
      updated_at: now,
    })
    .eq('id', step.request_id);

  // Log audit
  if (request) {
    await logAudit({
      companyId: request.company_id,
      userId: approverId,
      entityType: 'approval_step',
      entityId: stepId,
      action: 'rejected',
      afterJson: { stage: step.stage, comment, requestId: step.request_id },
    });
  }
}

// ══════════════════════════════════════════════
// Query Functions
// ══════════════════════════════════════════════

/**
 * Get my pending approvals (steps where I'm the approver and status is pending,
 * and the step's stage matches the request's current_stage).
 */
export async function getMyPendingApprovals(
  userId: string,
  companyId: string
): Promise<any[]> {
  const { data: steps, error } = await db
    .from('approval_steps')
    .select('*, approval_requests!inner(id, company_id, title, amount, request_type, requester_id, status, current_stage, total_stages, created_at, attachments)')
    .eq('approver_id', userId)
    .eq('status', 'pending')
    .eq('approval_requests.company_id', companyId)
    .eq('approval_requests.status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Filter: only show steps where stage matches current_stage of the request
  const filtered = (steps || []).filter(
    (s: any) => s.stage === s.approval_requests?.current_stage
  );

  // Enrich with requester info
  const requesterIds = [...new Set(filtered.map((s: any) => s.approval_requests?.requester_id).filter(Boolean))];
  let requesterMap = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: users } = await db
      .from('users')
      .select('id, name, email')
      .in('id', requesterIds);
    (users || []).forEach((u: any) => requesterMap.set(u.id, u.name || u.email || ''));
  }

  return filtered.map((s: any) => ({
    stepId: s.id,
    stage: s.stage,
    stageName: s.stage_name,
    requestId: s.approval_requests?.id,
    title: s.approval_requests?.title,
    amount: s.approval_requests?.amount,
    requestType: s.approval_requests?.request_type,
    requesterId: s.approval_requests?.requester_id,
    requesterName: requesterMap.get(s.approval_requests?.requester_id) || '',
    currentStage: s.approval_requests?.current_stage,
    totalStages: s.approval_requests?.total_stages,
    createdAt: s.approval_requests?.created_at,
    attachments: s.approval_requests?.attachments || [],
  }));
}

/**
 * Get approval timeline for a request (all steps ordered by stage + created_at).
 */
export async function getApprovalTimeline(requestId: string): Promise<ApprovalStep[]> {
  const { data: steps, error } = await db
    .from('approval_steps')
    .select('*, users:approver_id(name, email)')
    .eq('request_id', requestId)
    .order('stage', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (steps || []).map((s: any) => ({
    id: s.id,
    request_id: s.request_id,
    stage: s.stage,
    stage_name: s.stage_name || `${s.stage}단계`,
    approver_id: s.approver_id,
    approver_name: s.users?.name || s.users?.email || '',
    status: s.status,
    comment: s.comment || '',
    decided_at: s.decided_at,
    created_at: s.created_at,
  })) as ApprovalStep[];
}

/**
 * Get all approval requests for a company with optional filters.
 */
export async function getApprovalRequests(
  companyId: string,
  filters?: {
    status?: string;
    requestType?: string;
    requesterId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<ApprovalRequest[]> {
  let query = db
    .from('approval_requests')
    .select('*, users:requester_id(name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.requestType) query = query.eq('request_type', filters.requestType);
  if (filters?.requesterId) query = query.eq('requester_id', filters.requesterId);
  if (filters?.dateFrom) query = query.gte('created_at', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('created_at', filters.dateTo);

  const { data, error } = await query.limit(200);
  if (error) throw error;
  return (data || []) as ApprovalRequest[];
}

/**
 * Get requests submitted by a specific user.
 */
export async function getMyRequests(
  userId: string,
  companyId: string
): Promise<ApprovalRequest[]> {
  const { data, error } = await db
    .from('approval_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as ApprovalRequest[];
}

/**
 * Resubmit a rejected request — resets status to pending and recreates steps.
 */
export async function resubmitRequest(
  requestId: string,
  title?: string,
  amount?: number
): Promise<void> {
  // Get the existing request
  const { data: request, error: reqErr } = await db
    .from('approval_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (reqErr || !request) throw new Error('결재 요청을 찾을 수 없습니다.');

  if (request.status !== 'rejected') {
    throw new Error('반려된 요청만 재제출할 수 있습니다.');
  }

  const now = new Date().toISOString();

  // Update request fields
  const updates: Record<string, unknown> = {
    status: 'pending',
    current_stage: 1,
    updated_at: now,
  };
  if (title) updates.title = title;
  if (amount !== undefined) updates.amount = amount;

  await db.from('approval_requests').update(updates).eq('id', requestId);

  // Delete old steps
  await db.from('approval_steps').delete().eq('request_id', requestId);

  // Re-create steps based on policy
  let stages: ApprovalStageConfig[] = [
    { stage: 1, name: '최종 승인', approver_role: 'ceo', required_count: 1 },
  ];

  if (request.policy_id) {
    const { data: policy } = await db
      .from('approval_policies')
      .select('stages')
      .eq('id', request.policy_id)
      .single();
    if (policy?.stages) {
      stages = policy.stages;
    }
  }

  for (const stageConfig of stages) {
    const requiredCount = stageConfig.required_count ?? 1;
    const { data: approvers } = await db
      .from('users')
      .select('id')
      .eq('company_id', request.company_id)
      .eq('role', stageConfig.approver_role)
      .limit(requiredCount);

    const approverList = approvers || [];
    if (approverList.length === 0) {
      const { data: fallback } = await db
        .from('users')
        .select('id')
        .eq('company_id', request.company_id)
        .in('role', ['ceo', 'admin', 'owner'])
        .limit(requiredCount);
      approverList.push(...(fallback || []));
    }

    for (const approver of approverList.length > 0 ? approverList : [{ id: request.requester_id }]) {
      await db.from('approval_steps').insert({
        request_id: requestId,
        stage: stageConfig.stage,
        stage_name: stageConfig.name,
        approver_id: approver.id,
        status: 'pending',
      });
    }
  }

  // Log audit
  await logAudit({
    companyId: request.company_id,
    userId: request.requester_id,
    entityType: 'approval_request',
    entityId: requestId,
    action: 'resubmitted',
    afterJson: { title: title || request.title, amount: amount ?? request.amount },
  });
}

/**
 * Cancel an approval request (only by requester, only if still pending).
 */
export async function cancelRequest(requestId: string, userId: string): Promise<void> {
  const { data: request } = await db
    .from('approval_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (!request) throw new Error('결재 요청을 찾을 수 없습니다.');
  if (request.requester_id !== userId) throw new Error('요청자만 취소할 수 있습니다.');
  if (request.status !== 'pending') throw new Error('대기 중인 요청만 취소할 수 있습니다.');

  const now = new Date().toISOString();
  await db.from('approval_requests').update({ status: 'cancelled', updated_at: now }).eq('id', requestId);

  await logAudit({
    companyId: request.company_id,
    userId,
    entityType: 'approval_request',
    entityId: requestId,
    action: 'cancelled',
  });
}

// ══════════════════════════════════════════════
// Summary / Stats
// ══════════════════════════════════════════════

/**
 * Get approval stats for a company.
 */
export async function getApprovalStats(companyId: string) {
  const { data } = await db
    .from('approval_requests')
    .select('status')
    .eq('company_id', companyId);

  const items = data || [];
  return {
    total: items.length,
    pending: items.filter((i: any) => i.status === 'pending').length,
    approved: items.filter((i: any) => i.status === 'approved').length,
    rejected: items.filter((i: any) => i.status === 'rejected').length,
    cancelled: items.filter((i: any) => i.status === 'cancelled').length,
  };
}
