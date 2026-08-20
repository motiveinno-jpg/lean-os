"use client";

// 메신저 런처 (2026-06-22 → 2026-08-10 개편)
//
//   예전: 버튼을 누르면 화면 우하단에 **붙박이 패널**이 펼쳐졌다. 브라우저 안에만 있어서
//         최소화도, 최대화도, 다른 모니터로 빼는 것도 안 됐다.
//   지금(사장님 지시): 버튼을 누르면 **진짜 새 창**으로 열린다 — 최소화·최대화·창 밖 이동은
//         운영체제 창 컨트롤이 그대로 해 준다. 사이드바 '새 창으로 열기' 와 같은 길
//         (PopupProvider.openDetached → window.open(`/chat?embed=1`))을 쓴다.
//         창 이름이 라우트로 고정돼 있어 다시 눌러도 창이 하나다(그 창이 앞으로 온다).
//   팝업 차단이면 인앱 플로팅 창으로 폴백된다 — 그 창에도 최소화·최대화·드래그·리사이즈와
//         '새 창으로 분리' 가 붙어 있어 차단된 상태에서도 요구가 지켜진다.
//
//   · 데스크톱 전용: 모바일은 좁아 부적합 → 하단탭 '메신저'(/chat) 사용 (hidden md:block).
//   · /chat 페이지에서는 중복 방지로 런처 숨김.
//   · 런처는 안읽음 배지를 위해 닫혀 있어도 30초마다 합계만 폴링한다(가벼움).

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser, getUnreadCounts } from "@/lib/queries";
import { usePopups } from "@/components/popup-windows";

//   메신저 창 크기 — **아이콘 · 채팅방 목록 · 대화창 세 칸이 한 번에 보이게** 연다
//   (2026-08-10 사장님 지시, Teams 화면 기준). 좁게 열면 방을 열 때 목록이 접혀 두 칸이 된다.
const WIN_W = 1040;
const WIN_H = 780;

export function FloatingMessenger() {
  const pathname = usePathname();
  const popups = usePopups();
  // 런처 FAB 드래그 위치(뷰포트 좌상단 px). null = 기본(우하단 고정).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const FAB = 56; // w-14 h-14
  const clampPos = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - FAB - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - FAB - 8)),
  });

  const openWindow = () => {
    //   화면이 작으면 화면에 맞춘다(창이 모니터 밖으로 나가지 않게)
    const w = Math.min(WIN_W, Math.max(360, window.innerWidth - 60));
    const h = Math.min(WIN_H, Math.max(480, window.innerHeight - 40));
    popups?.openDetached("/chat", "메신저", { w, h });
  };

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
        if (p) { try { localStorage.setItem("messenger:pos", JSON.stringify(p)); } catch { /* 무시 */ } }
        return p;
      });
    } else {
      openWindow(); // 이동 없이 탭 = 클릭으로 처리
    }
  };

  //   런처 위치 복원 — SSR 하이드레이션 충돌을 피해 마운트 뒤에 읽는다
  useEffect(() => {
    try {
      const p = localStorage.getItem("messenger:pos");
      if (p) { const o = JSON.parse(p); if (typeof o?.x === "number" && typeof o?.y === "number") setPos(clampPos(o.x, o.y)); }
    } catch { /* 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: me } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => getCurrentUser(),
    staleTime: 60_000,
  });
  const companyId = me?.company_id ?? null;
  const userId = me?.id ?? null;

  // 안읽음 합계는 런처 배지에 항상 필요 → 창이 닫혀 있어도 폴링(합계만이라 가볍다).
  const { data: unreadMap, refetch: refetchUnread } = useQuery({
    queryKey: ["chat-unread", companyId, userId],
    queryFn: () => getUnreadCounts(companyId!, userId!),
    enabled: !!companyId && !!userId,
    refetchInterval: 30_000,
  });

  // 메신저는 새 창으로 뜬다 — 그 창에서 읽으면 여기(원래 창) 뱃지도 바로 지워져야 한다.
  //   다른 창의 localStorage 쓰기는 이 창에서 storage 이벤트로 잡힌다 (2026-08-20 사장님 제보:
  //   "읽어도 답장하기 전까지 알림이 떠있다"). 창이 다시 앞으로 올 때도 한 번 더 확인한다.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "ov:chat:read") refetchUnread(); };
    const onFocus = () => refetchUnread();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); };
  }, [refetchUnread]);
  const totalUnread = useMemo(
    () => (unreadMap ? Array.from(unreadMap.values()).reduce((s: number, v: number) => s + v, 0) : 0),
    [unreadMap]
  );

  // /chat 풀페이지에서는 런처 숨김(중복). 모바일은 CSS(hidden md:block)로 숨김.
  if (pathname?.startsWith("/chat")) return null;

  return (
    <div className="hidden md:block">
      <button
        ref={fabRef}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        aria-label="메신저 새 창으로 열기"
        title="메신저를 새 창으로 엽니다 — 드래그하면 이 단추 위치를 옮길 수 있어요"
        className={`messenger-fab ${pos ? "" : "bottom-6 right-6"}`}
        style={{ background: "linear-gradient(135deg, #4338ca, #6366f1)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", ...(pos ? { left: pos.x, top: pos.y } : {}) }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        {totalUnread > 0 && (
          <span className="messenger-fab-badge">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
