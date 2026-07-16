"use client";

// 플로팅 팝업 메신저 (2026-06-22) — app-shell 의 영속 셸에 마운트되어 어떤 페이지로 이동해도
// 열림 상태·선택 채널·스크롤이 유지된다. 채팅방 본문은 /chat 풀페이지와 동일한 ChatRoomView 를 공유.
//   · 데스크톱 전용: 모바일은 좁아 부적합 → 하단탭 '메신저'(/chat) 사용 (hidden md:block).
//   · /chat 페이지에서는 중복 방지로 런처 숨김.
//   · ChatRoomView 는 무겁고 전역 셸에 항상 마운트되므로 next/dynamic 으로 열 때만 로드.
import { useEffect, useMemo, useRef, useState } from "react";
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
      className="channel-button">
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
  // 런처 FAB 드래그 위치(뷰포트 좌상단 px). null = 기본(우하단 고정).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const FAB = 56; // w-14 h-14
  const clampPos = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - FAB - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - FAB - 8)),
  });
  const onFabPointerDown = (e: React.PointerEvent) => {
    const r = fabRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onFabPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved) setPos(clampPos(d.ox + dx, d.oy + dy));
  };
  const onFabPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      setPos((p) => {
        if (p) { try { localStorage.setItem("messenger:pos", JSON.stringify(p)); } catch {} }
        return p;
      });
    } else {
      setOpen((v) => !v); // 이동 없이 탭 = 클릭으로 처리
    }
  };

  // 영속화 — 영속 셸 마운트로 페이지 이동에는 이미 유지되지만, 혹시 모를 remount/새로고침에도
  //   열림 상태·선택 채널을 복원해 "이동해도 유지" 를 확실히 보장. (SSR 하이드레이션 충돌 방지 위해 useEffect 에서 복원)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("messenger:open") === "1");
      const ch = localStorage.getItem("messenger:channel");
      if (ch) setSelected(ch);
      const p = localStorage.getItem("messenger:pos");
      if (p) { const o = JSON.parse(p); if (typeof o?.x === "number" && typeof o?.y === "number") setPos(clampPos(o.x, o.y)); }
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

  // FAB 가 드래그됐으면 팝업 패널도 FAB 근처로 따라감(기본은 우하단 고정).
  const panelStyle = pos ? (() => {
    const W = 380, H = 560, gap = 12;
    let left = pos.x + FAB - W;            // FAB 우측 모서리에 패널 우측 정렬
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    let top = pos.y - H - gap;             // FAB 위로 펼침
    if (top < 8) top = pos.y + FAB + gap;  // 위 공간 부족 → 아래로
    top = Math.max(8, Math.min(top, window.innerHeight - H - 8));
    return { left, top } as const;
  })() : null;

  return (
    <div className="hidden md:block">
      {/* 팝업 패널 */}
      {open && (
        <div className={`messenger-panel ${panelStyle ? "" : "bottom-24 right-6"}`}
          style={{ background: "var(--glass-bg)", boxShadow: "0 24px 60px rgba(0,0,0,0.22)", ...(panelStyle || {}) }}>
          {/* 헤더 — 우측 원형 버튼. 색은 테마 토큰(라이트=밝게/다크=어둡게 자동 전환) */}
          <div className="messenger-header">
            {selected && (
              <button onClick={() => setSelected(null)} title="채널 목록" className="messenger-back-btn">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
            <span className="messenger-title">
              {selectedChannel ? `${selectedChannel.is_dm ? "@" : "#"} ${selectedChannel.is_dm ? (selectedChannel.dm_name || "1:1 대화") : selectedChannel.name}` : "# 메신저"}
            </span>
            <button onClick={openFull} title="전체화면" className="messenger-fullscreen-btn">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>
            </button>
            <button onClick={() => setOpen(false)} title="닫기" className="messenger-close-btn">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {/* 본문: 선택 시 채팅방, 미선택 시 채널 목록 */}
          {selected ? (
            <ChatRoomView channelId={selected} embedded compact onBack={() => setSelected(null)} />
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="messenger-search-row">
                <div className="flex items-center gap-2">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="채널 검색"
                    className="messenger-search-input" />
                  <button onClick={() => { setCreating((v) => !v); setNewName(""); }} title="새 채널 만들기"
                    className="messenger-new-channel-btn">
                    {creating ? "×" : "+"}
                  </button>
                </div>
                {creating && (
                  <div className="messenger-create-row">
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newName.trim() && !createMut.isPending) createMut.mutate(); }}
                      placeholder="새 채널 이름"
                      className="messenger-create-input" />
                    <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
                      className="messenger-create-submit">
                      {createMut.isPending ? "생성중" : "만들기"}
                    </button>
                  </div>
                )}
              </div>
              <div className="messenger-channel-list">
                {([["프로젝트", matched.deal], ["팀", matched.team], ["1:1", matched.dm]] as [string, any[]][]).map(([title, list]) =>
                  list.length === 0 ? null : (
                    <div key={title} className="messenger-channel-group">
                      <div className="messenger-channel-group-label">{title} {list.length}</div>
                      <div className="messenger-channel-group-items">
                        {list.map((ch) => (
                          <ChannelButton key={ch.id} ch={ch} unread={unreadMap?.get(ch.id) || 0} onClick={() => setSelected(ch.id)} />
                        ))}
                      </div>
                    </div>
                  )
                )}
                {channels.length === 0 && (
                  <div className="messenger-empty">채널이 없습니다. 위 + 버튼으로 새 채널을 만들어 보세요.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 런처 FAB */}
      <button
        ref={fabRef}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        aria-label="메신저 열기 (드래그로 이동)"
        title="드래그해서 위치를 옮길 수 있어요"
        className={`messenger-fab ${pos ? "" : "bottom-6 right-6"}`}
        style={{ background: "linear-gradient(135deg, #4338ca, #6366f1)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", ...(pos ? { left: pos.x, top: pos.y } : {}) }}
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        )}
        {!open && totalUnread > 0 && (
          <span className="messenger-fab-badge">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
