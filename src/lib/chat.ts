import { logRead } from "@/lib/log-read";
/**
 * OwnerView Chat Engine
 * 프로젝트룸 채팅: 채널 관리, 메시지, 참가자, 이벤트
 */

import { supabase } from './supabase';
import type { Json } from '@/types/models';

// ── Channel types ──
export const CHANNEL_TYPES = [
  { value: 'deal', label: '프로젝트 채널' },
  { value: 'subdeal', label: '외주 채널' },
  { value: 'general', label: '일반 채널' },
] as const;

export const PARTICIPANT_ROLES = [
  { value: 'OWNER', label: '오너' },
  { value: 'INTERNAL_MANAGER', label: '내부 담당자' },
  { value: 'CLIENT', label: '클라이언트' },
  { value: 'VENDOR', label: '외주사' },
  { value: 'member', label: '멤버' },
] as const;

// ── Create channel ──
export async function createChannel(params: {
  companyId: string;
  dealId?: string;
  subDealId?: string;
  type?: string;
  name: string;
  creatorUserId: string;
}) {
  const { data, error } = await supabase
    .from('chat_channels')
    .insert({
      company_id: params.companyId,
      deal_id: params.dealId || null,
      sub_deal_id: params.subDealId || null,
      type: params.type || 'deal',
      name: params.name,
    })
    .select()
    .single();

  if (error) throw error;

  // Auto-add creator. chat_members = RLS 의 진실(SELECT 정책이 is_channel_member 로 chat_members lookup),
  // chat_participants = read tracking·role 메타. 둘 다 채워야 본인이 채널을 보고 메시지 last_read_at 이 동작.
  const db = supabase as any;
  await db.from('chat_members').insert({
    channel_id: data.id,
    user_id: params.creatorUserId,
    role: 'OWNER',
  });
  await supabase.from('chat_participants').insert({
    channel_id: data.id,
    user_id: params.creatorUserId,
    role: 'OWNER',
  });

  // Log creation event
  await logEvent(data.id, 'channel_created', { created_by: params.creatorUserId });

  return data;
}

// ── Send message ──
export async function sendMessage(params: {
  channelId: string;
  senderId: string;
  content: string;
  type?: string;
  threadId?: string;
  replyToId?: string;
  metadata?: Record<string, any>;
}) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      channel_id: params.channelId,
      sender_id: params.senderId,
      content: params.content,
      type: params.type || 'text',
      thread_id: params.threadId || null,
      reply_to_id: params.replyToId || null,
      metadata: (params.metadata as Json) || null,
    })
    .select()
    .single();

  if (error) throw error;

  // Update sender's last_read_at
  await supabase
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', params.channelId)
    .eq('user_id', params.senderId);

  return data;
}

// ── Pin / Unpin message ──
export async function togglePin(messageId: string, pinned: boolean) {
  const { error } = await supabase
    .from('chat_messages')
    .update({ pinned })
    .eq('id', messageId);
  if (error) throw error;
}

// ── Invite participant ──
export async function inviteParticipant(params: {
  channelId: string;
  userId: string;
  role?: string;
}) {
  const { data, error } = await supabase
    .from('chat_participants')
    .insert({
      channel_id: params.channelId,
      user_id: params.userId,
      role: params.role || 'member',
    })
    .select()
    .single();

  if (error) throw error;

  // RLS SELECT 는 chat_members 기반 — 초대된 사용자가 채널/메시지를 보려면 chat_members 도 채워야 함.
  // 이미 존재하면 unique 위반 무시(legacy 채널 호환).
  const db = supabase as any;
  await db.from('chat_members').upsert(
    {
      channel_id: params.channelId,
      user_id: params.userId,
      role: params.role || 'member',
    },
    { onConflict: 'channel_id,user_id', ignoreDuplicates: true },
  );

  await logEvent(params.channelId, 'user_joined', {
    user_id: params.userId,
    role: params.role || 'member',
  });

  return data;
}

// ── Remove participant ──
export async function removeParticipant(channelId: string, userId: string) {
  const { error } = await supabase
    .from('chat_participants')
    .delete()
    .eq('channel_id', channelId)
    .eq('user_id', userId);
  if (error) throw error;

  await logEvent(channelId, 'user_left', { user_id: userId });
}

// ── Leave channel (본인이 대화방 나가기) ──
//   남은 참가자에게는 "{이름}님이 대화방을 나갔습니다." 시스템 메시지를 남기고,
//   본인은 chat_members(RLS SELECT 게이트) + chat_participants(read tracking) 양쪽에서
//   제거 → 채널 목록·접근에서 사라짐. 시스템 메시지는 멤버십 삭제 전에 보내 INSERT 권한 보장.
export async function leaveChannel(channelId: string, userId: string, userName: string) {
  await sendSystemMessage(channelId, userId, `${userName}님이 대화방을 나갔습니다.`);
  await logEvent(channelId, 'user_left', { user_id: userId });

  const db = supabase as any;
  await db.from('chat_participants').delete().eq('channel_id', channelId).eq('user_id', userId);
  await db.from('chat_members').delete().eq('channel_id', channelId).eq('user_id', userId);
}

// ── Mark as read ──
export async function markAsRead(channelId: string, userId: string) {
  const { error } = await supabase
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Archive channel ──
export async function archiveChannel(channelId: string) {
  const { error } = await supabase
    .from('chat_channels')
    .update({ is_archived: true })
    .eq('id', channelId);
  if (error) throw error;
}

// ── Log system event ──
export async function logEvent(
  channelId: string,
  eventType: string,
  data?: Record<string, any>
) {
  await supabase.from('chat_events').insert({
    channel_id: channelId,
    event_type: eventType,
    data_json: (data as Json) || null,
  });
}

// ── Send system message ──
export async function sendSystemMessage(channelId: string, senderId: string, content: string) {
  return sendMessage({
    channelId,
    senderId,
    content,
    type: 'system',
  });
}

// ═══════════════════════════════════════════════
// Phase B: 채팅 강화 — 파일 업로드, 멘션, 리액션, 편집, 액션카드
// ═══════════════════════════════════════════════

// ── Upload file to Supabase Storage ──
export async function uploadChatFile(params: {
  channelId: string;
  senderId: string;
  file: File;
}) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (params.file.size > MAX_SIZE) throw new Error('파일 크기는 10MB 이하만 가능합니다.');

  const ALLOWED_TYPES = [
    'image/', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-', 'text/csv',
  ];
  const isAllowed = ALLOWED_TYPES.some(t => params.file.type.startsWith(t));
  if (!isAllowed) throw new Error('지원하지 않는 파일 형식입니다.');

  const ext = params.file.name.split('.').pop() || 'bin';
  const path = `${params.channelId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('chat-files')
    .upload(path, params.file);
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);

  // Send file message first (message_id is required for chat_files)
  const msg = await sendMessage({
    channelId: params.channelId,
    senderId: params.senderId,
    content: params.file.name,
    type: 'file',
    metadata: {
      file_name: params.file.name,
      file_url: urlData.publicUrl,
      file_size: params.file.size,
      mime_type: params.file.type,
    },
  });

  // Insert file record linked to message
  await supabase.from('chat_files').insert({
    channel_id: params.channelId,
    message_id: msg.id,
    file_name: params.file.name,
    file_url: urlData.publicUrl,
    file_size: params.file.size,
    mime_type: params.file.type,
  });

  return msg;
}

// ── Send message with @mentions ──
export async function sendMessageWithMentions(params: {
  channelId: string;
  senderId: string;
  content: string;
  mentionedUserIds: string[];
  replyToId?: string;
  type?: string;
  metadata?: Record<string, any>;
}) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      channel_id: params.channelId,
      sender_id: params.senderId,
      content: params.content,
      type: params.type || 'text',
      reply_to_id: params.replyToId || null,
      metadata: (params.metadata as Json) || null,
    })
    .select()
    .single();
  if (error) throw error;

  // Create mention records
  if (params.mentionedUserIds.length > 0) {
    const mentions = params.mentionedUserIds.map(uid => ({
      message_id: data.id,
      channel_id: params.channelId,
      mentioned_user_id: uid,
    }));
    await supabase.from('chat_mentions').insert(mentions);

    // 멘션 알림 — notifications 테이블에도 INSERT (벨/알림 페이지는 notifications 를 읽음).
    //   기존엔 chat_mentions 만 넣어 알림이 전혀 안 가던 버그(2026-06-15). best-effort.
    try {
      const recipients = params.mentionedUserIds.filter((uid) => uid && uid !== params.senderId);
      if (recipients.length > 0) {
        const db = supabase as any;
        const ch = logRead('lib/chat:ch', await db.from('chat_channels').select('company_id, name, is_dm').eq('id', params.channelId).maybeSingle());
        const sender = logRead('lib/chat:sender', await db.from('users').select('name, email').eq('id', params.senderId).maybeSingle());
        if (ch?.company_id) {
          // 멘션된 사용자가 팀 채널 참가자가 아니면 추가 — 알림만 받고 채널 목록·미읽음(getUnreadCounts)·
          //   딥링크가 안 되던 문제(2026-06-22). chat_members(RLS SELECT 게이트) + chat_participants(미읽음) 양쪽.
          //   존재체크 후 plain insert (upsert+ignoreDuplicates 는 RLS WITH CHECK 충돌로 조용히 실패 — 2026-06-15 교훈).
          //   DM 채널은 멤버 고정이라 제외.
          if (!ch.is_dm) {
            for (const uid of recipients) {
              const m = logRead('lib/chat:m', await db.from('chat_members').select('id').eq('channel_id', params.channelId).eq('user_id', uid).maybeSingle());
              if (!m) await db.from('chat_members').insert({ channel_id: params.channelId, user_id: uid, role: 'member' });
              const p = logRead('lib/chat:p', await db.from('chat_participants').select('id').eq('channel_id', params.channelId).eq('user_id', uid).maybeSingle());
              if (!p) await db.from('chat_participants').insert({ channel_id: params.channelId, user_id: uid, role: 'member' });
            }
          }
          const senderName = sender?.name || sender?.email || '누군가';
          const where = ch.is_dm ? 'DM' : `#${ch.name}`;
          const preview = params.content.length > 80 ? `${params.content.slice(0, 80)}…` : params.content;
          const rows = recipients.map((uid) => ({
            company_id: ch.company_id,
            user_id: uid,
            type: 'chat',
            title: '채팅 멘션',
            message: `${senderName} 님이 ${where} 에서 회원님을 멘션했습니다: ${preview}`,
            entity_type: 'chat_channel',
            entity_id: params.channelId,
            is_read: false,
          }));
          await db.from('notifications').insert(rows);
        }
      }
    } catch { /* 알림 실패는 메시지 전송에 영향 없음 */ }
  }

  // Update sender's last_read_at
  await supabase
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', params.channelId)
    .eq('user_id', params.senderId);

  return data;
}

// ── Search messages in a channel ──
export async function searchMessages(channelId: string, query: string, limit = 50) {
  const data = logRead('lib/chat:data', await supabase
    .from('chat_messages')
    .select('*, users:sender_id(name, email)')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(limit));
  return data || [];
}

// ── Add reaction ──
export async function addReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await supabase
    .from('chat_reactions')
    .upsert({
      message_id: messageId,
      user_id: userId,
      emoji,
    }, { onConflict: 'message_id,user_id,emoji' });
  if (error) throw error;
}

// ── Remove reaction ──
export async function removeReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await supabase
    .from('chat_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);
  if (error) throw error;
}

// ── Edit message ──
export async function editMessage(messageId: string, newContent: string) {
  const { error } = await supabase
    .from('chat_messages')
    .update({
      content: newContent,
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId);
  if (error) throw error;
}

// ── Soft-delete message ──
export async function deleteMessage(messageId: string) {
  const { error } = await supabase
    .from('chat_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
// Phase J: Team channels, DM, channel type queries
// ═══════════════════════════════════════════════

// Create team channel (not linked to a deal)
export async function createTeamChannel(params: {
  companyId: string;
  name: string;
  description?: string;
  creatorUserId: string;
}) {
  const db = supabase as any;
  const { data, error } = await db
    .from('chat_channels')
    .insert({
      company_id: params.companyId,
      name: params.name,
      description: params.description || null,
      is_dm: false,
    })
    .select()
    .single();
  if (error) throw error;

  // 만든 사람을 chat_members + chat_participants 양쪽 등록 — RLS 통과 + read tracking.
  await db.from('chat_members').insert({
    channel_id: data.id,
    user_id: params.creatorUserId,
    role: 'OWNER',
  });
  await db.from('chat_participants').insert({
    channel_id: data.id,
    user_id: params.creatorUserId,
    role: 'OWNER',
  });
  await logEvent(data.id, 'channel_created', { created_by: params.creatorUserId });

  return data;
}

// Create DM channel
export async function createDMChannel(params: {
  companyId: string;
  participantIds: string[];
}) {
  const db = supabase as any;
  const name = `DM-${Date.now()}`;
  const { data, error } = await db
    .from('chat_channels')
    .insert({
      company_id: params.companyId,
      name,
      is_dm: true,
    })
    .select()
    .single();
  if (error) throw error;

  // 참여자 양쪽 테이블 동기 등록 — chat_members(RLS 게이트) + chat_participants(read tracking, getChannels DM 필터).
  // ⚠️ chat_members 는 upsert(onConflict)+ignoreDuplicates 가 RLS WITH CHECK 와 충돌해 조용히 실패 →
  //   DM 채널에 멤버가 0건으로 남아 메시지 전송/조회가 막히던 버그(2026-06-15). createChannel/
  //   createTeamChannel 과 동일하게 존재체크 후 plain insert 로 통일하고 에러를 표면화한다.
  const seen = new Set<string>();
  for (const uid of params.participantIds) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const mExisting = logRead('lib/chat:mExisting', await db
      .from('chat_members')
      .select('id')
      .eq('channel_id', data.id)
      .eq('user_id', uid)
      .maybeSingle());
    if (!mExisting) {
      const { error: mErr } = await db.from('chat_members').insert({
        channel_id: data.id,
        user_id: uid,
        role: 'member',
      });
      if (mErr) throw mErr;
    }
    const existing = logRead('lib/chat:existing', await db
      .from('chat_participants')
      .select('id')
      .eq('channel_id', data.id)
      .eq('user_id', uid)
      .maybeSingle());
    if (!existing) {
      await db.from('chat_participants').insert({
        channel_id: data.id,
        user_id: uid,
        role: 'member',
      });
    }
  }
  return data;
}

// Get channels by type
export async function getChannelsByType(companyId: string, type: 'deal' | 'team' | 'dm') {
  const db = supabase as any;
  let query = db
    .from('chat_channels')
    .select('*, chat_members(user_id)')
    .eq('company_id', companyId);

  if (type === 'deal') {
    query = query.not('deal_id', 'is', null);
  } else if (type === 'team') {
    query = query.is('deal_id', null).eq('is_dm', false);
  } else {
    query = query.eq('is_dm', true);
  }

  const data = logRead('lib/chat:data', await query.order('updated_at', { ascending: false }));
  return data || [];
}

// ── Get or create invite token for guest access ──
export async function getOrCreateInviteToken(channelId: string): Promise<string> {
  const db = supabase as any;
  const data = logRead('lib/chat:data', await db
    .from('chat_channels')
    .select('invite_token')
    .eq('id', channelId)
    .single());

  if (data?.invite_token) return data.invite_token;

  const token = crypto.randomUUID();
  await db
    .from('chat_channels')
    .update({ invite_token: token, allow_guests: true })
    .eq('id', channelId);

  return token;
}

// ── Build chat invite URL ──
export function getChatInviteUrl(token: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/chat?token=${token}`;
}

// ── Create action card ──
export async function createActionCard(params: {
  messageId: string;
  channelId: string;
  cardType: string; // quote | document | approval | payment | milestone
  referenceId: string;
  referenceTable: string;
  summaryJson?: Record<string, any>;
}) {
  const { data, error } = await supabase
    .from('chat_action_cards')
    .insert({
      message_id: params.messageId,
      channel_id: params.channelId,
      card_type: params.cardType,
      reference_id: params.referenceId,
      reference_table: params.referenceTable,
      summary_json: (params.summaryJson as Json) || {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
