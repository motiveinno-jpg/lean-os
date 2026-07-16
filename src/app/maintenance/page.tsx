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
    <div className="maintenance-page">
      {/* 점검 페이지 전용 망치질 애니메이션 (순수 CSS, 외부 의존 없음) */}
      <style>{`
        @keyframes hmr-swing { 0%,32%,100% { transform: rotate(-22deg); } 50% { transform: rotate(20deg); } 64% { transform: rotate(15deg); } }
        @keyframes hmr-spark { 0%,44%,72%,100% { opacity: 0; transform: translateX(-50%) scale(0.4); } 52% { opacity: 1; transform: translateX(-50%) scale(1.15); } }
        @keyframes hmr-shake { 0%,46%,100% { transform: translateX(-50%) translateY(0); } 54% { transform: translateX(-50%) translateY(2px); } 60% { transform: translateX(-50%) translateY(0); } }
        .hmr-tool { animation: hmr-swing 1.2s cubic-bezier(.5,0,.5,1) infinite; }
        .hmr-spark { animation: hmr-spark 1.2s ease-in-out infinite; }
        .hmr-anvil { animation: hmr-shake 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .hmr-tool, .hmr-spark, .hmr-anvil { animation: none; } .hmr-spark { opacity: 0; } }
      `}</style>
      <div className="max-w-md w-full text-center space-y-5">
        <div className="maintenance-anvil-scene" aria-hidden>
          <div className="hmr-anvil absolute left-1/2 bottom-[14px] -translate-x-1/2 w-[50px] h-[14px] rounded-[6px] bg-[var(--bg-surface)] border border-[var(--border)]" />
          <div className="hmr-spark absolute left-1/2 bottom-[26px] -translate-x-1/2 text-[18px]">✨</div>
          <div className="hmr-tool absolute left-1/2 top-0 -ml-6 text-5xl leading-none origin-[50%_92%]">🔨</div>
        </div>
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
        <p className="text-[11px] text-[var(--text-dim)]">문제가 계속되면 070-5097-6371 로 연락 주세요.</p>
      </div>
    </div>
  );
}
