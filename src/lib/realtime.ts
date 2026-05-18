/**
 * OwnerView Realtime Helper
 * Supabase Realtime 구독 관리
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ── Connection status type ──
export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'connecting';

// ── Subscribe to new messages in a channel ──
export function subscribeToMessages(
  channelId: string,
  onMessage: (payload: any) => void,
  onStatus?: (status: RealtimeStatus) => void,
): RealtimeChannel {
  const channel = supabase
    .channel(`chat:${channelId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `channel_id=eq.${channelId}`,
      },
      (payload) => {
        onMessage(payload.new);
      }
    )
    .subscribe((status) => {
      onStatus?.(status as RealtimeStatus);
    });

  return channel;
}

// ── Subscribe to message updates (pin, edit) ──
export function subscribeToMessageUpdates(
  channelId: string,
  onUpdate: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`chat-updates:${channelId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `channel_id=eq.${channelId}`,
      },
      (payload) => {
        onUpdate(payload.new);
      }
    )
    .subscribe();

  return channel;
}

// ── Subscribe to events in a channel ──
export function subscribeToEvents(
  channelId: string,
  onEvent: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`events:${channelId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_events',
        filter: `channel_id=eq.${channelId}`,
      },
      (payload) => {
        onEvent(payload.new);
      }
    )
    .subscribe();

  return channel;
}

// ── Subscribe to reactions on messages in a channel ──
// Note: chat_reactions has no channel_id column, so we can't filter by channel.
// The callback only invalidates the current channel's reaction query, so
// cross-channel noise has no functional impact (just triggers a no-op re-fetch).
export function subscribeToReactions(
  channelId: string,
  onReaction: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`reactions:${channelId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_reactions',
      },
      (payload) => {
        onReaction(payload);
      }
    )
    .subscribe();

  return channel;
}

// ── Subscribe to mentions for a specific user ──
export function subscribeToMentions(
  userId: string,
  onMention: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`mentions:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_mentions',
        filter: `mentioned_user_id=eq.${userId}`,
      },
      (payload) => {
        onMention(payload.new);
      }
    )
    .subscribe();

  return channel;
}

// ── Subscribe to bank_transactions changes for a company ──
// 통장 거래 INSERT/UPDATE/DELETE 실시간 구독. CODEF sync 가 새 거래를 적재하면
// 페이지가 즉시 반영. 호출자는 반환된 channel 을 supabase.removeChannel 로 정리할 것.
export function subscribeToBankTransactions(
  companyId: string,
  onChange: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`bank-tx-${companyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bank_transactions',
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        onChange(payload);
      }
    )
    .subscribe();

  return channel;
}

// ── Subscribe to bank_accounts changes for a company ──
// 통장 잔액(balance) UPDATE 가 발생하면 대시보드 cash-pulse 등 잔액 위젯 즉시 갱신.
export function subscribeToBankAccounts(
  companyId: string,
  onChange: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`bank-acc-${companyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bank_accounts',
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        onChange(payload);
      }
    )
    .subscribe();

  return channel;
}

// ── Subscribe to card_transactions changes for a company ──
// 카드 거래 INSERT/UPDATE/DELETE 실시간 구독. CODEF 카드 sync 결과 즉시 반영.
export function subscribeToCardTransactions(
  companyId: string,
  onChange: (payload: any) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`card-tx-${companyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'card_transactions',
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        onChange(payload);
      }
    )
    .subscribe();

  return channel;
}

// ── Unsubscribe from a channel ──
export function unsubscribe(channel: RealtimeChannel) {
  supabase.removeChannel(channel);
}
