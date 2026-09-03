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
import { WidgetEmptyContext } from "@/components/widget-empty-context";
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
  //   크기 조절 하한 (2026-08-20 사장님: 위젯 크기 자유 조절 복원) — 신호 줄처럼 좁으면 깨지는 위젯이 정한다
  minW?: number; minH?: number;
  render: () => React.ReactNode;
};

function buildDefault(cat: CatalogWidget[]): Layout[] {
  // 좌표 미지정 위젯은 세 열 중 가장 낮은 열에 순서대로 — 예전 (i%3)*4·y=1000 방식은
  //   지정 위젯이 왼쪽 열에 몰린 계정(권한 필터로 위젯이 줄어든 직원)에서 배치가 기울었다 (2026-08-11 사장님).
  const colH = [0, 0, 0];
  // 지정 좌표 위젯이 이미 차지한 높이를 열별로 반영
  for (const w of cat) {
    if (w.x != null && w.y != null) {
      //   전폭 위젯(신호·챙길 것, w=12)은 세 열을 다 차지한다 — 한 열만 올리면 나머지 열의 자동 배치가 그 위로 끼어든다 (2026-08-20)
      const c0 = Math.max(0, Math.min(2, Math.floor((w.x ?? 0) / 4)));
      const c1 = Math.max(c0, Math.min(2, Math.floor(((w.x ?? 0) + (w.w || 4) - 1) / 4)));
      for (let c = c0; c <= c1; c++) colH[c] = Math.max(colH[c], (w.y ?? 0) + (w.h || 4));
    }
  }
  // ⚠️ 하한은 위젯이 정한 값을 쓴다 — 예전엔 minW:3/minH:2 로 못박아 CatalogWidget 의 minW·minH 가
  //    무시됐다. 달력처럼 작게 줄이면 내용이 잘리는 위젯이 스스로를 지킬 수 없었다 (2026-08-21).
  return cat.map((w) => {
    const size = { w: w.w || 4, h: w.h || 5, minW: w.minW ?? 3, minH: w.minH ?? 2 };   // 1단 = h5(268px), 2단 = h10 (2026-09-03 v2 결정 149)
    if (w.x != null && w.y != null) return { i: w.id, x: w.x, y: w.y, ...size };
    const c = colH.indexOf(Math.min(...colH));
    const item = { i: w.id, x: c * 4, y: colH[c], ...size };
    colH[c] += size.h;
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

export type WidgetPreset = { id: string; label: string; ids: string[] };

export function DashboardGrid({
  storageKey, catalog, defaultActiveIds, title = "", recommended = [], sidebarCollapsed = false,
  layoutMigration, activeMigration, presets = [], headLeft,
}: {
  storageKey: string;
  catalog: CatalogWidget[];
  defaultActiveIds: string[];
  title?: string;
  recommended?: string[];
  sidebarCollapsed?: boolean;
  //   머리 줄 왼쪽에 끼울 것(대시보드의 날짜·회사 이름) — '보기 설정'이 화면 최상단 오른쪽에 온다 (2026-08-20 사장님)
  headLeft?: React.ReactNode;
  //   관점 프리셋(대표/회계/직원) — '보기 설정' 판에서 고르면 그 위젯 묶음이 켜진다. 이후 사람이 켜고 끈 것이 이긴다.
  presets?: WidgetPreset[];
  // 위젯 내용이 커졌을 때 이미 저장된 배치를 한 번만 끌어올린다(id 가 바뀔 때만 재적용).
  //   저장본이 있는 계정은 카탈로그 기본 크기를 안 쓰기 때문에, 이게 없으면 큰 카드가 옛 높이에 갇힌다.
  layoutMigration?: { id: string; minH: Record<string, number>; set?: Record<string, Partial<Pick<Layout, "x" | "y" | "w" | "h">>> };
  // 기본 활성 목록이 바뀌었을 때, 이미 저장된 선택에도 새 기본값을 1회 병합한다(id 가 바뀔 때만 재적용).
  //   병합 후 사용자가 위젯을 빼면 그 선택은 그대로 유지된다.
  activeMigration?: string;
}) {
  const [edit, setEdit] = useState(false);      // 순서 바꾸기(드래그) 모드
  //   저장된 배치 1회 마이그레이션 — minH(최소 높이 끌어올림) + set(자리·크기 강제, 없는 위젯은 추가). 2026-09-03 v2: 챙길 것 8열 + 오늘 한눈 4열.
  const applyLayoutMig = (list: Layout[]): Layout[] => {
    if (!layoutMigration) return list;
    const out = list.map((l) => {
      const min = layoutMigration.minH[l.i];
      const set = layoutMigration.set?.[l.i];
      let n = min && (l.h ?? 0) < min ? { ...l, h: min } : l;
      if (set) n = { ...n, ...set };
      return n;
    });
    for (const [id, set] of Object.entries(layoutMigration.set || {})) {
      if (!out.some((l) => l.i === id)) out.push({ i: id, x: set.x ?? 0, y: set.y ?? 0, w: set.w ?? 4, h: set.h ?? 4 });
    }
    return out;
  };
  const [viewOpen, setViewOpen] = useState(false); // 보기 설정 판
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<Layout[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>(defaultActiveIds);
  //   저장된 선택이 없을 때는 기본값(권한·프리셋으로 정해짐)을 따라간다 — 기본값이 나중에 바뀌어도(권한 도착) 굳지 않게 (2026-08-19)
  const hasSavedActive = useRef(false);
  const defaultKey = defaultActiveIds.join(",");
  useEffect(() => { if (!hasSavedActive.current) setActiveIds(defaultActiveIds); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [defaultKey]);

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
          const bumped = applyLayoutMig(raw);
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
        hasSavedActive.current = true;
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
          srvLayout = applyLayoutMig(srvLayout);
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
          hasSavedActive.current = true;
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

  //   catMap(=카탈로그 객체)에 의존한다 — id 만 보면 render 클로저가 첫 렌더 값(예: 동기화 상태 로딩 전)에 갇힌다 (2026-08-19)
  const active = useMemo(() => activeIds.map((id) => catMap[id]).filter(Boolean) as CatalogWidget[], [activeIds, catMap]);

  //   빈 위젯 집합 — 위젯이 WidgetEmptyContext 로 알린다. 한 줄(h:1)로 접어 맨 아래로 (2026-09-03 v2 결정 149·157).
  const [emptyIds, setEmptyIds] = useState<Set<string>>(() => new Set());
  const reportEmpty = useCallback((id: string, empty: boolean) => {
    setEmptyIds((prev) => { if (prev.has(id) === empty) return prev; const n = new Set(prev); if (empty) n.add(id); else n.delete(id); return n; });
  }, []);
  const effective = useMemo(() => {
    const saved = Object.fromEntries(layout.map((l) => [l.i, l]));
    const def = Object.fromEntries(buildDefault(active).map((l) => [l.i, l]));
    //   2026-09-03 v2 결정 149(사장님 확정): 크기 조절 없음 · 자리 이동만 자유. 저장본에서는 x·y 만 쓰고 w·h 는 카탈로그(위젯이 내용에 맞춰 선언)가 정한다.
    //   (2026-08-20 자유 조절 복원의 이유였던 '달력 잘림'은 위젯이 2단을 선언해 푼다 — 결정 157)
    return active.map((w) => {
      const l = saved[w.id] || def[w.id];
      const size = { w: w.w || 4, h: w.h || 5 };
      if (emptyIds.has(w.id)) return { i: w.id, x: l.x, y: 100000 + l.y, w: size.w, h: 1, minW: 3, minH: 1, isResizable: false };
      return { i: w.id, x: l.x, y: l.y, ...size, minW: w.minW ?? 3, minH: w.minH ?? 2, isResizable: false };
    });
  }, [layout, activeIds, catMap, catalogIds, emptyIds]);

  const persistActive = (ids: string[]) => {
    hasSavedActive.current = true;
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
      for (const it of l) { if (emptyIds.has(it.i)) continue; map[it.i] = { i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: it.minW, minH: it.minH }; }   // 접힌 빈 위젯의 임시 자리는 저장하지 않는다
      const next = Object.values(map);
      stateRef.current = { ...stateRef.current, layout: next };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* noop */ }
      scheduleServerSave();
      return next;
    });
  };

  const removeWidget = (id: string) => persistActive(activeIds.filter((x) => x !== id));
  const reset = () => {
    setLayout([]);
    stateRef.current = { ...stateRef.current, layout: [] };
    persistActive(defaultActiveIds); // scheduleServerSave 포함 — 리셋도 다른 기기에 전파
    try { localStorage.removeItem(storageKey); } catch { /* noop */ }
  };

  //   보기 설정 판 (2026-08-19 재편) — 조회 화면의 '보기 설정'과 같은 생김새: 관점 프리셋 · 위젯 켜기/끄기 · 순서 바꾸기 · 기본으로.
  //   예전 '위젯 편집'(드래그·크기·추가 피커)을 이 판 하나로 모았다.
  const applyPreset = (pr: WidgetPreset) => {
    const ids = pr.ids.filter((id) => catMap[id]);
    setLayout([]); stateRef.current = { ...stateRef.current, layout: [] };
    try { localStorage.removeItem(storageKey); } catch { /* noop */ }
    persistActive(ids);
  };
  const toggleWidget = (id: string) => (activeIds.includes(id) ? removeWidget(id) : persistActive([...activeIds, id]));
  const Header = (
    <div className="dash-section-head">
      <div className="min-w-0">
        {headLeft}
        {title && <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--primary)" }}>{title}</div>}
        {edit && !isMobile && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">위젯을 드래그해 이동 · 우측/하단 모서리로 크기 조절 · ×로 끄기 (자동 저장)</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 relative">
        {edit && <button onClick={() => setEdit(false)} className="btn-primary btn-sm no-drag">편집 완료</button>}
        {!edit && (
          <button onClick={() => setViewOpen((v) => !v)} className={`btn-secondary btn-sm no-drag ${viewOpen ? "dash-view-btn-on" : ""}`} aria-expanded={viewOpen}>
            보기 설정 <span className="text-[var(--text-dim)]">▾</span>
          </button>
        )}
        {viewOpen && !edit && (
          <div className="dash-view-panel no-drag" role="dialog" aria-label="보기 설정">
            {presets.length > 0 && (
              <>
                <div className="dash-view-h">관점</div>
                <div className="dash-view-row">
                  {presets.map((pr) => {
                    const on = pr.ids.filter((id) => catMap[id]).every((id) => activeIds.includes(id)) && activeIds.every((id) => pr.ids.includes(id));
                    return <button key={pr.id} type="button" onClick={() => applyPreset(pr)} className={on ? "qk-quick qk-quick-on" : "qk-quick"}>{pr.label}</button>;
                  })}
                </div>
              </>
            )}
            <div className="dash-view-h">위젯 켜기 · 끄기</div>
            <div className="dash-view-row">
              {catalog.map((c) => {
                const on = activeIds.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleWidget(c.id)} className={on ? "qk-quick qk-quick-on" : "qk-quick"} title={c.desc}>
                    {on ? "✓ " : ""}{c.name}{!on && recommended.includes(c.id) ? " · 추천" : ""}
                  </button>
                );
              })}
            </div>
            <div className="dash-view-foot">
              {!isMobile && <button type="button" className="btn-secondary btn-sm" onClick={() => { setEdit(true); setViewOpen(false); }} title="드래그로 이동 · 모서리로 크기 조절">편집</button>}
              <button type="button" className="btn-secondary btn-sm" onClick={reset}>기본으로</button>
              <span className="flex-1" />
              <button type="button" className="btn-primary btn-sm" onClick={() => setViewOpen(false)}>닫기</button>
            </div>
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

  // 모바일은 드래그·크기조절이 없다(아래 isDraggable/isResizable). 그런데도 격자로 그리면
  //   데스크톱에서 저장한 h 가 그대로 높이가 돼 내용이 잘린다 —
  //   신호 6칸이 100px 타일 안에 255px 로 들어가 4칸이 아예 안 보였다(2026-08-21 실측).
  //   폰에서는 위젯을 세로로 쌓고 각자 제 높이를 갖게 한다(잘림 원천 차단).
  //   ⚠️ 측정용 ref 는 여기서도 붙여야 데스크톱으로 돌아올 때 폭을 다시 잰다.
  if (isMobile) {
    const pos = Object.fromEntries(effective.map((l) => [l.i, l]));
    const ordered = [...active].sort((a, b) => {
      const A = pos[a.id], B = pos[b.id];
      return (A?.y ?? 0) - (B?.y ?? 0) || (A?.x ?? 0) - (B?.x ?? 0);
    });
    return (
      <div className="dashboard-grid">
        {Header}
        <div ref={containerRef} className="dashboard-grid-stack">
          {ordered.map((w) => <div key={w.id}>{w.render()}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-grid ${edit ? "rgl-editing" : ""}`}>
      {Header}
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
          isResizable={false}
          compactType="vertical"
          onLayoutChange={onLayoutChange}
          draggableCancel=".no-drag"
        >
          {active.map((w) => (
            <div key={w.id} className={`dashboard-widget-tile ${edit ? "relative rounded-2xl ring-1 ring-dashed ring-[var(--primary)]/60" : ""}`}>
              {edit && (
                <button onClick={() => removeWidget(w.id)} className="no-drag absolute -top-2 -right-2 z-20 w-6 h-6 rounded-full bg-[var(--danger)] text-white text-[13px] font-bold flex items-center justify-center shadow-md hover:scale-110 transition" style={{ pointerEvents: "auto" }} aria-label={`${w.name} 위젯 삭제`} title="위젯 삭제">×</button>
              )}
              <WidgetEmptyContext.Provider value={{ id: w.id, report: reportEmpty }}>
                <div className={`h-full overflow-auto [&>*]:min-h-full ${edit ? "pointer-events-none select-none" : ""}`}>{w.render()}</div>
              </WidgetEmptyContext.Provider>
            </div>
          ))}
        </GridLayout>
      </div>
    </div>
  );
}
