"use client";

// 플로팅 팝업 메신저 (2026-06-22) — app-shell 의 영속 셸에 마운트되어 어떤 페이지로 이동해도
// 열림 상태·선택 채널·스크롤이 유지된다. 채팅방 본문은 /chat 풀페이지와 동일한 ChatRoomView 를 공유.
//   · 데스크톱 전용: 모바일은 좁아 부적합 → 하단탭 '메신저'(/chat) 사용 (hidden md:block).
//   · /chat 페이지에서는 중복 방지로 런처 숨김.
//   · ChatRoomView 는 무겁고 전역 셸에 항상 마운트되므로 next/dynamic 으로 열 때만 로드.
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getChannels, getUnreadCounts } from "@/lib/queries";
import { createTeamChannel } from "@/lib/chat";

const ChatRoomView = dynamic(() => import("@/components/chat-room-view").then((m) => m.ChatRoomView), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

function ChannelButton({ ch, unread, onClick }: { ch: any; unread: number; onClick: () => void }) {
  const isDM = ch.is_dm;
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition hover:bg-[var(--bg-surface)] text-[var(--text-muted)]">
      <span className="text-sm shrink-0 text-[var(--text-dim)]">{isDM ? "@" : "#"}</span>
      <span className={`flex-1 truncate text-sm ${unread > 0 ? "font-bold text-[var(--text)]" : "font-medium"}`}>
        {isDM ? (ch.dm_name || "1:1 대화") : ch.name}
      </span>
      {unread > 0 && (
        <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 shrink-0 bg-red-500 text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

export function FloatingMessenger() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // 영속화 — 영속 셸 마운트로 페이지 이동에는 이미 유지되지만, 혹시 모를 remount/새로고침에도
  //   열림 상태·선택 채널을 복원해 "이동해도 유지" 를 확실히 보장. (SSR 하이드레이션 충돌 방지 위해 useEffect 에서 복원)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("messenger:open") === "1");
      const ch = localStorage.getItem("messenger:channel");
      if (ch) setSelected(ch);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("messenger:open", open ? "1" : "0"); } catch {}
  }, [open]);
  useEffect(() => {
    try {
      if (selected) localStorage.setItem("messenger:channel", selected);
      else localStorage.removeItem("messenger:channel");
    } catch {}
  }, [selected]);

  const { data: me } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => getCurrentUser(),
    staleTime: 60_000,
  });
  const companyId = me?.company_id ?? null;
  const userId = me?.id ?? null;

  // 안읽음 합계는 런처 배지에 항상 필요 → 닫혀 있어도 폴링. 채널 목록은 열 때만 로드(비용 최소화).
  const { data: unreadMap } = useQuery({
    queryKey: ["chat-unread", companyId, userId],
    queryFn: () => getUnreadCounts(companyId!, userId!),
    enabled: !!companyId && !!userId,
    refetchInterval: 30_000,
  });
  const { data: channels = [] } = useQuery({
    queryKey: ["chat-channels", companyId],
    queryFn: () => getChannels(companyId!, userId || undefined),
    enabled: !!companyId && open,
  });

  const createMut = useMutation({
    mutationFn: () => createTeamChannel({ companyId: companyId!, name: newName.trim(), creatorUserId: userId! }),
    onSuccess: (ch: any) => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      setCreating(false);
      setNewName("");
      if (ch?.id) setSelected(ch.id);
    },
  });

  const totalUnread = useMemo(
    () => (unreadMap ? Array.from(unreadMap.values()).reduce((s: number, v: number) => s + v, 0) : 0),
    [unreadMap]
  );

  const q = search.trim().toLowerCase();
  const matched = useMemo(() => {
    const m = (ch: any) => !q || (ch.name || ch.dm_name || "").toLowerCase().includes(q);
    const list = (channels as any[]).filter(m);
    return {
      deal: list.filter((c) => !!c.deal_id),
      team: list.filter((c) => !c.deal_id && !c.is_dm),
      dm: list.filter((c) => c.is_dm),
    };
  }, [channels, q]);

  const selectedChannel = (channels as any[]).find((c) => c.id === selected) || null;

  // /chat 풀페이지에서는 런처 숨김(중복). 모바일은 CSS(hidden md:block)로 숨김.
  if (pathname?.startsWith("/chat")) return null;

  const openFull = () => {
    const id = selected;
    setOpen(false);
    router.push(id ? `/chat?channel=${id}` : "/chat");
  };

  return (
    <div className="hidden md:block">
      {/* 팝업 패널 */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] h-[560px] max-h-[calc(100vh-7rem)] flex flex-col rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden"
          style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.18)" }}>
          {/* 헤더 */}
          <div className="shrink-0 flex items-center gap-2 px-3 h-12 border-b border-[var(--border)] bg-[var(--bg-surface)]">
            {selected ? (
              <button onClick={() => setSelected(null)} title="채널 목록" className="p-1 -ml-1 rounded-md hover:bg-[var(--bg-card)] text-[var(--text-muted)]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            ) : (
              <span className="text-sm">💬</span>
            )}
            <span className="flex-1 truncate text-sm font-bold text-[var(--text)]">
              {selectedChannel ? `${selectedChannel.is_dm ? "@" : "#"} ${selectedChannel.is_dm ? (selectedChannel.dm_name || "1:1 대화") : selectedChannel.name}` : "메신저"}
            </span>
            <button onClick={openFull} title="전체화면" className="p-1 rounded-md hover:bg-[var(--bg-card)] text-[var(--text-muted)]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>
            </button>
            <button onClick={() => setOpen(false)} title="닫기" className="p-1 rounded-md hover:bg-[var(--bg-card)] text-[var(--text-muted)]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {/* 본문: 선택 시 채팅방, 미선택 시 채널 목록 */}
          {selected ? (
            <ChatRoomView channelId={selected} embedded compact onBack={() => setSelected(null)} />
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="shrink-0 p-2 border-b border-[var(--border)] space-y-2">
                <div className="flex items-center gap-2">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="채널 검색"
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--primary)]" />
                  <button onClick={() => { setCreating((v) => !v); setNewName(""); }} title="새 채널 만들기"
                    className="shrink-0 w-8 h-8 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center text-lg leading-none hover:opacity-90 transition">
                    {creating ? "×" : "+"}
                  </button>
                </div>
                {creating && (
                  <div className="flex items-center gap-2">
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newName.trim() && !createMut.isPending) createMut.mutate(); }}
                      placeholder="새 채널 이름"
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--primary)]" />
                    <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
                      className="shrink-0 px-3 h-8 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 transition disabled:opacity-40">
                      {createMut.isPending ? "생성중" : "만들기"}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {([["프로젝트", matched.deal], ["팀", matched.team], ["1:1", matched.dm]] as [string, any[]][]).map(([title, list]) =>
                  list.length === 0 ? null : (
                    <div key={title}>
                      <div className="px-2 mb-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-dim)]">{title} {list.length}</div>
                      <div className="space-y-0.5">
                        {list.map((ch) => (
                          <ChannelButton key={ch.id} ch={ch} unread={unreadMap?.get(ch.id) || 0} onClick={() => setSelected(ch.id)} />
                        ))}
                      </div>
                    </div>
                  )
                )}
                {channels.length === 0 && (
                  <div className="py-10 text-center text-xs text-[var(--text-dim)]">채널이 없습니다. ‘전체화면’에서 새 채널을 만들어 보세요.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 런처 FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="메신저 열기"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[var(--primary)] text-white flex items-center justify-center hover:opacity-90 transition active:scale-95"
        style={{ boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        )}
        {!open && totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 flex items-center justify-center text-[10px] font-bold rounded-full px-1 bg-red-500 text-white border-2 border-[var(--bg-card)]">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
