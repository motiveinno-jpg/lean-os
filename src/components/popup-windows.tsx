"use client";

// 팝업 창(메뉴 팝업) — 사이드바 메뉴를 현재 페이지 위 플로팅 창으로 열어 사용(2026-07-15).
//   각 메뉴 라우트를 `?embed=1` iframe 으로 담아(셸 크롬 숨김) 리팩터 없이 그대로 표시.
//   창: 드래그 이동 + 우하단 리사이즈 + 최소화/최대화/닫기. 셸에 상주(PopupProvider)해 페이지 이동에도 유지.
//   데스크톱 전용(모바일은 일반 링크 이동).

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

type Win = {
  id: string; href: string; title: string;
  min: boolean; max: boolean;
  x: number; y: number; w: number; h: number; z: number;
};

type Ctx = {
  wins: Win[];
  dragging: boolean;
  setDragging: (v: boolean) => void;
  open: (href: string, title: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  toggleMin: (id: string) => void;
  restore: (id: string) => void;
  toggleMax: (id: string) => void;
  setRect: (id: string, r: Partial<Pick<Win, "x" | "y" | "w" | "h">>) => void;
};

const PopupCtx = createContext<Ctx | null>(null);
export const usePopups = () => useContext(PopupCtx);

let seq = 0;

export function PopupProvider({ children }: { children: React.ReactNode }) {
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const zRef = useRef(60);

  const focus = useCallback((id: string) => {
    zRef.current += 1;
    const z = zRef.current;
    setWins((prev) => prev.map((w) => (w.id === id ? { ...w, z } : w)));
  }, []);

  const open = useCallback((href: string, title: string) => {
    zRef.current += 1;
    const z = zRef.current;
    setWins((prev) => {
      const ex = prev.find((w) => w.href === href);
      if (ex) return prev.map((w) => (w.id === ex.id ? { ...w, min: false, z } : w));
      const i = prev.length;
      const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
      const vh = typeof window !== "undefined" ? window.innerHeight : 900;
      const w = Math.min(820, Math.round(vw * 0.62));
      const h = Math.min(600, Math.round(vh * 0.7));
      const x = Math.round(vw * 0.28) + (i % 5) * 34;
      const y = 96 + (i % 5) * 34;
      return [...prev, { id: `pw-${++seq}`, href, title, min: false, max: false, x, y, w, h, z }];
    });
  }, []);

  const close = useCallback((id: string) => setWins((prev) => prev.filter((w) => w.id !== id)), []);
  const toggleMin = useCallback((id: string) => setWins((prev) => prev.map((w) => (w.id === id ? { ...w, min: !w.min } : w))), []);
  const restore = useCallback((id: string) => {
    zRef.current += 1; const z = zRef.current;
    setWins((prev) => prev.map((w) => (w.id === id ? { ...w, min: false, z } : w)));
  }, []);
  const toggleMax = useCallback((id: string) => setWins((prev) => prev.map((w) => (w.id === id ? { ...w, max: !w.max } : w))), []);
  const setRect = useCallback((id: string, r: Partial<Pick<Win, "x" | "y" | "w" | "h">>) =>
    setWins((prev) => prev.map((w) => (w.id === id ? { ...w, ...r } : w))), []);

  return (
    <PopupCtx.Provider value={{ wins, dragging, setDragging, open, close, focus, toggleMin, restore, toggleMax, setRect }}>
      {children}
    </PopupCtx.Provider>
  );
}

// ── 창 하나 ──
function PopupWindow({ win }: { win: Win }) {
  const ctx = usePopups()!;
  const { close, focus, toggleMin, toggleMax, setRect, setDragging } = ctx;
  const modeRef = useRef<null | "move" | "resize">(null);
  const startRef = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0 });

  const begin = (mode: "move" | "resize") => (e: React.MouseEvent) => {
    if (win.max && mode === "resize") return;
    e.preventDefault();
    if (mode === "resize") e.stopPropagation();
    focus(win.id);
    modeRef.current = mode;
    startRef.current = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    setDragging(true);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!modeRef.current) return;
      const s = startRef.current;
      const dx = e.clientX - s.mx, dy = e.clientY - s.my;
      if (modeRef.current === "move") {
        const vw = window.innerWidth, vh = window.innerHeight;
        setRect(win.id, { x: Math.min(Math.max(0, s.x + dx), vw - 80), y: Math.min(Math.max(0, s.y + dy), vh - 40) });
      } else {
        setRect(win.id, { w: Math.max(380, s.w + dx), h: Math.max(260, s.h + dy) });
      }
    };
    const onUp = () => { if (modeRef.current) { modeRef.current = null; setDragging(false); } };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.id]);

  // 새 OS 창으로 분리 — window.open 은 진짜 브라우저 창이라 모니터 밖·다른 화면까지 이동 가능(OS 창 컨트롤 제공).
  const detach = (w: Win) => {
    const width = w.max ? 1024 : w.w;
    const height = w.max ? 720 : w.h;
    const left = (window.screenX || 0) + (w.max ? 60 : w.x);
    const top = (window.screenY || 0) + (w.max ? 60 : w.y) + 72; // 대략 브라우저 크롬 높이 보정
    const feat = `popup=yes,noopener=no,width=${width},height=${height},left=${Math.max(0, left)},top=${Math.max(0, top)}`;
    const wref = window.open(`${w.href}?embed=1`, `ovpop-${w.id}`, feat);
    if (wref) close(w.id); // 성공 시 인앱 팝업 닫음. 차단되면(null) 인앱 팝업 유지.
    else alert("팝업 차단으로 새 창을 열 수 없습니다. 브라우저 팝업 허용 후 다시 시도해주세요.");
  };

  if (win.min) return null;

  const style: React.CSSProperties = win.max
    ? { left: 12, top: 12, right: 12, bottom: 12, zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  const iframePE = ctx.dragging ? "none" : "auto";

  return (
    <div className="popup-win fixed rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] flex flex-col shadow-2xl"
      style={style} onMouseDown={() => focus(win.id)}>
      {/* 타이틀바 */}
      <div className="popup-titlebar flex items-center gap-1 h-9 pl-3 pr-1.5 bg-[var(--bg-surface)] border-b border-[var(--border)] cursor-move select-none shrink-0"
        onMouseDown={begin("move")} onDoubleClick={() => toggleMax(win.id)}>
        <span className="text-[12px] font-bold text-[var(--text)] truncate flex-1">{win.title}</span>
        <button onClick={() => detach(win)} title="새 창으로 분리 (브라우저 밖으로 이동 가능)"
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--primary)] transition">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7" /><path d="M21 3l-9 9" /><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" /></svg>
        </button>
        <button onClick={() => toggleMin(win.id)} title="최소화"
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] transition">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="5" y1="19" x2="19" y2="19" /></svg>
        </button>
        <button onClick={() => toggleMax(win.id)} title={win.max ? "이전 크기로" : "최대화"}
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] transition">
          {win.max
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="7" width="11" height="11" rx="1.5" /><path d="M4 15V5.5A1.5 1.5 0 015.5 4H15" /></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>}
        </button>
        <button onClick={() => close(win.id)} title="닫기"
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--danger)] hover:text-white transition">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
      {/* 본문 — 라우트를 embed 로 iframe */}
      <div className="flex-1 relative bg-[var(--bg)]">
        <iframe src={`${win.href}?embed=1`} title={win.title}
          className="absolute inset-0 w-full h-full" style={{ border: 0, pointerEvents: iframePE }} />
      </div>
      {/* 우하단 리사이즈 핸들 */}
      {!win.max && (
        <div onMouseDown={begin("resize")} title="크기 조절"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{ background: "linear-gradient(135deg, transparent 50%, var(--text-dim) 50%, var(--text-dim) 60%, transparent 60%, transparent 72%, var(--text-dim) 72%, var(--text-dim) 82%, transparent 82%)" }} />
      )}
    </div>
  );
}

// ── 셸에 상주하는 호스트 — 모든 창 + 최소화 작업표시줄 렌더 ──
export function PopupWindowsHost() {
  const ctx = usePopups();
  if (!ctx) return null;
  const { wins, dragging, restore, close } = ctx;
  if (wins.length === 0) return null;
  const minimized = wins.filter((w) => w.min);

  return (
    <>
      {/* 드래그 중 iframe 이벤트 삼킴 방지 오버레이 */}
      {dragging && <div className="fixed inset-0 z-[59]" style={{ cursor: "grabbing" }} />}
      {wins.map((w) => <PopupWindow key={w.id} win={w} />)}
      {/* 최소화된 창 — 하단 작업표시줄 칩 */}
      {minimized.length > 0 && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[58] flex gap-2 max-w-[92vw] overflow-x-auto">
          {minimized.map((w) => (
            <div key={w.id} className="flex items-center gap-1.5 pl-3 pr-1.5 h-9 rounded-full bg-[var(--bg-card)] border border-[var(--border)] shadow-lg shrink-0">
              <button onClick={() => restore(w.id)} className="text-[12px] font-semibold text-[var(--text)] hover:text-[var(--primary)] transition max-w-[160px] truncate">
                {w.title}
              </button>
              <button onClick={() => close(w.id)} title="닫기"
                className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:bg-[var(--danger)] hover:text-white transition">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
