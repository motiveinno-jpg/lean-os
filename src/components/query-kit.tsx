"use client";

// 공용 조회 부품 — 모든 메뉴의 조회 줄을 **같은 모양**으로 (2026-08-13 사장님 확정)
//
//   지시: "지금의 UI 정리방법을 핵심으로 기억하고 앞으로 UI정리는 이런형식으로 간다."
//   전문은 CLAUDE.md 「조회 화면 표준」. 여기가 그 유일한 구현이다 — 새 툴바를 만들지 말 것.
//
//   산만함의 원인은 **버튼 개수가 아니라** 성격이 다른 것이 한 줄에 섞인 것이었다.
//   조건(누르면 목록이 바뀜) · 결과(안 바뀜) · 도우미(안 바뀜) · 확정(되돌리기 어려움)을 줄로 가른다.
//
//     1줄 QueryBar        [날짜 직접입력 ⎸ 검색조건 ▾] · 빠른검색 · 상태 ‖ AI 제안 · 주 실행
//        └ ConditionPanel  표를 밀지 않고 **떠서** 열린다. 기간칩·달력 / 다중 선택 / 금액 → 조회
//        └ AppliedChips    켜진 조건을 ✕ 로 하나씩 뺀다 (열지 않고도 보인다)
//     2줄 ResultStrip     건수·합계
//     (표) → Pager        기본 50줄
//     3줄 SelectionBar    고른 순간에만. 파란 버튼은 화면을 통틀어 여기 하나
//
//   ★ 조회값은 자동으로 기억하지 않는다 — 나갔다 오면 기본값(최근 1개월).
//     편의는 '내 조건'(DB saved_queries, ★ 하나가 기본)이 맡는다. 줄 수도 조건이라 같이 저장된다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { todayKst } from "@/lib/kst";

// ── 기간 기본값 ───────────────────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();
const parseYmd = (s: string) => { const [y, m, d] = String(s).split("-").map(Number); return { y, m, d }; };
function minusDays(s: string, n: number) {
  const { y, m, d } = parseYmd(s); const t = new Date(y, m - 1, d - n);
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
function minusMonths(s: string, n: number) {
  const { y, m, d } = parseYmd(s); const t = y * 12 + (m - 1) - n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return ymd(ny, nm, Math.min(d, lastDayOf(ny, nm)));
}

/**
 * 기본 조회기간 — **최근 1개월** (2026-08-13 사장님 확정).
 *   '이번 달 1일~오늘'이 아닌 이유: 매달 1~2일에 열면 하루이틀치만 보여
 *   "받아온 자료가 없다"로 읽힌다. 최근 1개월은 언제 열어도 한 달치가 보인다.
 */
export function defaultRange(): { from: string; to: string } {
  const t = todayKst();
  return { from: minusMonths(t, 1), to: t };
}

/** 자주 쓰는 기간 — 검색조건 패널 안에 늘 펼쳐 둔다 */
export function periodQuicks(): { key: string; label: string; from: string; to: string }[] {
  const t = todayKst();
  const lm = minusMonths(t, 1);
  const lp = parseYmd(lm);
  return [
    { key: "day", label: "당일", from: t, to: t },
    { key: "week", label: "1주일", from: minusDays(t, 6), to: t },
    { key: "m1", label: "1개월", from: minusMonths(t, 1), to: t },
    { key: "m3", label: "3개월", from: minusMonths(t, 3), to: t },
    { key: "tmon", label: "이번 달", from: `${t.slice(0, 7)}-01`, to: t },
    { key: "lmon", label: "지난 달", from: `${lm.slice(0, 7)}-01`, to: ymd(lp.y, lp.m, lastDayOf(lp.y, lp.m)) },
  ];
}

/**
 * 월 단위 화면(세금계산서·전자계산서 …)의 기본 기간 — **지난달 ~ 이번 달**.
 *   부가세 자료는 월이 최소 단위다(DateRangeField unit="month").
 *   '이번 달'만 두면 매달 1~2일에 열었을 때 거의 비어 보인다 — 날짜 단위의 '최근 1개월'과 같은 뜻.
 */
export function defaultRangeMonth(): { from: string; to: string } {
  const t = todayKst();
  return { from: minusMonths(t, 1).slice(0, 7), to: t.slice(0, 7) };
}

/** 월 단위 빠른 기간 — 신고 주기에 맞춘다 */
export function periodQuicksMonth(): { key: string; label: string; from: string; to: string }[] {
  const t = todayKst();
  const ym = t.slice(0, 7);
  const last = minusMonths(t, 1).slice(0, 7);
  const q = `${t.slice(0, 4)}-${pad(Number(t.slice(5, 7)) - ((Number(t.slice(5, 7)) - 1) % 3))}`;
  return [
    { key: "tmon", label: "이번 달", from: ym, to: ym },
    { key: "lmon", label: "지난 달", from: last, to: last },
    { key: "m2", label: "지난달~이번달", from: last, to: ym },
    { key: "quarter", label: "이번 분기", from: q, to: ym },
    { key: "half", label: "반기", from: `${t.slice(0, 4)}-${Number(t.slice(5, 7)) <= 6 ? "01" : "07"}`, to: ym },
    { key: "year", label: "올해", from: `${t.slice(0, 4)}-01`, to: ym },
  ];
}

// ── 1줄: 조회 조건 ────────────────────────────────────────────────────────

/**
 * 조회 화면 상자 — **탭 · 조회 줄 · 걸린 조건 · 결과 요약 · 표 · 쪽 넘김을 통째로 한 상자**에.
 *   (2026-08-13 사장님 지시 — 목업 그대로. 처음엔 조회부와 표를 따로 뒀는데 그게 틀렸다.)
 *   낱장으로 흩어져 있으면 "이 표가 저 조건의 결과"라는 게 눈으로 안 이어진다.
 *   ⚠️ 안에서 검색조건 패널·달력이 떠오르므로 **overflow 를 자르면 안 된다.**
 */
export function QueryScreen({ children }: { children: ReactNode }) {
  return <div className="qk-screen">{children}</div>;
}

/** 상자 윗부분 — 탭 · 조회 줄 · 걸린 조건 · 결과 요약 (아래 표와 선 하나로 갈린다) */
export function QueryHead({ children }: { children: ReactNode }) {
  return <div className="qk-head">{children}</div>;
}

/**
 * 표가 들어가는 자리 — **선택 바가 여기 위로 떠오른다** (2026-08-13 사장님 지시).
 *   예전엔 선택 바가 흐름에 끼어 있어, 줄을 고르는 순간 표가 그만큼 줄어들었다.
 *   고를 때마다 표가 들썩이면 고르던 자리를 놓친다. 표 크기는 그대로 두고 위에 띄운다.
 */
export function QueryBody({ children }: { children: ReactNode }) {
  return <div className="qk-body">{children}</div>;
}

export function QueryBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="qk-bar">
      <div className="qk-bar-left">{children}</div>
      {right && <div className="qk-bar-right">{right}</div>}
    </div>
  );
}

export type Chip<T extends string> = { value: T; label: string; title?: string };

/** 값 몇 개 중 하나 고르기 — 좁은 native select 는 글자가 잘려 안 보인다 */
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

// ── 빠른검색 ──────────────────────────────────────────────────────────────

/**
 * 빠른검색 — 글자 한 칸으로 거래처·계좌·계정과목·금액을 **한꺼번에** 찾는다.
 *   ★ 고르는 곳이 아니라 **치는 곳**이다. 이름이 정확하지 않아도 일부만 치면 걸린다.
 *   ★ 여러 개는 **쉼표** — `모티브, 운영계좌` 는 **하나라도** 맞으면 나온다(또는).
 *     한 덩어리 안의 띄어쓰기는 **전부** 들어 있어야 맞는다(그리고) — 좁힐 때 쓴다.
 *   ★ **Enter 로 반영**한다. 치는 대로 좁히면 한 글자마다 표가 흔들려 읽을 수가 없다.
 */
export function QuickSearch({
  value, onApply, placeholder,
}: { value: string; onApply: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  //   밖에서 조건 칩을 지우면 칸도 따라 지워져야 한다
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <span className="qk-qs">
      <span className="qk-qs-ico" aria-hidden>🔍</span>
      <input value={draft} aria-label="빠른검색"
        placeholder={placeholder ?? "거래처 · 계좌 · 계정과목 · 금액 — 쉼표로 여러 개, Enter"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onApply(draft.trim()); }
          if (e.key === "Escape") setDraft(value);
        }} />
      {value && (
        <button type="button" className="qk-qs-x" aria-label="빠른검색 지우기"
          onClick={() => { setDraft(""); onApply(""); }}>✕</button>
      )}
    </span>
  );
}

/** 쉼표로 나눈 낱말들 */
export const quickTerms = (q: string) => q.split(",").map((t) => t.trim()).filter(Boolean);

/**
 * 빠른검색 맞춤 — 쉼표는 '또는', 한 덩어리 안 띄어쓰기는 '그리고'.
 *   숫자만 친 낱말은 **금액**으로도 본다 (`275000` · `275,000` 둘 다).
 */
export function quickSearchHit(q: string, fields: (string | null | undefined)[], amounts: number[] = []): boolean {
  const terms = quickTerms(q);
  if (terms.length === 0) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  const amts = amounts.map((n) => String(Math.round(Math.abs(Number(n) || 0))));
  return terms.some((t) =>
    t.toLowerCase().split(/\s+/).filter(Boolean).every((w) => {
      if (hay.includes(w)) return true;
      const n = w.replace(/[^0-9]/g, "");
      return !!n && /^[\d,]+$/.test(w) && amts.some((a) => a.includes(n));
    }));
}

// ── 검색조건 패널 ─────────────────────────────────────────────────────────

/**
 * 검색조건 — **표를 밀지 않고 떠서** 열린다.
 *   ★ 열 때 어떤 칸에도 커서를 두지 않는다 (2026-08-13 사장님 지적). 커서를 주면 그 칸 후보가
 *     펼쳐져 **찾지도 않은 목록**이 화면을 덮는다. 어느 칸을 쓸지는 사람이 정한다.
 */
export function ConditionPanel({
  open, onOpenChange, activeCount, children, foot, tabs, anchorSel, label = "검색조건",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 버튼 배지 — 지금 몇 개가 걸려 있나 */
  activeCount: number;
  children: ReactNode;
  foot: ReactNode;
  /** 패널 머리의 '내 조건' 탭 */
  tabs?: ReactNode;
  /** 바깥 클릭으로 안 닫을 영역 (기간 칸처럼 같이 쓰는 것) */
  anchorSel?: string;
  /** 버튼·패널 이름 — 값을 거르는 게 아니라 **보는 법**을 고르는 곳(월별 표)은 '보기 설정' (2026-08-19). 문법은 같다: 고르고 → 적용 */
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (box.current?.contains(t)) return;
      if (anchorSel && t.closest(anchorSel)) return;
      onOpenChange(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open, onOpenChange, anchorSel]);

  return (
    <div className="qk-cond" ref={box}>
      <button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open}
        className={activeCount > 0 || open ? "qk-cond-btn qk-cond-btn-on" : "qk-cond-btn"}>
        {label}
        {activeCount > 0 && <em className="qk-cond-n">{activeCount}</em>}
        <span className="qk-caret">▾</span>
      </button>
      {open && (
        <div className="qk-panel" role="dialog" aria-label={label}>
          <div className="qk-panel-head">
            <b>{label}</b>
            {tabs}
            <button type="button" className="qk-panel-x" aria-label="닫기"
              onClick={() => onOpenChange(false)}>✕</button>
          </div>
          <div className="qk-panel-body">{children}</div>
          <div className="qk-panel-foot">{foot}</div>
        </div>
      )}
    </div>
  );
}

/** 검색조건 한 줄 — 라벨 왼쪽, 칸 오른쪽 */
export function ConditionRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <>
      <div className="qk-crow-label">{label}{hint && <small>{hint}</small>}</div>
      <div className="qk-crow-body">{children}</div>
    </>
  );
}

export type TokenItem = { value: string; label: string; sub?: string };

/**
 * 다중 선택 — 이름 일부를 쳐서 고르고 **칩으로 쌓는다** (2026-08-13 사장님 지시, 이카운트 계좌 칸 참고).
 *   "거래처명이 정확하지 않을때, 모티를 치면 모티가 들어간 회사들이 나와서 선택하고, 또 다른 거래처를 지정"
 *   ★ 거래처는 실제로 2,000곳이다 — 아무것도 안 쳤을 때 전부 뿌리면 스크롤 벽이 된다.
 *     앞 20개만 보여 주고 **잘렸다는 사실을 적는다**(조용히 자르면 '이게 전부'로 읽힌다).
 */
const TOKEN_CAP = 20;
export function TokenField({
  items, value, onChange, placeholder, openOnClick,
}: {
  items: TokenItem[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /** 칸을 누르면 전체 목록을 바로 펼친다 — 카드·통장처럼 목록에서 골라 담는 칸 전용 opt-in
   *  (2026-09-01 사장님: "클릭하면 보이는 목록식으로"). 기본값은 종전 그대로(글자를 쳐야 열림). */
  openOnClick?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const all = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((it) => !s || `${it.label} ${it.sub ?? ""}`.toLowerCase().includes(s));
  }, [items, q]);
  const list = all.slice(0, TOKEN_CAP);
  const cut = all.length - list.length;

  //   ★ 담고 나면 글자를 지우므로 목록이 **저절로 닫힌다** (2026-08-13 사장님 지적).
  //     예전엔 담은 뒤에도 목록이 남아 다음 칸을 덮었고, 다른 데를 한 번 눌러야 넘어갔다.
  const add = (it?: TokenItem) => {
    if (!it) return;
    if (!value.includes(it.value)) onChange([...value, it.value]);
    setQ(""); setCur(-1); setOpen(false); input.current?.focus();
  };

  return (
    <div className="qk-tok" ref={box}>
      <div className="qk-tok-box" onClick={() => input.current?.focus()}>
        {value.map((v) => (
          <span key={v} className="qk-tok-chip">
            <span>{items.find((i) => i.value === v)?.label ?? v}</span>
            <button type="button" aria-label={`${v} 빼기`}
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== v)); }}>✕</button>
          </span>
        ))}
        {/*   ★ 커서만 갔다고 목록을 열지 않는다 (2026-08-13 사장님 지적) —
              열려 있으면 아래 칸을 덮어, 다음 조건으로 가려면 딴 데를 한 번 눌러야 했다.
              **글자를 쳐야** 후보가 뜬다. 다 보고 싶으면 ↓ 를 누른다. */}
        <input ref={input} value={q} placeholder={value.length ? "" : placeholder}
          onFocus={() => { if (openOnClick) setOpen(true); }}
          onChange={(e) => { setQ(e.target.value); setOpen(openOnClick || e.target.value.trim().length > 0); setCur(-1); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) { setOpen(true); return; }   // ↓ 로 전체 목록을 펼친다
              if (list.length === 0) return;
              setCur((c) => e.key === "ArrowDown" ? Math.min(c + 1, list.length - 1) : Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault(); add(list[cur >= 0 ? cur : 0]);
            } else if (e.key === "Backspace" && !q && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape") { setOpen(false); }
          }} />
      </div>
      {value.length > 0 && (
        <button type="button" className="qk-tok-x" aria-label="모두 지우기"
          onClick={() => onChange([])}>✕</button>
      )}
      {open && (
        <div className="qk-tok-pop" role="listbox">
          {all.length === 0 ? (
            <p className="qk-tok-none">‘{q}’ 에 맞는 것이 없습니다</p>
          ) : (<>
            <p className="qk-tok-head">{q.trim() ? `‘${q.trim()}’ 검색 결과 ${all.length}` : `전체 ${all.length}`}</p>
            {list.map((it, i) => {
              const on = value.includes(it.value);
              return (
                <button key={it.value} type="button" role="option" aria-selected={on}
                  onClick={() => add(it)}
                  className={`qk-tok-i${on ? " qk-tok-i-on" : ""}${i === cur ? " qk-tok-i-cur" : ""}`}>
                  <span className="qk-tok-i-name">{it.label}</span>
                  {it.sub && <small>{it.sub}</small>}
                  {on && <small>담김 ✓</small>}
                </button>
              );
            })}
            {cut > 0 && <p className="qk-tok-none">외 {cut}개 더 — 이름 일부를 치면 좁혀집니다</p>}
          </>)}
        </div>
      )}
    </div>
  );
}

/** 금액 범위 — 한쪽만 채워도 된다. 숫자만 남기고 쉼표로 보여 준다. */
export function AmountRange({ min, max, onMin, onMax }: {
  min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void;
}) {
  const fmt = (v: string) => (v ? Number(v).toLocaleString("ko-KR") : "");
  const take = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 13);
  return (
    <span className="qk-amt">
      <input className="qk-input qk-amt-in" inputMode="numeric" placeholder="최소" aria-label="최소 금액"
        value={fmt(min)} onChange={(e) => onMin(take(e.target.value))} />
      <i>~</i>
      <input className="qk-input qk-amt-in" inputMode="numeric" placeholder="최대" aria-label="최대 금액"
        value={fmt(max)} onChange={(e) => onMax(take(e.target.value))} />
      <em>원</em>
    </span>
  );
}

/** 금액 범위 맞춤 — 부호는 보지 않는다(출금 -165,000 도 165,000 으로 찾는다) */
export function amountHit(n: number, min: string, max: string): boolean {
  const v = Math.abs(Number(n) || 0);
  if (min && v < Number(min)) return false;
  if (max && v > Number(max)) return false;
  return true;
}

/** 한 쪽에 몇 줄 — **조건의 하나**라 '내 조건'에 같이 저장된다 (2026-08-13 사장님 지시) */
export const PAGE_SIZES = [50, 100, 200, 500] as const;
//   '전체' = 사실상 무한대인 유한 수 — Infinity 는 JSON(내 조건 저장·쿼리키)에서 null 이 되므로 못 쓴다 (2026-08-26)
export const ALL_ROWS = 1_000_000_000;
const sizeLabel = (n: number) => (n >= ALL_ROWS ? "전체" : `${n}줄`);
export function RowsPerPage({ value, onChange, withAll }: { value: number; onChange: (n: number) => void; withAll?: boolean }) {
  //   withAll: '전체' 옵션 노출 (수집·전표 — 2026-08-26 사장님). 현재 값이 목록에 없으면(주소로 온 값 등) 맨 앞에 끼워 빈 셀렉트를 막는다.
  const list: number[] = [...PAGE_SIZES, ...(withAll ? [ALL_ROWS] : [])];
  if (!list.includes(value)) list.unshift(value);
  return (
    <label className="qk-size">
      <span>줄 수</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="한 쪽에 몇 줄">
        {list.map((n) => <option key={n} value={n}>{sizeLabel(n)}</option>)}
      </select>
    </label>
  );
}

// ── 걸린 조건 칩 ──────────────────────────────────────────────────────────

export type AppliedChip = { group: string; label: string; onRemove: () => void };

/** 켜진 조건을 조회 줄에 남긴다 — 패널을 열지 않고도 알고, ✕ 로 하나씩 뺀다 */
export function AppliedChips({ chips, onClearAll }: { chips: AppliedChip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="qk-applied">
      {chips.map((c, i) => (
        <span key={`${c.group}-${c.label}-${i}`} className="qk-applied-c">
          <em>{c.group}</em>{c.label}
          <button type="button" aria-label={`${c.label} 빼기`} onClick={c.onRemove}>✕</button>
        </span>
      ))}
      <button type="button" className="qk-applied-clr" onClick={onClearAll}>조건 모두 지우기</button>
    </div>
  );
}

// ── 2줄: 결과 요약 ────────────────────────────────────────────────────────

export function ResultStrip({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="qk-strip">
      <div className="qk-strip-left">{children}</div>
      {right && <div className="qk-strip-right">{right}</div>}
    </div>
  );
}

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
  /** 출처 — 'AI 추천' · '내가 배운 규칙' · '국세청 조회'. **전부 AI 라고 뭉뚱그리지 않는다.** */
  source?: string;
};

/**
 * AI 제안 — 보조 기능 모음 (2026-08-13 사장님 확정).
 *   ★ **'제안'** 인 이유: 여기 있는 것들은 **채워만 주고 확정은 사람이 한다**
 *     (이 저장소의 원칙 '제안은 자동, 확정은 사람'). '처리'·'자동'이라 이름 붙이면
 *     "누르면 알아서 끝난다"로 읽혀 이름이 거짓말을 한다.
 *   ★ 줄마다 **출처를 적는다.** 배운 규칙은 사람이 고른 것이고 구분 채우기는 국세청 조회다.
 *     전부 AI 라고 뭉뚱그리면 틀렸을 때 원인을 엉뚱한 데서 찾는다.
 */
//   ★ 2026-08-27 사장님 "버튼이 많아진다" — AI 가 아닌 보조 동작(자재 소요·전표·처분·설정)도 한 묶음으로 접는다.
//     그때는 label 을 '도구'로 준다. AI 제안이라 부르면 이름이 거짓말한다. 줄마다 출처(source)는 그대로 적는다.
export function HelperMenu({ items, label = "AI 제안" }: { items: HelperItem[]; label?: string }) {
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
        {label}
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
                {it.source && <em className="qk-help-src">{it.source}</em>}
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

export type ExcelItem = {
  label: string;
  onClick: () => void;
  hint?: string;
  /** 몇 건이 대상인지 — 내려받기 전에 알고 누르게 */
  count?: number;
  disabled?: boolean;
};

/**
 * 엑셀 — 내려받기·올리기를 한 버튼 안에 (2026-08-13 사장님 지시).
 *   ★ **되는 것만 넣는다.** 되는 척하는 메뉴는 없느니만 못하다 — 눌러 보고 아무 일도 안 일어나면
 *     그 다음부터 메뉴 전체를 안 믿는다.
 */
export function ExcelMenu({ items }: { items: ExcelItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="qk-help" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="qk-xls-btn">
        엑셀<span className="qk-caret">▾</span>
      </button>
      {open && (
        <div className="qk-help-pop">
          {items.map((it) => (
            <button key={it.label} type="button" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }} className="qk-help-item">
              <span className="qk-help-item-top">
                <span>{it.label}</span>
                {it.count != null && <em className="qk-xls-n">{it.count.toLocaleString("ko-KR")}건</em>}
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

export function usePager<T>(rows: T[], size: number, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { setPage(1); }, [size, resetKey]);
  useEffect(() => { setPage((p) => Math.min(p, pages)); }, [pages]);
  const view = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page, size]);
  return {
    page, setPage, pages, view,
    from: rows.length === 0 ? 0 : (page - 1) * size + 1,
    to: Math.min(page * size, rows.length),
  };
}

export function Pager({
  page, pages, total, from, to, size, onPage, onSize,
}: { page: number; pages: number; total: number; from: number; to: number; size: number; onPage: (p: number) => void;
  //   onSize 를 주면 '한 쪽 N줄'이 셀렉트(+'전체')가 된다 — 쪽 이동하는 자리에서 바로 줄 수를 바꾼다 (2026-08-26 사장님, 수집·전표)
  onSize?: (n: number) => void }) {
  if (total === 0) return null;
  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) nums.push(p);
  const sizeList: number[] = [...PAGE_SIZES, ALL_ROWS];
  if (!sizeList.includes(size)) sizeList.unshift(size);
  return (
    <div className="qk-pager">
      <span className="qk-pager-info">
        <b className="mono-number">{from.toLocaleString("ko-KR")}–{to.toLocaleString("ko-KR")}</b>
        {" / "}
        <b className="mono-number">{total.toLocaleString("ko-KR")}</b>건
        {onSize ? (
          <em className="qk-pager-size">· 한 쪽{" "}
            <select className="qk-pager-size-sel" value={size} onChange={(e) => onSize(Number(e.target.value))}
              aria-label="한 쪽에 몇 줄 — 전체를 고르면 한 쪽에 다 보입니다">
              {sizeList.map((n) => <option key={n} value={n}>{sizeLabel(n)}</option>)}
            </select>
          </em>
        ) : (
          <em className="qk-pager-size">· 한 쪽 {sizeLabel(size)}</em>
        )}
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

export type SavedQuery = { id: string; name: string; params: Record<string, unknown>; is_default: boolean };

/**
 * 내 조건 — 자주 쓰는 조회 조건에 이름을 붙여 둔다. **★ 하나가 화면의 기본값**이 된다.
 *   자동 기억(localStorage)을 없앤 자리를 이것이 대신한다. 저장소는 DB 라 **PC 를 바꿔도 따라온다**
 *   (사장님은 PC 두 대로 일한다 — localStorage 였다면 반쪽이다).
 */
export function useSavedQueries(screen: string, companyId: string | null) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["saved-queries", screen, companyId];

  const { data: list = [], isFetched } = useQuery<SavedQuery[]>({
    queryKey: key,
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead("saved-queries", await supabase
        .from("saved_queries").select("id, name, params, is_default")
        .eq("screen", screen).eq("company_id", companyId!)
        .order("created_at"));
      return ((data as any[]) || []) as SavedQuery[];
    },
  });

  const save = async (name: string, params: Record<string, unknown>, asDefault = false) => {
    if (!companyId || !name.trim()) return;
    //   ★ 기본으로 삼으려면 나머지를 먼저 끈다 — 화면마다 하나뿐이다(DB 에도 유일 인덱스)
    if (asDefault) {
      await supabase.from("saved_queries").update({ is_default: false })
        .eq("screen", screen).eq("company_id", companyId);
    }
    const { error } = await supabase.from("saved_queries")
      //   같은 이름이면 덮어쓴다 — 사람은 조건을 다듬어 가며 같은 이름으로 다시 누른다
      .upsert({ company_id: companyId, screen, name: name.trim(), params,
        is_default: asDefault, updated_at: new Date().toISOString() } as any,
        { onConflict: "auth_id,screen,name" });
    if (error) { toast(`조건을 저장하지 못했습니다 — ${error.message}`, "error"); return; }
    qc.invalidateQueries({ queryKey: key });
    toast(`'${name.trim()}' 조건을 저장했습니다${asDefault ? " — 화면을 열 때 이 조건으로 걸립니다" : ""}`, "success");
  };

  const remove = async (s: SavedQuery) => {
    if (!(await appConfirm(`'${s.name}' 조건을 지울까요?`, { danger: true, title: "내 조건 삭제", confirmLabel: "삭제" }))) return;
    const { error } = await supabase.from("saved_queries").delete().eq("id", s.id);
    if (error) { toast(`지우지 못했습니다 — ${error.message}`, "error"); return; }
    qc.invalidateQueries({ queryKey: key });
  };

  /** ★ — 화면마다 하나. 켜면 나머지는 꺼진다(DB 에도 유일 인덱스가 걸려 있다). */
  const setDefault = async (s: SavedQuery) => {
    if (!companyId) return;
    const on = !s.is_default;
    if (on) {
      const { error: e1 } = await supabase.from("saved_queries")
        .update({ is_default: false }).eq("screen", screen).eq("company_id", companyId).neq("id", s.id);
      if (e1) { toast(`바꾸지 못했습니다 — ${e1.message}`, "error"); return; }
    }
    const { error } = await supabase.from("saved_queries").update({ is_default: on }).eq("id", s.id);
    if (error) { toast(`바꾸지 못했습니다 — ${error.message}`, "error"); return; }
    qc.invalidateQueries({ queryKey: key });
    toast(on ? `'${s.name}' 을(를) 기본 조건으로 두었습니다` : "기본 조건을 해제했습니다", "info");
  };

  return { list, isFetched, save, remove, setDefault, def: list.find((s) => s.is_default) ?? null };
}

/**
 * 패널 머리의 '내 조건' 목록 — **불러오기 전용** (2026-08-13 사장님 지적).
 *   예전엔 여기 '＋ 내 조건' 이 있어 이름만 치면 바로 저장됐다. 사람은 위→아래로 읽으니
 *   **아래 조건을 고르기도 전에** 저장해 버린다. 저장은 발(ConditionSave)로 내렸다.
 *   맨 앞의 **기본** 은 처음 상태 — ★ 조건을 정해 둬도 한 번 눌러 돌아온다.
 */
export function SavedTabs({
  list, current, basic, onApply, onBasic, onRemove, onSetDefault,
}: {
  list: SavedQuery[];
  /** 지금 걸린 조건 — 어느 것이 켜졌는지 표시하려고 견준다 */
  current: Record<string, unknown>;
  /** '기본' 이 뜻하는 조건 */
  basic: Record<string, unknown>;
  onApply: (s: SavedQuery) => void;
  onBasic: () => void;
  onRemove: (s: SavedQuery) => void;
  onSetDefault: (s: SavedQuery) => void;
}) {
  //   ★ 그냥 JSON.stringify 로 견주면 **늘 다르게** 나온다 — Postgres jsonb 가 키 순서를 제 맘대로
  //     바꿔 저장하기 때문이다(실제로 저장한 조건을 불러와도 '임시 조건'으로 떴다).
  //     키를 정렬하고 배열(거래처·계좌 묶음)도 정렬해 **내용만** 견준다.
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? [...v.map(canon)].sort((x, y) => String(x).localeCompare(String(y)))
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort()
            .map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const hit = list.find((s) => same(s.params, current));
  const isBasic = same(current, basic);
  return (
    <span className="qk-tabs">
      <button type="button" title="처음 상태로 — 기본 기간, 조건 없음"
        className={isBasic ? "qk-tab qk-tab-on" : "qk-tab"} onClick={onBasic}>기본</button>
      {list.map((s) => (
        <span key={s.id} className={`qk-tab${hit?.id === s.id ? " qk-tab-on" : ""}${s.is_default ? " qk-tab-def" : ""}`}>
          <button type="button" className="qk-tab-star" onClick={() => onSetDefault(s)}
            title={s.is_default ? "기본으로 열기 해제" : "화면을 열 때 이 조건으로"}>{s.is_default ? "★" : "☆"}</button>
          <button type="button" className="qk-tab-name" onClick={() => onApply(s)}>{s.name}</button>
          <button type="button" className="qk-tab-x" aria-label={`${s.name} 삭제`} onClick={() => onRemove(s)}>✕</button>
        </span>
      ))}
      {/*   저장해 둔 것과도 기본과도 다르면 지금 보는 게 뭔지 헷갈린다 — 그렇다고 적어 준다 */}
      {!isBasic && !hit && <span className="qk-tab-dirty">· 임시 조건</span>}
    </span>
  );
}

/**
 * 패널 발의 '내 조건으로 저장' — **조건을 다 고른 뒤** 이름을 붙인다.
 *   누르면 발 바로 위에 이름 줄이 열린다. 이름은 고른 조건으로 미리 지어 준다 —
 *   매번 뭐라고 쓸지 고민하게 두지 않는다.
 */
export function ConditionSave({
  suggest, onSave,
}: { suggest: () => string; onSave: (name: string, asDefault: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [asDefault, setAsDefault] = useState(false);
  //   ★ 이름은 30자까지 (DB check). 지어 준 이름이 그걸 넘으면 **저장이 400 으로 튕긴다** —
  //     실제로 `보조금_홍보지원 ···4017 · (주)모티브이노베이션 · 미처리`(38자)로 겪었다.
  //     사람이 친 것은 maxLength 가 막지만 **지어 준 값은 안 막힌다**. 여기서 자른다.
  const clip = (v: string) => v.slice(0, 30).trim();
  const start = () => { setName(clip(suggest())); setAsDefault(false); setOpen(true); };
  const done = () => { const n = clip(name); if (!n) return; onSave(n, asDefault); setOpen(false); };
  return (
    <>
      {open && (
        <div className="qk-savebar">
          <span className="qk-savebar-lbl">조건 이름</span>
          <input autoFocus value={name} maxLength={30} placeholder="예: 운영계좌 미처리"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(); }
                                if (e.key === "Escape") setOpen(false); }} />
          <label className="qk-savebar-def">
            <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />
            화면 열 때 이 조건으로
          </label>
          <span className="qk-savebar-grow" />
          <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!name.trim()} onClick={done}>저장</button>
        </div>
      )}
      <button type="button" className="btn-secondary btn-sm" onClick={start}>＋ 내 조건으로 저장</button>
    </>
  );
}
