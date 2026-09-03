"use client";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

import { useEffect, useMemo, useState, useRef, useCallback, Suspense } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import {
  getCurrentUser, getChannels, getDeals, getUnreadCounts, getChannel, getMessages, getMessagesPaginated, getParticipants, getChannelEvents,
  searchChannelMessages, getBatchReactions, getActionCards, getChannelFiles, getCompanyUsers,
} from "@/lib/queries";
import { createChannel, sendMessage, togglePin, markAsRead, uploadChatFile, sendMessageWithMentions, addReaction, removeReaction, editMessage, deleteMessage, createTeamChannel, createDMChannel, getOrCreateDMChannel, inviteParticipant, getOrCreateInviteToken, getChatInviteUrl, sendSystemMessage } from "@/lib/chat";
import { subscribeToMessages, subscribeToMessageUpdates, subscribeToReactions, unsubscribe, type RealtimeStatus } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { ChatBubble } from "@/components/chat-bubble";
import { ChatInput } from "@/components/chat-input";
import { ChatSearch } from "@/components/chat-search";
import { ChatRoomView } from "@/components/chat-room-view";
import { ChatSchedulePanel } from "@/components/chat-schedule-panel";
import { ChatScheduleCalendar } from "@/components/chat-schedule-calendar";
import { useModalKeys } from "@/hooks/use-modal-keys";

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
        const channel = logRead('chat/page:channel', await supabase
          .from('chat_channels')
          .select('id, name, allow_guests')
          .eq('invite_token', token)
          .eq('is_archived', false)
          .maybeSingle());

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

        const dbUser = logRead('chat/page:dbUser', await supabase
          .from('users')
          .select('id, name, email')
          .eq('auth_id', user.id)
          .maybeSingle());

        if (!dbUser) {
          setError('사용자 정보를 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        const existing = logRead('chat/page:existing', await supabase
          .from('chat_participants')
          .select('id')
          .eq('channel_id', channel.id)
          .eq('user_id', dbUser.id)
          .maybeSingle());

        // 게스트도 RLS SELECT 통과를 위해 chat_members 를 **먼저** 등록 (멱등 upsert).
        //   chat_participants 의 SELECT 정책이 chat_members 를 보므로 순서가 뒤바뀌면 403 이 난다(2026-08-05).
        const dbAny = supabase;
        await dbAny.from('chat_members').upsert(
          { channel_id: channel.id, user_id: dbUser.id, role: 'GUEST' },
          { onConflict: 'channel_id,user_id', ignoreDuplicates: true },
        );

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
          <div className="text-3xl mb-4"><Ico e="🔒" /></div>
          <div className="text-sm font-bold mb-2 text-[var(--danger)]">접근 불가</div>
          <div className="text-sm text-[var(--text-muted)]">{error}</div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="chat-guest-view" style={{ height: "calc(100dvh - 60px)" }}>
      <div className="chat-guest-header">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--warning-dim)] text-[var(--warning)] font-bold">GUEST</span>
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
            guestRtStatus === 'connecting' ? 'bg-[var(--warning-dim)] text-[var(--warning)]' :
            'bg-[var(--danger-dim)] text-[var(--danger)]'
          }`}>
            <span className="flex items-center gap-2">
              {guestRtStatus === 'connecting' && <><span className="w-2 h-2 rounded-full bg-[var(--warning)] animate-pulse" /> 연결 중...</>}
              {(guestRtStatus === 'CHANNEL_ERROR' || guestRtStatus === 'TIMED_OUT') && <><span className="w-2 h-2 rounded-full bg-[var(--danger)]" /> 연결 오류</>}
              {guestRtStatus === 'CLOSED' && <><span className="w-2 h-2 rounded-full bg-gray-400" /> 연결 종료됨</>}
            </span>
            {guestRtStatus !== 'connecting' && (
              <button onClick={() => window.location.reload()} className="px-3 py-1 bg-white/10 rounded-lg hover:bg-white/20 transition text-xs font-semibold">새로고침</button>
            )}
          </div>
        )}
        <div className={`chat-guest-messages-panel ${guestRtStatus === 'SUBSCRIBED' ? 'rounded-t-2xl' : ''}`}>
          {messages.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-4xl mb-3"><Ico e="💬" /></div>
              <div className="text-sm font-semibold text-[var(--text)]">첫 메시지를 보내세요</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1.5">아래 입력창에서 대화를 시작할 수 있습니다.</div>
            </div>
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
          <div className="px-4 py-2 bg-[var(--danger-dim)] text-[var(--danger)] text-xs font-medium">{guestSendError}</div>
        )}
        <div className="chat-guest-input-wrapper">
          <ChatInput onSend={(text) => sendMut.mutate(text)} disabled={sendMut.isPending} />
        </div>
      </div>
    </div>
  );
}

// ── Chat (메신저형 2단: 좌 채널 사이드바 + 우 대화) ──
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
      className={`chat-channel-row ${
        active ? "bg-[var(--primary)] text-white" : "hover:bg-[var(--bg-surface)] text-[var(--text-muted)]"
      }`}>
      <span className={`text-sm shrink-0 ${active ? "text-white/70" : "text-[var(--text-dim)]"}`}>{prefix}</span>
      <span className={`flex-1 truncate text-sm ${unread > 0 && !active ? "font-bold text-[var(--text)]" : "font-medium"}`}>{isDM ? (ch.dm_name || "1:1 대화") : ch.name}</span>
      {unread > 0 && (
        <span className={`min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 shrink-0 ${active ? "bg-white/25 text-white" : "bg-[var(--danger)] text-white"}`}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

//   왼쪽 레일의 갈래 — 구성원 / 채팅방 / 일정·할 일
type Rail = "people" | "rooms" | "schedule";
const RAILS: Rail[] = ["people", "rooms", "schedule"];

// ── 구성원 한 줄 — 누르면 그 사람과의 1:1 대화가 오른쪽에 열린다 (2026-08-10 사장님 지시) ──
//   앱 계정이 없는 인사기록(userId 없음)은 대화를 걸 수 없으므로 흐리게 두고 이유를 적는다.
function PersonRow({ p, active, unread, busy, isMe, onClick }: {
  p: { name: string; position: string; userId: string | null };
  active: boolean; unread: number; busy: boolean; isMe: boolean; onClick: () => void;
}) {
  const disabled = isMe || !p.userId || busy;
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      title={isMe ? "나입니다" : p.userId ? `${p.name} 님과 1:1 대화` : "앱 계정이 없어 대화를 걸 수 없습니다"}
      className={`chat-person ${active ? "chat-person-on" : ""} ${disabled ? "chat-person-off" : ""}`}>
      <span className="chat-person-face">{(p.name || "?").slice(0, 1)}</span>
      <span className="chat-person-body">
        <b>{p.name}{isMe && <em>나</em>}</b>
        {p.position && <i>{p.position}</i>}
      </span>
      {unread > 0 && <span className="chat-person-badge">{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
}

// 사이드바 섹션 (접기/펼치기 + 추가 버튼)
function SidebarSection({ title, count, onAdd, children }: { title: string; count: number; onAdd: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="chat-sidebar-section">
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
  //   새 창(?embed=1)으로 열리면 셸 헤더가 없다 — 104px 을 빼면 아래가 비어 보인다.
  //   창 높이를 다 쓰도록 임베드 여백(위아래 각 20px)만 뺀다 (2026-08-10 메신저 새 창).
  const [isEmbed] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1");
  //   왼쪽 아이콘 레일 — 사람(부서 → 구성원) / 채팅방 / 일정·할 일. 고른 것은 기억한다(2026-08-10 사장님 지시)
  const [rail, setRail] = useState<Rail>(selectedChannel ? "rooms" : "people");
  useEffect(() => {
    if (selectedChannel) return;                 // 채널로 들어왔으면 그 화면을 그대로 둔다
    //   ★ '일정' 은 기억하지 않는다 (2026-08-27 사장님: "메신저 메뉴에 달력이 나오는데 이게 맞는 건지") —
    //     메신저를 열면 대화부터 보여야 한다. 사람/채팅방 선택만 기억한다.
    try { const v = localStorage.getItem("chat:rail"); if (RAILS.includes(v as Rail) && v !== "schedule") setRail(v as Rail); } catch { /* 무시 */ }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const pickRail = (v: Rail) => {
    setRail(v);
    try { localStorage.setItem("chat:rail", v); } catch { /* 무시 */ }
  };
  const [openDepts, setOpenDepts] = useState<Set<string>>(() => new Set());
  const [dmBusy, setDmBusy] = useState<string | null>(null);

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
  //   구성원 디렉토리 — 부서·직책이 여기에 있다(급여 등 민감 컬럼은 RPC 가 아예 안 준다).
  //   users 테이블엔 부서가 없어 이메일로 두 목록을 잇는다.
  const { data: directory = [] } = useQuery({
    queryKey: ["chat-directory", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!companyId,
  });

  const totalUnread = unreadMap ? Array.from(unreadMap.values()).reduce((s: number, v: number) => s + v, 0) : 0;

  //   이미 있는 1:1 대화 — 사람을 누를 때 새로 만들지 않고 이 방을 연다(중복 방 방지)
  const dmByUser = useMemo(() => {
    const m = new Map<string, any>();
    for (const ch of channels as any[]) if (ch.is_dm && ch.dm_user_id) m.set(ch.dm_user_id, ch);
    return m;
  }, [channels]);

  //   부서 → 구성원. 재직자만 보여 주고, 인사기록이 없는 앱 계정도 '미배정' 으로 함께 담는다.
  const byDept = useMemo(() => {
    const usersByEmail = new Map<string, any>();
    const usersById = new Map<string, any>();
    for (const u of companyUsers as any[]) { if (u.email) usersByEmail.set(String(u.email).toLowerCase(), u); usersById.set(u.id, u); }
    const seen = new Set<string>();
    const list: { key: string; name: string; dept: string; position: string; userId: string | null }[] = [];
    for (const e of directory as any[]) {
      if (e.status !== "active" && e.status !== "joined") continue;
      // 계정 연결 우선(employees.user_id), 없으면 이메일 — 이메일만 보면 같은 사람이 '미배정'에 한 번 더 보였다(2026-09-03)
      const u = (e.user_id && usersById.get(e.user_id)) || (e.email ? usersByEmail.get(String(e.email).toLowerCase()) : null);
      if (u) seen.add(u.id);
      list.push({
        key: `d-${e.id}`, name: e.name || u?.name || e.email || "이름 없음",
        dept: e.department || "미배정", position: e.position || "", userId: u?.id || null,
      });
    }
    for (const u of companyUsers as any[]) {
      if (seen.has(u.id)) continue;
      list.push({ key: `u-${u.id}`, name: u.name || u.email || "이름 없음", dept: "미배정", position: "", userId: u.id });
    }
    const t = search.trim().toLowerCase();
    const shown = t ? list.filter((p) => `${p.name} ${p.dept} ${p.position}`.toLowerCase().includes(t)) : list;
    const groups = new Map<string, typeof list>();
    for (const p of shown) {
      const arr = groups.get(p.dept) || [];
      arr.push(p);
      groups.set(p.dept, arr);
    }
    //   '미배정' 은 늘 맨 아래
    return [...groups.entries()]
      .map(([dept, people]) => ({ dept, people: people.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => (a.dept === "미배정" ? 1 : b.dept === "미배정" ? -1 : a.dept.localeCompare(b.dept)));
  }, [directory, companyUsers, search]);

  const toggleDept = (d: string) => setOpenDepts((prev) => {
    const next = new Set(prev);
    if (next.has(d)) next.delete(d); else next.add(d);
    return next;
  });

  const q = search.trim().toLowerCase();
  const match = (ch: any) => !q || (ch.name || "").toLowerCase().includes(q);
  const dealChannels = channels.filter((ch: any) => !!ch.deal_id && match(ch));
  const teamChannels = channels.filter((ch: any) => !ch.deal_id && !ch.is_dm && match(ch));
  const dmChannels = channels.filter((ch: any) => ch.is_dm && match(ch));

  const open = (id: string) => router.push(`/chat?channel=${id}${isEmbed ? "&embed=1" : ""}`);

  //   구성원을 누르면 그 사람과의 1:1 대화를 연다 — 이미 있으면 그 방, 없을 때만 만든다.
  //   ⚠️ 화면에 받아 둔 채널 목록으로 판단하지 않는다(아직 안 왔으면 방이 하나 더 생긴다).
  //      getOrCreateDMChannel 이 누른 그 순간 DB 를 보고 정한다.
  const openDm = async (p: { name: string; userId: string | null }) => {
    if (!p.userId || p.userId === userId || !companyId || !userId || dmBusy) return;
    setDmBusy(p.userId);
    try {
      const ch = await getOrCreateDMChannel({ companyId, meId: userId, otherId: p.userId });
      await queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      if (ch?.id) open(ch.id);
    } catch (err: any) {
      toast(friendlyError(err, `${p.name} 님과 대화를 열지 못했습니다`), "error");
    } finally { setDmBusy(null); }
  };

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

  function handleCreateConfirm() {
    if (creating === "team") {
      if (teamName.trim() && !createTeamMut.isPending) createTeamMut.mutate();
    } else if (creating === "deal") {
      if (form.name.trim() && !createMut.isPending) createMut.mutate();
    } else if (creating === "dm") {
      if (dmUserId && !createDMMut.isPending) createDMMut.mutate();
    }
  }

  useModalKeys(!!creating, () => setCreating(null), handleCreateConfirm);

  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  const sections: { key: "deal" | "team" | "dm"; title: string; list: any[]; empty: string }[] = [
    { key: "team", title: "팀 채널", list: teamChannels, empty: "팀 채널 없음" },
    { key: "deal", title: "프로젝트", list: dealChannels, empty: "프로젝트 채널 없음" },
    { key: "dm", title: "다이렉트 메시지", list: dmChannels, empty: "DM 없음" },
  ];

  //   높이는 CSS 로 — zoom 안에서는 100vh 를 ÷ --app-zoom 해야 사이드바 끝선과 맞는다 (2026-08-27 사장님: "칸 크기가 좌측 사이드바랑 안 맞음")
  return (
    <div className={isEmbed ? "chat-workspace chat-workspace-embed glass-card" : "chat-workspace glass-card"}>
      {/* ── 좌측 아이콘 레일 — 사람(부서 → 구성원) / 채팅방 (2026-08-10 사장님 지시) ── */}
      <nav className="chat-rail" aria-label="메신저 보기 전환">
        <button type="button" onClick={() => pickRail("people")} aria-pressed={rail === "people"}
          className={`chat-rail-btn ${rail === "people" ? "chat-rail-btn-on" : ""}`} title="구성원 — 부서에서 사람을 골라 1:1 대화">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 6.2a3.2 3.2 0 0 1 0 6" /><path d="M18 14.4a5.6 5.6 0 0 1 3.5 5.2" /></svg>
          <em>구성원</em>
        </button>
        <button type="button" onClick={() => pickRail("rooms")} aria-pressed={rail === "rooms"}
          className={`chat-rail-btn ${rail === "rooms" ? "chat-rail-btn-on" : ""}`} title="채팅방 — 팀 · 프로젝트 · 1:1 목록">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <em>채팅방</em>
          {totalUnread > 0 && <span className="chat-rail-badge">{totalUnread > 99 ? "99+" : totalUnread}</span>}
        </button>
        {/*  일정 · 할 일 — 대화를 보다가 그 자리에서 잡는다. 저장은 '일정 / 할 일' 메뉴와 같은 자리 */}
        <button type="button" onClick={() => pickRail("schedule")} aria-pressed={rail === "schedule"}
          className={`chat-rail-btn ${rail === "schedule" ? "chat-rail-btn-on" : ""}`} title="일정 · 할 일 — 여기서 적으면 일정/할 일 메뉴에도 그대로 들어갑니다">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><path d="M9 14.5l2 2 4-4" /></svg>
          <em>일정</em>
        </button>
      </nav>

      {/* ── 목록 패널 — 레일에서 고른 것에 따라 구성원 또는 채팅방 ── */}
      <aside className={`chat-sidebar chat-sidebar-railed ${selectedChannel ? "hidden md:flex" : "flex"}`}>
        <div className="px-3 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-dim)]">{rail === "people" ? "구성원" : rail === "schedule" ? "일정 · 할 일" : "채팅방"}</span>
            {rail === "rooms" && totalUnread > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--danger)] text-white rounded-full font-bold">{totalUnread}</span>}
          </div>
          {rail === "rooms" && (
            <button onClick={() => { setCreating("team"); }} title="새로 만들기"
              className="w-7 h-7 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center text-base leading-none hover:opacity-90 transition">+</button>
          )}
        </div>
        {rail !== "schedule" && (
          <div className="px-3 py-2 shrink-0">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={rail === "people" ? "이름·부서·직책 검색" : "채널 검색"}
              className="w-full px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
          </div>
        )}

        {rail === "schedule" ? (
          <ChatSchedulePanel companyId={companyId} userId={userId} />
        ) : rail === "people" ? (
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {byDept.length === 0 && <div className="px-2.5 py-4 text-[11px] text-[var(--text-dim)]">구성원이 없습니다.</div>}
            {byDept.map(({ dept, people }) => {
              //   검색 중에는 찾은 부서를 자동으로 펼쳐 준다(한 번 더 누르게 하지 않는다)
              const expanded = openDepts.has(dept) || !!search.trim();
              return (
                <div key={dept} className="chat-dept">
                  <button type="button" onClick={() => toggleDept(dept)} className="chat-dept-head" aria-expanded={expanded}>
                    <svg className={expanded ? "chat-dept-caret chat-dept-caret-on" : "chat-dept-caret"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="9 6 15 12 9 18" /></svg>
                    <span>{dept}</span>
                    <em>{people.length}</em>
                  </button>
                  {expanded && (
                    <div className="chat-dept-people">
                      {people.map((p) => {
                        const dm = p.userId ? dmByUser.get(p.userId) : null;
                        return (
                          <PersonRow key={p.key} p={p} isMe={p.userId === userId}
                            active={!!dm && selectedChannel === dm.id}
                            unread={dm ? (unreadMap?.get(dm.id) || 0) : 0}
                            busy={dmBusy === p.userId}
                            onClick={() => openDm(p)} />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
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
        )}
      </aside>

      {/* ── 우측 대화 패널 ── */}
      <section className={`chat-conversation-panel ${selectedChannel || rail === "schedule" ? "flex" : "hidden md:flex"}`}>
        {/*  '일정' 갈래에서는 대화창 자리에 달력이 선다 — 날짜를 눌러 그 날 일정을 넣는다(2026-08-10) */}
        {rail === "schedule" ? (
          <ChatScheduleCalendar companyId={companyId} userId={userId} />
        ) : selectedChannel ? (
          <div className="flex-1 min-h-0 flex flex-col p-2 sm:p-3">
            {/*  뒤로 갈 때도 embed 를 달고 간다 — 빼면 새로고침 시 새 창 안에 셸이 통째로 뜬다 */}
            <ChatRoomView channelId={selectedChannel} embedded onOpenChannel={open}
              onBack={() => router.push(isEmbed ? "/chat?embed=1" : "/chat")} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <div className="text-5xl mb-4"><Ico e="💬" /></div>
              <div className="text-sm font-semibold text-[var(--text)]">대화를 골라 주세요</div>
              <div className="text-xs text-[var(--text-muted)] mt-1.5">
                왼쪽 <b className="text-[var(--text)]">구성원</b>에서 부서를 펼쳐 사람을 누르면 1:1 대화가,
                <b className="text-[var(--text)]"> 채팅방</b>에서 방을 누르면 그 방이 여기 열립니다.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── 생성 모달 (프로젝트/팀/DM 통합) ── */}
      {creating && (
        <div className="chat-create-modal fixed inset-0">
          <div className="glass-card w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold text-[var(--text)]">새로 만들기</h3>
              <button onClick={() => setCreating(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-lg">×</button>
            </div>
            <div className="mx-6 mt-4">
              <div className="seg-bar flex w-full">
                {([["team", "팀 채널"], ["deal", "프로젝트"], ["dm", "DM"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setCreating(k)}
                    className={`seg-item flex-1 ${creating === k ? "seg-item-active" : ""}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="px-6 py-4">
              {creating === "team" && (
                <>
                  <label className="field-label">채널명</label>
                  <input value={teamName} onChange={(e) => setTeamName(e.target.value)} autoFocus placeholder="마케팅팀, 개발팀..."
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]" />
                  <button onClick={() => teamName.trim() && createTeamMut.mutate()} disabled={!teamName.trim() || createTeamMut.isPending}
                    className="btn-primary w-full">만들기</button>
                </>
              )}
              {creating === "deal" && (
                <>
                  <label className="field-label">채널명</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="수출바우처 A기업 채팅"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-3 focus:outline-none focus:border-[var(--primary)]" />
                  <label className="field-label">연결 프로젝트</label>
                  <select value={form.deal_id} onChange={(e) => setForm({ ...form, deal_id: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-3 focus:outline-none focus:border-[var(--primary)]">
                    <option value="">선택 안함</option>
                    {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <label className="field-label">유형</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]">
                    <option value="deal">프로젝트 채널</option>
                    <option value="subdeal">외주 채널</option>
                    <option value="general">일반 채널</option>
                  </select>
                  <button onClick={() => form.name.trim() && createMut.mutate()} disabled={!form.name.trim() || createMut.isPending}
                    className="btn-primary w-full">만들기</button>
                </>
              )}
              {creating === "dm" && (
                <>
                  <label className="field-label">대상 멤버</label>
                  <select value={dmUserId} onChange={(e) => setDmUserId(e.target.value)} autoFocus
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]">
                    <option value="">멤버 선택</option>
                    {companyUsers.filter((u: any) => u.id !== userId).map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                  <button onClick={() => dmUserId && createDMMut.mutate()} disabled={!dmUserId || createDMMut.isPending}
                    className="btn-primary w-full">대화 시작</button>
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
