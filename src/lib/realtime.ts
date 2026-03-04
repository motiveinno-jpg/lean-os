/**
 * LeanOS Realtime Helper
 * Supabase Realtime 구독 관리
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ── Subscribe to new messages in a channel ──
export function subscribeToMessages(
  channelId: string,
  onMessage: (payload: any) => void
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
    .subscribe();

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

// ── Unsubscribe from a channel ──
export function unsubscribe(channel: RealtimeChannel) {
  supabase.removeChannel(channel);
}
