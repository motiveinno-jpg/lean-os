"use client";

// 위젯식 대시보드 그리드 — react-grid-layout 기반 자유 배치(2026-07-14 개편).
//   편집 모드: 드래그로 아무 위치 이동(작은 격자에 스냅) + 모서리 드래그로 크기 조절, 세로 자동 압축(빈칸 자동 정렬).
//   레이아웃은 회사별 localStorage 자동 저장. RGL 1.5(nodeRef)로 React 19 호환.

import { useState, useEffect } from "react";
import { Responsive, WidthProvider, type Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const RGL = WidthProvider(Responsive);

export type DashWidget = { id: string; node: React.ReactNode; w?: number; h?: number };

export function DashboardGrid({ widgets, storageKey, title = "" }: { widgets: DashWidget[]; storageKey: string; title?: string }) {
  const [edit, setEdit] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layouts, setLayouts] = useState<Layouts>({});

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (raw && typeof raw === "object") setLayouts(raw as Layouts);
    } catch { /* noop */ }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const onLayoutChange = (_cur: unknown, all: Layouts) => {
    if (!mounted) return;
    setLayouts(all);
    try { localStorage.setItem(storageKey, JSON.stringify(all)); } catch { /* noop */ }
  };
  const reset = () => { setLayouts({}); try { localStorage.removeItem(storageKey); } catch { /* noop */ } };

  const Header = (
    <div className="dash-section-head flex items-center justify-between gap-2">
      <div>
        {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
        {edit && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">카드를 드래그해 원하는 위치로 · 모서리를 드래그해 크기 조절 (빈칸 자동 정렬 · 자동 저장)</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {edit && <button onClick={reset} className="btn-secondary btn-sm">기본값</button>}
        <button onClick={() => setEdit((v) => !v)} className={`btn-sm ${edit ? "btn-primary" : "btn-secondary"}`}>
          {edit ? "✓ 편집 완료" : "⠿ 위젯 편집"}
        </button>
      </div>
    </div>
  );

  // 마운트 전(SSR/첫 페인트): 일반 그리드로 스택 — 레이아웃 점프 방지
  if (!mounted) {
    return (
      <div className="dashboard-grid">
        {Header}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {widgets.map((w) => <div key={w.id}>{w.node}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-grid ${edit ? "rgl-editing" : ""}`}>
      {Header}
      <RGL
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1024, md: 640, sm: 0 }}
        cols={{ lg: 12, md: 8, sm: 2 }}
        rowHeight={44}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={edit}
        isResizable={edit}
        compactType="vertical"
        onLayoutChange={onLayoutChange}
        draggableCancel="a,button,input,select,label,.no-drag"
      >
        {widgets.map((w, i) => (
          <div
            key={w.id}
            data-grid={{ x: (i % 3) * 4, y: Math.floor(i / 3) * (w.h || 5), w: w.w || 4, h: w.h || 5, minW: 3, minH: 2 }}
            className={edit ? "rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/60" : ""}
          >
            {/* 흰색 카드가 셀 높이를 채우되(h-full), 콘텐츠가 넘치면 잘리지 않고 스크롤(overflow-auto) */}
            <div className={`h-full overflow-auto [&>*]:min-h-full ${edit ? "pointer-events-none select-none" : ""}`}>{w.node}</div>
          </div>
        ))}
      </RGL>
    </div>
  );
}
