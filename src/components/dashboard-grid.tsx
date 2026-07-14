"use client";

// 위젯식 대시보드 그리드 — react-grid-layout(비반응형 GridLayout, 완전 controlled) 기반 자유 배치(2026-07-14).
//   편집 모드: 드래그로 아무 위치 이동(격자 스냅) + 모서리 드래그로 크기 조절, 세로 자동 압축(빈칸 자동 정렬).
//   단일 layout 배열을 상태로 관리(드롭이 원위치로 튕기던 문제 해결). 레이아웃 회사별 localStorage 저장.

import { useState, useEffect } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const RGL = WidthProvider(GridLayout);

export type DashWidget = { id: string; node: React.ReactNode; w?: number; h?: number };

function buildDefault(widgets: DashWidget[]): Layout[] {
  return widgets.map((w, i) => ({
    i: w.id, x: (i % 3) * 4, y: Math.floor(i / 3) * (w.h || 6), w: w.w || 4, h: w.h || 6, minW: 3, minH: 2,
  }));
}

export function DashboardGrid({ widgets, storageKey, title = "" }: { widgets: DashWidget[]; storageKey: string; title?: string }) {
  const [edit, setEdit] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout[]>(() => buildDefault(widgets));

  const widgetIds = widgets.map((w) => w.id).join(",");

  // 저장된 레이아웃 로드 + 신규/삭제 위젯 머지 (widget 구성 바뀌면 재계산)
  useEffect(() => {
    const def = buildDefault(widgets);
    let base: Layout[] = def;
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(raw)) {
        const savedIds = new Set(raw.map((l: Layout) => l.i));
        const validIds = new Set(widgets.map((w) => w.id));
        base = [...raw.filter((l: Layout) => validIds.has(l.i)), ...def.filter((d) => !savedIds.has(d.i))];
      }
    } catch { /* noop */ }
    setLayout(base);
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, widgetIds]);

  const onLayoutChange = (l: Layout[]) => {
    setLayout(l);
    if (mounted) { try { localStorage.setItem(storageKey, JSON.stringify(l)); } catch { /* noop */ } }
  };
  const reset = () => { setLayout(buildDefault(widgets)); try { localStorage.removeItem(storageKey); } catch { /* noop */ } };

  // 현재 배치를 JSON으로 복사 — 앱 기본값(buildDefault)으로 하드코딩할 때 사용
  const [copied, setCopied] = useState(false);
  const copyLayout = async () => {
    const json = JSON.stringify(layout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("아래 값을 복사하세요", json); }
  };

  const Header = (
    <div className="dash-section-head flex items-start justify-between gap-2 mb-3">
      <div>
        {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
        {edit && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">카드를 드래그해 원하는 위치로 · 우하단 모서리를 드래그해 크기 조절 (빈칸 자동 정렬 · 자동 저장)</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {edit && <button onClick={copyLayout} className="btn-secondary btn-sm">{copied ? "복사됨!" : "📋 배치 복사"}</button>}
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
        layout={layout}
        cols={12}
        rowHeight={44}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={edit}
        isResizable={edit}
        compactType="vertical"
        onLayoutChange={onLayoutChange}
        draggableCancel=".no-drag"
        resizeHandles={["s", "w", "e", "n", "sw", "nw", "se", "ne"]}
      >
        {widgets.map((w) => (
          <div key={w.id} className={edit ? "rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/60" : ""}>
            {/* 흰색 카드가 셀을 채우되(min-h-full), 넘치면 잘리지 않고 스크롤(overflow-auto) */}
            <div className={`h-full overflow-auto [&>*]:min-h-full ${edit ? "pointer-events-none select-none" : ""}`}>{w.node}</div>
          </div>
        ))}
      </RGL>
    </div>
  );
}
