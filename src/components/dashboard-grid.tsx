"use client";

// 위젯식 대시보드 그리드 — react-grid-layout(비반응형 GridLayout, 완전 controlled) 기반 자유 배치(2026-07-14).
//   편집 모드: 하단·우측 드래그 리사이즈 + 아무 위치 드래그 이동(격자 스냅) + 세로 자동 압축. 회사/유저별 localStorage 저장.
//   2026-07-15 카탈로그 기반 전환: 전체 위젯 카탈로그 + 개인별 활성 목록 관리 → 편집 모드에서 위젯 추가/삭제 자유.
//     · 활성 목록: localStorage `${storageKey}::active` (없으면 defaultActiveIds)
//     · 배치(layout): localStorage `${storageKey}` (현재 없는 위젯 항목도 보존)
//   활성 위젯만 render() 호출 → 비활성 위젯의 쿼리/컴포넌트는 마운트되지 않음(비용 0).
//   2026-07-24 모바일 반응형 수정: cols={12}를 모바일에서는 cols={1}로 조정 → 세로 단일열 레이아웃으로 변경.
//   모바일에서도 편집모드는 유지됨(드래그/리사이즈 불가, 추가/삭제만 가능).

import { useState, useEffect, useMemo } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const RGL = WidthProvider(GridLayout);

// 카탈로그 위젯 정의 — 페이지에서 render 클로저로 페이지 데이터(companyId 등)를 캡처해 전달.
export type CatalogWidget = {
  id: string;
  name: string;               // picker 표시 이름
  icon?: string;              // 이모지
  desc?: string;              // picker 설명
  category?: string;          // picker 그룹
  x?: number; y?: number; w?: number; h?: number; // 기본 배치(기본 활성 위젯용)
  render: () => React.ReactNode;
};

function buildDefault(cat: CatalogWidget[]): Layout[] {
  return cat.map((w, i) => ({
    i: w.id,
    x: w.x ?? (i % 3) * 4,
    // 기본 배치(y) 없는 위젯(=사용자가 나중에 추가)은 맨 아래로 — vertical 압축이 빈자리로 끌어올림.
    y: w.y ?? 1000,
    w: w.w || 4, h: w.h || 4, minW: 3, minH: 2,
  }));
}

export function DashboardGrid({
  storageKey, catalog, defaultActiveIds, title = "", recommended = [], sidebarCollapsed = false,
}: {
  storageKey: string;
  catalog: CatalogWidget[];
  defaultActiveIds: string[];
  title?: string;
  recommended?: string[]; // 지금 신호가 있어 추천하는 위젯 id(비활성일 때만 편집모드 칩·picker 상단 노출)
  sidebarCollapsed?: boolean; // 2026-07-24 사이드바 collapsed 상태 (이 값 변경 시 resize 이벤트 발동)
}) {
  const [edit, setEdit] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout[]>([]);      // 저장된 배치(현재 없는 위젯 항목도 보존)
  const [activeIds, setActiveIds] = useState<string[]>(defaultActiveIds);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);           // 위젯 추가 패널 열림

  const activeKey = `${storageKey}::active`;
  const catMap = useMemo(() => Object.fromEntries(catalog.map((c) => [c.id, c])), [catalog]);
  const catalogIds = catalog.map((c) => c.id).join(",");

  useEffect(() => {
    try { const raw = JSON.parse(localStorage.getItem(storageKey) || "null"); if (Array.isArray(raw)) setLayout(raw); } catch { /* noop */ }
    try {
      const rawA = JSON.parse(localStorage.getItem(activeKey) || "null");
      if (Array.isArray(rawA)) setActiveIds(rawA);
    } catch { /* noop */ }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // 활성 위젯(카탈로그에 존재하는 것만) — 순서 보존.
  const active = useMemo(
    () => activeIds.map((id) => catMap[id]).filter(Boolean) as CatalogWidget[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeIds, catalogIds],
  );

  // 추가 가능한 위젯(현재 비활성) — picker 목록.
  const addable = useMemo(
    () => catalog.filter((c) => !activeIds.includes(c.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeIds, catalogIds],
  );

  // 추천(신호 있음 + 현재 비활성) — 편집모드 칩 + picker 상단.
  const recSet = recommended.join(",");
  const recAddable = useMemo(
    () => addable.filter((c) => recommended.includes(c.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addable, recSet],
  );
  // picker 정렬 — 추천을 위로.
  const pickerList = useMemo(
    () => [...addable].sort((a, b) => (recommended.includes(b.id) ? 1 : 0) - (recommended.includes(a.id) ? 1 : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addable, recSet],
  );

  // 렌더용 배치 — 활성 위젯마다 항상 항목 보장(저장분 우선, 없으면 기본값).
  const effective = useMemo(() => {
    const saved = Object.fromEntries(layout.map((l) => [l.i, l]));
    const def = Object.fromEntries(buildDefault(active).map((l) => [l.i, l]));
    return active.map((w) => saved[w.id] || def[w.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, activeIds, catalogIds]);

  const persistActive = (ids: string[]) => {
    setActiveIds(ids);
    try { localStorage.setItem(activeKey, JSON.stringify(ids)); } catch { /* noop */ }
  };

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

  const addWidget = (id: string) => { if (!activeIds.includes(id)) persistActive([...activeIds, id]); setPicking(false); };
  const removeWidget = (id: string) => persistActive(activeIds.filter((x) => x !== id));

  const reset = () => {
    setLayout([]); persistActive(defaultActiveIds);
    try { localStorage.removeItem(storageKey); } catch { /* noop */ }
  };
  const copyLayout = async () => {
    const json = JSON.stringify(effective.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("아래 값을 복사하세요", json); }
  };

  // 2026-07-24 모바일 반응형: 뷰포트에 따라 cols 동적 조정
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // 2026-07-24 사이드바 토글 시 RGL 너비 재계산 강제
  // WidthProvider는 ResizeObserver로 자동 감지하지만, 부모 컨테이너의 margin 변경(collapsed 상태)은
  // DOM 너비 변경이 아니라서 감지 안 됨. → resize 이벤트 디스패치로 강제 재계산.
  useEffect(() => {
    // mounted일 때 resize 이벤트 디스패치 (RGL이 responsive 값 재계산하도록)
    if (!mounted) return;
    // 여러 번 발동해 RGL이 확실히 감지하도록 함
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50 + i * 50); // 50ms, 100ms, 150ms에 각각 발동
    }
  }, [storageKey, mounted, sidebarCollapsed]); // sidebarCollapsed 변경 감지

  const Header = (
    <div className="dash-section-head">
      <div>
        {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
        {edit && !isMobile && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">카드를 드래그해 이동 · 우측/하단 모서리로 크기 조절 · 위젯 추가/삭제 (자동 저장)</p>}
        {edit && isMobile && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">모바일에서는 위젯 추가/삭제만 가능합니다. 배치 편집은 데스크톱에서 하세요.</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 relative">
        {edit && (
          <button onClick={() => setPicking((v) => !v)} className="btn-secondary btn-sm no-drag">
            {picking ? "닫기" : `＋ 위젯 추가${addable.length ? ` (${addable.length})` : ""}`}
          </button>
        )}
        {edit && <button onClick={copyLayout} className="btn-secondary btn-sm no-drag">{copied ? "복사됨!" : "📋 배치 복사"}</button>}
        {edit && <button onClick={reset} className="btn-secondary btn-sm no-drag">기본값</button>}
        <button onClick={() => { setEdit((v) => !v); setPicking(false); }} className={`btn-sm no-drag ${edit ? "btn-primary" : "btn-secondary"}`}>
          {edit ? "✓ 편집 완료" : "⠿ 위젯 편집"}
        </button>

        {/* 위젯 추가 패널 */}
        {edit && picking && (
          <div className="widget-picker">
            {addable.length === 0 ? (
              <div className="text-[12px] text-[var(--text-dim)] text-center py-6">추가할 수 있는 위젯이 없습니다.<br />모든 위젯이 이미 표시 중입니다.</div>
            ) : (
              pickerList.map((c) => (
                <button key={c.id} onClick={() => addWidget(c.id)}
                  className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-surface)] transition">
                  <span className="w-7 h-7 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center text-[14px] shrink-0">{c.icon || "🧩"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-bold text-[var(--text)] truncate">{c.name}</span>
                      {recommended.includes(c.id) && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">추천</span>}
                    </span>
                    {c.desc && <span className="block text-[11px] text-[var(--text-dim)] truncate">{c.desc}</span>}
                  </span>
                  <span className="text-[16px] text-[var(--primary)] font-bold shrink-0 leading-none mt-1">＋</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (!mounted) {
    return (
      <div className="dashboard-grid">
        {Header}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {active.map((w) => <div key={w.id}>{w.render()}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-grid ${edit ? "rgl-editing" : ""}`}>
      {Header}
      {/* 상황 기반 추천 — 신호가 있는데 꺼진 위젯을 편집모드에서 원클릭 추가 칩으로 안내 */}
      {edit && recAddable.length > 0 && (
        <div className="recommended-widgets-row">
          <span className="text-[var(--text-dim)]">💡 지금 유용한 위젯:</span>
          {recAddable.map((c) => (
            <button key={c.id} onClick={() => addWidget(c.id)}
              className="no-drag inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/20 transition">
              {c.icon} {c.name} 추가 ＋
            </button>
          ))}
        </div>
      )}
      <RGL
        key={isMobile ? "mobile" : "desktop"} // 2026-07-24 모바일/데스크톱 전환 시 리마운트
        className="layout"
        layout={effective}
        cols={isMobile ? 1 : 12}
        rowHeight={44}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={edit && !isMobile}
        isResizable={edit && !isMobile}
        compactType="vertical"
        onLayoutChange={onLayoutChange}
        draggableCancel=".no-drag"
        // 하단·우측 핸들만 사용(s/e/se). 상단·좌측(n/w/nw/ne/sw) 핸들은 리사이즈 시 x/y까지
        // 이동시켜 vertical 압축과 충돌 → "다른 위치 위젯이 리사이즈/축소"되는 RGL 고질 버그를 유발.
        resizeHandles={["s", "e", "se"]}
      >
        {active.map((w) => (
          <div key={w.id} className={`dashboard-widget-tile ${edit ? "relative rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/60" : ""}`}>
            {edit && (
              <button onClick={() => removeWidget(w.id)}
                className="no-drag absolute -top-2 -right-2 z-20 w-6 h-6 rounded-full bg-[var(--danger)] text-white text-[13px] font-bold flex items-center justify-center shadow-md hover:scale-110 transition"
                style={{ pointerEvents: "auto" }} aria-label={`${w.name} 위젯 삭제`} title="위젯 삭제">
                ×
              </button>
            )}
            <div className={`h-full overflow-auto [&>*]:min-h-full ${edit ? "pointer-events-none select-none" : ""}`}>{w.render()}</div>
          </div>
        ))}
      </RGL>
    </div>
  );
}
