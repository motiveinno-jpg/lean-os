"use client";

// 위젯식 대시보드 그리드 — react-grid-layout(비반응형 GridLayout, 완전 controlled) 기반 자유 배치(2026-07-14).
//   편집 모드: 하단·우측 드래그 리사이즈 + 아무 위치 드래그 이동(격자 스냅) + 세로 자동 압축. 회사/유저별 localStorage 저장.
//   2026-07-15 카탈로그 기반 전환: 전체 위젯 카탈로그 + 개인별 활성 목록 관리 → 편집 모드에서 위젯 추가/삭제 자유.
//     · 활성 목록: localStorage `${storageKey}::active` (없으면 defaultActiveIds)
//     · 배치(layout): localStorage `${storageKey}` (현재 없는 위젯 항목도 보존)
//   2026-08-04 계정 동기화: 원본은 user_preferences.dashboard_grid(서버) — 로그인 기기 어디서든
//     같은 편집이 보인다. localStorage 는 첫 페인트용 캐시로 유지, 마운트 후 서버 값이 덮는다.
//   활성 위젯만 render() 호출 → 비활성 위젯의 쿼리/컴포넌트는 마운트되지 않음(비용 0).
//   2026-07-24 반응형 완전 수정: WidthProvider 제거 → ResizeObserver로 직접 width 측정 후 prop 주입.
//     WidthProvider는 마운트 시점에 너비를 1회 측정하는 클래스 컴포넌트라,
//     창 축소→확대 시 잘못된 너비가 고정되는 버그가 있었음. 직접 측정으로 완전 해결.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Ico } from "@/components/ui-icon";
import { supabase } from "@/lib/supabase";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// 카탈로그 위젯 정의
export type CatalogWidget = {
  id: string;
  name: string;
  icon?: string;
  desc?: string;
  category?: string;
  x?: number; y?: number; w?: number; h?: number;
  render: () => React.ReactNode;
};

function buildDefault(cat: CatalogWidget[]): Layout[] {
  // 좌표 미지정 위젯은 세 열 중 가장 낮은 열에 순서대로 — 예전 (i%3)*4·y=1000 방식은
  //   지정 위젯이 왼쪽 열에 몰린 계정(권한 필터로 위젯이 줄어든 직원)에서 배치가 기울었다 (2026-08-11 사장님).
  const colH = [0, 0, 0];
  // 지정 좌표 위젯이 이미 차지한 높이를 열별로 반영
  for (const w of cat) {
    if (w.x != null && w.y != null) {
      const c = Math.max(0, Math.min(2, Math.floor((w.x ?? 0) / 4)));
      colH[c] = Math.max(colH[c], (w.y ?? 0) + (w.h || 4));
    }
  }
  return cat.map((w) => {
    if (w.x != null && w.y != null) {
      return { i: w.id, x: w.x, y: w.y, w: w.w || 4, h: w.h || 4, minW: 3, minH: 2 };
    }
    const c = colH.indexOf(Math.min(...colH));
    const item = { i: w.id, x: c * 4, y: colH[c], w: w.w || 4, h: w.h || 4, minW: 3, minH: 2 };
    colH[c] += (w.h || 4);
    return item;
  });
}

// 컨테이너 너비를 ResizeObserver로 직접 측정하는 훅.
//   콜백 ref 방식 — 렌더 분기(폴백 grid ↔ RGL)로 컨테이너 DOM 노드가 교체돼도
//   옵저버가 새 노드에 다시 붙는다. 기존 useRef+useEffect 방식은 최초 노드만 관찰해서,
//   분기 전환 후 떼어진 옛 노드를 계속 보다가 사이드바 애니메이션 중 좁게 잰 폭에
//   영영 고정됐다 (2026-07-29 직원 대시보드가 1열 세로 스택으로 짜부된 사고의 원인).
function useContainerWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node) return;
    setWidth(node.offsetWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);

  return [setRef, width];
}

export function DashboardGrid({
  storageKey, catalog, defaultActiveIds, title = "", recommended = [], sidebarCollapsed = false,
  layoutMigration, activeMigration,
}: {
  storageKey: string;
  catalog: CatalogWidget[];
  defaultActiveIds: string[];
  title?: string;
  recommended?: string[];
  sidebarCollapsed?: boolean;
  // 위젯 내용이 커졌을 때 이미 저장된 배치를 한 번만 끌어올린다(id 가 바뀔 때만 재적용).
  //   저장본이 있는 계정은 카탈로그 기본 크기를 안 쓰기 때문에, 이게 없으면 큰 카드가 옛 높이에 갇힌다.
  layoutMigration?: { id: string; minH: Record<string, number> };
  // 기본 활성 목록이 바뀌었을 때, 이미 저장된 선택에도 새 기본값을 1회 병합한다(id 가 바뀔 때만 재적용).
  //   병합 후 사용자가 위젯을 빼면 그 선택은 그대로 유지된다.
  activeMigration?: string;
}) {
  const [edit, setEdit] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>(defaultActiveIds);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);

  const activeKey = `${storageKey}::active`;

  // ── 계정 단위 동기화 (2026-08-04 사장님: "다른 컴퓨터에서 로그인해도 위젯 편집 적용되게") ──
  //   localStorage 는 즉시 반영용 캐시로 유지하고, 원본은 user_preferences.dashboard_grid
  //   ({ [storageKey]: { layout, active, ... } }) — 마운트 시 서버 값이 로컬을 덮는다.
  const stateRef = useRef({ layout, activeIds });
  useEffect(() => { stateRef.current = { layout, activeIds }; });
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleServerSave = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const authUser = session?.user;
        if (!authUser) return;
        // user_preferences.user_id 는 auth uid — company_id 는 users 에서 auth_id 로 조회 (sidebar-context 와 동일 규약)
        const { data: userData } = await supabase.from("users").select("company_id").eq("auth_id", authUser.id).maybeSingle();
        if (!userData?.company_id) return;
        const { data: cur } = await (supabase as any)
          .from("user_preferences").select("dashboard_grid")
          .eq("user_id", authUser.id).eq("company_id", userData.company_id).maybeSingle();
        const grid = {
          ...((cur?.dashboard_grid as Record<string, unknown>) || {}),
          [storageKey]: {
            layout: stateRef.current.layout,
            active: stateRef.current.activeIds,
            layout_mig: layoutMigration?.id ?? null,
            active_mig: activeMigration ?? null,
            saved_at: new Date().toISOString(),
          },
        };
        await (supabase as any).from("user_preferences").upsert({
          user_id: authUser.id,
          company_id: userData.company_id,
          dashboard_grid: grid,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,company_id" });
      } catch { /* 동기화 실패는 비치명 — 로컬 저장은 이미 됨 */ }
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const catMap = useMemo(() => Object.fromEntries(catalog.map((c) => [c.id, c])), [catalog]);
  const catalogIds = catalog.map((c) => c.id).join(",");

  const [containerRef, containerWidth] = useContainerWidth();
  const isMobile = containerWidth > 0 && containerWidth < 768;
  const cols = isMobile ? 1 : 12;

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(raw)) {
        // 오염 저장본 자가 치유 — 과거 버그로 모바일 클램프 배치(전 항목 w≤1·x=0)가
        //   저장된 계정이 있다 (2026-07-29 직원 대시보드 짜부 사고). 그 시그니처면 폐기하고 기본 배치로.
        const poisoned = raw.length > 1 && raw.every((l: Layout) => (l?.w ?? 0) <= 1 && (l?.x ?? 0) === 0);
        if (poisoned) { try { localStorage.removeItem(storageKey); } catch { /* noop */ } }
        else if (layoutMigration && localStorage.getItem(`${storageKey}::mig`) !== layoutMigration.id) {
          const bumped = raw.map((l: Layout) => {
            const min = layoutMigration.minH[l.i];
            return min && (l.h ?? 0) < min ? { ...l, h: min } : l;
          });
          setLayout(bumped);
          try {
            localStorage.setItem(storageKey, JSON.stringify(bumped));
            localStorage.setItem(`${storageKey}::mig`, layoutMigration.id);
          } catch { /* noop */ }
        }
        else setLayout(raw);
      }
    } catch { /* noop */ }
    try {
      const rawA = JSON.parse(localStorage.getItem(activeKey) || "null");
      if (Array.isArray(rawA)) {
        if (activeMigration && localStorage.getItem(`${activeKey}::mig`) !== activeMigration) {
          const merged = [...rawA, ...defaultActiveIds.filter((id) => !rawA.includes(id))];
          setActiveIds(merged);
          try {
            localStorage.setItem(activeKey, JSON.stringify(merged));
            localStorage.setItem(`${activeKey}::mig`, activeMigration);
          } catch { /* noop */ }
        } else setActiveIds(rawA);
      } else if (activeMigration) {
        // 저장 선택이 없으면 기본값이 이미 전체 — 마이그레이션 완료로만 표시
        try { localStorage.setItem(`${activeKey}::mig`, activeMigration); } catch { /* noop */ }
      }
    } catch { /* noop */ }
    setMounted(true);

    // ── 서버 저장본 로드 — 로컬(캐시)을 먼저 그려두고, 도착하면 서버 값으로 덮는다(계정 동기화의 원본).
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const authUser = session?.user;
        if (!authUser) return;
        const { data: rows } = await (supabase as any)
          .from("user_preferences").select("dashboard_grid").eq("user_id", authUser.id);
        const saved = (rows || []).map((r: any) => r?.dashboard_grid?.[storageKey]).find(Boolean);
        if (!saved) return;
        let srvLayout: Layout[] = Array.isArray(saved.layout) ? saved.layout : [];
        let srvActive: string[] | null = Array.isArray(saved.active) ? saved.active : null;
        let migrated = false;
        // 다른 기기가 옛 버전에서 저장했을 수 있으므로 서버 스냅샷에도 마이그레이션을 적용한다.
        if (layoutMigration && saved.layout_mig !== layoutMigration.id) {
          srvLayout = srvLayout.map((l) => {
            const min = layoutMigration.minH[l.i];
            return min && (l.h ?? 0) < min ? { ...l, h: min } : l;
          });
          migrated = true;
        }
        if (srvActive && activeMigration && saved.active_mig !== activeMigration) {
          srvActive = [...srvActive, ...defaultActiveIds.filter((id) => !srvActive!.includes(id))];
          migrated = true;
        }
        if (srvLayout.length) {
          setLayout(srvLayout);
          try { localStorage.setItem(storageKey, JSON.stringify(srvLayout)); } catch { /* noop */ }
        }
        if (srvActive) {
          setActiveIds(srvActive);
          try { localStorage.setItem(activeKey, JSON.stringify(srvActive)); } catch { /* noop */ }
        }
        try {
          if (layoutMigration) localStorage.setItem(`${storageKey}::mig`, layoutMigration.id);
          if (activeMigration) localStorage.setItem(`${activeKey}::mig`, activeMigration);
        } catch { /* noop */ }
        if (migrated) scheduleServerSave();
      } catch { /* 서버 로드 실패 — 로컬 캐시로 동작 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const active = useMemo(() => activeIds.map((id) => catMap[id]).filter(Boolean) as CatalogWidget[], [activeIds, catalogIds]);
  const addable = useMemo(() => catalog.filter((c) => !activeIds.includes(c.id)), [activeIds, catalogIds]);
  const recSet = recommended.join(",");
  const recAddable = useMemo(() => addable.filter((c) => recommended.includes(c.id)), [addable, recSet]);
  const pickerList = useMemo(() => [...addable].sort((a, b) => (recommended.includes(b.id) ? 1 : 0) - (recommended.includes(a.id) ? 1 : 0)), [addable, recSet]);

  const effective = useMemo(() => {
    const saved = Object.fromEntries(layout.map((l) => [l.i, l]));
    const def = Object.fromEntries(buildDefault(active).map((l) => [l.i, l]));
    return active.map((w) => saved[w.id] || def[w.id]);
  }, [layout, activeIds, catalogIds]);

  const persistActive = (ids: string[]) => {
    setActiveIds(ids);
    stateRef.current = { ...stateRef.current, activeIds: ids };
    try { localStorage.setItem(activeKey, JSON.stringify(ids)); } catch { /* noop */ }
    scheduleServerSave();
  };

  const onLayoutChange = (l: Layout[]) => {
    // 모바일(1열) 렌더 중엔 절대 저장 금지 — RGL이 클램프한 w1·x0 배치가 저장되면
    //   데스크톱 복귀 후에도 짜부가 영구화된다. isMobileRef(effect 타이밍상 한 렌더 늦음)
    //   대신 현재 렌더의 값으로 직접 판정 (2026-07-29 사고 원인).
    if (!mounted || isMobile || cols === 1 || containerWidth < 768) return;
    setLayout((prev) => {
      const map: Record<string, Layout> = Object.fromEntries(prev.map((x) => [x.i, x]));
      for (const it of l) map[it.i] = { i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: it.minW, minH: it.minH };
      const next = Object.values(map);
      stateRef.current = { ...stateRef.current, layout: next };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* noop */ }
      scheduleServerSave();
      return next;
    });
  };

  const addWidget = (id: string) => { if (!activeIds.includes(id)) persistActive([...activeIds, id]); setPicking(false); };
  const removeWidget = (id: string) => persistActive(activeIds.filter((x) => x !== id));
  const reset = () => {
    setLayout([]);
    stateRef.current = { ...stateRef.current, layout: [] };
    persistActive(defaultActiveIds); // scheduleServerSave 포함 — 리셋도 다른 기기에 전파
    try { localStorage.removeItem(storageKey); } catch { /* noop */ }
  };
  const copyLayout = async () => {
    const json = JSON.stringify(effective.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("아래 값을 복사하세요", json); }
  };

  const Header = (
    <div className="dash-section-head">
      <div>
        {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
        {edit && !isMobile && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">카드를 드래그해 이동 · 우측/하단 모서리로 크기 조절 · 위젯 추가/삭제 (자동 저장)</p>}
        {edit && isMobile && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">모바일에서는 위젯 추가/삭제만 가능합니다. 배치 편집은 데스크톱에서 하세요.</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 relative">
        {edit && <button onClick={() => setPicking((v) => !v)} className="btn-secondary btn-sm no-drag">{picking ? "닫기" : `위젯 추가${addable.length ? ` (${addable.length})` : ""}`}</button>}
        {edit && <button onClick={copyLayout} className="btn-secondary btn-sm no-drag">{copied ? "복사됨!" : "배치 복사"}</button>}
        {edit && <button onClick={reset} className="btn-secondary btn-sm no-drag">기본값</button>}
        <button onClick={() => { setEdit((v) => !v); setPicking(false); }} className={`btn-sm no-drag ${edit ? "btn-primary" : "btn-secondary"}`}>{edit ? "편집 완료" : "위젯 편집"}</button>
        {edit && picking && (
          <div className="widget-picker">
            {addable.length === 0 ? <div className="text-[12px] text-[var(--text-dim)] text-center py-6">추가할 수 있는 위젯이 없습니다.<br />모든 위젯이 이미 표시 중입니다.</div> : pickerList.map((c) => (
              <button key={c.id} onClick={() => addWidget(c.id)} className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-surface)] transition">
                <span className="w-7 h-7 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center text-[14px] shrink-0"><Ico e={c.icon || "🧩"} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12px] font-bold text-[var(--text)] truncate">{c.name}</span>
                    {recommended.includes(c.id) && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">추천</span>}
                  </span>
                  {c.desc && <span className="block text-[11px] text-[var(--text-dim)] truncate">{c.desc}</span>}
                </span>
                <span className="text-[16px] text-[var(--primary)] font-bold shrink-0 leading-none mt-1">＋</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ⚠️ 측정 컨테이너(ref div)는 아래에서 폴백↔RGL 어느 분기든 항상 같은 노드여야 한다.
  //   과거엔 분기마다 ref div 가 달라 → 분기 전환 시 ResizeObserver 가 떼어진 옛 노드를
  //   계속 관찰 → 사이드바 마진 애니메이션 중 좁게 잰 폭(수백px)에 영영 고정 →
  //   isMobile 오판정으로 데스크톱에서 1열 세로 스택 (2026-07-29 직원 대시보드 짜부 사고).
  if (!mounted || containerWidth === 0) {
    return (
      <div className="dashboard-grid">
        {Header}
        <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {active.map((w) => <div key={w.id}>{w.render()}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-grid ${edit ? "rgl-editing" : ""}`}>
      {Header}
      {edit && recAddable.length > 0 && (
        <div className="recommended-widgets-row">
          <span className="text-[var(--text-dim)]"><Ico e="💡" /> 지금 유용한 위젯:</span>
          {recAddable.map((c) => (
            <button key={c.id} onClick={() => addWidget(c.id)} className="no-drag inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/20 transition">
              <Ico e={c.icon ?? ""} /> {c.name} 추가 ＋
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef}>
        <GridLayout
          key={cols} // cols 1↔12 전환 시 강제 리마운트 — RGL 은 layout prop 이 같으면 cols 변화만으로 내부 클램프 배치를 다시 풀지 않는다 (2026-07-29 짜부 사고)
          width={containerWidth}
          className="layout"
          layout={effective}
          cols={cols}
          rowHeight={44}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          isDraggable={edit && !isMobile}
          isResizable={edit && !isMobile}
          compactType="vertical"
          onLayoutChange={onLayoutChange}
          draggableCancel=".no-drag"
          resizeHandles={["s", "e", "se"]}
        >
          {active.map((w) => (
            <div key={w.id} className={`dashboard-widget-tile ${edit ? "relative rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/60" : ""}`}>
              {edit && (
                <button onClick={() => removeWidget(w.id)} className="no-drag absolute -top-2 -right-2 z-20 w-6 h-6 rounded-full bg-[var(--danger)] text-white text-[13px] font-bold flex items-center justify-center shadow-md hover:scale-110 transition" style={{ pointerEvents: "auto" }} aria-label={`${w.name} 위젯 삭제`} title="위젯 삭제">×</button>
              )}
              <div className={`h-full overflow-auto [&>*]:min-h-full ${edit ? "pointer-events-none select-none" : ""}`}>{w.render()}</div>
            </div>
          ))}
        </GridLayout>
      </div>
    </div>
  );
}
