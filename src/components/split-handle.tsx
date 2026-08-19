"use client";

// 영역 나누는 선을 잡아끌어 높이 조절 — 일반전표(분개 입력 ↔ 전표 목록) · 매입매출전표(격자 ↔ 분개) (2026-08-19 사장님:
//   "분개 영역을 더 넓게 보고 싶을 경우 자체적으로 조절해가면서 쓸 수 있게").
//   높이는 이 PC 브라우저에 기억(localStorage) — 화면 취향은 사용자 값. 선을 두 번 누르면 기본으로.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export function useDragHeight(storageKey: string, opts: { min: number; max?: number; /** 손잡이가 영역 **위**에 있으면(아래로 끌면 줄어듦) true */ invert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeightState] = useState<number | null>(null);
  //   최신 값은 ref 로도 든다 — mouseup 저장이 setState 갱신자 안에서 돌면 두 번 누르기(기본으로)보다 늦게 실행돼 지운 값을 되살렸다
  const latest = useRef<number | null>(null);
  const setHeight = useCallback((v: number | null) => { latest.current = v; setHeightState(v); }, []);
  useEffect(() => { try { const v = localStorage.getItem(storageKey); if (v) setHeight(Math.max(opts.min, Number(v))); } catch { /* 저장 못 해도 동작 */ } }, [storageKey, opts.min, setHeight]);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const start = height ?? ref.current?.getBoundingClientRect().height ?? opts.min;
    const maxH = opts.max ?? Math.round(window.innerHeight * 0.8);
    document.body.classList.add("split-dragging");
    const move = (ev: MouseEvent) => {
      const d = (ev.clientY - startY) * (opts.invert ? -1 : 1);
      setHeight(Math.min(maxH, Math.max(opts.min, Math.round(start + d))));
    };
    const up = () => {
      document.body.classList.remove("split-dragging");
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      try { if (latest.current != null) localStorage.setItem(storageKey, String(latest.current)); } catch { /* */ }
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }, [height, opts.min, opts.max, opts.invert, storageKey, setHeight]);
  const reset = useCallback(() => { setHeight(null); try { localStorage.removeItem(storageKey); } catch { /* */ } }, [storageKey, setHeight]);
  return { ref: ref as RefObject<HTMLDivElement | null>, height, onMouseDown, reset };
}

/** 잡아끄는 선 — 가운데 짧은 손잡이 표시. 두 번 누르면 기본 높이로 */
export function SplitHandle({ onMouseDown, onReset, title = "끌어서 높이 조절 · 두 번 누르면 기본으로" }: { onMouseDown: (e: React.MouseEvent) => void; onReset: () => void; title?: string }) {
  return (
    <div role="separator" aria-orientation="horizontal" title={title} className="split-handle no-print" onMouseDown={onMouseDown} onDoubleClick={onReset}>
      <span className="split-handle-grip" />
    </div>
  );
}
