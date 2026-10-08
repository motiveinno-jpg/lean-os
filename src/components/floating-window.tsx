"use client";

// ── 떠 있는 팝업 창 — 끌어서 옮기고, 여러 개 겹쳐 열고, 누르면 맨 위로 ("상단 기능들 팝업으로") ──
//   판(dropdown)이 아니라 창이다: 화면 어디로든 옮기고, 다른 곳을 눌러도 안 닫힌다(✕ 로만). 위치는 화면 안에 머문다.
//   z-index 는 모듈 카운터 — 누른 창이 맨 위.
//   resizable 이면 오른쪽 아래 모서리를 끌어 가로·세로를 함께 바꾼다(대각선). storageKey 가 있으면 크기를 기억한다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

let zTop = 1200;
const nextZ = () => ++zTop;

type Resizable = { minW?: number; minH?: number; storageKey?: string };
type Size = { w: number; h: number | null };

function readSize(key?: string): Size | null {
  if (!key) return null;
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v && Number(v.w) > 0 ? { w: Number(v.w), h: Number(v.h) > 0 ? Number(v.h) : null } : null; } catch { return null; }
}

export function FloatingWindow({ title, onClose, children, initial, width = 340, className = "", headExtra, resizable }: {
  title: ReactNode; onClose: () => void; children: ReactNode;
  initial?: { x: number; y: number }; width?: number; className?: string; headExtra?: ReactNode;
  resizable?: Resizable;
}) {
  //   ★ 창에 CSS zoom 을 주면 left/top 도 zoom 배로 찍힌다 — 좌표는 전부 '÷ zoom' 한 공간에서 계산한다 (안 그러면 오른쪽 창이 화면 밖으로 나간다)
  const zoom = () => { const el = document.querySelector<HTMLElement>(".app-zoom"); const v = el ? parseFloat(getComputedStyle(el).zoom || "1") : 1; return Number.isFinite(v) && v > 0 ? v : 1; };
  const [pos, setPos] = useState(() => { const zf = zoom(); return initial || { x: Math.max(16, window.innerWidth / zf - width - 40), y: 80 }; });
  const [z, setZ] = useState(nextZ);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [size, setSize] = useState<Size>(() => readSize(resizable?.storageKey) || { w: width, h: null });
  const rs = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    const r = boxRef.current?.getBoundingClientRect(); if (!r) return;
    const zf = zoom();
    drag.current = { dx: e.clientX / zf - r.left / zf, dy: e.clientY / zf - r.top / zf };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setZ(nextZ());
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const zf = zoom();
    const w = boxRef.current?.offsetWidth || width;
    const x = Math.min(Math.max(0, e.clientX / zf - drag.current.dx), window.innerWidth / zf - Math.min(w, 120));
    const y = Math.min(Math.max(0, e.clientY / zf - drag.current.dy), window.innerHeight / zf - 40);
    setPos({ x, y });
  };
  const onUp = () => { drag.current = null; };

  //   모서리 끌기 — 시작점에서 움직인 만큼 폭·높이를 같이 바꾼다. 화면 밖으로는 못 넘긴다.
  const onResizeDown = (e: React.PointerEvent) => {
    const box = boxRef.current; if (!box) return;
    e.preventDefault(); e.stopPropagation();
    const zf = zoom();
    rs.current = { x: e.clientX / zf, y: e.clientY / zf, w: box.offsetWidth, h: box.offsetHeight };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setZ(nextZ());
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const s0 = rs.current; if (!s0) return;
    const zf = zoom();
    const minW = resizable?.minW ?? 220, minH = resizable?.minH ?? 160;
    const maxW = Math.max(minW, window.innerWidth / zf - pos.x - 8), maxH = Math.max(minH, window.innerHeight / zf - pos.y - 8);
    setSize({
      w: Math.round(Math.min(maxW, Math.max(minW, s0.w + (e.clientX / zf - s0.x)))),
      h: Math.round(Math.min(maxH, Math.max(minH, s0.h + (e.clientY / zf - s0.y)))),
    });
  };
  const onResizeUp = () => {
    if (!rs.current) return;
    rs.current = null;
    if (resizable?.storageKey) { try { localStorage.setItem(resizable.storageKey, JSON.stringify(size)); } catch { /* 기억만 못 할 뿐 */ } }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && z === zTop) onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [z, onClose]);
  if (typeof document === "undefined") return null;
  //   body 에 붙는 창은 zoom 밖이라 앱 글자 크기와 같게 zoom 을 따로 준다
  return createPortal(
    <div ref={boxRef} className={`fw ${resizable ? "fw-resizable" : ""} ${resizable && size.h ? "fw-sized" : ""} ${className}`}
      style={{ left: pos.x, top: pos.y, width: resizable ? size.w : width, ...(resizable && size.h ? { height: size.h, maxHeight: "none" } : {}), zIndex: z, zoom: zoom() }}
      onMouseDown={() => setZ(nextZ())}>
      <div className="fw-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <b className="fw-title">{title}</b>
        {headExtra}
        <button type="button" className="fw-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="fw-body">{children}</div>
      {resizable && (
        <span className="fw-resize" role="separator" aria-label="창 크기 조절 — 끌어서 가로·세로 크기 바꾸기" title="끌어서 크기 조절"
          onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} onPointerCancel={onResizeUp} />
      )}
    </div>,
    document.body,
  );
}
