"use client";

// 시안 공통 — 알림 박스. items 가 빈 배열이면 박스 자체 hidden (가짜 alert 방지).
//   emptyFallback 텍스트 주면 "이상 없음" 톤으로 1줄 표시.

type AlertType = "warning" | "error" | "info" | "success";

const STYLE: Record<AlertType, { box: string; iconBg: string; iconColor: string; emoji: string }> = {
  warning: { box: "border-amber-500/30 bg-amber-500/5", iconBg: "bg-amber-500/15", iconColor: "text-amber-500", emoji: "⚠️" },
  error: { box: "border-rose-500/30 bg-rose-500/5", iconBg: "bg-rose-500/15", iconColor: "text-rose-500", emoji: "📌" },
  info: { box: "border-blue-500/30 bg-blue-500/5", iconBg: "bg-blue-500/15", iconColor: "text-blue-500", emoji: "ℹ️" },
  success: { box: "border-emerald-500/30 bg-emerald-500/5", iconBg: "bg-emerald-500/15", iconColor: "text-emerald-500", emoji: "✅" },
};

export function SiyanAlertBox({
  type,
  title,
  items,
  emptyFallback,
  className = "",
}: {
  type: AlertType;
  title: string;
  items: string[]; // 실데이터 파생만 — 가짜 항목 박지 말 것
  emptyFallback?: string; // items=[] 일 때 보일 1줄 (없으면 박스 자체 hidden)
  className?: string;
}) {
  if (items.length === 0 && !emptyFallback) return null;
  const s = STYLE[type];
  return (
    <div className={`rounded-2xl border ${s.box} p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`p-2 rounded-lg shrink-0 text-base leading-none ${s.iconBg} ${s.iconColor}`}>{s.emoji}</span>
        <div className="min-w-0">
          <p className="font-bold text-[var(--text)] mb-1.5">{title}</p>
          <ul className="space-y-1 text-sm text-[var(--text-muted)]">
            {items.length > 0
              ? items.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`${s.iconColor} shrink-0`}>•</span>
                    <span>{it}</span>
                  </li>
                ))
              : <li className="text-[var(--text-dim)]">{emptyFallback}</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
