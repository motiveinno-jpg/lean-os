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
    // 2026-05-28 sticky 헤더 — 스크롤 내려도 페이지 제목·액션 항상 노출.
    //   AppShell main 에 pt-14(Topbar 56px) 패딩 있어 sticky top-0 이 정확히 Topbar 바로 아래에 고정됨.
    //   -mx-4 sm:-mx-6 px-4 sm:px-6 트릭으로 main 의 좌우 padding 까지 헤더 배경이 덮음(헤더 양옆 빈공간 방지).
    //   backdrop-blur + bg/90 으로 뒤 콘텐츠 살짝 비치며 흐림. print 시엔 sticky 해제.
    <div className={`siyan-page-header sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-6 bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)]/60 print:static print:bg-transparent print:border-none print:py-0 print:mx-0 print:px-0 flex flex-col sm:flex-row sm:items-end justify-between gap-3 ${className}`}>
      <div className="siyan-page-header-title-block min-w-0">
        <h1 className={`text-2xl sm:text-3xl font-extrabold bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
          {title}
        </h1>
        {subtitle && <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="siyan-page-header-actions flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
