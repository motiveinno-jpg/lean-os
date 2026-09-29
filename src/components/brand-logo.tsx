"use client";
import { useEffect, useState } from "react";

/* ── OwnerView SVG Icon ── */
export function OwnerViewIcon({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={`owner-view-icon ${className}`} xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#1E293B"/>
      <circle cx="18" cy="17" r="8.5" stroke="#fff" strokeWidth="2.5" fill="none"/>
      <line x1="24" y1="23" x2="31" y2="30" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
      <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="22" cy="14" r="2" fill="#3b82f6"/>
    </svg>
  );
}

/* ── Rolling Brand Text: OwnerView ↔ 오너뷰 ──
 *   두 글자가 같은 시간에 엇갈려 움직이면 중간에 반쯤 투명한 두 이름이 한 칸에 겹쳐 보인다.
 *   나가는 쪽이 먼저 완전히 사라진 뒤(OUT_MS) 들어오는 쪽이 시작하도록 들어오는 쪽에만 지연을 준다. */
const OUT_MS = 260;
const IN_MS = 320;
function rollStyle(visible: boolean, hiddenShift: string): React.CSSProperties {
  return {
    transform: visible ? "translateY(0)" : `translateY(${hiddenShift})`,
    opacity: visible ? 1 : 0,
    transition: visible
      ? `transform ${IN_MS}ms ease-out ${OUT_MS}ms, opacity ${IN_MS}ms ease-out ${OUT_MS}ms`
      : `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`,
  };
}
export function RollingBrandText({ className = "", interval = 2000 }: { className?: string; interval?: number }) {
  const [showKr, setShowKr] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setShowKr(v => !v), interval);
    return () => clearInterval(timer);
  }, [interval]);

  return (
    <span className={`brand-rolling-text ${className}`}>
      {/* Invisible sizer — ensures container is wide enough for longest text */}
      <span className="brand-rolling-sizer" aria-hidden="true">OwnerView</span>
      <span className="brand-rolling-en" style={rollStyle(!showKr, "-100%")}>
        OwnerView
      </span>
      <span className="brand-rolling-kr" style={rollStyle(showKr, "100%")}>
        오너뷰
      </span>
    </span>
  );
}
