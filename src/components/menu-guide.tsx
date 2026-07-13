"use client";

// 우측 상단 '?' 메뉴 도움말 — 클릭하면 본문·헤더가 왼쪽으로 밀리고 우측에 상세 가이드 드로어가 열린다.
//   · MenuGuide       = 헤더의 '?' 토글 버튼 (useGuide 컨텍스트로 열림 상태 제어)
//   · MenuGuideDrawer = 우측 슬라이드 패널 (개요·기능·단계·팁·FAQ 상세)
//   콘텐츠는 src/lib/menu-guides.ts (라우트 최장 프리픽스 매칭). 본문 밀기는 app-shell.tsx 에서 처리.
//   데스크톱: 콘텐츠가 밀려 드로어와 나란히 보임. 모바일: 전체 오버레이 + 백드롭.

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { findMenuGuide } from "@/lib/menu-guides";
import { useGuide } from "@/components/guide-context";

// ─── 헤더의 '?' 버튼 ───
export function MenuGuide() {
  const { open, toggleGuide } = useGuide();
  return (
    <button
      onClick={toggleGuide}
      className={`menu-guide-toggle pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full border transition ${
        open
          ? "bg-[var(--primary)] text-white border-[var(--primary)]"
          : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
      }`}
      style={{ boxShadow: "var(--shadow-sm)" }}
      aria-label="이 메뉴 도움말"
      aria-expanded={open}
      title="이 메뉴 사용법 자세히 보기"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </button>
  );
}

// ─── 우측 상세 가이드 드로어 ───
export function MenuGuideDrawer() {
  const pathname = usePathname();
  const guide = findMenuGuide(pathname || "");
  const { open, closeGuide } = useGuide();

  // Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeGuide(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeGuide]);

  return (
    <>
      {/* 모바일 백드롭 (데스크톱은 콘텐츠가 밀려 나란히 보이므로 백드롭 없음) */}
      {open && (
        <div className="menu-guide-backdrop fixed inset-0 z-[39] bg-black/30 md:hidden" onClick={closeGuide} aria-hidden />
      )}

      <aside
        className={`menu-guide-drawer fixed top-0 right-0 h-[100dvh] w-full md:w-[400px] z-40 bg-[var(--bg-card)] border-l border-[var(--border)] flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
        style={{ boxShadow: open ? "-12px 0 32px rgba(0,0,0,0.12)" : "none" }}
        aria-hidden={!open}
        aria-label="메뉴 사용 가이드"
      >
        {/* 헤더 */}
        <div className="guide-head flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="text-2xl leading-none mt-0.5">{guide?.icon ?? "❓"}</span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold tracking-wide text-[var(--primary)] uppercase">메뉴 가이드</div>
              <div className="text-[17px] font-extrabold text-[var(--text)] leading-6 truncate">{guide?.title ?? "도움말"}</div>
              {guide?.tagline && <div className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-snug">{guide.tagline}</div>}
            </div>
          </div>
          <button onClick={closeGuide} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none px-1 -mt-0.5" aria-label="가이드 닫기">✕</button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="guide-body flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {guide ? (
            <>
              {/* 이 메뉴는 */}
              <section className="guide-overview">
                <h3 className="guide-section-title text-[11px] font-bold tracking-wide text-[var(--text-dim)] uppercase mb-1.5">이 메뉴는</h3>
                <p className="text-[13.5px] leading-relaxed text-[var(--text)]">{guide.overview}</p>
              </section>

              {/* 이 화면에서 할 수 있는 것 */}
              {guide.features.length > 0 && (
                <section className="guide-features">
                  <h3 className="guide-section-title text-[11px] font-bold tracking-wide text-[var(--text-dim)] uppercase mb-2">이 화면에서 할 수 있는 것</h3>
                  <ul className="space-y-2.5">
                    {guide.features.map((f, i) => (
                      <li key={i} className="guide-feature-row flex gap-2.5">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--primary)] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-bold text-[var(--text)] leading-snug">{f.name}</div>
                          <div className="text-[12.5px] leading-relaxed text-[var(--text-muted)] mt-0.5">{f.desc}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 처음이라면 이렇게 */}
              {guide.steps.length > 0 && (
                <section className="guide-steps">
                  <h3 className="guide-section-title text-[11px] font-bold tracking-wide text-[var(--text-dim)] uppercase mb-2">처음이라면 이렇게</h3>
                  <ol className="space-y-2">
                    {guide.steps.map((step, i) => (
                      <li key={i} className="guide-step-row flex gap-2.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
                        <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-[var(--primary)]/12 text-[var(--primary)] text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {/* 알아두면 좋아요 */}
              {guide.tips && guide.tips.length > 0 && (
                <section className="guide-tips space-y-2">
                  <h3 className="guide-section-title text-[11px] font-bold tracking-wide text-[var(--text-dim)] uppercase">알아두면 좋아요</h3>
                  {guide.tips.map((tip, i) => (
                    <div key={i} className="flex gap-2 rounded-xl bg-[var(--bg-surface)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                      <span className="shrink-0">💡</span>
                      <span>{tip}</span>
                    </div>
                  ))}
                </section>
              )}

              {/* 자주 묻는 질문 */}
              {guide.faq && guide.faq.length > 0 && (
                <section className="guide-faq">
                  <h3 className="guide-section-title text-[11px] font-bold tracking-wide text-[var(--text-dim)] uppercase mb-2">자주 묻는 질문</h3>
                  <div className="space-y-2.5">
                    {guide.faq.map((item, i) => (
                      <div key={i} className="guide-faq-item rounded-xl border border-[var(--border)] px-3.5 py-2.5">
                        <div className="text-[13px] font-bold text-[var(--text)] leading-snug">Q. {item.q}</div>
                        <div className="text-[12.5px] leading-relaxed text-[var(--text-muted)] mt-1">A. {item.a}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              이 화면의 상세 안내는 준비 중입니다. 아래 전체 사용 가이드에서 OwnerView의 기능과 따라하기를 확인해 보세요.
            </p>
          )}
        </div>

        {/* 푸터 — 전체 가이드 */}
        <div className="guide-foot px-5 py-3 border-t border-[var(--border)] shrink-0">
          <Link
            href="/guide"
            onClick={closeGuide}
            className="flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-[var(--primary)] hover:underline"
          >
            📖 전체 사용 가이드 보기 →
          </Link>
        </div>
      </aside>
    </>
  );
}
