"use client";

// 시안 공통 — 검색 input + 필터 pill 그룹 슬롯 + 정렬 dropdown 슬롯.
//   모든 controlled. 페이지가 자기 state/option 을 children 으로 주입.

import type { ReactNode } from "react";

export function SiyanSearchFilter({
  search,
  onSearchChange,
  placeholder = "검색...",
  filters,
  sort,
  trailing,
  className = "",
}: {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  filters?: ReactNode; // 필터 pill 그룹(페이지가 직접 렌더 — SiyanPillTabs 등 자유)
  sort?: ReactNode; // 정렬 dropdown(페이지가 자기 state 주입). 없으면 미표시
  trailing?: ReactNode; // 추가 버튼(필터 아이콘 등)
  className?: string;
}) {
  return (
    <div className={`siyan-search-filter ${className}`}>
      <div className="siyan-search-input-wrap">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" strokeWidth={2} />
          <path strokeLinecap="round" strokeWidth={2} d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-transparent transition"
        />
      </div>
      {filters && <div className="siyan-search-filters">{filters}</div>}
      {sort && <div className="siyan-search-sort">{sort}</div>}
      {trailing}
    </div>
  );
}
