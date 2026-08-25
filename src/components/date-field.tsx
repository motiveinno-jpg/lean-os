"use client";

// 예쁜 커스텀 날짜 선택 — 네이티브 <input type="date"> 드롭인 대체.
//   onChange 는 input 호환({ target: { value } })이라 기존 핸들러(e.target.value) 그대로 동작.
//   value/onChange/min/max/className/disabled/placeholder/id/name 지원. body 포털로 어디서든 안 잘림.
//   2026-08-19 사장님: ① 칸에서 숫자를 키보드로 바로 입력 가능(20260821 · 2026-8-21 · 0821 · 8-21,
//   Enter 로 반영) ② 머리의 "YYYY년 M월"을 누르면 연·월 선택 모드로 바뀌어 연 단위 이동.
//   2026-08-25 사장님: ③ 머리 클릭 → 연도 그리드 선택 → 연도 고르면 월 선택 → 일 선택(3단 드릴다운).
//   ④ 완성된 날짜를 키보드로 치면 Enter 없이 바로 반영, 유효한 날짜를 쳐두고 포커스가 빠져도 되돌리지 않는다.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getHoliday } from "@/lib/holidays";

type ChangeLike = { target: { value: string } };

const WD = ["일", "월", "화", "수", "목", "금", "토"];

function parseYmd(v?: string | null): { y: number; m: number; d: number } | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// 자유 입력 해석 — 구분자(-, ., /, 공백, 년월일) 허용. 8자리=YMD · 4자리=올해 MMDD ·
//   두 조각=올해 M-D · 세 조각=Y-M-D. 실제 존재하는 날짜만 통과(2/30 등 거부).
function parseLoose(text: string, fallbackYear: number): { y: number; m: number; d: number } | null {
  const s = text.trim().replace(/[.\s/년월일]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) return null;
  let y: number, m: number, d: number;
  if (/^\d{8}$/.test(s)) { y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8); }
  else if (/^\d{4}$/.test(s)) { y = fallbackYear; m = +s.slice(0, 2); d = +s.slice(2, 4); }
  else {
    const parts = s.split("-").filter(Boolean);
    if (parts.some((p) => !/^\d+$/.test(p))) return null;
    const nums = parts.map(Number);
    if (nums.length === 3) [y, m, d] = nums as [number, number, number];
    else if (nums.length === 2) { y = fallbackYear; [m, d] = nums as [number, number]; }
    else return null;
  }
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return { y, m, d };
}

// 연도가 확실히 들어간 '완성된' 입력인가 — Enter 없이 바로 반영해도 되는지 판단.
//   YYYYMMDD(8자리) 또는 세 조각 중 첫 조각이 4자리 연도(YYYY-M-D)일 때만 true.
//   (올해 기준 MMDD·M-D 같은 축약형은 치는 도중 조기 확정되면 곤란하므로 Enter/블러로 반영.)
function isCompleteDateInput(text: string): boolean {
  const t = text.trim();
  if (/^\d{8}$/.test(t)) return true;
  const parts = t.replace(/[.\s/년월일]+/g, "-").split("-").filter(Boolean);
  return parts.length === 3 && /^\d{4}$/.test(parts[0]);
}

// 12년 묶음 그리드의 시작 연도
const yearBlock = (y: number) => Math.floor(y / 12) * 12;

export function DateField({
  value, onChange, min, max, className = "", disabled, placeholder = "연도-월-일", id, name,
  title, style, autoFocus, onBlur,
}: {
  value?: string | null;
  onChange?: (e: ChangeLike) => void;
  min?: string; max?: string;
  className?: string; disabled?: boolean; placeholder?: string;
  id?: string; name?: string;
  title?: string; style?: CSSProperties; autoFocus?: boolean; onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // 머리 클릭 드릴다운: false(일) → "year"(연도 그리드) → "month"(월 그리드) → false(일)
  const [pick, setPick] = useState<false | "year" | "month">(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sel = parseYmd(value);
  const today = new Date();
  const [view, setView] = useState(() => sel ? { y: sel.y, m: sel.m } : { y: today.getFullYear(), m: today.getMonth() + 1 });
  // 연도 그리드가 보여줄 12년 묶음의 시작 연도
  const [yearWin, setYearWin] = useState(() => yearBlock(sel ? sel.y : today.getFullYear()));
  // 키보드 입력 초안 — 편집 중이 아닐 땐 항상 저장값을 비춘다
  const [draft, setDraft] = useState(value || "");
  const [editing, setEditing] = useState(false);
  const committedRef = useRef(false);

  useEffect(() => { if (sel) setView({ y: sel.y, m: sel.m }); if (!editing) setDraft(value || ""); /* eslint-disable-next-line */ }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (btnRef.current && !btnRef.current.contains(e.target as Node)) { const pop = document.getElementById("datefield-pop"); if (pop && pop.contains(e.target as Node)) return; setOpen(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const place = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const W = 256, H = 300;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const top = r.bottom + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4;
    setPos({ top, left });
  };
  const openPop = () => { if (disabled || open) return; place(); setPick(false); setOpen(true); };
  const toggle = () => {
    if (disabled) return;
    if (!open) { place(); setPick(false); }
    setOpen((o) => !o);
  };
  const emit = (v: string) => {
    committedRef.current = true;
    onChange?.({ target: { value: v } });
    setEditing(false);
    setDraft(v);
    setOpen(false);
  };

  // autoFocus: 마운트 시 달력 자동 오픈 (인라인 편집 셀용)
  useEffect(() => { if (autoFocus) { inputRef.current?.focus(); toggle(); } /* eslint-disable-next-line */ }, []);
  // onBlur: 팝오버가 닫힐 때 호출 (편집 종료 신호)
  const prevOpen = useRef(false);
  useEffect(() => { if (prevOpen.current && !open) { setPick(false); onBlur?.(); } prevOpen.current = open; /* eslint-disable-next-line */ }, [open]);

  // ── 키보드 입력 ──
  const withinRange = (v: string) => !((min && v < min) || (max && v > max));
  const handleType = (raw: string) => {
    setEditing(true);
    setDraft(raw);
    const p = parseLoose(raw, view.y);
    if (p) {
      setView({ y: p.y, m: p.m }); // 치는 대로 달력이 따라간다
      // 연도까지 완성된 날짜면 Enter 없이 바로 반영 (2026-08-25 사장님)
      if (isCompleteDateInput(raw)) {
        const v = ymd(p.y, p.m, p.d);
        if (withinRange(v)) emit(v);
      }
    }
  };
  const commitDraft = () => {
    const t = draft.trim();
    if (t === "") { emit(""); return; }
    const p = parseLoose(t, view.y);
    if (!p) { setEditing(false); setDraft(value || ""); return; } // 해석 불가 — 원래 값으로
    const v = ymd(p.y, p.m, p.d);
    if (!withinRange(v)) { setEditing(false); setDraft(value || ""); return; }
    emit(v);
  };
  const handleInputBlur = () => {
    // 팝오버(포털) 클릭으로 빠지는 블러는 무시 — 확정은 Enter/날짜 클릭으로
    setTimeout(() => {
      if (committedRef.current) { committedRef.current = false; return; }
      const pop = document.getElementById("datefield-pop");
      if (pop && pop.contains(document.activeElement)) return;
      // 유효한 날짜를 쳐두고 포커스가 빠지면 되돌리지 말고 반영 (2026-08-25 사장님)
      const t = draft.trim();
      if (t !== "" && t !== (value || "")) {
        const p = parseLoose(t, view.y);
        if (p) {
          const v = ymd(p.y, p.m, p.d);
          if (withinRange(v)) { emit(v); return; }
        }
      }
      setEditing(false);
      setDraft(value || "");
    }, 120);
  };

  // 달력 그리드
  const first = new Date(view.y, view.m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthHols: { d: number; name: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) { const n = getHoliday(ymd(view.y, view.m, d)); if (n) monthHols.push({ d, name: n }); }
  const isDisabled = (d: number) => {
    const v = ymd(view.y, view.m, d);
    if (min && v < min) return true;
    if (max && v > max) return true;
    return false;
  };
  const prevMonth = () => setView((v) => v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 });
  const nextMonth = () => setView((v) => v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 });
  const prevYear = () => setView((v) => ({ y: v.y - 1, m: v.m }));
  const nextYear = () => setView((v) => ({ y: v.y + 1, m: v.m }));
  const prevYear10 = () => setView((v) => ({ y: v.y - 10, m: v.m }));
  const nextYear10 = () => setView((v) => ({ y: v.y + 10, m: v.m }));

  // 머리 클릭: 일 → 연도 그리드, 월 → 연도 그리드(다시 위로), 연도 → 일(취소)
  const openYear = () => { setYearWin(yearBlock(view.y)); setPick("year"); };
  const headerClick = () => { if (pick === "year") setPick(false); else openYear(); };
  // 네비게이션 화살표 — 모드별로 의미가 다르다
  const navPrevOuter = () => { if (pick === "year") setYearWin((w) => w - 12); else if (pick === "month") prevYear10(); else prevYear(); };
  const navPrevInner = () => { if (pick === "year") setYearWin((w) => w - 12); else if (pick === "month") prevYear(); else prevMonth(); };
  const navNextInner = () => { if (pick === "year") setYearWin((w) => w + 12); else if (pick === "month") nextYear(); else nextMonth(); };
  const navNextOuter = () => { if (pick === "year") setYearWin((w) => w + 12); else if (pick === "month") nextYear10(); else nextYear(); };
  const headerLabel = pick === "year" ? `${yearWin} - ${yearWin + 11}` : pick === "month" ? `${view.y}년` : `${view.y}년 ${view.m}월`;
  const outerPrevTitle = pick === "year" ? "이전 12년" : pick === "month" ? "10년 전" : "이전 연도";
  const innerPrevTitle = pick === "year" ? "이전 12년" : pick === "month" ? "이전 연도" : "이전 달";
  const innerNextTitle = pick === "year" ? "다음 12년" : pick === "month" ? "다음 연도" : "다음 달";
  const outerNextTitle = pick === "year" ? "다음 12년" : pick === "month" ? "10년 후" : "다음 연도";
  const headerTitle = pick === "year" ? "일 선택으로 돌아가기" : pick === "month" ? "연도 선택으로" : "연·월 바로 이동";

  const popStyle: CSSProperties = pos ? { position: "fixed", top: pos.top, left: pos.left, width: 256, zIndex: 90 } : { display: "none" };
  const navBtnCls = "w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center";

  return (
    <>
      <div ref={btnRef} title={title} style={style}
        onClick={() => { if (!disabled) { inputRef.current?.focus(); openPop(); } }}
        className={`date-field-button ${className} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-text"}`}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={editing ? draft : (value || "")}
          placeholder={placeholder}
          onChange={(e) => handleType(e.target.value)}
          // 포커스 시 기존값 전체 선택 → 키보드로 치면 기존값에 덧붙지 않고 대체된다 (2026-08-25 사장님).
          //   달력만 클릭할 땐 타이핑이 없으므로 값은 그대로 보존된다.
          onFocus={() => { openPop(); setTimeout(() => inputRef.current?.select(), 0); }}
          onBlur={handleInputBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
            if (e.key === "Escape") { setEditing(false); setDraft(value || ""); setOpen(false); }
          }}
          className={`date-field-typed-input mono-number ${value || editing ? "text-[var(--text)]" : ""}`}
        />
        <svg onClick={(e) => { e.stopPropagation(); toggle(); }} className="w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] cursor-pointer" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      {name && <input type="hidden" name={name} value={value || ""} readOnly />}
      {open && typeof document !== "undefined" && createPortal(
        <div id="datefield-pop" style={popStyle} className="date-field-popover">
          <div className="date-field-popover-header">
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={navPrevOuter} title={outerPrevTitle} className={`${navBtnCls} text-xs font-bold`}>«</button>
              <button type="button" onClick={navPrevInner} title={innerPrevTitle} className={navBtnCls}>‹</button>
            </div>
            {/* 머리 클릭 → 연도 그리드 → 월 그리드 → 일 (2026-08-25 사장님) */}
            <button type="button" onClick={headerClick} title={headerTitle}
              className="text-sm font-bold text-[var(--text)] tabular-nums px-2 py-0.5 rounded-lg hover:bg-[var(--bg-surface)] transition">
              {headerLabel}<span className="ml-1 text-[9px] text-[var(--text-dim)]">▾</span>
            </button>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={navNextInner} title={innerNextTitle} className={navBtnCls}>›</button>
              <button type="button" onClick={navNextOuter} title={outerNextTitle} className={`${navBtnCls} text-xs font-bold`}>»</button>
            </div>
          </div>
          {pick === "year" ? (
            <div className="date-field-month-grid">
              {Array.from({ length: 12 }, (_, i) => yearWin + i).map((y) => (
                <button key={y} type="button" onClick={() => { setView((v) => ({ y, m: v.m })); setPick("month"); }}
                  className={`date-field-month-btn ${view.y === y ? "date-field-month-btn-on" : ""}`}>
                  {y}
                </button>
              ))}
            </div>
          ) : pick === "month" ? (
            <div className="date-field-month-grid">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <button key={m} type="button" onClick={() => { setView((v) => ({ y: v.y, m })); setPick(false); }}
                  className={`date-field-month-btn ${view.m === m ? "date-field-month-btn-on" : ""}`}>
                  {m}월
                </button>
              ))}
            </div>
          ) : (<>
          <div className="date-field-weekday-row">
            {WD.map((w, i) => (
              <div key={w} className={`date-field-weekday ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-[var(--text-dim)]"}`}>{w}</div>
            ))}
          </div>
          <div className="date-field-grid">
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const dow = (startDow + d - 1) % 7;
              const dayStr = ymd(view.y, view.m, d);
              const holiday = getHoliday(dayStr);
              const isSel = sel && sel.y === view.y && sel.m === view.m && sel.d === d;
              const isToday = today.getFullYear() === view.y && today.getMonth() + 1 === view.m && today.getDate() === d;
              const dis = isDisabled(d);
              return (
                <button key={d} type="button" disabled={dis} onClick={() => emit(dayStr)} title={holiday || undefined}
                  className={`date-field-day-btn
                    ${isSel ? "bg-[var(--primary)] text-white font-bold" : dis ? "text-[var(--text-dim)]/40 cursor-not-allowed" : `hover:bg-[var(--bg-surface)] ${(dow === 0 || holiday) ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-[var(--text)]"}`}
                    ${isToday && !isSel ? "ring-1 ring-inset ring-[var(--primary)]/50" : ""}`}>
                  {d}
                  {holiday && !isSel && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400" />}
                </button>
              );
            })}
          </div>
          {monthHols.length > 0 && (
            <div className="date-field-holidays">
              {monthHols.map((h) => `${h.d}일 ${h.name}`).join("  ·  ")}
            </div>
          )}
          <div className="date-field-footer">
            <button type="button" onClick={() => emit("")} className="date-field-clear-btn">지우기</button>
            <button type="button" onClick={() => emit(ymd(today.getFullYear(), today.getMonth() + 1, today.getDate()))} className="date-field-today-btn">오늘</button>
          </div>
          </>)}
        </div>,
        document.body,
      )}
    </>
  );
}
