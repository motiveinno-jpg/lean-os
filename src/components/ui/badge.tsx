"use client";

// 퍼센트/상태 pill 배지 — 2026-05-27 새 디자인 시스템(시안 기반).
//   tone 별 색 + /10 배경 pill (px-3 py-1 rounded-full). 시안 재무카드 % 배지 패턴.

type BadgeTone = "danger" | "info" | "success" | "warning" | "muted" | "brand";

const TONE_CLASS: Record<BadgeTone, string> = {
  danger: "text-[var(--danger)] bg-[var(--danger)]/10",
  info: "text-[var(--brand-info)] bg-[var(--brand-info)]/10",
  success: "text-[var(--success)] bg-[var(--success)]/10",
  warning: "text-[var(--warning)] bg-[var(--warning)]/10",
  muted: "text-[var(--text-muted)] bg-[var(--text-muted)]/10",
  brand: "text-[var(--brand)] bg-[var(--brand)]/10",
};

export function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span className={`text-[13px] font-semibold px-3 py-1 rounded-full whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </span>
  );
}
