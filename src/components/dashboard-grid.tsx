"use client";

// 위젯식 대시보드 그리드 — 편집 모드에서 드래그로 위치 이동 + [크기] 버튼으로 넓이 조절, 레이아웃 자동 저장(2026-07-14).
//   무거운 그리드 라이브러리 없이 CSS grid(dense flow) + 네이티브 드래그로 구현. localStorage 회사별 저장.

import { useState, useEffect, useRef } from "react";

export type DashWidget = { id: string; node: React.ReactNode };

// 넓이(컬럼 스팬) — md 2열/xl 3열 기준. 1=좁게, 2=중간, 3=넓게(full)
const SIZE_CLS: Record<number, string> = {
  1: "md:col-span-1 xl:col-span-1",
  2: "md:col-span-2 xl:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
};

export function DashboardGrid({ widgets, storageKey, title = "" }: { widgets: DashWidget[]; storageKey: string; title?: string }) {
  const ids = widgets.map((w) => w.id);
  const [edit, setEdit] = useState(false);
  const [order, setOrder] = useState<string[]>(ids);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const dragId = useRef<string | null>(null);

  // localStorage 로드 (SSR 안전: 최초엔 기본 순서)
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (Array.isArray(raw.order)) {
        const kept = raw.order.filter((id: string) => ids.includes(id));
        const added = ids.filter((id) => !kept.includes(id));
        setOrder([...kept, ...added]);
      }
      if (raw.sizes && typeof raw.sizes === "object") setSizes(raw.sizes);
    } catch { /* noop */ }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ order, sizes })); } catch { /* noop */ }
  }, [order, sizes, hydrated, storageKey]);

  const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));
  const ordered = order.filter((id) => byId[id]);

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    setOrder((prev) => {
      const a = [...prev];
      const fi = a.indexOf(from), ti = a.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      a.splice(fi, 1);
      a.splice(ti, 0, from);
      return a;
    });
  };
  const cycleSize = (id: string) => setSizes((prev) => ({ ...prev, [id]: ((prev[id] || 1) % 3) + 1 }));
  const resetLayout = () => { setOrder(ids); setSizes({}); };

  return (
    <div className="dashboard-grid">
      <div className="dash-section-head flex items-center justify-between gap-2">
        <div>
          {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
          {edit && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">카드를 드래그해 위치 이동 · [크기] 버튼으로 넓이 조절 (자동 저장)</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {edit && <button onClick={resetLayout} className="btn-secondary btn-sm">기본값</button>}
          <button onClick={() => setEdit((v) => !v)} className={`btn-sm ${edit ? "btn-primary" : "btn-secondary"}`}>
            {edit ? "✓ 편집 완료" : "⠿ 위젯 편집"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 [grid-auto-flow:dense]">
        {ordered.map((id) => {
          const w = byId[id];
          const size = sizes[id] || 1;
          return (
            <div
              key={id}
              className={`${SIZE_CLS[size]} ${edit ? "relative rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/50 cursor-grab active:cursor-grabbing" : ""}`}
              draggable={edit}
              onDragStart={() => { dragId.current = id; }}
              onDragOver={(e) => { if (edit) { e.preventDefault(); if (dragId.current && dragId.current !== id) reorder(dragId.current, id); } }}
              onDragEnd={() => { dragId.current = null; }}
            >
              {edit && (
                <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
                  <button onClick={() => cycleSize(id)} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--primary)] text-white font-semibold shadow-sm" title="넓이 조절(좁게↔넓게)">크기 {size}</button>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-sm" title="드래그해서 이동">⠿</span>
                </div>
              )}
              <div className={edit ? "pointer-events-none select-none" : ""}>{w.node}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
