"use client";
import { useEffect, useState } from "react";

/* ── OwnerView SVG Icon ── */
export function OwnerViewIcon({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={`owner-view-icon shrink-0 ${className}`} xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#1E293B"/>
      <circle cx="18" cy="17" r="8.5" stroke="#fff" strokeWidth="2.5" fill="none"/>
      <line x1="24" y1="23" x2="31" y2="30" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
      <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="22" cy="14" r="2" fill="#3b82f6"/>
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
    <span className={`brand-rolling-text relative inline-flex justify-center overflow-hidden h-[1.25em] ${className}`}>
      {/* Invisible sizer — ensures container is wide enough for longest text */}
      <span className="brand-rolling-sizer invisible whitespace-nowrap px-1" aria-hidden="true">OwnerView</span>
      <span
        className="brand-rolling-en absolute inset-x-0 text-center transition-all duration-500 ease-in-out whitespace-nowrap"
        style={{
          transform: showKr ? "translateY(-100%)" : "translateY(0)",
          opacity: showKr ? 0 : 1,
        }}
      >
        OwnerView
      </span>
      <span
        className="brand-rolling-kr absolute inset-x-0 text-center transition-all duration-500 ease-in-out whitespace-nowrap"
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
