"use client";

// 시안 공통 — 하단 그린 일괄 처리 바. 버튼은 페이지가 실핸들러로 children 주입.
//   가짜 "이메일 발송" 같은 미연결 버튼 금지 — 핸들러 없는 버튼이면 사용 자체 안 함.

import type { ReactNode } from "react";

export function SiyanExportBar({
  title,
  subtitle,
  gradient = "from-emerald-600 to-teal-500",
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  gradient?: string;
  children: ReactNode; // 페이지가 실핸들러 가진 버튼들을 주입
  className?: string;
}) {
  return (
    <div className={`siyan-export-bar no-print ${gradient} ${className}`}>
      <div className="export-bar-title-block">
        <h3 className="text-lg font-bold mb-1">{title}</h3>
        {subtitle && <p className="text-white/80 text-sm">{subtitle}</p>}
      </div>
      <div className="export-bar-actions">{children}</div>
    </div>
  );
}
