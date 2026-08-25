/**
 * OwnerView Notification Engine
 * 알림 생성 → 조회 → 읽음 처리 → 삭제
 */

import { supabase } from './supabase';

const db = supabase;

// ── Notification Type Constants ──
export const NOTIFICATION_TYPES: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  signature_request: {
    label: '서명 요청',
    icon: 'pen',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  signature_completed: {
    label: '서명 완료',
    icon: 'check-circle',
    color: 'text-green-600',
    bg: 'bg-green-500/10',
  },
  signature_rejected: {
    label: '서명 거부',
    icon: 'x-circle',
    color: 'text-red-500',
    bg: 'bg-red-500/10',
  },
  document_approved: {
    label: '문서 승인',
    icon: 'file-check',
    color: 'text-green-600',
    bg: 'bg-green-500/10',
  },
  document_review: {
    label: '검토 요청',
    icon: 'file-search',
    color: 'text-yellow-600',
    bg: 'bg-yellow-500/10',
  },
  deal_update: {
    label: '딜 업데이트',
    icon: 'briefcase',
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
  },
  payment_received: {
    label: '입금 확인',
    icon: 'credit-card',
    color: 'text-green-600',
    bg: 'bg-green-500/10',
  },
  payment_due: {
    label: '결제 예정',
    icon: 'clock',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
  mention: {
    label: '멘션',
    icon: 'at-sign',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  system: {
    label: '시스템',
    icon: 'info',
    color: 'text-gray-500',
    bg: 'bg-gray-500/10',
  },
  milestone: {
    label: '마일스톤',
    icon: 'flag',
    color: 'text-indigo-500',
    bg: 'bg-indigo-500/10',
  },
  chat: {
    label: '채팅',
    icon: 'message-circle',
    color: 'text-sky-500',
    bg: 'bg-sky-500/10',
  },
  approval_request: {
    label: '결재 요청',
    icon: 'file-search',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
  approval_approved: {
    label: '결재 승인',
    icon: 'check-circle',
    color: 'text-green-600',
    bg: 'bg-green-500/10',
  },
  approval_rejected: {
    label: '결재 반려',
    icon: 'x-circle',
    color: 'text-red-500',
    bg: 'bg-red-500/10',
  },
};

// ── Create Notification ──
export async function createNotification(params: {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
}) {
  const { data, error } = await db
    .from('notifications')
    .insert({
      company_id: params.companyId,
      user_id: params.userId,
      type: params.type,
      title: params.title,
      message: params.message || null,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      is_read: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 2026-05-29 연장근무 알림 헬퍼 (신청·승인·거절·자동퇴근)
//   - notifications 테이블 insert (필수)
// ════════════════════════════════════════════════════════════════════════

// 회사의 admin/owner user id 목록 조회 (notifications insert 대상).
async function getCompanyAdminOwnerIds(companyId: string): Promise<string[]> {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('company_id', companyId)
    .in('role', ['owner', 'admin']);
  if (error) return [];
  return (data || []).map((u: { id: string }) => u.id);
}

// B. 승인/반려 → 신청자에게 알림.
export async function notifyOvertimeDecision(params: {
  companyId: string;
  requestId: string;
  targetUserId: string;           // 신청자 user_id
  decision: 'approved' | 'rejected';
  requestedDate: string;
  requestedEndTime: string;
  rejectedReason?: string;        // 반려 시
}): Promise<void> {
  const { companyId, requestId, targetUserId, decision, requestedDate, requestedEndTime, rejectedReason } = params;
  const title = decision === 'approved' ? '연장근무 신청 승인됨' : '연장근무 신청 반려됨';
  const message = decision === 'approved'
    ? `${requestedDate} ${requestedEndTime}까지 출근 가능`
    : `사유: ${rejectedReason || '관리자 안내 참조'}`;
  try {
    await createNotification({
      companyId,
      userId: targetUserId,
      type: decision === 'approved' ? 'overtime_approved' : 'overtime_rejected',
      title,
      message,
      entityType: 'overtime_request',
      entityId: requestId,
    });
  } catch {
    /* notifications insert 실패는 토스트만 표시되도록 throw 안 함 */
  }
}
