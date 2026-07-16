"use client";

// 월 선택 — 네이티브 <input type="month"> 드롭인 대체(커스텀 팝오버).
//   value/onChange 는 month 호환("YYYY-MM"), onChange 는 { target: { value } }.
//   value/onChange/min/max/className/disabled/placeholder/id/name/title/style 지원. body 포털.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type ChangeLike = { target: { value: string } };

function parseYm(v?: string | null): { y: number; m: number } | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})/.exec(v);
  if (!m) return null;
  return { y: +m[1], m: +m[2] };
}
const pad = (n: number) => String(n).padStart(2, "0");
const ym = (y: number, m: number) => `${y}-${pad(m)}`;

export function MonthField({
  value, onChange, min, max, className = "", disabled, placeholder = "연도-월", id, name, title, style,
}: {
  value?: string | null;
  onChange?: (e: ChangeLike) => void;
  min?: string; max?: string;
  className?: string; disabled?: boolean; placeholder?: string;
  id?: string; name?: string; title?: string; style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const sel = parseYm(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(() => sel ? sel.y : today.getFullYear());

  useEffect(() => { if (sel) setViewYear(sel.y); /* eslint-disable-next-line */ }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (btnRef.current && !btnRef.current.contains(e.target as Node)) { const pop = document.getElementById("monthfield-pop"); if (pop && pop.contains(e.target as Node)) return; setOpen(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const W = 240, H = 240;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
      const top = r.bottom + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen((o) => !o);
  };
  const emit = (v: string) => { onChange?.({ target: { value: v } }); setOpen(false); };

  const minYm = parseYm(min), maxYm = parseYm(max);
  const isDisabled = (m: number) => {
    const v = ym(viewYear, m);
    if (min && v < min) return true;
    if (max && v > max) return true;
    return false;
  };

  const popStyle: CSSProperties = pos ? { position: "fixed", top: pos.top, left: pos.left, width: 240, zIndex: 90 } : { display: "none" };

  return (
    <>
      <button ref={btnRef} type="button" id={id} disabled={disabled} onClick={toggle} title={title} style={style}
        className={`${className} inline-flex items-center justify-between gap-2 text-left ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
        <span className={value ? "text-[var(--text)] mono-number" : "text-[var(--text-dim)]"}>{value || placeholder}</span>
        <svg className="w-3.5 h-3.5 shrink-0 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      {name && <input type="hidden" name={name} value={value || ""} readOnly />}
      {open && typeof document !== "undefined" && createPortal(
        <div id="monthfield-pop" style={popStyle} className="month-field-popover">
          <div className="month-field-year-nav">
            <button type="button" onClick={() => setViewYear((y) => y - 1)} disabled={!!minYm && viewYear - 1 < minYm.y} className="w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center disabled:opacity-30">‹</button>
            <div className="text-sm font-bold text-[var(--text)] tabular-nums">{viewYear}년</div>
            <button type="button" onClick={() => setViewYear((y) => y + 1)} disabled={!!maxYm && viewYear + 1 > maxYm.y} className="w-7 h-7 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] flex items-center justify-center disabled:opacity-30">›</button>
          </div>
          <div className="month-field-grid">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const isSel = sel && sel.y === viewYear && sel.m === m;
              const isCur = today.getFullYear() === viewYear && today.getMonth() + 1 === m;
              const dis = isDisabled(m);
              return (
                <button key={m} type="button" disabled={dis} onClick={() => emit(ym(viewYear, m))}
                  className={`h-9 rounded-lg text-xs font-semibold transition flex items-center justify-center
                    ${isSel ? "bg-[var(--primary)] text-white" : dis ? "text-[var(--text-dim)]/40 cursor-not-allowed" : `hover:bg-[var(--bg-surface)] text-[var(--text)]`}
                    ${isCur && !isSel ? "ring-1 ring-inset ring-[var(--primary)]/50" : ""}`}>
                  {m}월
                </button>
              );
            })}
          </div>
          <div className="month-field-footer">
            <button type="button" onClick={() => emit("")} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] px-1.5 py-1">지우기</button>
            <button type="button" onClick={() => emit(ym(today.getFullYear(), today.getMonth() + 1))} className="text-[11px] font-semibold text-[var(--primary)] hover:underline px-1.5 py-1">이번 달</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
