"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[var(--bg)]">
      <div className="text-center max-w-md">
        <div className="text-6xl font-extrabold text-[var(--primary)] mb-4">404</div>
        <h1 className="text-xl font-bold text-[var(--text)] mb-2">페이지를 찾을 수 없습니다</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)] rounded-xl font-semibold text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            홈으로 이동
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            대시보드로 이동
          </Link>
        </div>
      </div>
    </div>
  );
}
