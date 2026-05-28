"use client";

// 시안 공통 — 페이지 헤더 (그라데이션 제목 + 부제 + 우측 액션 슬롯).
//   tone/gradient 자유 지정, 다크/라이트 토큰 유지. lucide 미사용.

import type { ReactNode } from "react";

export function SiyanPageHeader({
  title,
  subtitle,
  gradient = "from-emerald-600 to-teal-500",
  actions,
  className = "",
}: {
  title: string;
  subtitle?: string;
  gradient?: string; // Tailwind gradient classes (e.g. "from-indigo-600 to-purple-500")
  actions?: ReactNode; // 우측 버튼/아이콘 슬롯 (페이지가 실핸들러 주입)
  className?: string;
}) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6 ${className}`}>
      <div className="min-w-0">
        <h1 className={`text-2xl sm:text-3xl font-extrabold bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
          {title}
        </h1>
        {subtitle && <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
