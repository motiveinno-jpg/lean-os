"use client";

/**
 * QueryStatus — useQuery 에러/로딩 상태 표시 컴포넌트
 * 각 페이지 상단에 배치하여 네트워크 에러/로딩 상태를 표시
 */

export function QueryErrorBanner({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-red-500 flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <span className="text-xs text-red-500 font-medium truncate">
          데이터를 불러오지 못했습니다. 네트워크를 확인하세요.
        </span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500/30 transition flex-shrink-0"
        >
          재시도
        </button>
      )}
    </div>
  );
}

export function PageLoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="p-12 text-center bg-[var(--bg-card)] rounded-2xl border border-[var(--border)]">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="text-base font-bold mb-1">{title}</div>
      {description && <div className="text-xs text-[var(--text-muted)] mb-4">{description}</div>}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 transition"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
