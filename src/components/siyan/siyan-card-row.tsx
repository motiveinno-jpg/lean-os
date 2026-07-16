"use client";

// 시안 공통 — 카드 행. 좌측 아이콘 슬롯 + 헤더(자유 ReactNode) + 메타 + 3색 금액 박스(슬롯) + 우측 액션.
//   row.tsx 가 데이터 형태를 강제하지 않도록 모든 부분을 ReactNode 슬롯으로 받음(가짜 필드 방지).

import type { ReactNode } from "react";

export type SiyanAmount = {
  label: string;
  value: ReactNode;
  tone: "blue" | "orange" | "emerald" | "indigo" | "rose" | "amber" | "muted";
};

const A_TONE: Record<SiyanAmount["tone"], { bg: string; text: string }> = {
  blue: { bg: "bg-blue-500/10", text: "text-blue-500/90" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-500/90" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-500/90" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-500/90" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-500/90" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-500/90" },
  muted: { bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]" },
};

export function SiyanCardRow({
  leftIcon,
  header,
  meta,
  amounts,
  actions,
  checkbox,
  onClick,
  className = "",
}: {
  leftIcon?: ReactNode; // 좌측 컬럼(아이콘 타일 + 옵션 버튼 등 자유 슬롯)
  header: ReactNode; // 제목 + 배지 + 부가 ReactNode
  meta?: ReactNode; // 날짜·태그·서브 메타
  amounts?: SiyanAmount[]; // 1~3개 금액 박스(공급가/세액/합계 등) — 없으면 미렌더
  actions?: ReactNode; // 우측(보통 호버에 노출되는 아이콘 버튼들)
  checkbox?: ReactNode; // 인박스 체크박스 등
  onClick?: () => void;
  className?: string;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`siyan-card-row group glass-card ${clickable ? "cursor-pointer hover:shadow-md" : ""} ${className}`}
    >
      <div className="card-row-body">
        {checkbox}
        {leftIcon && <div className="shrink-0">{leftIcon}</div>}
        <div className="flex-1 min-w-0">
          <div className="card-row-header">
            <div className="min-w-0">{header}</div>
            {actions && <div className="card-row-actions">{actions}</div>}
          </div>
          {meta && <div className="mt-1">{meta}</div>}
          {amounts && amounts.length > 0 && (
            <div className={`card-row-amounts ${amounts.length === 3 ? "grid-cols-3" : amounts.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
              {amounts.map((a, i) => {
                const t = A_TONE[a.tone];
                return (
                  <div key={i} className={`amount-box ${t.bg}`}>
                    <p className={`text-[10px] mb-0.5 ${t.text}`}>{a.label}</p>
                    <p className="text-sm font-bold text-[var(--text)] mono-number">{a.value}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
