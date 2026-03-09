/**
 * OwnerView Notification Engine
 * 알림 생성 → 조회 → 읽음 처리 → 삭제
 */

import { supabase } from './supabase';

const db = supabase as any;

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
