"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import {
  getCurrentUser, getChannels, getDeals, getUnreadCounts, getChannel, getMessages, getMessagesPaginated, getParticipants, getChannelEvents,
  searchChannelMessages, getBatchReactions, getActionCards, getChannelFiles, getCompanyUsers,
} from "@/lib/queries";
import { createChannel, sendMessage, togglePin, markAsRead, uploadChatFile, sendMessageWithMentions, addReaction, removeReaction, editMessage, deleteMessage, createTeamChannel, createDMChannel, inviteParticipant, getOrCreateInviteToken, getChatInviteUrl, sendSystemMessage } from "@/lib/chat";
import { subscribeToMessages, subscribeToMessageUpdates, subscribeToReactions, unsubscribe, type RealtimeStatus } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { ChatBubble } from "@/components/chat-bubble";
import { ChatInput } from "@/components/chat-input";
import { ChatSearch } from "@/components/chat-search";
import { ChatRoomView } from "@/components/chat-room-view";

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
  const [guestRtStatus, setGuestRtStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    async function validateToken() {
      try {
        const { data: channel } = await supabase
          .from('chat_channels')
          .select('id, name, allow_guests')
          .eq('invite_token', token)
          .eq('is_archived', false)
          .maybeSingle();

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
          .maybeSingle();

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

        // 게스트도 RLS SELECT 통과를 위해 chat_members 동시 등록 (멱등 upsert).
        const dbAny = supabase as any;
        await dbAny.from('chat_members').upsert(
          { channel_id: channel.id, user_id: dbUser.id, role: 'GUEST' },
          { onConflict: 'channel_id,user_id', ignoreDuplicates: true },
        );

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
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["guest-participants", session?.channelId],
    queryFn: () => getParticipants(session!.channelId),
    enabled: !!session?.channelId,
  });

  useEffect(() => {
    if (!session?.channelId) return;
    setGuestRtStatus('connecting');
    const sub = subscribeToMessages(session.channelId, () => {
      queryClient.invalidateQueries({ queryKey: ["guest-messages", session.channelId] });
    }, (status) => {
      setGuestRtStatus(status);
    });
    return () => unsubscribe(sub);
  }, [session?.channelId, queryClient]);

  useEffect(() => {
    if (session) markAsRead(session.channelId, session.userId);
  }, [session, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const [guestSendError, setGuestSendError] = useState<string | null>(null);

  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage({
      channelId: session!.channelId,
      senderId: session!.userId,
      content,
    }),
    onSuccess: () => {
      setGuestSendError(null);
      queryClient.invalidateQueries({ queryKey: ["guest-messages", session?.channelId] });
    },
    onError: (err: any) => {
      setGuestSendError(err?.message || '메시지 전송에 실패했습니다.');
      setTimeout(() => setGuestSendError(null), 5000);
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
        <div className="glass-card p-10 text-center max-w-md">
          <div className="text-3xl mb-4">🔒</div>
          <div className="text-lg font-bold mb-2 text-red-400">접근 불가</div>
          <div className="text-sm text-[var(--text-muted)]">{error}</div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="max-w-[700px] mx-auto flex flex-col" style={{ height: "calc(100dvh - 60px)" }}>
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
        {guestRtStatus !== 'SUBSCRIBED' && (
          <div className={`px-4 py-2 text-xs font-medium flex items-center justify-between rounded-t-2xl ${
            guestRtStatus === 'connecting' ? 'bg-yellow-500/10 text-yellow-500' :
            'bg-red-500/10 text-red-400'
          }`}>
            <span className="flex items-center gap-2">
              {guestRtStatus === 'connecting' && <><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" /> 연결 중...</>}
              {(guestRtStatus === 'CHANNEL_ERROR' || guestRtStatus === 'TIMED_OUT') && <><span className="w-2 h-2 rounded-full bg-red-400" /> 연결 오류</>}
              {guestRtStatus === 'CLOSED' && <><span className="w-2 h-2 rounded-full bg-gray-400" /> 연결 종료됨</>}
            </span>
            {guestRtStatus !== 'connecting' && (
              <button onClick={() => window.location.reload()} className="px-3 py-1 bg-white/10 rounded-lg hover:bg-white/20 transition text-xs font-semibold">새로고침</button>
            )}
          </div>
        )}
        <div className={`flex-1 overflow-y-auto bg-[var(--bg-card)] ${guestRtStatus === 'SUBSCRIBED' ? 'rounded-t-2xl' : ''} border border-b-0 border-[var(--border)] p-5`}>
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
        {guestSendError && (
          <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs font-medium">{guestSendError}</div>
        )}
        <div className="rounded-b-2xl border border-t-0 border-[var(--border)] overflow-hidden">
          <ChatInput onSend={(text) => sendMut.mutate(text)} disabled={sendMut.isPending} />
        </div>
      </div>
    </div>
  );
}

// ── Chat (Slack-style 2단: 좌 채널 사이드바 + 우 대화) ──
function ChatPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedChannel = searchParams.get("channel");
  const guestToken = searchParams.get("token");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  if (guestToken) return <GuestChatView token={guestToken} />;

  return <ChatWorkspace companyId={companyId} userId={userId} selectedChannel={selectedChannel} router={router} />;
}

// 슬랙식 채널 행 — #채널 / @DM, 안읽음 굵게+배지, 활성 하이라이트
function ChannelRow({ ch, active, unread, onClick }: { ch: any; active: boolean; unread: number; onClick: () => void }) {
  const isDM = ch.is_dm;
  const prefix = isDM ? "@" : "#";
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition ${
        active ? "bg-[var(--primary)] text-white" : "hover:bg-[var(--bg-surface)] text-[var(--text-muted)]"
      }`}>
      <span className={`text-sm shrink-0 ${active ? "text-white/70" : "text-[var(--text-dim)]"}`}>{prefix}</span>
      <span className={`flex-1 truncate text-sm ${unread > 0 && !active ? "font-bold text-[var(--text)]" : "font-medium"}`}>{isDM ? (ch.dm_name || "1:1 대화") : ch.name}</span>
      {unread > 0 && (
        <span className={`min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 shrink-0 ${active ? "bg-white/25 text-white" : "bg-red-500 text-white"}`}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

// 사이드바 섹션 (접기/펼치기 + 추가 버튼)
function SidebarSection({ title, count, onAdd, children }: { title: string; count: number; onAdd: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1 px-2 mb-0.5 group">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 flex-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-dim)] hover:text-[var(--text-muted)] transition py-1">
          <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18" /></svg>
          <span>{title}</span>
          <span className="text-[var(--text-dim)]/70">{count}</span>
        </button>
        <button onClick={onAdd} title="추가"
          className="w-6 h-6 rounded-md text-[var(--text-dim)] hover:bg-[var(--bg-surface)] hover:text-[var(--primary)] flex items-center justify-center text-base leading-none transition">+</button>
      </div>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

function ChatWorkspace({ companyId, userId, selectedChannel, router }: any) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // 생성 모달: null | "deal" | "team" | "dm"
  const [creating, setCreating] = useState<null | "deal" | "team" | "dm">(null);
  const [form, setForm] = useState({ name: "", deal_id: "", type: "deal" });
  const [teamName, setTeamName] = useState("");
  const [dmUserId, setDmUserId] = useState("");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCreating(null); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const { data: channels = [] } = useQuery({
    queryKey: ["chat-channels", companyId],
    queryFn: () => getChannels(companyId!, userId || undefined),
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

  const q = search.trim().toLowerCase();
  const match = (ch: any) => !q || (ch.name || "").toLowerCase().includes(q);
  const dealChannels = channels.filter((ch: any) => !!ch.deal_id && match(ch));
  const teamChannels = channels.filter((ch: any) => !ch.deal_id && !ch.is_dm && match(ch));
  const dmChannels = channels.filter((ch: any) => ch.is_dm && match(ch));

  const open = (id: string) => router.push(`/chat?channel=${id}`);

  const createMut = useMutation({
    mutationFn: () => {
      if (!userId || !companyId) throw new Error("Not authenticated");
      return createChannel({ companyId, dealId: form.deal_id || undefined, type: form.type, name: form.name.trim(), creatorUserId: userId });
    },
    onSuccess: (ch: any) => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setCreating(null); setForm({ name: "", deal_id: "", type: "deal" });
      if (ch?.id) open(ch.id);
    },
    onError: (err: any) => toast(friendlyError(err, "채널 생성 실패"), "error"),
  });
  const createTeamMut = useMutation({
    mutationFn: () => {
      if (!userId || !companyId) throw new Error("Not authenticated");
      return createTeamChannel({ companyId, name: teamName.trim(), creatorUserId: userId });
    },
    onSuccess: (ch: any) => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setCreating(null); setTeamName("");
      if (ch?.id) open(ch.id);
    },
    onError: (err: any) => toast(friendlyError(err, "팀 채널 생성 실패"), "error"),
  });
  const createDMMut = useMutation({
    mutationFn: () => {
      if (!userId || !companyId) throw new Error("Not authenticated");
      return createDMChannel({ companyId, participantIds: [userId, dmUserId] });
    },
    onSuccess: (ch: any) => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setCreating(null); setDmUserId("");
      if (ch?.id) open(ch.id);
    },
    onError: (err: any) => toast(friendlyError(err, "DM 채널 생성 실패"), "error"),
  });

  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  const sections: { key: "deal" | "team" | "dm"; title: string; list: any[]; empty: string }[] = [
    { key: "team", title: "팀 채널", list: teamChannels, empty: "팀 채널 없음" },
    { key: "deal", title: "프로젝트", list: dealChannels, empty: "프로젝트 채널 없음" },
    { key: "dm", title: "다이렉트 메시지", list: dmChannels, empty: "DM 없음" },
  ];

  return (
    <div className="flex rounded-2xl border border-[var(--border)] overflow-hidden bg-[var(--bg-card)]" style={{ height: "calc(100dvh - 104px)" }}>
      {/* ── 좌측 채널 사이드바 ── */}
      <aside className={`${selectedChannel ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-72 shrink-0 border-r border-[var(--border)] bg-[var(--bg-surface)]/40`}>
        <div className="px-3 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-extrabold text-[var(--text)]">메시지</h1>
            {totalUnread > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-red-500 text-white rounded-full font-bold">{totalUnread}</span>}
          </div>
          <button onClick={() => { setCreating("team"); }} title="새로 만들기"
            className="w-7 h-7 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center text-base leading-none hover:opacity-90 transition">+</button>
        </div>
        <div className="px-3 py-2 shrink-0">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="채널·멤버 검색"
            className="w-full px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {sections.map((sec) => (
            <SidebarSection key={sec.key} title={sec.title} count={sec.list.length} onAdd={() => setCreating(sec.key)}>
              {sec.list.length === 0 ? (
                <div className="px-2.5 py-1 text-[11px] text-[var(--text-dim)]">{sec.empty}</div>
              ) : (
                sec.list.map((ch: any) => (
                  <ChannelRow key={ch.id} ch={ch} active={selectedChannel === ch.id} unread={unreadMap?.get(ch.id) || 0} onClick={() => open(ch.id)} />
                ))
              )}
            </SidebarSection>
          ))}
        </div>
      </aside>

      {/* ── 우측 대화 패널 ── */}
      <section className={`${selectedChannel ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col`}>
        {selectedChannel ? (
          <div className="flex-1 min-h-0 flex flex-col p-2 sm:p-3">
            <ChatRoomView channelId={selectedChannel} embedded onBack={() => router.push("/chat")} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <div className="text-5xl mb-3">💬</div>
              <div className="text-sm font-semibold text-[var(--text)]">채널을 선택하세요</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">왼쪽에서 대화를 선택하거나 새 채널을 만드세요</div>
            </div>
          </div>
        )}
      </section>

      {/* ── 생성 모달 (프로젝트/팀/DM 통합) ── */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreating(null)}>
          <div className="glass-card w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-bold text-[var(--text)]">새로 만들기</h3>
              <button onClick={() => setCreating(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-lg">×</button>
            </div>
            <div className="flex gap-1 mx-6 mt-4 bg-[var(--bg-surface)] rounded-xl p-1">
              {([["team", "팀 채널"], ["deal", "프로젝트"], ["dm", "DM"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setCreating(k)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${creating === k ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>{label}</button>
              ))}
            </div>
            <div className="px-6 py-4">
              {creating === "team" && (
                <>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">채널명</label>
                  <input value={teamName} onChange={(e) => setTeamName(e.target.value)} autoFocus placeholder="마케팅팀, 개발팀..."
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]" />
                  <button onClick={() => teamName.trim() && createTeamMut.mutate()} disabled={!teamName.trim() || createTeamMut.isPending}
                    className="w-full py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">만들기</button>
                </>
              )}
              {creating === "deal" && (
                <>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">채널명</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="수출바우처 A기업 채팅"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-3 focus:outline-none focus:border-[var(--primary)]" />
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">연결 프로젝트</label>
                  <select value={form.deal_id} onChange={(e) => setForm({ ...form, deal_id: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-3 focus:outline-none focus:border-[var(--primary)]">
                    <option value="">선택 안함</option>
                    {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">유형</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]">
                    <option value="deal">프로젝트 채널</option>
                    <option value="subdeal">외주 채널</option>
                    <option value="general">일반 채널</option>
                  </select>
                  <button onClick={() => form.name.trim() && createMut.mutate()} disabled={!form.name.trim() || createMut.isPending}
                    className="w-full py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">만들기</button>
                </>
              )}
              {creating === "dm" && (
                <>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">대상 멤버</label>
                  <select value={dmUserId} onChange={(e) => setDmUserId(e.target.value)} autoFocus
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]">
                    <option value="">멤버 선택</option>
                    {companyUsers.filter((u: any) => u.id !== userId).map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                  <button onClick={() => dmUserId && createDMMut.mutate()} disabled={!dmUserId || createDMMut.isPending}
                    className="w-full py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">대화 시작</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
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
