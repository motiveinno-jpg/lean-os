"use client";

// 시안 공통 — pill 탭. 기존 페이지의 tab/setTab state 와 그대로 호환(controlled).
//   active = 그라데이션 + shadow / inactive = 토큰 카드. 다크/라이트 토큰.

export interface SiyanPillTab<K extends string> {
  key: K;
  label: string;
  count?: number; // 옵션 — 표기 시 `(N)` 부착
}

export function SiyanPillTabs<K extends string>({
  tabs,
  active,
  onChange,
  gradient = "from-emerald-600 to-teal-500",
  className = "",
}: {
  tabs: SiyanPillTab<K>[];
  active: K;
  onChange: (key: K) => void;
  gradient?: string; // Tailwind gradient classes
  className?: string;
}) {
  return (
    <div className={`siyan-pill-tabs ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`siyan-pill-tab ${
            active === t.key
              ? `bg-gradient-to-r ${gradient} text-white shadow-md`
              : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-muted)]"
          }`}
        >
          {t.label}
          {typeof t.count === "number" && <span className="text-xs opacity-70 ml-1">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
