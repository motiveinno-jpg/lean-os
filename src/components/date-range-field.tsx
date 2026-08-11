"use client";

// 조회기간 — 타이핑 + 두 달 달력 (2026-08-11 사장님 지시)
//
//   · 평소엔 칩 하나. 달력은 아이콘을 눌렀을 때만 열린다(툴바가 넓어지지 않는다).
//   · 년4·월2·일2 **고정 칸**에 숫자를 치면 다 채워질 때 다음 칸으로 저절로 넘어간다.
//   · 지름길: 년 `9999` → 올해 · 월 `99` → 이번 달 · 일 `99` → 오늘.
//   · 달력에서 시작일·종료일을 찍어도 되고, 아래 작은 글씨로 1개월·3개월·6개월·1년을 한 번에 고른다.
//
//   ⚠️ 날짜는 **문자열(YYYY-MM-DD)로만** 다룬다. toISOString() 을 쓰면 KST 자정이 UTC 로 밀려
//     하루 전으로 저장되는 사고가 이 저장소에서 실제로 있었다.

import { useEffect, useMemo, useRef, useState } from "react";
import { todayKst } from "@/lib/kst";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const parse = (s: string) => {
  const [y, m, d] = String(s || "").split("-").map(Number);
  return { y: y || 0, m: m || 0, d: d || 0 };
};
/** 날짜를 n 일 뒤로 민 값 — 문자열로만 다룬다(UTC 로 새지 않게) */
function minusDays(s: string, n: number): string {
  const { y, m, d } = parse(s);
  const dt = new Date(y, m - 1, d - n);
  return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}
/** 달을 n 개 뒤로 민 날짜 (말일 넘침은 그 달 말일로 맞춘다) */
function minusMonths(s: string, n: number): string {
  const { y, m, d } = parse(s);
  const total = y * 12 + (m - 1) - n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, lastDay(ny, nm)));
}
const addMonth = (y: number, m: number, n: number) => {
  const t = y * 12 + (m - 1) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
/** 그 달 달력 칸 — 앞뒤 빈칸을 이웃 달 날짜로 채워 7의 배수로 맞춘다 */
function monthCells(y: number, m: number) {
  const first = new Date(y, m - 1, 1).getDay();      // 0=일
  const len = lastDay(y, m);
  const prev = addMonth(y, m, -1);
  const prevLen = lastDay(prev.y, prev.m);
  const next = addMonth(y, m, 1);
  const cells: { date: string; day: number; out: boolean; dow: number }[] = [];
  for (let i = first - 1; i >= 0; i--) {
    const d = prevLen - i;
    cells.push({ date: ymd(prev.y, prev.m, d), day: d, out: true, dow: cells.length % 7 });
  }
  for (let d = 1; d <= len; d++) cells.push({ date: ymd(y, m, d), day: d, out: false, dow: cells.length % 7 });
  while (cells.length % 7 !== 0) {
    const d = cells.length - first - len + 1;
    cells.push({ date: ymd(next.y, next.m, d), day: d, out: true, dow: cells.length % 7 });
  }
  return cells;
}

type Seg = "fy" | "fm" | "fd" | "ty" | "tm" | "td";
const SEG_ORDER: Seg[] = ["fy", "fm", "fd", "ty", "tm", "td"];
//   월 단위에서는 '일' 칸이 없다 — 부가세·손익은 월이 최소 단위라 반달을 고를 일이 없다
const SEG_ORDER_M: Seg[] = ["fy", "fm", "ty", "tm"];
const QUARTER_START = (m: number) => m - ((m - 1) % 3);

/**
 * @param unit "day" = YYYY-MM-DD 주고받음(기본) · "month" = **YYYY-MM** 주고받음.
 *   월 단위는 부가세·손익처럼 **월이 최소 단위**인 화면에 쓴다. 반달 손익은 회계적으로 의미가 흐리고,
 *   반달만 신고하는 실수도 막는다. 생김새·조작법은 같고 고르는 알갱이만 달라진다.
 */
export function DateRangeField({
  from, to, onChange, label = "조회기간", unit = "day",
}: {
  from: string; to: string;
  onChange: (from: string, to: string) => void;
  label?: string;
  unit?: "day" | "month";
}) {
  const isM = unit === "month";
  const order = isM ? SEG_ORDER_M : SEG_ORDER;
  const today = todayKst();
  const nowYM = today.slice(0, 7);
  const [open, setOpen] = useState(false);
  //   달력 왼쪽 달 (오른쪽은 그 다음 달)
  const [view, setView] = useState(() => { const p = parse(from); return { y: p.y, m: p.m }; });
  //   시작일만 찍은 중간 상태 — 이때는 목록을 바꾸지 않는다
  const [half, setHalf] = useState<string | null>(null);
  //   타이핑 중인 글자 (확정 전) — 다 치면 그때 onChange 로 올린다
  const [draft, setDraft] = useState<Partial<Record<Seg, string>>>({});
  const boxRef = useRef<HTMLDivElement>(null);
  const inputs = useRef<Partial<Record<Seg, HTMLInputElement | null>>>({});
  //   다음에 옮겨 갈 칸 — 값이 바뀌면 부모까지 다시 그려지므로 **렌더가 끝난 뒤** 옮겨야 한다.
  //   바로 focus() 하면 아직 옛 DOM 이라 옮겨지지 않거나, 곧바로 다시 그려지며 포커스를 잃는다.
  const [focusNext, setFocusNext] = useState<Seg | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setHalf(null); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setHalf(null); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { const p = parse(from); setView({ y: p.y, m: p.m }); }, [from]);

  useEffect(() => {
    if (!focusNext) return;
    const el = inputs.current[focusNext];
    if (el) { el.focus(); el.select(); }
    setFocusNext(null);
  }, [focusNext, from, to]);

  const f = parse(from), t = parse(to);
  //   월 단위는 '그 달 1일 ~ 그 달 말일'로 펼쳐 달력·일수 계산에 쓴다
  const fFull = isM ? ymd(f.y, f.m, 1) : from;
  const tFull = isM ? ymd(t.y, t.m, lastDay(t.y, t.m)) : to;
  const segValue = (s: Seg): string => {
    if (draft[s] != null) return draft[s]!;
    switch (s) {
      case "fy": return pad(f.y, 4); case "fm": return pad(f.m); case "fd": return pad(f.d);
      case "ty": return pad(t.y, 4); case "tm": return pad(t.m); case "td": return pad(t.d);
    }
  };

  /** 지름길 + 범위 보정 — 9999=올해, 99=이번 달/오늘 */
  const normalize = (s: Seg, raw: string): number => {
    const now = parse(today);
    const n = Number(raw);
    if (s === "fy" || s === "ty") return raw === "9999" ? now.y : Math.min(2999, Math.max(1900, n || now.y));
    if (s === "fm" || s === "tm") return raw === "99" ? now.m : Math.min(12, Math.max(1, n || now.m));
    if (raw === "99") return now.d;
    return Math.max(1, n || now.d);   // 말일 보정은 아래에서 (그 달을 알아야 한다)
  };

  const commit = (next: Partial<Record<Seg, string>>) => {
    const get = (s: Seg) => (next[s] != null ? next[s]! : segValue(s));
    const fy = normalize("fy", get("fy")), fm = normalize("fm", get("fm"));
    const ty = normalize("ty", get("ty")), tm = normalize("tm", get("tm"));
    if (isM) {
      let a = `${pad(fy, 4)}-${pad(fm)}`, b = `${pad(ty, 4)}-${pad(tm)}`;
      if (a > b) [a, b] = [b, a];
      setDraft({});
      onChange(a, b);
      return;
    }
    const fd = Math.min(normalize("fd", get("fd")), lastDay(fy, fm));
    const td = Math.min(normalize("td", get("td")), lastDay(ty, tm));
    let a = ymd(fy, fm, fd), b = ymd(ty, tm, td);
    if (a > b) [a, b] = [b, a];        // 거꾸로 치면 바꿔 준다
    setDraft({});
    onChange(a, b);
  };

  const onSegChange = (s: Seg, v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, s.endsWith("y") ? 4 : 2);
    const next = { ...draft, [s]: digits };
    setDraft(next);
    //   다 채우면 저절로 다음 칸으로 — 년4·월2·일2 고정
    if (digits.length === (s.endsWith("y") ? 4 : 2)) {
      const i = order.indexOf(s);
      const nx = order[i + 1];
      if (nx) setFocusNext(nx);
      else commit(next);
    }
  };

  /** 다 골랐으면 확정하고 닫는다 — 화면마다 열린 채로 남거나 닫히거나 하면 헷갈린다.
   *  값이 정해진 뒤엔 칩에 그대로 보이므로 굳이 열어 둘 이유가 없다. */
  const settle = (a: string, b: string) => {
    setHalf(null);
    onChange(a, b);
    setOpen(false);
  };

  /** 월 단위 — 월 칸을 눌러 시작·종료 월을 잡는다 */
  const pickMonth = (ym: string) => {
    if (!half) { setHalf(ym); return; }
    let a = half, b = ym;
    if (a > b) [a, b] = [b, a];
    settle(a, b);
  };

  const pickDay = (date: string) => {
    if (!half) { setHalf(date); return; }
    let a = half, b = date;
    if (a > b) [a, b] = [b, a];
    settle(a, b);
  };

  //   자주 쓰는 기간 — 사장님이 당일·1주일을 제일 많이 쓴다 하여 맨 앞에 둔다 (2026-08-11).
  //   당일은 하루, 1주일은 **오늘 포함 최근 7일**. 나머지는 '그 달 전 같은 날부터 오늘'.
  const QUICKS: { label: string; start: () => string }[] = isM
    //   월 단위 빠른 선택은 **신고 주기**에 맞춘다 — 이번 달·지난 달·분기·반기·올해
    ? [
        { label: "이번 달", start: () => nowYM },
        { label: "지난 달", start: () => minusMonths(today, 1).slice(0, 7) },
        { label: "이번 분기", start: () => `${today.slice(0, 4)}-${pad(QUARTER_START(Number(today.slice(5, 7))))}` },
        { label: "반기", start: () => `${today.slice(0, 4)}-${Number(today.slice(5, 7)) <= 6 ? "01" : "07"}` },
        { label: "올해", start: () => `${today.slice(0, 4)}-01` },
      ]
    : [
        { label: "당일", start: () => today },
        { label: "1주일", start: () => minusDays(today, 6) },
        { label: "1개월", start: () => minusMonths(today, 1) },
        { label: "3개월", start: () => minusMonths(today, 3) },
        { label: "6개월", start: () => minusMonths(today, 6) },
        { label: "1년", start: () => minusMonths(today, 12) },
      ];
  //   월 단위에서 '끝'은 오늘이 아니라 **이번 달**이다
  const quickEnd = isM ? nowYM : today;
  const [activeQuick, setActiveQuick] = useState<string | null>(null);
  useEffect(() => { setActiveQuick(null); }, [from, to]);

  const right = addMonth(view.y, view.m, 1);
  const days = useMemo(() => {
    const a = parse(fFull), b = parse(tFull);
    return Math.max(1, Math.round(
      (new Date(b.y, b.m - 1, b.d).getTime() - new Date(a.y, a.m - 1, a.d).getTime()) / 86400000) + 1);
  }, [fFull, tFull]);
  //   월 단위에서는 '몇 개월'이 더 읽기 쉽다
  const months = useMemo(() => (t.y * 12 + t.m) - (f.y * 12 + f.m) + 1, [from, to]);

  const cellClass = (c: { date: string; out: boolean; dow: number }) => {
    const lo = half ?? from, hi = half ?? to;
    const a = half ? (half < to ? half : to) : from;
    const b = half ? (half < to ? to : half) : to;
    const isEdge = c.date === (half ?? from) || c.date === (half ? (half < to ? to : half) : to);
    const inRange = c.date > a && c.date < b;
    const cls = ["drf-day"];
    if (c.out) cls.push("drf-out");
    if (c.dow === 0) cls.push("drf-sun");
    if (c.dow === 6) cls.push("drf-sat");
    if (inRange) cls.push("drf-in");
    if (c.date === a) cls.push("drf-edge", "drf-edge-s");
    if (c.date === b && b !== a) cls.push("drf-edge", "drf-edge-e");
    if (c.date === a && b === a) cls.push("drf-edge", "drf-edge-one");
    if (c.date === today) cls.push("drf-today");
    void lo; void hi;
    return cls.join(" ");
  };

  /** 한 해의 12개월 칸 */
  const YearCal = ({ y }: { y: number }) => {
    const a = half ? (half < to ? half : to) : from;
    const b = half ? (half < to ? to : half) : to;
    return (
      <div className="drf-cal drf-cal-y">
        <div className="drf-cal-title">{y}년</div>
        <div className="drf-months">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const ym = `${pad(y, 4)}-${pad(m)}`;
            const cls = ["drf-mon"];
            if (ym > a && ym < b) cls.push("drf-in");
            if (ym === a) cls.push("drf-edge", "drf-edge-s");
            if (ym === b && b !== a) cls.push("drf-edge", "drf-edge-e");
            if (ym === a && b === a) cls.push("drf-edge", "drf-edge-one");
            if (ym === nowYM) cls.push("drf-today");
            return (
              <button key={ym} type="button" className={cls.join(" ")} onClick={() => pickMonth(ym)}>
                {m}월
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const Cal = ({ y, m }: { y: number; m: number }) => (
    <div className="drf-cal">
      <div className="drf-cal-title">{y}년 {m}월</div>
      <div className="drf-dow">{["일", "월", "화", "수", "목", "금", "토"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="drf-days">
        {monthCells(y, m).map((c) => (
          <button key={c.date} type="button" className={cellClass(c)} onClick={() => pickDay(c.date)}>{c.day}</button>
        ))}
      </div>
    </div>
  );

  const seg = (s: Seg, w: string, aria: string) => (
    <input
      ref={(el) => { inputs.current[s] = el; }}
      value={segValue(s)}
      onChange={(e) => onSegChange(s, e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => { if (!focusNext && Object.keys(draft).length) commit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { commit(draft); (e.target as HTMLInputElement).blur(); }
        if (e.key === "Backspace" && !segValue(s)) {
          const i = order.indexOf(s); const pv = order[i - 1];
          if (pv) inputs.current[pv]?.focus();
        }
      }}
      inputMode="numeric" aria-label={aria}
      className={`drf-seg ${w}`}
    />
  );

  return (
    <div className="drf" ref={boxRef}>
      <span className="drf-label">{label}</span>
      <div className={open ? "drf-chip drf-chip-open" : "drf-chip"}>
        {seg("fy", "drf-y", "시작 연도")}<i>-</i>{seg("fm", "drf-md", "시작 월")}
        {!isM && <><i>-</i>{seg("fd", "drf-md", "시작 일")}</>}
        <i className="drf-tilde">~</i>
        {seg("ty", "drf-y", "종료 연도")}<i>-</i>{seg("tm", "drf-md", "종료 월")}
        {!isM && <><i>-</i>{seg("td", "drf-md", "종료 일")}</>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="drf-cal-btn" aria-label="달력 열기">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="drf-pop">
          <div className="drf-pop-head">
            <b>조회기간</b>
            {half
              ? <span className="drf-half">시작 {half} · <b>{isM ? "종료 월을" : "종료일을"} 고르세요</b></span>
              : <span className="drf-range mono-number">{from} ~ {to} · {isM ? `${months}개월` : `${days}일`}</span>}
            <span className="drf-nav">
              <button type="button" onClick={() => setView(isM ? { y: view.y - 1, m: view.m } : addMonth(view.y, view.m, -1))}
                aria-label={isM ? "이전 해" : "이전 달"}>‹</button>
              <button type="button" onClick={() => setView(isM ? { y: view.y + 1, m: view.m } : addMonth(view.y, view.m, 1))}
                aria-label={isM ? "다음 해" : "다음 달"}>›</button>
            </span>
          </div>

          <div className="drf-cals">
            {isM ? (
              <>
                {/*   시작 연도와 그 다음 해 — 해를 걸치는 기간(2025-09~2026-08)이 흔해서
                      시작 해만 보이면 종료 월을 못 찍는다 */}
                <YearCal y={view.y} />
                <YearCal y={view.y + 1} />
              </>
            ) : (
              <>
                <Cal y={view.y} m={view.m} />
                <Cal y={right.y} m={right.m} />
              </>
            )}
          </div>

          <div className="drf-quick">
            <em>빠른 선택</em>
            {QUICKS.map((q) => (
              <button key={q.label} type="button"
                onClick={() => { setActiveQuick(q.label); settle(q.start(), quickEnd); }}
                className={activeQuick === q.label || (from === q.start() && to === quickEnd) ? "on" : ""}>
                {q.label}
              </button>
            ))}
          </div>

          <div className="drf-foot">
            <span>
              년 <b>9999</b> · {isM ? "월" : "월·일"} <b>99</b> 를 치면 오늘 기준으로 채워집니다 ·
              {isM ? " 이번 달 " : " 오늘 "}<b className="mono-number">{isM ? nowYM : today}</b>
            </span>
            <button type="button" onClick={() => { setOpen(false); setHalf(null); }} className="btn-secondary btn-sm">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
