"use client";

// 공용 조회 컴포넌트 — 모든 메뉴의 윗줄을 **같은 모양**으로 (2026-08-13 사장님 지시)
//
//   지시: "여러 버튼들과 기능들이 되게 정리없이 배치가되어 산만한것 같아 … 이런문제는 오너뷰
//          전메뉴에서 공통적으로 발생하는 문제인듯 … 공용(통일감)있는 정리가 필요해"
//
//   문제의 뿌리는 **버튼이 많아서**가 아니라 성격이 다른 것들이 한 줄에 섞여 있어서다.
//   조회 조건(무엇을 볼까)·결과 요약(뭐가 나왔나)·선택 실행(고른 것을 어떻게)이 뒤엉키면
//   눈이 매번 전체를 훑어야 한다. 그래서 **성격별로 줄을 나눈다.**
//
//     1줄 QueryBar     — 조회 조건. 여기 있는 것만 목록을 바꾼다.
//     2줄 ResultStrip  — 결과 요약 + 부수 도구(도움·엑셀). 목록을 바꾸지 않는다.
//     (표)
//     3줄 SelectionBar — 줄을 고른 순간에만 나타난다. 파란 버튼은 **여기 하나뿐**.
//     Pager           — 표 아래. 기본 50줄.
//
//   ★ 조회값은 **기억하지 않는다** (사장님 지시).
//     "페이지를 나갔다가 오면 기존 검색값대로 보여주기보다 기본값을 보여주고,
//      내 조건 저장을 통해서 사용자 편의에 맞게" — 화면 안에 머무는 동안은 당연히 유지되고
//     (그냥 React 상태다), 나갔다 오면 기본값이다. 편의는 SavedQueryMenu 가 맡는다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";

// ── 1줄: 조회 조건 ────────────────────────────────────────────────────────

/** 조회 조건 줄 — 왼쪽엔 조건, 오른쪽엔 그 조건으로 하는 일(수집·조회 등) */
export function QueryBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="qk-bar">
      <div className="qk-bar-left">{children}</div>
      {right && <div className="qk-bar-right">{right}</div>}
    </div>
  );
}

/** 라벨 + 조작칸 한 벌 — 라벨이 있어야 "이게 무슨 조건인지" 묻지 않는다 */
export function QueryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="qk-field">
      <span className="qk-field-label">{label}</span>
      <span className="qk-field-body">{children}</span>
    </label>
  );
}

/** 조건 사이 칸막이 — 성격이 다른 조건 묶음을 눈으로 가른다 */
export function QueryDivider() {
  return <span className="qk-divider" aria-hidden />;
}

export type Chip<T extends string> = { value: T; label: string; title?: string };

/** 값 몇 개 중 하나 고르기 — 좁은 native select 대신 늘 보이는 칩 */
export function ChipGroup<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: readonly Chip<T>[] }) {
  return (
    <span className="qk-chips">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title}
          onClick={() => onChange(o.value)}
          className={value === o.value ? "qk-chip qk-chip-on" : "qk-chip"}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * 조건 더보기 — 자주 안 쓰는 조건을 접어 둔다.
 *   ★ 접었다는 사실만 보이면 사람은 "안에 뭐가 켜져 있나" 매번 열어 본다.
 *     켜져 있는 개수를 배지로 내걸어 **열지 않고도 알게** 한다.
 */
export function MoreFilters({ count = 0, children }: { count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="qk-more" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={count > 0 ? "qk-more-btn qk-more-btn-on" : "qk-more-btn"}>
        조건 더보기
        {count > 0 && <em className="qk-more-badge">{count}</em>}
        <span className="qk-caret">▾</span>
      </button>
      {open && <div className="qk-more-pop">{children}</div>}
    </div>
  );
}

/** 한 페이지에 몇 줄 — 기본 50줄, 더 봐야 하면 여기서 늘린다 (사장님 지시) */
export const PAGE_SIZES = [50, 100, 200, 500] as const;
export function RowsPerPage({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <QueryField label="조회 줄 수">
      <select className="qk-select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}줄</option>)}
      </select>
    </QueryField>
  );
}

// ── 2줄: 결과 요약 ────────────────────────────────────────────────────────

/** 결과 줄 — 뭐가 몇 건 나왔나. 여기 있는 것은 목록을 바꾸지 않는다(도움·엑셀) */
export function ResultStrip({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="qk-strip">
      <div className="qk-strip-left">{children}</div>
      {right && <div className="qk-strip-right">{right}</div>}
    </div>
  );
}

/** 결과 요약의 숫자 한 칸 — 라벨과 값을 늘 같은 모양으로 */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "plus" | "minus" }) {
  return (
    <span className="qk-stat">
      <span className="qk-stat-label">{label}</span>
      <b className={tone === "minus" ? "qk-stat-v qk-stat-minus" : tone === "plus" ? "qk-stat-v qk-stat-plus" : "qk-stat-v"}>{value}</b>
    </span>
  );
}

export type HelperItem = {
  label: string;
  onClick: () => void;
  /** 몇 건이 기다리는지 — 0이면 안 붙는다 */
  badge?: number;
  hint?: string;
  disabled?: boolean;
};

/**
 * 도움 — 오너뷰만 있는 보조 기능(배운 규칙·구분 채우기·계정 추천 …)을 한 곳에.
 *   ★ 이것들을 조회 줄에 늘어놓으면 **조건인지 실행인지** 구분이 안 간다.
 *     묶되 숨기지는 않는다 — 할 일이 있으면 버튼에 숫자가 뜬다.
 */
export function HelperMenu({ items }: { items: HelperItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const total = items.reduce((n, i) => n + (i.badge ?? 0), 0);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="qk-help" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={total > 0 ? "qk-help-btn qk-help-btn-on" : "qk-help-btn"}>
        도움
        {total > 0 && <em className="qk-help-badge">{total}</em>}
        <span className="qk-caret">▾</span>
      </button>
      {open && (
        <div className="qk-help-pop">
          {items.map((it) => (
            <button key={it.label} type="button" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }} className="qk-help-item">
              <span className="qk-help-item-top">
                <span>{it.label}</span>
                {it.badge != null && it.badge > 0 && <em className="qk-help-item-badge">{it.badge}</em>}
              </span>
              {it.hint && <small className="qk-help-item-hint">{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 3줄: 고른 줄로 하는 일 ────────────────────────────────────────────────

/**
 * 선택 줄 — **줄을 고른 순간에만** 나타난다.
 *   확정 버튼(파란 것)은 화면을 통틀어 여기 하나다. 늘 떠 있으면 눌러도 되는지 매번 판단해야 한다.
 */
export function SelectionBar({
  count, summary, onClear, children,
}: { count: number; summary?: ReactNode; onClear: () => void; children: ReactNode }) {
  if (count <= 0) return null;
  return (
    <div className="qk-selbar">
      <b className="qk-selbar-n">{count}건 선택</b>
      {summary && <span className="qk-selbar-sum">{summary}</span>}
      <div className="qk-selbar-right">
        <button type="button" onClick={onClear} className="qk-selbar-clear">선택 해제</button>
        {children}
      </div>
    </div>
  );
}

// ── 페이지 넘김 ───────────────────────────────────────────────────────────

/**
 * 페이지 — 기본 50줄씩 (2026-08-13 사장님 지시: "아래로 데이터가 계속 길어짐").
 *   조건이 바뀌면 1쪽으로 돌아간다 — 3쪽을 보다 기간을 바꿨는데 3쪽이 남아 있으면
 *   빈 화면이 뜨고 "자료가 없다"로 읽힌다.
 */
export function usePager<T>(rows: T[], size: number, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { setPage(1); }, [size, resetKey]);
  useEffect(() => { setPage((p) => Math.min(p, pages)); }, [pages]);
  const view = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page, size]);
  return { page, setPage, pages, view, from: rows.length === 0 ? 0 : (page - 1) * size + 1, to: Math.min(page * size, rows.length) };
}

export function Pager({
  page, pages, total, from, to, onPage,
}: { page: number; pages: number; total: number; from: number; to: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  //   앞뒤 두 쪽씩만 — 쪽이 40개면 숫자가 표를 덮는다
  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) nums.push(p);
  return (
    <div className="qk-pager">
      <span className="qk-pager-info">
        <b className="mono-number">{from.toLocaleString("ko-KR")}–{to.toLocaleString("ko-KR")}</b>
        {" / "}
        <b className="mono-number">{total.toLocaleString("ko-KR")}</b>건
      </span>
      {pages > 1 && (
        <span className="qk-pager-nav">
          <button type="button" className="qk-page" disabled={page <= 1} onClick={() => onPage(1)} aria-label="첫 쪽">«</button>
          <button type="button" className="qk-page" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="이전 쪽">‹</button>
          {nums[0] > 1 && <span className="qk-page-gap">…</span>}
          {nums.map((p) => (
            <button key={p} type="button" onClick={() => onPage(p)}
              className={p === page ? "qk-page qk-page-on" : "qk-page"}>{p}</button>
          ))}
          {nums[nums.length - 1] < pages && <span className="qk-page-gap">…</span>}
          <button type="button" className="qk-page" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="다음 쪽">›</button>
          <button type="button" className="qk-page" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="끝 쪽">»</button>
        </span>
      )}
    </div>
  );
}

// ── 내 조건 ───────────────────────────────────────────────────────────────

type Saved = { id: string; name: string; params: Record<string, unknown> };

/**
 * 내 조건 — 자주 쓰는 조회 조건에 이름을 붙여 둔다.
 *   자동 기억(localStorage)을 없앤 자리를 이것이 대신한다. 저장소는 DB 라 **PC 를 바꿔도 따라온다**
 *   (사장님은 PC 두 대로 일한다 — localStorage 였다면 반쪽이다).
 */
export function SavedQueryMenu({
  screen, companyId, params, onApply,
}: {
  screen: string;
  companyId: string | null;
  /** 지금 화면의 조건 — 저장 버튼을 누른 순간의 값 */
  params: Record<string, unknown>;
  /** 저장해 둔 조건을 화면에 되돌려 놓는다 */
  onApply: (params: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const { data: list = [] } = useQuery<Saved[]>({
    queryKey: ["saved-queries", screen, companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead("saved-queries", await supabase
        .from("saved_queries").select("id, name, params")
        .eq("screen", screen).eq("company_id", companyId!)
        .order("created_at"));
      return ((data as any[]) || []) as Saved[];
    },
  });

  //   이름 붙이기는 **팝오버 안에서** 한다 — window.prompt 는 화면 밖 브라우저 창이라
  //   무엇을 저장하는지 안 보이고, 이 저장소에서 쓰지 않는 방식이다
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");

  const save = async () => {
    const name = draft.trim();
    if (!companyId || !name) return;
    setNaming(false);
    setDraft("");
    const { error } = await supabase.from("saved_queries")
      //   같은 이름이면 덮어쓴다 — 사람은 조건을 다듬어 가며 같은 이름으로 다시 누른다
      .upsert({ company_id: companyId, screen, name, params, updated_at: new Date().toISOString() } as any,
        { onConflict: "auth_id,screen,name" });
    if (error) { toast(`조건을 저장하지 못했습니다 — ${error.message}`, "error"); return; }
    qc.invalidateQueries({ queryKey: ["saved-queries", screen, companyId] });
    toast(`'${name}' 조건을 저장했습니다`, "success");
  };

  const remove = async (s: Saved) => {
    if (!(await appConfirm(`'${s.name}' 조건을 지울까요?`, { danger: true, title: "내 조건 삭제", confirmLabel: "삭제" }))) return;
    const { error } = await supabase.from("saved_queries").delete().eq("id", s.id);
    if (error) { toast(`지우지 못했습니다 — ${error.message}`, "error"); return; }
    qc.invalidateQueries({ queryKey: ["saved-queries", screen, companyId] });
  };

  return (
    <div className="qk-saved" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="qk-saved-btn">
        내 조건
        {list.length > 0 && <em className="qk-saved-n">{list.length}</em>}
        <span className="qk-caret">▾</span>
      </button>
      {open && (
        <div className="qk-saved-pop">
          {list.length === 0 ? (
            <p className="qk-saved-empty">저장해 둔 조건이 없습니다.<br />지금 조건을 저장해 두면 다음에 한 번에 불러옵니다.</p>
          ) : list.map((s) => (
            <div key={s.id} className="qk-saved-row">
              <button type="button" className="qk-saved-apply"
                onClick={() => { setOpen(false); onApply(s.params || {}); }}>{s.name}</button>
              <button type="button" className="qk-saved-del" onClick={() => remove(s)} aria-label={`${s.name} 삭제`}>✕</button>
            </div>
          ))}
          {naming ? (
            <form className="qk-saved-name" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <input autoFocus value={draft} maxLength={30} placeholder="조건 이름 (예: 이번 달 미처리)"
                onChange={(e) => setDraft(e.target.value)} className="qk-saved-input" />
              <button type="submit" disabled={!draft.trim()} className="qk-saved-ok">저장</button>
            </form>
          ) : (
            <button type="button" className="qk-saved-save" onClick={() => { setNaming(true); setDraft(""); }}>
              + 지금 조건 저장
            </button>
          )}
        </div>
      )}
    </div>
  );
}
