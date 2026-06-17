"use client";

// 서버 점검 화면 — DB/인증 미응답으로 504 로 떨어지기 전에 미들웨어가 이 페이지로 보냄.
//   Supabase·DB 를 일절 호출하지 않는 순수 정적 페이지(점검 중에도 안전하게 렌더).
import { useEffect, useState } from "react";

export default function MaintenancePage() {
  const [retrying, setRetrying] = useState(false);

  // 점검 중이라도 30초마다 자동 재시도 — 복구되면 원래 페이지로 자연 복귀.
  useEffect(() => {
    const t = setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 30000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="text-5xl" aria-hidden>🛠️</div>
        <h1 className="text-2xl font-extrabold text-[var(--text)]">서버 점검 중</h1>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">
          일시적으로 서버가 응답하지 않아 점검 중입니다.<br />
          잠시 후 자동으로 다시 연결을 시도합니다.
        </p>
        <button
          onClick={() => { setRetrying(true); try { window.location.reload(); } catch { /* noop */ } }}
          disabled={retrying}
          className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition"
        >
          {retrying ? "다시 시도 중..." : "다시 시도"}
        </button>
        <p className="text-[11px] text-[var(--text-dim)]">문제가 계속되면 잠시 후 다시 접속해 주세요.</p>
      </div>
    </div>
  );
}
