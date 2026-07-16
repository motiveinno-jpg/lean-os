"use client";

// 시안 공통 — 그라데이션 통계 카드. tone preset 또는 직접 gradient 클래스 prop.
//   라벨·값·서브텍스트·아이콘 슬롯. 흰 텍스트(다크/라이트 양쪽 가독성 OK).

import type { ReactNode } from "react";

type Tone = "blue" | "green" | "red" | "amber" | "purple" | "indigo" | "slate" | "emerald";

const GRAD: Record<Tone, string> = {
  blue: "from-blue-600 to-cyan-500",
  green: "from-emerald-600 to-green-500",
  emerald: "from-emerald-600 to-teal-500",
  red: "from-red-500 to-rose-500",
  amber: "from-amber-500 to-orange-500",
  purple: "from-purple-600 to-pink-500",
  indigo: "from-indigo-600 to-purple-500",
  slate: "from-slate-700 to-slate-500",
};

export function SiyanStatCard({
  tone = "indigo",
  gradient,
  label,
  value,
  sub,
  icon,
  className = "",
}: {
  tone?: Tone;
  gradient?: string; // override tone with custom Tailwind gradient
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode; // 우상단 흰/투명 박스에 들어갈 아이콘 (이모지/svg/IconTile)
  className?: string;
}) {
  const g = gradient || GRAD[tone];
  return (
    <div className={`siyan-stat-card ${g} ${className}`}>
      <div className="stat-card-body">
        <div className="min-w-0">
          <div className="stat-card-label">{label}</div>
          <div className="stat-card-value mono-number">{value}</div>
          {sub != null && <div className="stat-card-sub">{sub}</div>}
        </div>
        {icon != null && (
          <span className="stat-card-icon">
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
