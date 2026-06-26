"use client";

// 거래내역 4종(통장·카드·현금영수증·세금계산서) 공통 정렬 버튼 툴바.
// 헤더 더블클릭/클릭 정렬과 sortKey/sortDir state 를 공유한다(별도 state 만들지 말 것).
// - 버튼 클릭: 그 키로 정렬. 같은 키 재클릭: 오름↔내림 토글.
// - 활성 버튼 강조 + ▲/▼ 표시.

export type SortDir = "asc" | "desc";

export interface SortOption {
  key: string;
  label: string;
}

export function SortToolbar({
  options,
  sortKey,
  sortDir,
  onSort,
  className = "",
}: {
  options: SortOption[];
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <span className="text-xs font-semibold text-[var(--text-muted)] mr-0.5">정렬:</span>
      {options.map((opt) => {
        const active = sortKey === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSort(opt.key)}
            aria-pressed={active}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition select-none ${
              active
                ? "bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--primary)]/50"
            }`}
          >
            {opt.label}
            {active ? <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
