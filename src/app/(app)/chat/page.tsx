"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import {
  getCurrentUser, getChannels, getDeals, getUnreadCounts, getChannel, getMessages, getParticipants, getChannelEvents,
  searchChannelMessages, getBatchReactions, getActionCards, getChannelFiles, getCompanyUsers,
} from "@/lib/queries";
import { createChannel, sendMessage, togglePin, markAsRead, uploadChatFile, sendMessageWithMentions, addReaction, removeReaction, editMessage, deleteMessage, createTeamChannel, createDMChannel, inviteParticipant, getOrCreateInviteToken, getChatInviteUrl, sendSystemMessage } from "@/lib/chat";
import { subscribeToMessages, subscribeToMessageUpdates, subscribeToReactions, unsubscribe } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { ChatBubble } from "@/components/chat-bubble";
import { ChatInput } from "@/components/chat-input";
import { ChatSearch } from "@/components/chat-search";

// ── Inline edit component ──
function EditInline({ content, onSave, onCancel }: { content: string; onSave: (c: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(content);
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-surface)] rounded-xl my-1">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(text); if (e.key === 'Escape') onCancel(); }}
        className="flex-1 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
        autoFocus
      />
      <button onClick={() => onSave(text)} className="text-xs text-[var(--primary)] font-semibold">저장</button>
      <button onClick={onCancel} className="text-xs text-[var(--text-dim)]">취소</button>
    </div>
  );
}

// ── Chat Room View (previously chat/[channelId]/client.tsx) ──
function ChatRoomView({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "participants" | "events" | "files">("chat");
  const [showSearch, setShowSearch] = useState(false);
  const [replyTo, setReplyTo] = useState<{ messageId: string; senderName: string; content: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteTab, setInviteTab] = useState<"internal" | "external">("internal");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLink, setInviteLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [extContact, setExtContact] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setUserId(u.id); setCompanyId(u.company_id); }
    });
  }, []);

  const { data: channel } = useQuery({
    queryKey: ["chat-channel", channelId],
    queryFn: () => getChannel(channelId),
    enabled: !!channelId,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["chat-messages", channelId],
    queryFn: () => getMessages(channelId),
    enabled: !!channelId,
    refetchInterval: 5000,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["chat-participants", channelId],
    queryFn: () => getParticipants(channelId),
    enabled: !!channelId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["chat-events", channelId],
    queryFn: () => getChannelEvents(channelId),
    enabled: !!channelId,
  });

  const { data: reactionsMap } = useQuery({
    queryKey: ["chat-reactions", channelId, messages.length],
    queryFn: () => getBatchReactions(messages.map((m: any) => m.id)),
    enabled: messages.length > 0,
  });

  const { data: actionCards = [] } = useQuery({
    queryKey: ["chat-action-cards", channelId],
    queryFn: () => getActionCards(channelId),
    enabled: !!channelId,
  });

  const { data: files = [] } = useQuery({
    queryKey: ["chat-files", channelId],
    queryFn: () => getChannelFiles(channelId),
    enabled: !!channelId && tab === 'files',
  });

  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
  });

  useEffect(() => {
    if (!channelId) return;
    const subs = [
      subscribeToMessages(channelId, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
      }),
      subscribeToMessageUpdates(channelId, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
      }),
      subscribeToReactions(channelId, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-reactions", channelId] });
      }),
    ];
    return () => subs.forEach(unsubscribe);
  }, [channelId, queryClient]);

  useEffect(() => {
    if (channelId && userId) markAsRead(channelId, userId);
  }, [channelId, userId, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const actionCardMap = new Map<string, any>();
  actionCards.forEach((ac: any) => actionCardMap.set(ac.message_id, ac));

  function getReactionsForMessage(msgId: string) {
    const raw = reactionsMap?.get(msgId) || [];
    const grouped = new Map<string, { count: number; hasOwn: boolean }>();
    raw.forEach((r: any) => {
      const existing = grouped.get(r.emoji) || { count: 0, hasOwn: false };
      existing.count++;
      if (r.user_id === userId) existing.hasOwn = true;
      grouped.set(r.emoji, existing);
    });
    return Array.from(grouped.entries()).map(([emoji, data]) => ({ emoji, ...data }));
  }

  function getReplyInfo(msg: any) {
    if (!msg.reply_to_id) return null;
    const original = messages.find((m: any) => m.id === msg.reply_to_id);
    if (!original) return null;
    return {
      senderName: (original as any).users?.name || (original as any).users?.email || '—',
      content: original.content?.slice(0, 60) || '',
    };
  }

  const sendMut = useMutation({
    mutationFn: (params: { content: string; mentionedUserIds?: string[]; replyToId?: string }) =>
      params.mentionedUserIds?.length
        ? sendMessageWithMentions({
            channelId,
            senderId: userId!,
            content: params.content,
            mentionedUserIds: params.mentionedUserIds,
            replyToId: params.replyToId,
          })
        : sendMessage({
            channelId,
            senderId: userId!,
            content: params.content,
            threadId: params.replyToId,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
    },
  });

  const fileMut = useMutation({
    mutationFn: (file: File) => uploadChatFile({ channelId, senderId: userId!, file }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat-files", channelId] });
    },
  });

  const pinMut = useMutation({
    mutationFn: ({ msgId, pinned }: { msgId: string; pinned: boolean }) => togglePin(msgId, pinned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] }),
  });

  const reactionMut = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) => {
      const existing = reactionsMap?.get(msgId) || [];
      const hasOwn = existing.some((r: any) => r.user_id === userId && r.emoji === emoji);
      return hasOwn ? removeReaction(msgId, userId!, emoji) : addReaction(msgId, userId!, emoji);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-reactions", channelId] }),
  });

  const editMut = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) => editMessage(msgId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (msgId: string) => deleteMessage(msgId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] }),
  });

  const handleSearch = useCallback(async (query: string) => {
    return await searchChannelMessages(channelId, query);
  }, [channelId]);

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const EVENT_LABELS: Record<string, string> = {
    channel_created: "채널 생성",
    user_joined: "멤버 참가",
    user_left: "멤버 퇴장",
    contract_executed: "계약 체결",
    payment_received: "입금 확인",
    milestone_completed: "마일스톤 완료",
    assignment_changed: "담당자 변경",
    document_approved: "문서 승인",
    document_locked: "문서 잠금",
    deal_status_changed: "딜 상태 변경",
  };

  const pinnedMessages = messages.filter((m: any) => m.pinned);

  return (
    <div className="max-w-[900px] flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition">
            &larr; 채널 목록
          </button>
          <div>
            <h1 className="text-lg font-extrabold">{channel?.name || "..."}</h1>
            <div className="text-xs text-[var(--text-dim)]">
              {(channel as any)?.deals?.name ? `딜: ${(channel as any).deals.name}` : channel?.type || ""}
              {" · "}
              {participants.length}명 참가
            </div>
          </div>
        </div>
        <button onClick={() => setShowSearch(!showSearch)}
          className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] rounded-lg transition">
          검색
        </button>
      </div>

      {showSearch && (
        <ChatSearch
          onSearch={handleSearch}
          onResultClick={(id) => {
            const el = document.getElementById(`msg-${id}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.classList.add('ring-2', 'ring-[var(--primary)]');
            setTimeout(() => el?.classList.remove('ring-2', 'ring-[var(--primary)]'), 2000);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {pinnedMessages.length > 0 && tab === 'chat' && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2 mb-2 shrink-0">
          <div className="text-[10px] font-semibold text-yellow-400 mb-1">
            📌 고정 메시지 ({pinnedMessages.length})
          </div>
          <div className="text-xs text-[var(--text-muted)] truncate">
            {(pinnedMessages[0] as any).content}
          </div>
        </div>
      )}

      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-3 shrink-0">
        {([
          { key: "chat" as const, label: `채팅 (${messages.length})` },
          { key: "participants" as const, label: `참가자 (${participants.length})` },
          { key: "files" as const, label: `파일` },
          { key: "events" as const, label: `이벤트 (${events.length})` },
        ]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.key ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto bg-[var(--bg-card)] rounded-t-2xl border border-b-0 border-[var(--border)] p-5">
            {messages.length === 0 ? (
              <div className="text-center py-20 text-sm text-[var(--text-muted)]">첫 메시지를 보내세요</div>
            ) : (
              messages.map((msg: any) => {
                const ac = actionCardMap.get(msg.id);
                return (
                  <div key={msg.id} id={`msg-${msg.id}`} className="transition-all duration-300 rounded-lg">
                    {editingId === msg.id ? (
                      <EditInline
                        content={msg.content}
                        onSave={(c) => editMut.mutate({ msgId: msg.id, content: c })}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <ChatBubble
                        senderName={msg.users?.name || msg.users?.email || "—"}
                        content={msg.content}
                        time={formatTime(msg.created_at)}
                        isOwn={msg.sender_id === userId}
                        type={msg.type}
                        pinned={msg.pinned}
                        editedAt={msg.edited_at}
                        deletedAt={msg.deleted_at}
                        replyTo={getReplyInfo(msg)}
                        reactions={getReactionsForMessage(msg.id)}
                        metadata={msg.metadata}
                        actionCard={ac ? { cardType: ac.card_type, status: ac.status, summaryJson: ac.summary_json } : null}
                        onPin={() => pinMut.mutate({ msgId: msg.id, pinned: !msg.pinned })}
                        onReply={() => setReplyTo({
                          messageId: msg.id,
                          senderName: msg.users?.name || msg.users?.email || '—',
                          content: msg.content?.slice(0, 60) || '',
                        })}
                        onReact={(emoji) => reactionMut.mutate({ msgId: msg.id, emoji })}
                        onEdit={msg.sender_id === userId ? () => setEditingId(msg.id) : undefined}
                        onDelete={msg.sender_id === userId ? () => { if (confirm('메시지를 삭제하시겠습니까?')) deleteMut.mutate(msg.id); } : undefined}
                      />
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="rounded-b-2xl border border-t-0 border-[var(--border)] overflow-hidden">
            <ChatInput
              onSend={(content, mentionedUserIds, replyToId) =>
                sendMut.mutate({ content, mentionedUserIds, replyToId: replyToId || replyTo?.messageId })
              }
              onFileUpload={(file) => fileMut.mutate(file)}
              disabled={sendMut.isPending || fileMut.isPending || !userId}
              users={companyUsers}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </div>
        </div>
      )}

      {tab === "participants" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden flex-1 overflow-y-auto">
          {/* 초대 버튼 */}
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <button
              onClick={() => { setShowInvite(true); setInviteLink(""); setLinkCopied(false); setExtContact(""); }}
              className="w-full py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              멤버 초대
            </button>
          </div>

          {/* 참가자 목록 */}
          {participants.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">참가자가 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {participants.map((p: any) => (
                <div key={p.id} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                      {(p.users?.name || p.users?.email || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{p.users?.name || p.users?.email || "—"}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">
                        {p.invited_at ? new Date(p.invited_at).toLocaleDateString("ko") : ""} 참가
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    p.role === 'OWNER' ? 'bg-yellow-500/10 text-yellow-600' :
                    p.role === 'INTERNAL_MANAGER' ? 'bg-blue-500/10 text-blue-600' :
                    p.role === 'CLIENT' ? 'bg-green-500/10 text-green-600' :
                    p.role === 'VENDOR' ? 'bg-purple-500/10 text-purple-600' :
                    p.role === 'GUEST' ? 'bg-orange-500/10 text-orange-600' :
                    'bg-gray-500/10 text-gray-500'
                  }`}>
                    {p.role === 'OWNER' ? '오너' : p.role === 'INTERNAL_MANAGER' ? '담당자' : p.role === 'CLIENT' ? '클라이언트' : p.role === 'VENDOR' ? '외주사' : p.role === 'GUEST' ? '게스트' : '멤버'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 초대 모달 */}
          {showInvite && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvite(false)}>
              <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* 모달 헤더 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                  <h3 className="text-base font-bold text-[var(--text)]">멤버 초대</h3>
                  <button onClick={() => setShowInvite(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 탭 */}
                <div className="flex gap-1 mx-6 mt-4 bg-[var(--bg-surface)] rounded-xl p-1">
                  {([
                    { key: "internal" as const, label: "내부 멤버" },
                    { key: "external" as const, label: "외부 초대" },
                  ]).map((t) => (
                    <button key={t.key} onClick={() => setInviteTab(t.key)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        inviteTab === t.key ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="px-6 py-4">
                  {/* 내부 멤버 초대 */}
                  {inviteTab === "internal" && (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">역할</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm mb-3 focus:outline-none focus:border-[var(--primary)]"
                      >
                        <option value="member">멤버</option>
                        <option value="INTERNAL_MANAGER">담당자</option>
                        <option value="CLIENT">클라이언트</option>
                        <option value="VENDOR">외주사</option>
                      </select>

                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">멤버 선택</label>
                      <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded-xl">
                        {companyUsers
                          .filter((u: any) => !participants.some((p: any) => p.user_id === u.id))
                          .map((u: any) => (
                            <button
                              key={u.id}
                              onClick={async () => {
                                try {
                                  await inviteParticipant({ channelId, userId: u.id, role: inviteRole });
                                  if (userId) await sendSystemMessage(channelId, userId, `${u.name || u.email}님이 채널에 참가했습니다.`);
                                  queryClient.invalidateQueries({ queryKey: ["chat-participants", channelId] });
                                  queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
                                } catch {}
                              }}
                              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-surface)] transition text-left"
                            >
                              <div className="w-8 h-8 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                                {(u.name || u.email || "?")[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-[var(--text)]">{u.name || "—"}</div>
                                <div className="text-[10px] text-[var(--text-dim)]">{u.email}</div>
                              </div>
                            </button>
                          ))}
                        {companyUsers.filter((u: any) => !participants.some((p: any) => p.user_id === u.id)).length === 0 && (
                          <div className="p-6 text-center text-xs text-[var(--text-muted)]">추가할 멤버가 없습니다</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 외부 초대 */}
                  {inviteTab === "external" && (
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-4">
                        초대 링크를 문자 또는 이메일로 보내 외부 인원을 채팅방에 초대합니다.
                      </p>

                      {/* 링크 생성 */}
                      {!inviteLink ? (
                        <button
                          onClick={async () => {
                            const token = await getOrCreateInviteToken(channelId);
                            setInviteLink(getChatInviteUrl(token));
                          }}
                          className="w-full py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm font-semibold text-[var(--text)] hover:bg-[var(--border)] transition mb-3"
                        >
                          초대 링크 생성
                        </button>
                      ) : (
                        <>
                          {/* 링크 표시 */}
                          <div className="flex items-center gap-2 mb-4">
                            <input
                              readOnly
                              value={inviteLink}
                              className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] truncate"
                            />
                            <button
                              onClick={() => { navigator.clipboard.writeText(inviteLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }}
                              className={`px-3 py-2 rounded-lg text-xs font-semibold transition shrink-0 ${linkCopied ? 'bg-green-100 text-green-700' : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'}`}
                            >
                              {linkCopied ? "복사됨!" : "복사"}
                            </button>
                          </div>

                          {/* 연락처 입력 */}
                          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">전화번호 또는 이메일</label>
                          <input
                            type="text"
                            value={extContact}
                            onChange={(e) => setExtContact(e.target.value)}
                            placeholder="010-1234-5678 또는 guest@company.com"
                            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]"
                          />

                          {/* 발송 버튼 */}
                          <div className="grid grid-cols-2 gap-2">
                            <a
                              href={`sms:${extContact.includes('@') ? '' : extContact.replace(/-/g, '')}?body=${encodeURIComponent(`[REFLECT] "${channel?.name || '채팅방'}" 에 초대되었습니다.\n아래 링크를 눌러 참가하세요:\n${inviteLink}`)}`}
                              className="flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              문자 보내기
                            </a>
                            <a
                              href={`mailto:${extContact.includes('@') ? extContact : ''}?subject=${encodeURIComponent(`[REFLECT] 채팅방 초대`)}&body=${encodeURIComponent(`안녕하세요,\n\n"${channel?.name || '채팅방'}" 에 초대되었습니다.\n아래 링크를 클릭하여 참가하세요:\n\n${inviteLink}\n\nREFLECT`)}`}
                              className="flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              이메일 보내기
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "files" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden flex-1 overflow-y-auto">
          {files.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">파일이 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {files.map((f: any) => (
                <a key={f.id} href={f.file_url} target="_blank" rel="noopener noreferrer"
                  className="px-5 py-3 flex items-center justify-between hover:bg-[var(--bg-surface)] transition block">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {f.mime_type?.startsWith('image/') ? '🖼' : f.mime_type?.includes('pdf') ? '📕' : '📎'}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{f.file_name}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">
                        {(f.users as any)?.name || (f.users as any)?.email || '—'} · {f.file_size ? formatFileSize(f.file_size) : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)]">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString('ko') : '—'}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "events" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">이벤트가 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {events.map((ev: any) => (
                <div key={ev.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                      {EVENT_LABELS[ev.event_type] || ev.event_type}
                    </span>
                    {ev.data_json && (
                      <span className="text-[10px] text-[var(--text-dim)]">
                        {JSON.stringify(ev.data_json).slice(0, 60)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-dim)]">
                    {ev.created_at ? new Date(ev.created_at).toLocaleString("ko") : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Guest Chat View (previously chat/guest/[token]/client.tsx) ──
interface GuestSession {
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
}

function GuestChatView({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<GuestSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function validateToken() {
      try {
        const { data: channel } = await supabase
          .from('chat_channels')
          .select('id, name, allow_guests')
          .eq('invite_token', token)
          .eq('is_archived', false)
          .single();

        if (!channel) {
          setError('유효하지 않은 초대 링크입니다.');
          setLoading(false);
          return;
        }

        if (!channel.allow_guests) {
          setError('이 채널은 게스트 접근이 허용되지 않습니다.');
          setLoading(false);
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError('로그인이 필요합니다.');
          setLoading(false);
          return;
        }

        const { data: dbUser } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('auth_id', user.id)
          .single();

        if (!dbUser) {
          setError('사용자 정보를 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        const { data: existing } = await supabase
          .from('chat_participants')
          .select('id')
          .eq('channel_id', channel.id)
          .eq('user_id', dbUser.id)
          .maybeSingle();

        if (!existing) {
          await supabase.from('chat_participants').insert({
            channel_id: channel.id,
            user_id: dbUser.id,
            role: 'GUEST',
          });
        }

        setSession({
          channelId: channel.id,
          channelName: channel.name,
          userId: dbUser.id,
          userName: dbUser.name || dbUser.email,
        });
      } catch {
        setError('채널 정보를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    }

    if (token) validateToken();
  }, [token]);

  const { data: messages = [] } = useQuery({
    queryKey: ["guest-messages", session?.channelId],
    queryFn: () => getMessages(session!.channelId),
    enabled: !!session?.channelId,
    refetchInterval: 5000,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["guest-participants", session?.channelId],
    queryFn: () => getParticipants(session!.channelId),
    enabled: !!session?.channelId,
  });

  useEffect(() => {
    if (!session?.channelId) return;
    const sub = subscribeToMessages(session.channelId, () => {
      queryClient.invalidateQueries({ queryKey: ["guest-messages", session.channelId] });
    });
    return () => unsubscribe(sub);
  }, [session?.channelId, queryClient]);

  useEffect(() => {
    if (session) markAsRead(session.channelId, session.userId);
  }, [session, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage({
      channelId: session!.channelId,
      senderId: session!.userId,
      content,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guest-messages", session?.channelId] });
    },
  });

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg)]">
        <div className="text-sm text-[var(--text-muted)]">게스트 채널 확인 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg)]">
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-10 text-center max-w-md">
          <div className="text-3xl mb-4">🔒</div>
          <div className="text-lg font-bold mb-2 text-red-400">접근 불가</div>
          <div className="text-sm text-[var(--text-muted)]">{error}</div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="max-w-[700px] mx-auto flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-bold">GUEST</span>
            <h1 className="text-lg font-extrabold">{session.channelName}</h1>
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">
            게스트 접속 · {participants.length}명 참가 · {session.userName}
          </div>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto bg-[var(--bg-card)] rounded-t-2xl border border-b-0 border-[var(--border)] p-5">
          {messages.length === 0 ? (
            <div className="text-center py-20 text-sm text-[var(--text-muted)]">첫 메시지를 보내세요</div>
          ) : (
            messages.map((msg: any) => (
              <ChatBubble
                key={msg.id}
                senderName={msg.users?.name || msg.users?.email || "—"}
                content={msg.content}
                time={formatTime(msg.created_at)}
                isOwn={msg.sender_id === session.userId}
                type={msg.type}
                pinned={msg.pinned}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="rounded-b-2xl border border-t-0 border-[var(--border)] overflow-hidden">
          <ChatInput onSend={(text) => sendMut.mutate(text)} disabled={sendMut.isPending} />
        </div>
      </div>
    </div>
  );
}

// ── Chat List ──
function ChatPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedChannel = searchParams.get("channel");
  const guestToken = searchParams.get("token");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", deal_id: "", type: "deal" });
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  // If a guest token is in URL, show guest view
  if (guestToken) {
    return <GuestChatView token={guestToken} />;
  }

  // If a channel is selected, show the chat room
  if (selectedChannel) {
    return (
      <ChatRoomView
        channelId={selectedChannel}
        onBack={() => router.push("/chat")}
      />
    );
  }

  // Otherwise show the channel list (using the component below)
  return <ChatListView
    companyId={companyId}
    userId={userId}
    showForm={showForm}
    setShowForm={setShowForm}
    form={form}
    setForm={setForm}
    typeFilter={typeFilter}
    setTypeFilter={setTypeFilter}
    queryClient={queryClient}
    router={router}
  />;
}

function ChannelItem({ ch, unreadMap, router }: { ch: any; unreadMap: any; router: any }) {
  const unread = unreadMap?.get(ch.id) || 0;
  const isDM = ch.is_dm;
  const isDeal = !!ch.deal_id;
  return (
    <button onClick={() => router.push(`/chat?channel=${ch.id}`)}
      className="w-full text-left block bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)]/30 transition group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
            isDM ? 'bg-green-500/10 text-green-400' :
            isDeal ? 'bg-blue-500/10 text-blue-400' :
            ch.type === 'subdeal' ? 'bg-purple-500/10 text-purple-400' :
            'bg-gray-500/10 text-gray-400'
          }`}>
            {isDM ? 'DM' : isDeal ? 'D' : ch.type === 'subdeal' ? 'S' : 'T'}
          </div>
          <div>
            <div className="text-sm font-semibold group-hover:text-[var(--primary)] transition">
              {ch.name}
            </div>
            <div className="text-xs text-[var(--text-dim)] mt-0.5">
              {ch.deals?.name ? `딜: ${ch.deals.name}` : isDM ? 'DM' : '팀 채널'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {unread > 0 && (
            <span className="min-w-[20px] h-5 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          <div className="text-xs text-[var(--text-dim)]">
            {ch.created_at ? new Date(ch.created_at).toLocaleDateString('ko') : '--'}
          </div>
        </div>
      </div>
    </button>
  );
}

function ChatListView({ companyId, userId, showForm, setShowForm, form, setForm, typeFilter, setTypeFilter, queryClient, router }: any) {
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [showDMForm, setShowDMForm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [dmUserId, setDmUserId] = useState("");

  const { data: channels = [] } = useQuery({
    queryKey: ["chat-channels", companyId],
    queryFn: () => getChannels(companyId!),
    enabled: !!companyId,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });

  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
  });

  const { data: unreadMap } = useQuery({
    queryKey: ["chat-unread", companyId, userId],
    queryFn: () => getUnreadCounts(companyId!, userId!),
    enabled: !!companyId && !!userId,
    refetchInterval: 15000,
  });

  const totalUnread = unreadMap ? Array.from(unreadMap.values()).reduce((s: number, v: number) => s + v, 0) : 0;

  // Categorize channels into 3 sections
  const dealChannels = channels.filter((ch: any) => !!ch.deal_id);
  const teamChannels = channels.filter((ch: any) => !ch.deal_id && !ch.is_dm);
  const dmChannels = channels.filter((ch: any) => ch.is_dm);

  const createMut = useMutation({
    mutationFn: () => createChannel({
      companyId: companyId!,
      dealId: form.deal_id || undefined,
      type: form.type,
      name: form.name,
      creatorUserId: userId!,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setShowForm(false);
      setForm({ name: "", deal_id: "", type: "deal" });
    },
  });

  const createTeamMut = useMutation({
    mutationFn: () => createTeamChannel({
      companyId: companyId!,
      name: teamName,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setShowTeamForm(false);
      setTeamName("");
    },
  });

  const createDMMut = useMutation({
    mutationFn: () => createDMChannel({
      companyId: companyId!,
      participantIds: [userId!, dmUserId],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setShowDMForm(false);
      setDmUserId("");
    },
  });

  return (
    <div className="max-w-[800px]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">
            딜룸 채팅
            {totalUnread > 0 && (
              <span className="ml-2 text-sm px-2 py-0.5 bg-red-500 text-white rounded-full font-bold">
                {totalUnread}
              </span>
            )}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">딜별 소통 + 팀 채널 + DM</p>
        </div>
      </div>

      {/* Section 1: Deal Channels */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[var(--text-muted)]">딜 채널 ({dealChannels.length})</h2>
          <button onClick={() => { setShowForm(!showForm); setShowTeamForm(false); setShowDMForm(false); }}
            className="w-6 h-6 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--primary)] text-[var(--text-muted)] hover:text-white flex items-center justify-center text-xs font-bold transition">
            +
          </button>
        </div>

        {showForm && (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-4">
            <h3 className="text-sm font-bold mb-4">새 딜 채널</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">채널명 *</label>
                <input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                  placeholder="수출바우처 A기업 채팅" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">연결 딜</label>
                <select value={form.deal_id} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, deal_id: e.target.value })}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                  <option value="">선택 안함</option>
                  {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
                <select value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                  <option value="deal">딜 채널</option>
                  <option value="subdeal">서브딜 채널</option>
                  <option value="general">일반 채널</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => form.name && createMut.mutate()} disabled={!form.name || createMut.isPending}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">생성</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
        )}

        {dealChannels.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
            <div className="text-sm text-[var(--text-muted)]">딜 채널이 없습니다</div>
          </div>
        ) : (
          <div className="space-y-2">
            {dealChannels.map((ch: any) => (
              <ChannelItem key={ch.id} ch={ch} unreadMap={unreadMap} router={router} />
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Team Channels */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[var(--text-muted)]">팀 채널 ({teamChannels.length})</h2>
          <button onClick={() => { setShowTeamForm(!showTeamForm); setShowForm(false); setShowDMForm(false); }}
            className="w-6 h-6 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--primary)] text-[var(--text-muted)] hover:text-white flex items-center justify-center text-xs font-bold transition">
            +
          </button>
        </div>

        {showTeamForm && (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-4">
            <h3 className="text-sm font-bold mb-4">새 팀 채널</h3>
            <div className="mb-4">
              <label className="block text-xs text-[var(--text-muted)] mb-1">채널명 *</label>
              <input value={teamName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTeamName(e.target.value)}
                placeholder="마케팅팀, 개발팀..." className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] max-w-xs" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => teamName && createTeamMut.mutate()} disabled={!teamName || createTeamMut.isPending}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">생성</button>
              <button onClick={() => setShowTeamForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
        )}

        {teamChannels.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
            <div className="text-sm text-[var(--text-muted)]">팀 채널이 없습니다</div>
          </div>
        ) : (
          <div className="space-y-2">
            {teamChannels.map((ch: any) => (
              <ChannelItem key={ch.id} ch={ch} unreadMap={unreadMap} router={router} />
            ))}
          </div>
        )}
      </div>

      {/* Section 3: DM */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[var(--text-muted)]">DM ({dmChannels.length})</h2>
          <button onClick={() => { setShowDMForm(!showDMForm); setShowForm(false); setShowTeamForm(false); }}
            className="w-6 h-6 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--primary)] text-[var(--text-muted)] hover:text-white flex items-center justify-center text-xs font-bold transition">
            +
          </button>
        </div>

        {showDMForm && (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-4">
            <h3 className="text-sm font-bold mb-4">새 DM</h3>
            <div className="mb-4">
              <label className="block text-xs text-[var(--text-muted)] mb-1">대상 멤버 *</label>
              <select value={dmUserId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDmUserId(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] max-w-xs">
                <option value="">멤버 선택</option>
                {companyUsers.filter((u: any) => u.id !== userId).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => dmUserId && createDMMut.mutate()} disabled={!dmUserId || createDMMut.isPending}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">시작</button>
              <button onClick={() => setShowDMForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
        )}

        {dmChannels.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
            <div className="text-sm text-[var(--text-muted)]">DM이 없습니다</div>
          </div>
        ) : (
          <div className="space-y-2">
            {dmChannels.map((ch: any) => (
              <ChannelItem key={ch.id} ch={ch} unreadMap={unreadMap} router={router} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}>
      <ChatPageInner />
    </Suspense>
  );
}
