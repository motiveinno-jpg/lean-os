"use client";
import { useEffect, useState } from "react";

/* ── OwnerView SVG Icon ── */
export function OwnerViewIcon({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={`shrink-0 ${className}`}>
      <rect width="40" height="40" rx="10" fill="#111"/>
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none"/>
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"/>
      <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="22" cy="14" r="1.5" fill="#3b82f6"/>
    </svg>
  );
}

/* ── Rolling Brand Text: OwnerView ↔ 오너뷰 ── */
export function RollingBrandText({ className = "", interval = 2000 }: { className?: string; interval?: number }) {
  const [showKr, setShowKr] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setShowKr(v => !v), interval);
    return () => clearInterval(timer);
  }, [interval]);

  return (
    <span className={`relative inline-flex overflow-hidden ${className}`} style={{ height: "1.25em", minWidth: "5.5em" }}>
      <span
        className="absolute left-0 transition-all duration-500 ease-in-out whitespace-nowrap"
        style={{
          transform: showKr ? "translateY(-100%)" : "translateY(0)",
          opacity: showKr ? 0 : 1,
        }}
      >
        OwnerView
      </span>
      <span
        className="absolute left-0 transition-all duration-500 ease-in-out whitespace-nowrap"
        style={{
          transform: showKr ? "translateY(0)" : "translateY(100%)",
          opacity: showKr ? 1 : 0,
        }}
      >
        오너뷰
      </span>
    </span>
  );
}
