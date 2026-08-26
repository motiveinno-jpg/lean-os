"use client";

// 표 머리단 정렬 — 모든 표가 **같은 모양**으로 정렬되게 (2026-08-12 사장님 지시)
//
//   지시: "제목에 정렬기준 넣어주고 항상 제목(머리)단은 가운데 위치하게. 다른메뉴 다 동일"
//
//   그전엔 방식이 두 갈래였다 — 현금영수증은 헤더 클릭(▲▼↕), 매입매출전표는 작은 버튼(▲▼).
//   같은 일을 두 벌로 두면 한쪽만 고쳐진다. 여기 하나로 모으고 화면들이 이걸 쓴다.
//
//   ★ **머리단은 언제나 가운데**, 몸통 칸은 제 정렬을 지킨다(금액은 오른쪽, 이름은 왼쪽).
//     머리를 값에 맞춰 좌우로 흩으면 훑을 때 눈이 걸린다 — 사장님이 짚은 부분이다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** 다음 정렬 상태 — 같은 칸을 다시 누르면 방향만 뒤집는다 */
export function nextSort<K extends string>(cur: SortState<K>, key: K, firstDir: SortDir = "asc"): SortState<K> {
  return cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir };
}

/** 두 값 비교 — 문자는 한글 사전순, 숫자는 크기순. 빈 값은 늘 뒤로 보낸다. */
export function cmp(a: unknown, b: unknown): number {
  const na = a === null || a === undefined || a === "";
  const nb = b === null || b === undefined || b === "";
  if (na && nb) return 0;
  if (na) return 1;          // 빈 값은 방향과 무관하게 뒤 — 위에 몰리면 목록이 쓸모없어진다
  if (nb) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ko");
}

/** 열 너비 기억 — 화면별 storageKey 로 localStorage 에 저장 (원장 화면과 같은 방식) */
export function useColWidths(storageKey: string, defaults: Record<string, number>) {
  const [w, setW] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return defaults;
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; } catch { return defaults; }
  });
  const set = (k: string, px: number) => setW((prev) => {
    const next = { ...prev, [k]: Math.round(px) };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* noop */ }
    return next;
  });
  return [w, set] as const;
}

/** 열 너비 조절 묶음 — SortableTh 의 resize prop 으로 넘긴다 */
export type ThResize = {
  k: string;
  colIndex: number;
  widths: Record<string, number>;
  onResize: (k: string, px: number) => void;
  tableRef: React.RefObject<HTMLTableElement | null>;
};

/**
 * 엑셀식 머리단 필터 — 값 목록에서 골라 거른다 (2026-08-13 사장님: "엑셀과 아예 동일하게").
 *   values   이 칸에 실제로 있는 값들(표시 문자열 그대로)
 *   selected 걸린 필터. **null = 전체(필터 없음)** — 전부 고르면 null 로 돌린다
 */
export type ThFilterSpec = {
  values: string[];
  selected: Set<string> | null;
  onApply: (sel: Set<string> | null) => void;
};

/**
 * 머리단 ≡ 필터 상태 묶음 — 화면마다 colF·spec·hit 을 따로 짜지 않게 (2026-08-18 확산 Wave 3 정리).
 *   spec(k, values)  → SortableTh filter prop 에 그대로 넘긴다
 *   hit(vals)        → 줄이 지금 걸린 필터를 다 통과하는가 (vals = { k: 그 칸에 찍히는 글자 })
 *   key              → usePager resetKey 등에 섞을 문자열
 */
export function useColFilters() {
  const [colF, setColF] = useState<Record<string, Set<string> | null>>({});
  const spec = (k: string, values: string[]): ThFilterSpec => ({
    values, selected: colF[k] ?? null, onApply: (sel) => setColF((o) => ({ ...o, [k]: sel })),
  });
  const hit = (vals: Record<string, string>) => Object.entries(colF).every(([k, sel]) => !sel || sel.has(vals[k] ?? ""));
  const active = Object.entries(colF).filter(([, sel]) => sel).map(([k, sel]) => ({ k, n: sel!.size }));
  const clear = (k?: string) => setColF((o) => (k ? { ...o, [k]: null } : {}));
  const key = JSON.stringify(Object.fromEntries(Object.entries(colF).map(([k, v]) => [k, v ? [...v] : null])));
  return { colF, spec, hit, active, clear, key };
}

export function ThFilter({ spec }: { spec: ThFilterSpec }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  //   up: 아래 공간이 모자라면 버튼 위로 연다 — top 대신 bottom 을 잡아 화면 밖으로 안 나가게 (2026-08-26 사장님)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxH?: number }>({ top: 0, left: 0 });

  const uniq = useMemo(() => [...new Set(spec.values)], [spec.values]);
  const shown = q.trim() ? uniq.filter((v) => v.toLowerCase().includes(q.trim().toLowerCase())) : uniq;
  const allShownOn = shown.length > 0 && shown.every((v) => draft.has(v));

  const openPop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setDraft(new Set(spec.selected ?? uniq));
    setQ("");
    const r = btnRef.current!.getBoundingClientRect();
    //   팝업은 body 로 포털(앱 zoom 밖)하므로 rect 의 시각 좌표를 그대로 fixed 에 쓴다.
    //   좌우는 팝업 폭(232px), 아래는 최대 높이(340px) 기준으로 화면 안에 가두고,
    //   아래 공간이 모자라면 버튼 위로 연다 (2026-08-26 사장님: "가려져서 안 보인다").
    const W = 232, H = 340, vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - W - 12));
    const spaceBelow = vh - r.bottom;
    if (spaceBelow < Math.min(H, 240) && r.top > spaceBelow) {
      setPos({ bottom: vh - r.top + 4, left, maxH: Math.min(H, r.top - 12) });
    } else {
      setPos({ top: r.bottom + 4, left, maxH: Math.min(H, spaceBelow - 12) });
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const apply = () => {
    //   전부 골랐으면 '필터 없음'과 같다 — null 로 돌려 깔때기 표시를 끈다
    spec.onApply(draft.size >= uniq.length ? null : new Set(draft));
    setOpen(false);
  };
  const active = spec.selected !== null;

  return (
    <>
      <button type="button" ref={btnRef} onClick={openPop}
        className={active ? "th-filter th-filter-on" : "th-filter"}
        title={active ? `필터 걸림 (${spec.selected!.size}개 선택)` : "필터"}>
        {/*   석삼(≡) — 엑셀식 값 필터. 깔때기였다가 사장님 지시로 가로 세 줄 (2026-08-18) */}
        {/*   세로 크기 = 머리단 글자(10.5px 한글 ≈ 10px)와 같게 — 위아래가 다르면 같은 줄인데 어긋나 보인다 (2026-08-18 사장님) */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
          <rect x="0" y="0" width="10" height="1.6" rx="0.8" /><rect x="0" y="4.2" width="10" height="1.6" rx="0.8" /><rect x="0" y="8.4" width="10" height="1.6" rx="0.8" />
        </svg>
      </button>
      {/*   body 로 포털 — 앱 전체 zoom(.app-zoom) 안에서 fixed 좌표가 zoom 배로 밀려 가려지던 것 해결.
            body 는 zoom 밖이라 getBoundingClientRect 시각 좌표가 그대로 맞는다 (2026-08-26 사장님). */}
      {open && createPortal(
        <div ref={popRef} className="thf-pop" style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxH }}
          onClick={(e) => e.stopPropagation()}>
          <input className="thf-search" value={q} placeholder="검색"
            autoFocus onChange={(e) => setQ(e.target.value)} />
          <div className="thf-list">
            <label className="thf-item thf-all">
              <input type="checkbox" checked={allShownOn}
                onChange={() => setDraft((d) => {
                  const n = new Set(d);
                  if (allShownOn) shown.forEach((v) => n.delete(v));
                  else shown.forEach((v) => n.add(v));
                  return n;
                })} />
              (모두 선택{q.trim() ? " — 검색 결과" : ""})
            </label>
            {shown.map((v) => (
              <label key={v} className="thf-item">
                <input type="checkbox" checked={draft.has(v)}
                  onChange={() => setDraft((d) => {
                    const n = new Set(d);
                    if (n.has(v)) n.delete(v); else n.add(v);
                    return n;
                  })} />
                <span className="thf-v">{v === "" ? "(빈 칸)" : v}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="thf-none">검색 결과가 없습니다</div>}
          </div>
          <div className="thf-foot">
            <button type="button" className="thf-clear" onClick={() => { spec.onApply(null); setOpen(false); }}>필터 지우기</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>취소</button>
            <button type="button" className="btn-primary btn-sm" disabled={draft.size === 0} onClick={apply}>확인</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function SortableTh<K extends string>({
  label, sortKey, sort, onSort, style, title, filter, resize,
}: {
  label: ReactNode;
  /** 이 칸의 정렬 열쇠. 없으면 정렬 못 하는 칸(선택칸 등) */
  sortKey?: K;
  sort?: SortState<K>;
  onSort?: (key: K) => void;
  style?: React.CSSProperties;
  title?: string;
  /** 엑셀식 값 필터 — 주면 깔때기가 붙는다 */
  filter?: ThFilterSpec;
  /** 열 너비 조절 — 주면 드래그 손잡이가 붙는다 (더블클릭 = 내용에 맞춤) */
  resize?: ThResize;
}) {
  const on = !!sortKey && sort?.key === sortKey;
  //   ★ 예전엔 여기서 inline `position: relative` 를 줬다 — 그게 `.ev-scroll thead th { position: sticky }` 를 덮어
  //     너비 조절 켜진 표는 스크롤하면 머리단이 따라 올라갔다 (2026-08-18 사장님). 손잡이의 기준은 .th-c(relative)와
  //     sticky 자체가 잡아 주므로 인라인으로 줄 필요가 없다.
  const width = resize ? { width: resize.widths[resize.k] } : undefined;
  const handle = resize ? (
    <span
      onMouseDown={(e) => {
        e.preventDefault(); e.stopPropagation();
        const startX = e.clientX;
        const startW = resize.widths[resize.k] || 100;
        const move = (ev: MouseEvent) => resize.onResize(resize.k, Math.max(44, startW + (ev.clientX - startX)));
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
        document.body.style.cursor = "col-resize";
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const table = resize.tableRef.current;
        if (!table) return;
        let max = 44;
        table.querySelectorAll("tr").forEach((tr) => {
          const cell = tr.children[resize.colIndex] as HTMLElement | undefined;
          if (cell) max = Math.max(max, cell.scrollWidth);
        });
        resize.onResize(resize.k, Math.min(640, max + 14));
      }}
      onClick={(e) => e.stopPropagation()}
      className="th-grip"
      title="드래그: 너비 조절 · 더블클릭: 내용에 맞춤"
    />
  ) : null;

  //   글자는 칸 **정가운데**, 필터(≡)는 칸 **오른끝**에 붙는다 (2026-08-18 사장님: "삼각형이 중앙에 있고 글자가
  //   왼쪽으로 밀렸다"). 삼각형 폭만큼 왼쪽에 빈 칸(.th-mark-pad)을 두어 글자 자체가 가운데 오게 맞춘다.
  const thCls = filter ? " th-hasf" : "";
  if (!sortKey || !onSort) {
    return <th style={{ ...style, ...width }} className={"th-c" + thCls}>{label}{filter && <ThFilter spec={filter} />}{handle}</th>;
  }
  return (
    <th style={{ ...style, ...width }} className={"th-c th-sort" + thCls} onClick={() => onSort(sortKey)} title={title ?? "눌러서 정렬"}>
      <span className="th-sort-in">
        <i className="th-mark-pad" aria-hidden />
        {label}
        {/*   정렬 표시 — 깔때기와 같은 크기(16px 상자·9px 도형)의 아래삼각형. 오름차순이면 뒤집는다.
              글자(▲▼↕)로 두면 깔때기 svg 와 기준선·크기가 안 맞아 머리단이 삐뚤어 보였다 (2026-08-18 사장님) */}
        <em className={on ? "th-mark th-mark-on" : "th-mark"} title={on ? (sort!.dir === "asc" ? "오름차순" : "내림차순") : "정렬"}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden
            style={on && sort!.dir === "asc" ? { transform: "rotate(180deg)" } : undefined}>
            <path d="M0 2h10L5 8 0 2z" />
          </svg>
        </em>
      </span>
      {filter && <ThFilter spec={filter} />}
      {handle}
    </th>
  );
}
