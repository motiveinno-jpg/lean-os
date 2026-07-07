"use client";

// 우측 상단 '?' 메뉴 도움말 토글 — 현재 메뉴가 무엇인지 + 기본 사용법을 팝오버로 안내.
//   콘텐츠는 src/lib/menu-guides.ts (라우트 최장 프리픽스 매칭). 심화는 /guide 로 연결.
//   app-shell.tsx 헤더 우측에 마운트.
//   팝오버는 document.body 로 포털 + fixed 배치 — page-sticky-header(z-30, backdrop-filter 스택 컨텍스트)에
//   가려지던 문제 해소(버튼 rect 기준 뷰포트 좌표, z-[999]).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { findMenuGuide } from "@/lib/menu-guides";

export function MenuGuide() {
  const pathname = usePathname();
  const guide = findMenuGuide(pathname || "");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // 라우트 이동 시 자동 닫기
  useEffect(() => { setOpen(false); }, [pathname]);

  // 열릴 때 버튼 위치 계산 + Esc/리사이즈/스크롤 추적
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={`pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full border transition ${
          open
            ? "bg-[var(--primary)] text-white border-[var(--primary)]"
            : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
        }`}
        style={{ boxShadow: "var(--shadow-sm)" }}
        aria-label="이 메뉴 도움말"
        aria-expanded={open}
        title="이 메뉴 도움말"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        // 바깥 클릭 닫기 — 백드롭이 패널을 감싸는 구조(다른 모달과 동일 관례)라야 round10 CSS 규칙
        // (fixed+inset-0 직계 자식 .glass-card → 불투명)을 물려받아 또렷하게 보임. 이전엔 백드롭/패널이
        // 형제라 이 규칙이 안 걸려 반투명한 채 남아있었음(가독성 저하 — 2026-07-07 확인).
        <div className="fixed inset-0 z-[998]" onClick={() => setOpen(false)}>
          <div
            className="glass-card fixed z-[999] w-[min(92vw,360px)] max-h-[70vh] overflow-y-auto animate-[slide-in_0.15s_ease]"
            style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg leading-none">{guide?.icon ?? "❓"}</span>
                <span className="text-sm font-bold text-[var(--text)] truncate">
                  {guide?.title ?? "도움말"}
                </span>
              </div>
              <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none px-1" aria-label="닫기">✕</button>
            </div>

            <div className="px-4 py-3 space-y-3">
              {guide ? (
                <>
                  {/* 이 메뉴는 */}
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1">이 메뉴는</div>
                    <p className="text-[13px] leading-relaxed text-[var(--text)]">{guide.what}</p>
                  </div>
                  {/* 기본 사용법 */}
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1.5">기본 사용법</div>
                    <ol className="space-y-1.5">
                      {guide.howto.map((step, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                          <span className="flex-shrink-0 w-4 h-4 mt-0.5 rounded-full bg-[var(--primary)]/12 text-[var(--primary)] text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {/* 팁 */}
                  {guide.tip && (
                    <div className="flex gap-2 rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
                      <span className="flex-shrink-0">💡</span>
                      <span>{guide.tip}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                  이 화면의 안내는 준비 중입니다. 전체 사용 가이드에서 OwnerView의 기능과 따라하기를 확인해 보세요.
                </p>
              )}
            </div>

            {/* 푸터 — 전체 가이드 */}
            <div className="px-4 py-2.5 border-t border-[var(--border)]">
              <Link
                href="/guide"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[var(--primary)] hover:underline"
              >
                📖 전체 사용 가이드 보기 →
              </Link>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
