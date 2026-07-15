"use client";

// 재무 숫자 — 2026-05-27 새 디자인 시스템(시안 기반).
//   large(36px 그라데이션 텍스트) / medium(22px). tone 으로 색 지정(success/danger/info/muted/gradient).
//   gradient(기본 large)는 var(--fin-from)→var(--fin-to) 그라 텍스트(다크 자동 대응).

type FinSize = "large" | "medium";
type FinTone = "gradient" | "success" | "danger" | "info" | "muted";

const TONE_CLASS: Record<Exclude<FinTone, "gradient">, string> = {
  success: "text-[var(--success)]",
  danger: "text-[var(--danger)]",
  info: "text-[var(--brand-info)]",
  muted: "text-[var(--text-muted)]",
};

export function FinancialNumber({
  children,
  size = "large",
  tone = "gradient",
  className = "",
}: {
  children: React.ReactNode;
  size?: FinSize;
  tone?: FinTone;
  className?: string;
}) {
  const sizeClass = size === "large" ? "text-[36px]" : "text-[22px]";
  if (tone === "gradient") {
    return (
      <div className={`financial-number ${sizeClass} font-semibold bg-gradient-to-r from-[var(--fin-from)] to-[var(--fin-to)] bg-clip-text text-transparent tabular-nums ${className}`}>
        {children}
      </div>
    );
  }
  return (
    <div className={`financial-number ${sizeClass} font-semibold tabular-nums ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </div>
  );
}
