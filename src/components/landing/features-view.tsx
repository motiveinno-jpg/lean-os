"use client";

// /features — "오너뷰 둘러보기" 전용 페이지 (2026-07-27).
//   사장님: "둘러보기 메뉴는 클릭했을 때 다른 페이지로 이동해서 보여주고, 메인 랜딩에서는 빠지는 게 좋겠다.
//   지금 스크롤이 너무 길다."
//   → 메인에 있던 (1) 메뉴 20개 카탈로그 (2) AI 자동화 8종 (3) 도구 7종 묶음을 전부 이 페이지로 옮겼다.
//   메인은 히어로→하루→3대 축→AI→이 페이지로 보내는 배너 순으로 짧아진다.
//   스타일은 랜딩과 같은 lp4- 네임스페이스(landing.css).

import "@/app/landing.css";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { CATALOG, FEATURES, FOOTER } from "@/components/landing/content";

const Check = () => (<svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);
const Arrow = () => (<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" /></svg>);

// 메뉴 아이콘 — 실제 사이드바(components/sidebar.tsx)가 쓰는 아이콘과 같은 모양.
function MenuGlyph({ n }: { n: string }) {
  const p = { width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (n) {
    case "users": return <svg {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /></svg>;
    case "receipt": return <svg {...p}><path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5 4 2z" /><path d="M8 8h8M8 12h8" /></svg>;
    case "book": return <svg {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>;
    case "pen": return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
    case "chart": return <svg {...p}><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 5-9" /></svg>;
    case "calendar": return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
    case "briefcase": return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></svg>;
    case "check": return <svg {...p}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
    case "board": return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6" /></svg>;
    case "chat": return <svg {...p}><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 013 11.5a8.4 8.4 0 019-8.4 8.4 8.4 0 019 8.4z" /></svg>;
    case "sign": return <svg {...p}><path d="M3 17c3-6 5 3 8-2s4 1 7-3" /><path d="M4 21h16" /></svg>;
    case "user": return <svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "file": return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" /><path d="M14 2v6h6M9 14h6M9 18h4" /></svg>;
    case "folder": return <svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>;
    case "swap": return <svg {...p}><path d="M8 3L4 7l4 4" /><path d="M4 7h16" /><path d="M16 21l4-4-4-4" /><path d="M20 17H4" /></svg>;
    case "wallet": return <svg {...p}><path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 000 4h4v-4h-4z" /></svg>;
    case "repeat": return <svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>;
    case "trend": return <svg {...p}><path d="M22 7l-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></svg>;
    default: return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
  }
}

export default function FeaturesView() {
  const [cat, setCat] = useState(0);   // 0~3 = 메뉴 그룹, AI_TAB = AI 자동화
  const [menu, setMenu] = useState(0);

  // 토글을 고르면 그 영역만 보여주고 주소도 같이 바꾼다 — 메뉴마다 하나의 화면이 되게
  const go = (c: number, m: number) => {
    if (c === cat && m === menu) return;
    setCat(c); setMenu(m);
    window.history.replaceState(null, "", `?g=${CATALOG[c].key}${m ? `&m=${m}` : ""}`);
  };

  // 메인 메가메뉴에서 ?g=워크스페이스&m=2 로 넘어오면 그 그룹·메뉴를 열어 둔다
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("g") === "ai") { window.location.replace("/ai"); return; }
    const g = CATALOG.findIndex((c) => c.key === q.get("g"));
    if (g >= 0) {
      setCat(g);
      const m = Number(q.get("m"));
      if (Number.isInteger(m) && m >= 0 && m < CATALOG[g].menus.length) setMenu(m);
    }
  }, []);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      {/* 페이지 머리 */}
      <section className="lp4-section lp4-bg-canvas" id="catalog">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">{CATALOG[cat]?.group ?? "AI 자동화"}</div>
            <h1 className="lp4-h2">
              {CATALOG[cat]?.group ?? "AI 자동화"}에서 <span className="lp4-underline">할 수 있는 일</span>
            </h1>
            <p className="lp4-sub">
              메뉴를 고르면 실제 오너뷰 화면을 그대로 보여드려요. 다른 영역은 위 <b>오너뷰 둘러보기</b>에서 고를 수 있어요.
            </p>
          </div>
        </div>

        <div className="lp4-container">
          {(

            <div className="lp4-cat-panel" key={CATALOG[cat].key}>
              <p className="lp4-cat-lead">{CATALOG[cat].lead}</p>
              <div className="lp4-cat-body">
                <div className="lp4-cat-list">
                  {CATALOG[cat].menus.map((m, i) => (
                    <button
                      key={m.name}
                      className={`lp4-cat-item ${i === menu ? "lp4-cat-item-on" : ""}`}
                      onClick={() => go(cat, i)}
                      onMouseEnter={() => go(cat, i)}
                      aria-pressed={i === menu}
                    >
                      <span className="lp4-cat-ico"><MenuGlyph n={m.icon} /></span>
                      <span className="lp4-cat-item-txt">
                        <span className="lp4-cat-item-n">{m.name}</span>
                        <span className="lp4-cat-item-d">{m.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="lp4-cat-view" key={`${CATALOG[cat].key}-${menu}`}>
                  <div className="lp4-cat-shot">
                    <Image
                      src={CATALOG[cat].menus[menu].src}
                      alt={CATALOG[cat].menus[menu].alt}
                      width={1968}
                      height={1320}
                      sizes="(max-width: 1000px) 100vw, 900px"
                    />
                  </div>
                  <div className="lp4-cat-feats">
                    {CATALOG[cat].menus[menu].items.map((it) => (
                      <span key={it} className="lp4-cat-feat"><Check />{it}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 하단 전환 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">14일 써보고 결정하세요</h2>
          <p className="lp4-sub">따로 결제하던 {FEATURES.length}개 도구가 하나의 데이터 위에서 같이 움직여요.</p>
          <div className="lp4-mx-tools-list">
            {FEATURES.map((f) => <span key={f.tab} className="lp4-pillar-menu">{f.tab}</span>)}
          </div>
          <div className="lp4-feat-cta">
            <Link href="/auth" className="lp4-btn lp4-btn-brand">무료로 시작하기 <Arrow /></Link>
            <Link href="/pricing" className="lp4-btn lp4-btn-line">요금제 보기</Link>
          </div>
        </div>
      </section>

      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks">
              <Link href="/">홈</Link><Link href="/pricing">가격</Link><Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불규정</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
