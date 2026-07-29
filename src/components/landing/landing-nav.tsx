"use client";

// 랜딩 공통 상단바 (2026-07-27).
//   사장님: "둘러보기에서 메뉴로 이동하면 둘러보기 토글이 사라진다."
//   → /features · /ai · /pricing 에서도 같은 드롭다운을 쓰도록 네비를 한곳으로 뺐다.
//   "오너뷰 둘러보기"는 눌러도 페이지가 바뀌지 않는다. 좌측에서 영역을 고르면 그 영역의 메뉴만 나온다.

import Link from "next/link";
import { useEffect, useState } from "react";
import "@/app/landing-v6.css";
import { CATALOG, AI_AUTOMATION, NAV_LINKS, TOUR_HREF } from "@/components/landing/content";

const NAV_AI = 99;   // 드롭다운에서 AI 자동화를 가리키는 값

function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="#5b54e8" />
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none" />
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <polyline points="12,20 15,18 18,19 22,14" stroke="#fdba74" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="22" cy="14" r="1.5" fill="#fdba74" />
    </svg>
  );
}
const Arrow = () => (<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" /></svg>);

/** solid: 홈은 스크롤에 따라 배경이 생기고, 나머지 페이지는 항상 배경을 깐다. */
export function LandingNav({ solid = false }: { solid?: boolean }) {
  const [on, setOn] = useState(solid);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drop, setDrop] = useState(false);
  const [navG, setNavG] = useState(0);

  useEffect(() => {
    if (solid) return;
    const h = () => setOn(window.scrollY > 8);
    h();
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, [solid]);

  // 바깥을 누르거나 ESC 를 누르면 닫는다
  useEffect(() => {
    if (!drop) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".lp4-navdrop")) setDrop(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrop(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [drop]);

  const href = (h: string) => (h.startsWith("#") ? (solid ? `/${h}` : h) : h);

  return (
    <nav className={`lp4-nav ${on ? "lp4-nav-on" : ""}`}>
      <div className="lp4-nav-inner">
        <Link href="/" className="lp4-logo"><Logo size={25} /> OwnerView</Link>

        <div className="lp4-menu">
          {NAV_LINKS.map((l) =>
            l.href === TOUR_HREF ? (
              <div
                key={l.href}
                className={`lp4-navdrop ${drop ? "lp4-navdrop-open" : ""}`}
                onMouseEnter={() => setDrop(true)}
                onMouseLeave={() => setDrop(false)}
              >
                {/* 눌러도 페이지가 바뀌지 않는다 — 아래 메뉴만 펼친다 */}
                <button type="button" className="lp4-navdrop-t" aria-expanded={drop} onClick={() => setDrop((v) => !v)}>
                  {l.label}
                  <svg className="lp4-navdrop-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
                </button>
                <div className="lp4-mega">
                  <div className="lp4-mega-inner">
                    <div className="lp4-mega-side">
                      {CATALOG.map((g, i) => (
                        <button
                          key={g.key}
                          type="button"
                          className={`lp4-mega-side-b ${navG === i ? "lp4-mega-side-on" : ""}`}
                          onMouseEnter={() => setNavG(i)}
                          onFocus={() => setNavG(i)}
                          onClick={() => setNavG(i)}
                        >
                          {g.group}<span className="lp4-mega-side-c">{g.menus.length}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`lp4-mega-side-b ${navG === NAV_AI ? "lp4-mega-side-on" : ""}`}
                        onMouseEnter={() => setNavG(NAV_AI)}
                        onFocus={() => setNavG(NAV_AI)}
                        onClick={() => setNavG(NAV_AI)}
                      >
                        AI 자동화<span className="lp4-mega-side-c">{AI_AUTOMATION.length}</span>
                      </button>
                    </div>

                    {navG === NAV_AI ? (
                      <div className="lp4-mega-main" key="ai">
                        <p className="lp4-mega-lead">사람이 매번 하던 일을 AI가 대신 해요.</p>
                        <div className="lp4-mega-items">
                          {AI_AUTOMATION.map((a, j) => (
                            <Link key={a.name} className="lp4-mega-m" href={`/ai?a=${j}`} onClick={() => setDrop(false)}>
                              <span className="lp4-mega-m-n">{a.name}</span>
                              <span className="lp4-mega-m-d">{a.tag}</span>
                            </Link>
                          ))}
                        </div>
                        <Link className="lp4-mega-all" href="/ai" onClick={() => setDrop(false)}>AI 자동화 전체 보기 <Arrow /></Link>
                      </div>
                    ) : (
                      <div className="lp4-mega-main" key={CATALOG[navG].key}>
                        <p className="lp4-mega-lead">{CATALOG[navG].lead}</p>
                        <div className="lp4-mega-items">
                          {CATALOG[navG].menus.map((m, j) => (
                            <Link
                              key={m.name}
                              className="lp4-mega-m"
                              href={`/features?g=${CATALOG[navG].key}&m=${j}`}
                              onClick={() => setDrop(false)}
                            >
                              <span className="lp4-mega-m-n">{m.name}</span>
                              <span className="lp4-mega-m-d">{m.desc}</span>
                            </Link>
                          ))}
                        </div>
                        <Link className="lp4-mega-all" href={`/features?g=${CATALOG[navG].key}`} onClick={() => setDrop(false)}>
                          {CATALOG[navG].group} 전체 보기 <Arrow />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Link key={l.href} href={href(l.href)}>{l.label}</Link>
            )
          )}
        </div>

        <div className="lp4-nav-right">
          <Link href="/auth" className="lp4-login">로그인</Link>
          {/* ⚠️ 도입 상담 경로가 맨 아래 제휴 폼에만 있어 엔터프라이즈 리드가 거기까지 안 내려간다.
              준비도별로 셋(바로 시작 / 먼저 보기 / 물어보기)을 나눠 받는다 (2026-07-29). */}
          <Link href="/#partner" className="lp5-nav-ask">도입 상담</Link>
          <Link href="/auth" className="lp4-pill">무료로 시작하기</Link>
          <button
            type="button"
            className="lp4-burger"
            aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={menuOpen}
            aria-controls="lp4-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      <div id="lp4-mobile-menu" className={`lp4-mobile-menu ${menuOpen ? "lp4-mobile-menu-open" : ""}`}>
        {NAV_LINKS.map((l) =>
          l.href === TOUR_HREF ? (
            <div key={l.href} className="lp4-mob-group">
              <Link href="/features" onClick={() => setMenuOpen(false)}>{l.label}</Link>
              <div className="lp4-mob-subs">
                {CATALOG.map((g) => (
                  <Link key={g.key} className="lp4-mob-sub" href={`/features?g=${g.key}`} onClick={() => setMenuOpen(false)}>{g.group}</Link>
                ))}
              </div>
            </div>
          ) : (
            <Link key={l.href} href={href(l.href)} onClick={() => setMenuOpen(false)}>{l.label}</Link>
          )
        )}
        <Link href="/auth" onClick={() => setMenuOpen(false)}>로그인</Link>
      </div>
    </nav>
  );
}
