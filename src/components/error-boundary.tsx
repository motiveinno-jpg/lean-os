"use client";

import React from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    import("@/lib/error-logger").then(({ logError }) => {
      logError({
        source: "boundary",
        message: error?.message || String(error),
        stack: error?.stack,
        context: { componentStack: errorInfo?.componentStack?.slice(0, 1500) },
      });
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg,#f9fafb)]">
          <div className="max-w-md w-full mx-4 p-8 rounded-2xl bg-[var(--bg-card)] shadow-lg border border-[var(--border)] text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[var(--danger-dim)] flex items-center justify-center">
              <svg className="w-7 h-7 text-[var(--danger)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-[var(--text)] mb-2">오류가 발생했습니다</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              예상치 못한 문제가 발생했습니다. 아래 버튼을 눌러 다시 시도해주세요.
            </p>
            {this.state.error && (
              <pre className="text-[10px] text-left bg-[var(--bg-surface)] rounded-lg p-3 mb-6 overflow-auto max-h-24 text-[var(--text-dim)]">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                style={{ background: "var(--primary, #6366f1)" }}
              >
                새로고침
              </button>
              <button
                onClick={() => { window.location.href = "/dashboard"; }}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)] transition"
              >
                대시보드로 이동
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
