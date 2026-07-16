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

export function getNotificationTypeInfo(type: string) {
  return NOTIFICATION_TYPES[type] || NOTIFICATION_TYPES.system;
}

// ── Get Notifications ──
export async function getNotifications(userId: string, limit = 20) {
  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ── Get Unread Count ──
export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) throw error;
  return count || 0;
}

// ── Mark as Read ──
export async function markAsRead(id: string) {
  const { error } = await db
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);

  if (error) throw error;
}

// ── Mark All as Read ──
export async function markAllAsRead(userId: string) {
  const { error } = await db
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) throw error;
}

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

// ── Delete Notification ──
export async function deleteNotification(id: string) {
  const { error } = await db
    .from('notifications')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════════
// 2026-05-29 연장근무 알림 헬퍼 (신청·승인·거절·자동퇴근)
//   - notifications 테이블 insert (필수)
//   - 회사 Slack webhook 설정돼 있으면 동시 발송 (옵션, 실패해도 notif insert 는 성공)
//   - 카카오 알림톡/Telegram 미구현 (현 stack 에 없음) — 향후 lib 추가 시 여기에 분기
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

// Slack 발송 — 실패해도 throw 안 함(알림 insert 흐름 보호).
async function trySendSlack(companyId: string, title: string, message: string): Promise<void> {
  try {
    const { getSlackSettings, sendSlackNotification } = await import('./slack');
    const settings = await getSlackSettings(companyId);
    if (!settings?.slack_webhook_url) return;
    await sendSlackNotification(settings.slack_webhook_url, {
      event: 'approval_pending',
      title,
      message,
    });
  } catch {
    /* slack 미설정/실패는 무시 */
  }
}

// A. 신청 → 회사 admin/owner 전원 알림.
export async function notifyOvertimeRequest(params: {
  companyId: string;
  requestId: string;
  employeeName: string;
  requestedDate: string;     // YYYY-MM-DD
  requestedEndTime: string;  // HH:MM
  reason: string;
}): Promise<void> {
  const { companyId, requestId, employeeName, requestedDate, requestedEndTime, reason } = params;
  const targets = await getCompanyAdminOwnerIds(companyId);
  if (targets.length === 0) return;
  const title = `연장근무 신청 — ${employeeName}`;
  const message = `${requestedDate} ${requestedEndTime}까지 · 사유: ${reason}`;
  // 각 admin/owner 에게 1건씩 insert (실패 1건은 다른 건 영향 없음)
  await Promise.allSettled(
    targets.map((uid) =>
      createNotification({
        companyId,
        userId: uid,
        type: 'overtime_request',
        title,
        message,
        entityType: 'overtime_request',
        entityId: requestId,
      }),
    ),
  );
  // Slack (옵션)
  await trySendSlack(companyId, `🕘 ${title}`, `${message}\n→ /approvals?tab=overtime`);
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
  await trySendSlack(companyId, `${decision === 'approved' ? '✅' : '❌'} ${title}`, message);
}
