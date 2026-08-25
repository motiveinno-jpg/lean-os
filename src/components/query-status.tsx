"use client";

import { Ico } from "@/components/ui-icon";

/**
 * QueryStatus — useQuery 에러/로딩 상태 표시 컴포넌트
 * 각 페이지 상단에 배치하여 네트워크 에러/로딩 상태를 표시
 */

export function QueryErrorBanner({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="query-error-banner">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[var(--danger)] flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <span className="text-xs text-[var(--danger)] font-medium truncate">
          데이터를 불러오지 못했습니다. 네트워크를 확인하세요.
        </span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 transition flex-shrink-0"
        >
          재시도
        </button>
      )}
    </div>
  );
}
