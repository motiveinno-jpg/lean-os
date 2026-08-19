import { logRead } from "@/lib/log-read";
/**
 * OwnerView Multi-Step Approval Workflow Engine
 * 다단계 결재 워크플로우 엔진 — 정책 기반 자동 라우팅 + 단계별 승인/반려
 */

import { supabase } from './supabase';
import { logAudit } from './audit';
import { createQueueEntry } from './payment-queue';
import { resolveBank } from './routing';
import { createNotification } from './notifications';
import { sendApprovalMails } from './approval-email';
import type { ApprovalFormField } from './approval-forms';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

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
  | 'certificate'
  | 'custom';

export interface ApprovalPolicy {
  id: string;
  company_id: string;
  name: string;
  document_type: string;
  stages: ApprovalStageConfig[];
  auto_approve_below: number;
  is_active: boolean;
  label?: string;                // 양식 표시 이름(새 요청 유형 선택에 노출)
  description_template?: string; // 양식 선택 시 설명란 자동 입력 템플릿
  allow_line_edit?: boolean;     // 요청자가 새 요청에서 승인라인(승인자)을 바꿀 수 있는지(기본 true)
  requester_id?: string | null;  // 특정 요청자 전용 정책(null=회사 공통) — 하위호환, 매칭은 requester_ids ∪ {requester_id}
  requester_ids?: string[] | null;       // 2026-08-11 적용 대상 직원 복수선택
  requester_department?: string | null;  // 2026-08-11 팀(부서) 단위 적용 — employees.department 와 문자열 일치
  fields?: ApprovalFormField[];  // 2026-07-16 기본 유형용 커스텀 입력 필드(approval_forms.fields 와 동일 구조)
  reference_user_ids?: string[]; // 2026-07-16 기본 유형용 참조(CC) 인원 — approval_forms 와 동일 개념
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalStageConfig {
  stage: number;
  name: string;
  approver_role: string; // e.g. 'manager', 'director', 'ceo'
  required_count?: number; // how many approvers needed (default 1)
  approver_id?: string;    // 특정 인물 지정(HR 서비스식) — 설정 시 role 대신 이 사용자가 승인자
  approver_name?: string;  // 표시용(특정 인물 이름)
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
  reference_user_ids?: string[];
  form_id?: string | null;
  custom_fields?: Record<string, unknown>;
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
  certificate: '증명서 발급',   //   2026-08-19 마이페이지 › 급여·계약·증명에서 신청 — 재직·경력·급여 증명, 인사팀이 승인·발급
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
    // 비활성화(=이력 때문에 못 지운 삭제분)는 목록에서 제외 — 신규 매칭도 is_active=true 만 본다.
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    company_id: row.company_id as string,
    name: (row.name as string) || '',
    document_type: (row.entity_type as string) || '',
    stages: (row.stages as ApprovalStageConfig[]) || [],
    auto_approve_below: (row.auto_approve_threshold as number) || 0,
    is_active: row.is_active !== false,
    label: (row.label as string) || undefined,
    description_template: (row.description_template as string) || undefined,
    allow_line_edit: row.allow_line_edit !== false,
    requester_id: (row.requester_id as string) ?? null,
    requester_ids: (row.requester_ids as string[]) ?? null,
    requester_department: (row.requester_department as string) ?? null,
    fields: (row.fields as ApprovalFormField[]) || [],
    reference_user_ids: (row.reference_user_ids as string[]) || [],
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  })) as ApprovalPolicy[];
}

/** 정책의 적용 대상 — requester_ids ∪ {requester_id(하위호환)} + 부서. (2026-08-11) */
export function policyTargets(p: Pick<ApprovalPolicy, 'requester_id' | 'requester_ids' | 'requester_department'>): { userIds: string[]; department: string | null } {
  const userIds = [...(p.requester_ids || [])];
  if (p.requester_id && !userIds.includes(p.requester_id)) userIds.push(p.requester_id);
  const department = (p.requester_department || '').trim() || null;
  return { userIds, department };
}

/** 같은 문서 유형 후보들 중 요청자에게 적용될 정책 선택 (2026-08-11).
 *  우선순위: ① 직원 지정 정책(요청자 포함) ② 팀(부서) 정책(요청자 부서 일치) ③ 회사 공통(대상 미지정). */
export function pickPolicyForRequester<T extends Pick<ApprovalPolicy, 'requester_id' | 'requester_ids' | 'requester_department'>>(
  candidates: T[],
  userId?: string | null,
  department?: string | null,
): T | null {
  const byUser = userId ? candidates.find((p) => policyTargets(p).userIds.includes(userId)) : undefined;
  if (byUser) return byUser;
  const dept = (department || '').trim();
  const byDept = dept ? candidates.find((p) => policyTargets(p).department === dept) : undefined;
  if (byDept) return byDept;
  return candidates.find((p) => { const t = policyTargets(p); return t.userIds.length === 0 && !t.department; }) || null;
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
  const baseRow: Record<string, unknown> = {
    company_id: policy.company_id,
    name: policy.name,
    entity_type: policy.document_type,
    stages: policy.stages,
    auto_approve_threshold: policy.auto_approve_below ?? 0,
    auto_approve: (policy.auto_approve_below ?? 0) > 0,
    is_active: policy.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  if (policy.id) baseRow.id = policy.id;
  // label/description_template/allow_line_edit/requester_id/fields 컬럼은 마이그레이션 후 존재 — 없는 환경에서도 안 깨지게 폴백.
  const fullRow = {
    ...baseRow,
    label: policy.label ?? null,
    description_template: policy.description_template ?? null,
    allow_line_edit: policy.allow_line_edit ?? true,
    requester_id: policy.requester_id ?? null,
    requester_ids: policy.requester_ids?.length ? policy.requester_ids : null,
    requester_department: (policy.requester_department || '').trim() || null,
    fields: policy.fields ?? [],
    reference_user_ids: policy.reference_user_ids ?? [],
  };

  let { data, error } = await db.from('approval_policies').upsert(fullRow as never).select().single();
  if (error && /label|description_template|allow_line_edit|requester_id|requester_department|fields|reference_user_ids|schema cache|column|PGRST204|42703/i.test(error.message || '')) {
    ({ data, error } = await db.from('approval_policies').upsert(baseRow as never).select().single());
  }
  if (error) throw error;
  const d = data as Record<string, unknown>;
  return {
    id: d.id as string,
    company_id: d.company_id as string,
    name: (d.name as string) || '',
    document_type: (d.entity_type as string) || '',
    stages: (d.stages as ApprovalStageConfig[]) || [],
    auto_approve_below: (d.auto_approve_threshold as number) || 0,
    is_active: d.is_active !== false,
    label: (d.label as string) || undefined,
    description_template: (d.description_template as string) || undefined,
    allow_line_edit: d.allow_line_edit !== false,
    requester_id: (d.requester_id as string) ?? null,
    requester_ids: (d.requester_ids as string[]) ?? null,
    requester_department: (d.requester_department as string) ?? null,
    fields: (d.fields as ApprovalFormField[]) || [],
    reference_user_ids: (d.reference_user_ids as string[]) || [],
    created_at: d.created_at as string | undefined,
    updated_at: d.updated_at as string | undefined,
  } as ApprovalPolicy;
}

/**
 * Delete an approval policy
 */
// 이미 결재 이력이 붙은 정책은 지울 수 없다(approval_requests.policy_id FK, ON DELETE 없음 → 23503).
//   그 경우 이력을 보존한 채 비활성화한다. 신규 요청 매칭은 is_active=true 만 보므로 효과는 삭제와 같다.
export async function deleteApprovalPolicy(policyId: string): Promise<void> {
  const { error } = await db
    .from('approval_policies')
    .delete()
    .eq('id', policyId);
  if (!error) return;
  const code = (error as { code?: string }).code;
  if (code !== '23503') throw error;

  const { error: offErr } = await db
    .from('approval_policies')
    .update({ is_active: false })
    .eq('id', policyId);
  if (offErr) throw offErr;
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
  requestType: RequestType | string;
  requestId?: string;
  requesterId: string;
  title: string;
  amount?: number;
  description?: string;
  attachments?: string[];
  customApprovers?: { userId: string; name: string }[];
  formId?: string;                          // 커스텀 결재 양식 사용 시
  customFields?: Record<string, unknown>;    // 양식 커스텀 필드 값(+휴가 구조화 데이터 등 jsonb)
  referenceUserIds?: string[];              // 참조(CC) — 결재선과 별개, 통보만 받는 인원
}): Promise<ApprovalRequest> {
  const amount = params.amount ?? 0;

  // Find matching active policy for this request type.
  //   2026-08-11: 적용 대상(직원 복수·팀 단위) 정책이 생기면서 limit(1) 임의 선택 →
  //   pickPolicyForRequester (직원 지정 > 부서 > 회사 공통) 로 교체. 클라이언트 프리뷰와 동일 규칙.
  const policies = logRead('lib/approval-workflow:policies', await db
    .from('approval_policies')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('entity_type', params.requestType)
    .eq('is_active', true));

  // 요청자 부서 — 부서 대상 정책이 하나라도 있을 때만 조회 (없으면 쿼리 생략)
  const needsDept = (rows?: any[] | null) => (rows || []).some((p) => (p.requester_department || '').trim());
  let requesterDept: string | null = null;
  const deptOf = async () => {
    if (requesterDept !== null) return requesterDept;
    const emp = logRead('lib/approval-workflow:requester-emp', await db
      .from('employees')
      .select('department')
      .eq('company_id', params.companyId)
      .eq('user_id', params.requesterId)
      .maybeSingle());
    requesterDept = String(emp?.department || '').trim();
    return requesterDept;
  };

  let matchedPolicy = pickPolicyForRequester(
    (policies || []) as any[],
    params.requesterId,
    needsDept(policies) ? await deptOf() : null,
  ) as ApprovalPolicy | undefined | null;

  // If no policy found, try a "default" fallback
  if (!matchedPolicy) {
    const defaultPolicies = logRead('lib/approval-workflow:defaultPolicies', await db
      .from('approval_policies')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('entity_type', 'default')
      .eq('is_active', true));
    matchedPolicy = pickPolicyForRequester(
      (defaultPolicies || []) as any[],
      params.requesterId,
      needsDept(defaultPolicies) ? await deptOf() : null,
    ) as ApprovalPolicy | undefined | null;
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
      form_id: params.formId ?? null,
      custom_fields: (params.customFields ?? {}) as never,
      reference_user_ids: params.referenceUserIds ?? [],
    })
    .select()
    .single();
  if (reqError) throw reqError;

  // If auto-approved, log and return
  if (isAutoApproved) {
    // 자동승인된 휴가도 연차 차감(approveStep 을 거치지 않으므로 여기서 처리)
    if (params.requestType === 'leave') {
      await applyLeaveDeduction(request);
    }
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

  // Create approval steps — use custom approvers if provided
  if (params.customApprovers && params.customApprovers.length > 0) {
    for (let i = 0; i < params.customApprovers.length; i++) {
      const approver = params.customApprovers[i];
      const stageNum = i + 1;
      const stageName = params.customApprovers.length === 1
        ? "최종 승인"
        : stageNum === params.customApprovers.length ? "최종 승인" : `${stageNum}차 승인`;
      await db.from('approval_steps').insert({
        request_id: request.id,
        stage: stageNum,
        stage_name: stageName,
        approver_id: approver.userId,
        status: 'pending',
      });
    }
    if (params.customApprovers.length !== totalStages) {
      await db.from('approval_requests').update({ total_stages: params.customApprovers.length }).eq('id', request.id);
    }
  } else {
    for (const stageConfig of stages) {
      // 특정 인물 지정(HR 서비스식) — approver_id 가 있으면 role 해석을 건너뛰고 그 사용자로 단계 생성.
      if (stageConfig.approver_id) {
        await db.from('approval_steps').insert({
          request_id: request.id,
          stage: stageConfig.stage,
          stage_name: stageConfig.name,
          approver_id: stageConfig.approver_id,
          status: 'pending',
        });
        continue;
      }
      const approverRole = stageConfig.approver_role;
      const requiredCount = stageConfig.required_count ?? 1;

      const approvers = logRead('lib/approval-workflow:approvers', await db
        .from('users')
        .select('id, name')
        .eq('company_id', params.companyId)
        .eq('role', approverRole)
        .limit(requiredCount));

      const approverList = approvers || [];

      if (approverList.length === 0) {
        const fallbackApprovers = logRead('lib/approval-workflow:fallbackApprovers', await db
          .from('users')
          .select('id, name')
          .eq('company_id', params.companyId)
          .in('role', ['ceo', 'admin', 'owner'])
          .limit(requiredCount));
        approverList.push(...(fallbackApprovers || []));
      }

      if (approverList.length > 0) {
        for (const approver of approverList) {
          await db.from('approval_steps').insert({
            request_id: request.id,
            stage: stageConfig.stage,
            stage_name: stageConfig.name,
            approver_id: approver.id,
            status: 'pending',
          });
        }
      } else {
        await db.from('approval_steps').insert({
          request_id: request.id,
          stage: stageConfig.stage,
          stage_name: stageConfig.name,
          approver_id: params.requesterId,
          status: 'pending',
        });
      }
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

  // Notify all approvers of stage 1
  try {
    const stage1Steps = logRead('lib/approval-workflow:stage1Steps', await db
      .from('approval_steps')
      .select('approver_id')
      .eq('request_id', request.id)
      .eq('stage', 1));
    const approverIds = [...new Set((stage1Steps || []).map((s: any) => s.approver_id as string))];
    for (const appId of approverIds) {
      await createNotification({
        companyId: params.companyId,
        userId: appId as string,
        type: 'approval_request',
        title: `결재 요청: ${params.title}`,
        message: amount > 0 ? `금액: ${amount.toLocaleString()}원` : undefined,
        entityType: 'approval_request',
        entityId: request.id,
      });
    }

    // 2026-07-16 QA: 참조자(reference_user_ids)는 결재 요청 생성 시 저장만 되고 알림이
    //   전혀 안 가던 버그 — 결재 여부와 무관하게 통보만 받는 인원이므로 승인자와 별개로 발송.
    //   2026-07-27: entity_type 을 'approval_reference' 로 분리 — 참조자는 결재함이 비어 있으므로
    //   알림을 눌렀을 때 '참조' 탭(내용 열람)으로 바로 가야 한다(notification-routes.ts).
    const referenceIds = [...new Set(params.referenceUserIds || [])].filter((id) => !approverIds.includes(id));
    for (const refId of referenceIds) {
      await createNotification({
        companyId: params.companyId,
        userId: refId,
        type: 'approval_request',
        title: `참조: ${params.title}`,
        message: amount > 0 ? `금액: ${amount.toLocaleString()}원` : undefined,
        entityType: 'approval_reference',
        entityId: request.id,
      });
    }

    // 메일 통보 (2026-08-06 사장님 요청) — 인앱 알림과 함께 발송.
    //   설정 > 알림에서 끈 사람은 sendApprovalMails 안에서 걸러진다. 실패해도 흐름을 막지 않는다.
    await sendApprovalMails({
      userIds: approverIds as string[],
      kind: 'requested',
      title: params.title,
      requestId: request.id,
      amount,
      requestType: params.requestType,
      stage: 1,
      totalStages,
    });
    if (referenceIds.length > 0) {
      await sendApprovalMails({
        userIds: referenceIds,
        kind: 'reference',
        title: params.title,
        requestId: request.id,
        amount,
        requestType: params.requestType,
      });
    }
  } catch {
    // Notification failure should not break the workflow
  }

  return request as ApprovalRequest;
}

/**
 * Approve a single step.
 * If all steps in current stage are approved, advance to next stage or mark request approved.
 */
// 휴가 결재 최종 승인 시 연차 차감 — 사내 결재 전자결재 일원화(2026-07-15).
//   전자결재(approval_requests, request_type='leave')는 그동안 승인돼도 leave_balances 를
//   차감하지 않는 버그가 있었다(네이티브 leave_requests 경로만 차감). 여기서 동일 규칙으로 차감한다.
//   구조화 필드(custom_fields.leave) 우선, 없으면 description 텍스트 파싱(구버전 호환). 비차단.
async function applyLeaveDeduction(request: any): Promise<void> {
  try {
    const leave = request?.custom_fields?.leave;
    const rawStart: string | undefined =
      leave?.start_date ||
      request?.description?.match(/기간:\s*([0-9.\-]+)/)?.[1] ||
      request?.description?.match(/일자:\s*([0-9.\-]+)/)?.[1];
    const days = Number(leave?.days ?? request?.description?.match(/(\d+(?:\.\d+)?)일/)?.[1]);
    if (!rawStart || !days || days <= 0) return;

    // requester(user id) → employee 매핑: user_id 우선, 실패 시 email 매칭(네이티브 경로와 동일 폴백).
    let employeeId: string | null = null;
    const empByUser = logRead('lib/approval-workflow:empByUser', await db
      .from('employees').select('id')
      .eq('company_id', request.company_id).eq('user_id', request.requester_id).maybeSingle());
    if (empByUser) employeeId = empByUser.id;
    else {
      const user = logRead('lib/approval-workflow:user', await db.from('users').select('email').eq('id', request.requester_id).maybeSingle());
      if (user?.email) {
        const empByEmail = logRead('lib/approval-workflow:empByEmail', await db
          .from('employees').select('id')
          .eq('company_id', request.company_id).eq('email', user.email).maybeSingle());
        if (empByEmail) employeeId = empByEmail.id;
      }
    }
    if (!employeeId) return;

    const year = new Date(rawStart.replace(/\./g, '-')).getFullYear();
    const balance = logRead('lib/approval-workflow:balance', await db
      .from('leave_balances').select('id, used_days')
      .eq('employee_id', employeeId).eq('year', year).maybeSingle());
    if (balance) {
      await db.from('leave_balances')
        .update({ used_days: Number(balance.used_days) + days })
        .eq('id', balance.id);
    }

    // 승인 확정된 휴가를 leave_requests 에도 기록 — 근태 워크보드·휴가 현황이
    //   이 테이블(status=approved)만 읽어서, 결재허브 경로 휴가가 화면에 안 보였다
    //   (2026-07-30 사장님: "결재허브에서 휴가 써도 워크보드에 휴가라고 나와야").
    const startDate = (leave?.start_date || rawStart).replace(/\./g, '-');
    const endDate = (leave?.end_date || startDate).replace(/\./g, '-');
    await db.from('leave_requests').insert({
      company_id: request.company_id,
      employee_id: employeeId,
      leave_type: leave?.leave_type || 'annual',
      leave_unit: leave?.leave_unit || 'full_day',
      start_date: startDate,
      end_date: endDate,
      // 반차·시간차 시각 — 이게 없으면 워크보드 반차 게이지(오전/오후)와 지각 보정이 방향을 모른다 (2026-08-11)
      start_time: leave?.start_time || null,
      end_time: leave?.end_time || null,
      days,
      reason: request.title || '전자결재 휴가',
      status: 'approved',
      approved_at: new Date().toISOString(),
    });
  } catch {
    // 연차 차감·기록 실패는 승인 자체를 막지 않는다(비차단).
  }
}

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
  const request = logRead('lib/approval-workflow:request', await db
    .from('approval_requests')
    .select('*')
    .eq('id', step.request_id)
    .single());
  if (!request) throw new Error('결재 요청을 찾을 수 없습니다.');

  // Check if all steps in current stage are approved
  const stageSteps = logRead('lib/approval-workflow:stageSteps', await db
    .from('approval_steps')
    .select('*')
    .eq('request_id', step.request_id)
    .eq('stage', step.stage));

  const allApproved = (stageSteps || []).every((s: any) => s.status === 'approved');
  // 마지막 단계까지 끝나 요청 자체가 승인 확정됐는지 — 참조자 결과 통보 판단용(2026-07-27)
  let finallyApproved = false;

  if (allApproved) {
    // Check if there's a next stage
    const nextStage = step.stage + 1;
    const nextSteps = logRead('lib/approval-workflow:nextSteps', await db
      .from('approval_steps')
      .select('*')
      .eq('request_id', step.request_id)
      .eq('stage', nextStage));

    if (nextSteps && nextSteps.length > 0) {
      // Advance to next stage
      await db
        .from('approval_requests')
        .update({ current_stage: nextStage, updated_at: now })
        .eq('id', step.request_id);

      // 다음 단계 승인자 통보 (2026-08-06) — 그동안 단계가 넘어가도 다음 승인자에게
      //   인앱 알림조차 가지 않아, 첫 승인자만 알고 나머지는 모르고 있었다.
      try {
        const nextApproverIds = [...new Set((nextSteps || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((s: any) => s.approver_id as string)
          .filter(Boolean))];
        const totalStages = Number(request.total_stages || 0);
        for (const nid of nextApproverIds) {
          await createNotification({
            companyId: request.company_id,
            userId: nid,
            type: 'approval_request',
            title: `결재 요청: ${request.title}`,
            message: `${nextStage}단계 결재 차례입니다.`,
            entityType: 'approval_request',
            entityId: request.id,
          });
        }
        await sendApprovalMails({
          userIds: nextApproverIds,
          kind: 'stage_advanced',
          title: request.title,
          requestId: request.id,
          amount: Number(request.amount || 0),
          requestType: request.request_type,
          stage: nextStage,
          totalStages,
        });
      } catch {
        // 통보 실패가 결재 흐름을 막지 않는다
      }
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

      finallyApproved = true;

      // 휴가 결재 최종 승인 → 연차 차감(전자결재 일원화, 2026-07-15)
      const reqType = request.request_type;
      if (reqType === 'leave') {
        await applyLeaveDeduction(request);
      }

      // Auto-queue to payment if expense/payment/purchase type
      if (['expense', 'payment', 'purchase'].includes(reqType)) {
        const amount = Number(request.amount || 0);
        if (amount > 0) {
          try {
            const bank = await resolveBank(request.company_id, reqType === 'purchase' ? 'purchase' : 'expense');
            await createQueueEntry({
              companyId: request.company_id,
              approvalRequestId: request.id,
              amount,
              description: request.title,
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

  // Notify the original requester
  try {
    await createNotification({
      companyId: request.company_id,
      userId: request.requester_id,
      type: 'approval_approved',
      title: `결재 승인: ${request.title}`,
      message: comment || `${step.stage}단계 승인되었습니다.`,
      entityType: 'approval_request',
      entityId: request.id,
    });
  } catch {
    // Notification failure should not break the workflow
  }

  // 참조자 결과 통보 — 최종 승인 확정 시에만(중간 단계마다 알리면 소음)
  if (finallyApproved) {
    await notifyReferences(request, 'approval_approved', `참조 · 결재 승인: ${request.title}`, '최종 승인되었습니다.');
  }
}

/**
 * 참조자(CC)에게 결과를 통보한다.
 * 참조는 "결재선과 별개로 결과를 통보만 받는 인원"인데 그동안 생성 알림만 가고
 * 승인·반려 결과 알림은 전혀 안 갔다(2026-07-27 QA). 요청자 본인은 별도 알림을 받으므로 제외.
 */
async function notifyReferences(
  request: any,
  type: string,
  title: string,
  message?: string
): Promise<void> {
  const refIds = [...new Set(((request?.reference_user_ids as string[]) || []))]
    .filter((id) => id && id !== request.requester_id);
  for (const refId of refIds) {
    try {
      await createNotification({
        companyId: request.company_id,
        userId: refId,
        type,
        title,
        message,
        entityType: 'approval_reference',
        entityId: request.id,
      });
    } catch {
      // 알림 실패가 결재 흐름을 막지 않는다
    }
  }
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
  const request = logRead('lib/approval-workflow:request', await db
    .from('approval_requests')
    .select('*')
    .eq('id', step.request_id)
    .single());

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

    // Notify the original requester with rejection reason
    try {
      await createNotification({
        companyId: request.company_id,
        userId: request.requester_id,
        type: 'approval_rejected',
        title: `결재 반려: ${request.title}`,
        message: comment || '반려되었습니다.',
        entityType: 'approval_request',
        entityId: request.id,
      });
    } catch {
      // Notification failure should not break the workflow
    }

    // 참조자 결과 통보 — 반려는 그 자리에서 요청 전체가 종료되므로 즉시 발송
    await notifyReferences(request, 'approval_rejected', `참조 · 결재 반려: ${request.title}`, comment || '반려되었습니다.');
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
    .select('*, approval_requests!inner(id, company_id, title, amount, description, request_type, requester_id, status, current_stage, total_stages, created_at, attachments, form_id, custom_fields, reference_user_ids)')
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

  // Enrich with requester + reference(참조) 인원 정보
  const requesterIds = [...new Set(filtered.map((s: any) => s.approval_requests?.requester_id).filter(Boolean))];
  const referenceIds = [...new Set(filtered.flatMap((s: any) => s.approval_requests?.reference_user_ids || []))];
  const allUserIds = [...new Set([...requesterIds, ...referenceIds])];
  let userMap = new Map<string, string>();
  if (allUserIds.length > 0) {
    const users = logRead('lib/approval-workflow:users', await db
      .from('users')
      .select('id, name, email')
      .in('id', allUserIds));
    (users || []).forEach((u: any) => userMap.set(u.id, u.name || u.email || ''));
  }

  return filtered.map((s: any) => ({
    stepId: s.id,
    stage: s.stage,
    stageName: s.stage_name,
    requestId: s.approval_requests?.id,
    title: s.approval_requests?.title,
    amount: s.approval_requests?.amount,
    description: s.approval_requests?.description || '',
    requestType: s.approval_requests?.request_type,
    requesterId: s.approval_requests?.requester_id,
    requesterName: userMap.get(s.approval_requests?.requester_id) || '',
    currentStage: s.approval_requests?.current_stage,
    totalStages: s.approval_requests?.total_stages,
    createdAt: s.approval_requests?.created_at,
    attachments: s.approval_requests?.attachments || [],
    formId: s.approval_requests?.form_id || null,
    customFields: s.approval_requests?.custom_fields || {},
    referenceUsers: (s.approval_requests?.reference_user_ids || []).map((id: string) => ({ id, name: userMap.get(id) || '구성원' })),
  }));
}

/**
 * 내가 이미 처리(승인·반려)한 결재 — 2026-07-27 사장님 요청.
 *   기존엔 getMyPendingApprovals(대기중)만 있어, 승인하고 나면 그 건이 '내 결재함'에서
 *   사라지고 다시 볼 화면이 없었다('내 요청'은 내가 올린 것만, '전체 현황'은 admin 전용).
 *   결재선에 이름이 올랐던 건은 처리 후에도 본인이 다시 확인할 수 있어야 한다.
 */
export async function getMyProcessedApprovals(
  userId: string,
  companyId: string,
  limit = 100
): Promise<any[]> {
  const { data: steps, error } = await db
    .from('approval_steps')
    .select('*, approval_requests!inner(id, company_id, title, amount, description, request_type, requester_id, status, current_stage, total_stages, created_at, attachments, form_id, custom_fields, reference_user_ids)')
    .eq('approver_id', userId)
    .neq('status', 'pending')
    .eq('approval_requests.company_id', companyId)
    .order('decided_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;

  const rows = steps || [];
  const requesterIds = [...new Set(rows.map((s: any) => s.approval_requests?.requester_id).filter(Boolean))];
  const userMap = new Map<string, string>();
  if (requesterIds.length > 0) {
    const users = logRead('lib/approval-workflow:processedUsers', await db
      .from('users')
      .select('id, name, email')
      .in('id', requesterIds));
    (users || []).forEach((u: any) => userMap.set(u.id, u.name || u.email || ''));
  }

  return rows.map((s: any) => ({
    stepId: s.id,
    stage: s.stage,
    stageName: s.stage_name,
    // 내가 이 단계에서 내린 결정 + 시각·의견
    myDecision: s.status,
    decidedAt: s.decided_at,
    myComment: s.comment || '',
    requestId: s.approval_requests?.id,
    title: s.approval_requests?.title,
    amount: s.approval_requests?.amount,
    description: s.approval_requests?.description || '',
    requestType: s.approval_requests?.request_type,
    requesterId: s.approval_requests?.requester_id,
    requesterName: userMap.get(s.approval_requests?.requester_id) || '',
    // 문서 전체의 최종 상태(내 결정과 다를 수 있음 — 이후 단계에서 반려될 수 있으므로)
    requestStatus: s.approval_requests?.status,
    currentStage: s.approval_requests?.current_stage,
    totalStages: s.approval_requests?.total_stages,
    createdAt: s.approval_requests?.created_at,
    attachments: s.approval_requests?.attachments || [],
    formId: s.approval_requests?.form_id || null,
    customFields: s.approval_requests?.custom_fields || {},
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
 * 이미 승인/반려 처리된 결재 단계의 코멘트를 본인(승인자)이 수정.
 * 결정(approved/rejected) 자체는 바꾸지 않고 comment 텍스트만 갱신.
 */
export async function updateApprovalStepComment(stepId: string, comment: string): Promise<void> {
  const { error } = await db
    .from('approval_steps')
    .update({ comment })
    .eq('id', stepId);
  if (error) throw error;
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
 * 참조(CC)로 지정된 요청 목록.
 * 참조자는 결재선에도 요청자에도 없어 '내 결재함'·'내 요청' 어디에도 안 잡히고,
 * '전체 현황'은 관리자 전용이라 그동안 참조로 걸린 문서 내용을 볼 수 있는 화면이 전혀 없었다(2026-07-27 QA).
 */
export async function getReferencedRequests(
  userId: string,
  companyId: string
): Promise<ApprovalRequest[]> {
  const { data, error } = await db
    .from('approval_requests')
    .select('*, users:requester_id(name, email)')
    .eq('company_id', companyId)
    .contains('reference_user_ids', [userId])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  // 네이티브 휴가(leave_requests)에 참조로 걸린 건도 병합 (2026-07-30 사장님):
  //   휴가 탭(관리자 수동 등록·구버전 신청) 경로의 참조 통보를 눌렀을 때 전자결재 건처럼
  //   참조함에서 내용이 보여야 한다. 직원은 휴가 관리 화면 접근이 없어 여기가 유일한 열람처.
  const { data: leaveCc } = await db
    .from('leave_requests')
    .select('*, employees:employee_id(name)')
    .eq('company_id', companyId)
    .contains('cc_user_ids', [userId])
    .order('created_at', { ascending: false })
    .limit(50);
  // 신청자 이름 — 직원 계정은 employees RLS 로 타인 행이 null 이라 "구성원/알 수 없음"으로
  //   깨져 보였다(2026-07-30 정다정 계정 실사례) → 안전 필드만 반환하는 디렉토리 RPC 로 보강.
  let dirNameById: Record<string, string> = {};
  if ((leaveCc || []).length > 0) {
    const { data: dir } = await db.rpc('get_company_directory');
    (dir || []).forEach((d: any) => { if (d?.id && d?.name) dirNameById[d.id] = d.name; });
  }
  const LEAVE_KO: Record<string, string> = { annual: '연차', half_day: '반차', sick: '병가', family_event: '경조사' };
  const mappedLeaves = (leaveCc || []).map((r: any) => {
    const empName = r.employees?.name || dirNameById[r.employee_id] || '';
    const label = LEAVE_KO[r.leave_type] || '휴가';
    const period = r.end_date && r.end_date !== r.start_date ? `${r.start_date} ~ ${r.end_date}` : r.start_date;
    return {
      id: `leave:${r.id}`,
      company_id: companyId,
      requester_id: null,
      request_type: 'leave',
      title: `${empName || '구성원'} ${label} 신청 (${period}, ${Number(r.days)}일)`,
      status: r.status,
      amount: 0,
      current_stage: 1,
      total_stages: 1,
      form_id: null,
      custom_fields: {},
      description: `기간: ${period}
일수: ${Number(r.days)}일${r.reason ? `
사유: ${r.reason}` : ''}`,
      attachments: [],
      reference_user_ids: r.cc_user_ids || [],
      created_at: r.created_at,
      users: { name: empName || null, email: null },
      is_native_leave: true,
    };
  });

  return ([...(data || []), ...mappedLeaves] as any[])
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) as ApprovalRequest[];
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
/**
 * 대기중(pending) 결재 요청을 요청자 본인이 수정 (2026-07-16 사장님 요청).
 *   승인선/단계는 건드리지 않고 내용(제목·금액·상세·필드값)만 갱신한다.
 *   권한 검증은 앱 레벨(요청자 본인 + pending) — RLS 는 회사 스코프 UPDATE 허용.
 */
export async function updateApprovalRequest(params: {
  requestId: string;
  userId: string;
  title?: string;
  amount?: number;
  description?: string;
  customFields?: Record<string, unknown>;
  attachments?: string[];
}): Promise<void> {
  const { data: request, error: reqErr } = await db
    .from('approval_requests')
    .select('id, requester_id, status')
    .eq('id', params.requestId)
    .maybeSingle();
  if (reqErr) throw reqErr;
  if (!request) throw new Error('결재 요청을 찾을 수 없습니다.');
  if (request.requester_id !== params.userId) throw new Error('요청자 본인만 수정할 수 있습니다.');
  if (request.status !== 'pending') throw new Error('대기중인 요청만 수정할 수 있습니다.');

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.title !== undefined) updates.title = params.title;
  if (params.amount !== undefined) updates.amount = params.amount;
  if (params.description !== undefined) updates.description = params.description;
  if (params.customFields !== undefined) updates.custom_fields = params.customFields;
  if (params.attachments !== undefined) updates.attachments = params.attachments;

  const { error } = await db
    .from('approval_requests')
    .update(updates as never)
    .eq('id', params.requestId)
    .eq('status', 'pending');
  if (error) throw error;
}

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

  await db.from('approval_requests').update(updates as never).eq('id', requestId);

  // Delete old steps
  await db.from('approval_steps').delete().eq('request_id', requestId);

  // Re-create steps based on policy
  let stages: ApprovalStageConfig[] = [
    { stage: 1, name: '최종 승인', approver_role: 'ceo', required_count: 1 },
  ];

  if (request.policy_id) {
    const policy = logRead('lib/approval-workflow:policy', await db
      .from('approval_policies')
      .select('stages')
      .eq('id', request.policy_id)
      .single());
    if (policy?.stages) {
      stages = policy.stages as unknown as ApprovalStageConfig[];
    }
  }

  for (const stageConfig of stages) {
    const requiredCount = stageConfig.required_count ?? 1;
    const approvers = logRead('lib/approval-workflow:approvers', await db
      .from('users')
      .select('id')
      .eq('company_id', request.company_id)
      .eq('role', stageConfig.approver_role)
      .limit(requiredCount));

    const approverList = approvers || [];
    if (approverList.length === 0) {
      const fallback = logRead('lib/approval-workflow:fallback', await db
        .from('users')
        .select('id')
        .eq('company_id', request.company_id)
        .in('role', ['ceo', 'admin', 'owner'])
        .limit(requiredCount));
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
  const request = logRead('lib/approval-workflow:request', await db
    .from('approval_requests')
    .select('*')
    .eq('id', requestId)
    .single());

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

/**
 * Permanently delete an approval request and its steps (admin cleanup — 상태 무관).
 */
export async function deleteApprovalRequest(requestId: string): Promise<void> {
  await db.from('approval_steps').delete().eq('request_id', requestId);
  await db.from('approval_comments').delete().eq('request_id', requestId);
  const { error } = await db.from('approval_requests').delete().eq('id', requestId);
  if (error) throw error;
}

// ══════════════════════════════════════════════
// Summary / Stats
// ══════════════════════════════════════════════

/**
 * Get approval stats for a company.
 * 2026-07-21 QA: 개인 탭(내 결재함·내 요청)의 요약 카드가 회사 전체 건수를 집계해
 *   "내 요청은 1건인데 다른 사람 것까지 숫자로 나온다"는 혼란 — requesterId 를 주면 내 요청만 집계.
 */
export async function getApprovalStats(companyId: string, requesterId?: string) {
  let q = db
    .from('approval_requests')
    .select('status')
    .eq('company_id', companyId);
  if (requesterId) q = q.eq('requester_id', requesterId);
  const data = logRead('lib/approval-workflow:data', await q);

  const items = data || [];
  return {
    total: items.length,
    pending: items.filter((i: any) => i.status === 'pending').length,
    approved: items.filter((i: any) => i.status === 'approved').length,
    rejected: items.filter((i: any) => i.status === 'rejected').length,
    cancelled: items.filter((i: any) => i.status === 'cancelled').length,
  };
}
