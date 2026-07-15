"use client";

// 위젯식 대시보드 그리드 — react-grid-layout(비반응형 GridLayout, 완전 controlled) 기반 자유 배치(2026-07-14).
//   편집 모드: 8방향 드래그 리사이즈 + 아무 위치 드래그 이동(격자 스냅) + 세로 자동 압축. 회사/유저별 localStorage 저장.
//   렌더 시 모든 위젯에 항상 레이아웃 항목 보장 → 데이터 로딩으로 위젯이 잠깐 빠졌다 돌아올 때 RGL이 h=1로
//   자동생성/저장하며 최소 크기로 줄어들던 버그 방지. 위젯별 기본 위치(x/y/w/h)는 DashWidget 으로 지정 가능.

import { useState, useEffect, useMemo } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const RGL = WidthProvider(GridLayout);

export type DashWidget = { id: string; node: React.ReactNode; x?: number; y?: number; w?: number; h?: number };

function buildDefault(widgets: DashWidget[]): Layout[] {
  return widgets.map((w, i) => ({
    i: w.id,
    x: w.x ?? (i % 3) * 4,
    y: w.y ?? Math.floor(i / 3) * (w.h || 6),
    w: w.w || 4, h: w.h || 6, minW: 3, minH: 2,
  }));
}

export function DashboardGrid({ widgets, storageKey, title = "" }: { widgets: DashWidget[]; storageKey: string; title?: string }) {
  const [edit, setEdit] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout[]>([]); // 저장된 레이아웃(현재 없는 위젯 항목도 보존)
  const [copied, setCopied] = useState(false);

  const widgetIds = widgets.map((w) => w.id).join(",");

  useEffect(() => {
    try { const raw = JSON.parse(localStorage.getItem(storageKey) || "null"); if (Array.isArray(raw)) setLayout(raw); } catch { /* noop */ }
    setMounted(true);
  }, [storageKey]);

  // 렌더용 레이아웃 — 현재 위젯마다 항상 항목 보장(저장분 우선, 없으면 기본값). RGL h=1 자동생성 방지.
  const effective = useMemo(() => {
    const saved = Object.fromEntries(layout.map((l) => [l.i, l]));
    const def = Object.fromEntries(buildDefault(widgets).map((l) => [l.i, l]));
    return widgets.map((w) => saved[w.id] || def[w.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, widgetIds]);

  const onLayoutChange = (l: Layout[]) => {
    if (!mounted) return;
    setLayout((prev) => {
      const map: Record<string, Layout> = Object.fromEntries(prev.map((x) => [x.i, x]));
      for (const it of l) map[it.i] = { i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: it.minW, minH: it.minH };
      const next = Object.values(map);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };
  const reset = () => { setLayout([]); try { localStorage.removeItem(storageKey); } catch { /* noop */ } };
  const copyLayout = async () => {
    const json = JSON.stringify(effective.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("아래 값을 복사하세요", json); }
  };

  const Header = (
    <div className="dash-section-head flex items-start justify-between gap-2 mb-3">
      <div>
        {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
        {edit && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">카드를 드래그해 원하는 위치로 · 모서리/가장자리를 드래그해 크기 조절 (빈칸 자동 정렬 · 자동 저장)</p>}
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
        layout={effective}
        cols={12}
        rowHeight={44}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={edit}
        isResizable={edit}
        compactType="vertical"
        onLayoutChange={onLayoutChange}
        draggableCancel=".no-drag"
        // 하단·우측 핸들만 사용(s/e/se). 상단·좌측(n/w/nw/ne/sw) 핸들은 리사이즈 시 x/y까지
        // 이동시켜 vertical 압축과 충돌 → "다른 위치 위젯이 리사이즈/축소"되는 RGL 고질 버그를 유발.
        // 아래·오른쪽 핸들은 폭/높이만 키워 위치 이동이 없어 이웃 위젯에 영향 없음.
        resizeHandles={["s", "e", "se"]}
      >
        {widgets.map((w) => (
          <div key={w.id} className={edit ? "rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/60" : ""}>
            <div className={`h-full overflow-auto [&>*]:min-h-full ${edit ? "pointer-events-none select-none" : ""}`}>{w.node}</div>
          </div>
        ))}
      </RGL>
    </div>
  );
}
