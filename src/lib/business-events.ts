/**
 * Reflect Business Event Dispatcher
 * 비즈니스 이벤트 → 딜 채팅에 자동 시스템 메시지 + 액션카드 생성
 */

import { supabase } from './supabase';
import { sendSystemMessage, createActionCard, logEvent } from './chat';
import type { Json } from '@/types/models';

export type BusinessEventType =
  | 'contract_executed'
  | 'payment_received'
  | 'milestone_completed'
  | 'document_approved'
  | 'document_locked'
  | 'deal_status_changed'
  | 'cost_approved'
  | 'invoice_issued'
  | 'quote_approved'
  | 'contract_signed'
  | 'payment_schedule_created'
  | 'revenue_received';

interface BusinessEventParams {
  dealId: string;
  eventType: BusinessEventType;
  userId: string; // who triggered the event
  referenceId: string; // document/milestone/payment id
  referenceTable: string; // documents/deal_milestones/etc
  summary?: Record<string, any>;
}

const EVENT_MESSAGES: Record<BusinessEventType, (summary: Record<string, any>) => string> = {
  contract_executed: (s) => `📝 계약이 체결되었습니다. ${s.title || ''}`,
  payment_received: (s) => `💰 입금이 확인되었습니다. ${s.amount ? Number(s.amount).toLocaleString() + '원' : ''}`,
  milestone_completed: (s) => `🎯 마일스톤 완료: ${s.title || s.name || ''}`,
  document_approved: (s) => `✅ 문서가 승인되었습니다: ${s.title || ''}`,
  document_locked: (s) => `🔒 문서가 잠금되었습니다: ${s.title || ''}`,
  deal_status_changed: (s) => `📊 딜 상태 변경: ${s.from || ''} → ${s.to || ''}`,
  cost_approved: (s) => `💳 비용이 승인되었습니다. ${s.amount ? Number(s.amount).toLocaleString() + '원' : ''}`,
  invoice_issued: (s) => `📋 세금계산서가 발행되었습니다. ${s.amount ? Number(s.amount).toLocaleString() + '원' : ''}`,
  quote_approved: (s) => `📄 견적서가 승인되었습니다 → 계약서 자동 생성. ${s.title || ''}`,
  contract_signed: (s) => `✍️ 계약서가 서명되었습니다. ${s.title || ''}`,
  payment_schedule_created: (s) => `📅 매출 스케줄이 생성되었습니다. 선금 ${s.advance ? Number(s.advance).toLocaleString() + '원' : ''} / 잔금 ${s.balance ? Number(s.balance).toLocaleString() + '원' : ''}`,
  revenue_received: (s) => `💰 매출 입금: ${s.amount ? Number(s.amount).toLocaleString() + '원' : ''} (${s.progress || 0}%)`,
};

const EVENT_CARD_TYPES: Record<BusinessEventType, string> = {
  contract_executed: 'document',
  payment_received: 'payment',
  milestone_completed: 'milestone',
  document_approved: 'approval',
  document_locked: 'document',
  deal_status_changed: 'quote',
  cost_approved: 'payment',
  invoice_issued: 'document',
  quote_approved: 'approval',
  contract_signed: 'document',
  payment_schedule_created: 'payment',
  revenue_received: 'payment',
};

/**
 * Dispatch a business event to the deal's chat channel.
 * If the deal has no chat channel, silently skip.
 */
export async function dispatchBusinessEvent(params: BusinessEventParams) {
  const { dealId, eventType, userId, referenceId, referenceTable, summary = {} } = params;

  // Find the deal's chat channel
  const { data: channel } = await supabase
    .from('chat_channels')
    .select('id')
    .eq('deal_id', dealId)
    .eq('is_archived', false)
    .limit(1)
    .maybeSingle();

  if (!channel) return; // No channel for this deal, skip silently

  // Generate system message
  const msgFn = EVENT_MESSAGES[eventType];
  const message = msgFn ? msgFn(summary) : `시스템 이벤트: ${eventType}`;

  // Send system message
  const msg = await sendSystemMessage(channel.id, userId, message);

  // Create action card on the message
  const cardType = EVENT_CARD_TYPES[eventType] || 'document';
  await createActionCard({
    messageId: msg.id,
    channelId: channel.id,
    cardType,
    referenceId,
    referenceTable,
    summaryJson: { ...summary, eventType },
  });

  // Log event
  await logEvent(channel.id, eventType, {
    user_id: userId,
    reference_id: referenceId,
    reference_table: referenceTable,
    ...summary,
  });
}
