"use client";

// 예쁜 커스텀 날짜 선택 — 네이티브 <input type="date"> 드롭인 대체.
//   onChange 는 input 호환({ target: { value } })이라 기존 핸들러(e.target.value) 그대로 동작.
//   value/onChange/min/max/className/disabled/placeholder/id/name 지원. body 포털로 어디서든 안 잘림.
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const sel = parseYmd(value);
  const today = new Date();
  const [view, setView] = useState(() => sel ? { y: sel.y, m: sel.m } : { y: today.getFullYear(), m: today.getMonth() + 1 });

  useEffect(() => { if (sel) setView({ y: sel.y, m: sel.m }); /* eslint-disable-next-line */ }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (btnRef.current && !btnRef.current.contains(e.target as Node)) { const pop = document.getElementById("datefield-pop"); if (pop && pop.contains(e.target as Node)) return; setOpen(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const W = 256, H = 300;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
      const top = r.bottom + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen((o) => !o);
  };
  const emit = (v: string) => { onChange?.({ target: { value: v } }); setOpen(false); };

  // autoFocus: 마운트 시 달력 자동 오픈 (인라인 편집 셀용)
  useEffect(() => { if (autoFocus) toggle(); /* eslint-disable-next-line */ }, []);
  // onBlur: 팝오버가 닫힐 때 호출 (편집 종료 신호)
  const prevOpen = useRef(false);
  useEffect(() => { if (prevOpen.current && !open) onBlur?.(); prevOpen.current = open; /* eslint-disable-next-line */ }, [open]);

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

  const popStyle: CSSProperties = pos ? { position: "fixed", top: pos.top, left: pos.left, width: 256, zIndex: 90 } : { display: "none" };

  return (
    <>
      <button ref={btnRef} type="button" id={id} disabled={disabled} onClick={toggle} title={title} style={style}
        className={`${className} inline-flex items-center justify-between gap-2 text-left ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
        <span className={value ? "text-[var(--text)] mono-number" : "text-[var(--text-dim)]"}>{value || placeholder}</span>
        <svg className="w-3.5 h-3.5 shrink-0 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      {name && <input type="hidden" name={name} value={value || ""} readOnly />}
      {open && typeof document !== "undefined" && createPortal(
        <div id="datefield-pop" style={popStyle} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl p-2.5 select-none">
          <div className="flex items-center justify-between mb-2 px-0.5">
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={prevYear} title="이전 연도" className="w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center text-xs font-bold">«</button>
              <button type="button" onClick={prevMonth} title="이전 달" className="w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center">‹</button>
            </div>
            <div className="text-sm font-bold text-[var(--text)] tabular-nums">{view.y}년 {view.m}월</div>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={nextMonth} title="다음 달" className="w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center">›</button>
              <button type="button" onClick={nextYear} title="다음 연도" className="w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center text-xs font-bold">»</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WD.map((w, i) => (
              <div key={w} className={`h-6 flex items-center justify-center text-[10px] font-semibold ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-[var(--text-dim)]"}`}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
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
                  className={`relative h-7 rounded-lg text-xs font-medium transition flex items-center justify-center
                    ${isSel ? "bg-[var(--primary)] text-white font-bold" : dis ? "text-[var(--text-dim)]/40 cursor-not-allowed" : `hover:bg-[var(--bg-surface)] ${(dow === 0 || holiday) ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-[var(--text)]"}`}
                    ${isToday && !isSel ? "ring-1 ring-inset ring-[var(--primary)]/50" : ""}`}>
                  {d}
                  {holiday && !isSel && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400" />}
                </button>
              );
            })}
          </div>
          {monthHols.length > 0 && (
            <div className="mt-1.5 px-1 text-[10px] leading-snug text-red-400/90">
              {monthHols.map((h) => `${h.d}일 ${h.name}`).join("  ·  ")}
            </div>
          )}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]/60">
            <button type="button" onClick={() => emit("")} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] px-1.5 py-1">지우기</button>
            <button type="button" onClick={() => emit(ymd(today.getFullYear(), today.getMonth() + 1, today.getDate()))} className="text-[11px] font-semibold text-[var(--primary)] hover:underline px-1.5 py-1">오늘</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
