"use client";

// OwnerView 랜딩 뷰 — "AI ERP" 재디자인 (2026-07-27).
//   원칙 3가지:
//     1) 주인공은 제품 실물 화면이다. 히어로와 투어 섹션의 이미지는 전부 /demo 를 실제 뷰포트에서
//        캡처한 진짜 오너뷰 화면(public/product/*.png). 일러스트·목업 금지.
//     2) 강조색은 브랜드 인디고 하나. 오렌지는 위험/주의, 초록은 확인/절감 의미일 때만.
//        (이전 버전은 인디고·블루·오렌지·초록·신호등이 한 화면에 섞여 브랜드가 읽히지 않았다.)
//     3) 앱 본체(리퀴드글래스·인디고 그라데이션)와 같은 언어 — 가입 후 진입해도 같은 제품으로 보이게.
//   문구·가격은 content.ts 단일 출처. 스타일은 landing.css(lp4- 네임스페이스).
import "@/app/landing.css";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { HERO, STATS, PILLARS, DAY, MOBILE, FEATURES, ENGINES, CATALOG, AI_AUTOMATION, FAQS, NAV_LINKS, FOOTER } from "@/components/landing/content";
import { PartnershipForm } from "@/components/landing/partnership-form";
import { LIVE } from "@/components/landing/live-panels";

function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="#4F46E5" />
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none" />
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <polyline points="12,20 15,18 18,19 22,14" stroke="#fdba74" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="22" cy="14" r="1.5" fill="#fdba74" />
    </svg>
  );
}
const DAY_LIVE = ["brief", "quote", "attend", "match", "forecast"];

const Check = () => (<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);
const Arrow = () => (<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" /></svg>);

// 스크롤 등장 옵저버 — 인스턴스마다 IntersectionObserver 를 만들면 랜딩 한 장에 20개 이상이 생긴다.
// 하나만 만들어 모든 Reveal 이 공유하고, 한 번 보이면 즉시 unobserve 한다.
type RevealCb = () => void;
let revealIO: IntersectionObserver | null = null;
const revealTargets = new WeakMap<Element, RevealCb>();

function observeReveal(el: Element, cb: RevealCb) {
  if (typeof IntersectionObserver === "undefined") { cb(); return () => {}; }
  if (!revealIO) {
    revealIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        revealTargets.get(e.target)?.();
        revealTargets.delete(e.target);
        revealIO?.unobserve(e.target);
      }
    }, { threshold: 0.12 });
  }
  revealTargets.set(el, cb);
  revealIO.observe(el);
  return () => { revealTargets.delete(el); revealIO?.unobserve(el); };
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    return observeReveal(el, () => setSeen(true));
  }, []);
  return <div ref={ref} className={`lp4-reveal ${seen ? "lp4-reveal-in" : ""} ${className}`}>{children}</div>;
}

function CountUp({ to, suffix = "", dur = 1400 }: { to: number; suffix?: string; dur?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0; let started = false;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !started) {
        started = true; const t0 = performance.now();
        const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick); io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, dur]);
  return <span ref={ref}>{n.toLocaleString("ko-KR")}{suffix}</span>;
}

// AI 엔진 아이콘 — 텍스트만으로 나열되던 카드에 시각적 식별자를 준다.
function EngineGlyph({ n }: { n: string }) {
  const p = { width: 24, height: 24, fill: "none", stroke: "currentColor", strokeWidth: 1.9, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (n) {
    case "01": // 생존 레이더 — 레이더 스윕
      return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12L18.4 5.6" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
    case "02": // 원클릭 파이프라인 — 문서에서 문서로
      return <svg {...p}><path d="M4 4h7l3 3v4" /><path d="M4 4v13h6" /><rect x="12" y="12" width="8" height="8" rx="1.6" /><path d="M14.5 16.2l1.5 1.5 3-3" /></svg>;
    case "03": // AI 인사/총무팀 — 사람 + 자동 체크
      return <svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3.5 20v-1.4A4.6 4.6 0 018.1 14h1.8" /><path d="M14 17.5l2 2 4.5-4.5" /></svg>;
    default: // 거래처 자산화 — 연결된 노드
      return <svg {...p}><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M7.9 8.6l2.6 7.2M16.1 8.6l-2.6 7.2M8.4 7h7.2" /></svg>;
  }
}

// 제품 화면 프레임 — 브라우저 크롬을 씌워 "실제 화면"임을 시각적으로 못 박는다.
function ShotFrame({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="lp4-shot-frame">
      <div className="lp4-shot-bar">
        <span className="lp4-shot-dot lp4-shot-dot-r" />
        <span className="lp4-shot-dot lp4-shot-dot-y" />
        <span className="lp4-shot-dot lp4-shot-dot-g" />
        <span className="lp4-shot-url">app.owner-view.com</span>
      </div>
      <Image className="lp4-shot-img" src={src} alt={alt} width={1440} height={900} priority={priority} sizes="(max-width: 1100px) 100vw, 1032px" />
    </div>
  );
}



// 3대 축 한 덩어리 — 화면을 고정하고 순서대로 전환한 뒤 다음 섹션으로 넘어간다.
//   바깥(track)이 블록 수 × 100vh 높이를 갖고, 안쪽(pin)이 sticky 로 화면에 붙는다.
//   스크롤 진행률로 활성 블록을 계산하므로 우측 화면이 잘리지 않는다.
function PillarBlock({ pillar, flip }: { pillar: (typeof PILLARS)[number]; flip: boolean }) {
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const n = pillar.blocks.length;

  useEffect(() => {
    const el = trackRef.current; if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        if (total <= 0) return;
        const p = Math.min(1, Math.max(0, -r.top / total));
        setIdx(Math.min(n - 1, Math.floor(p * n)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [n]);

  return (
    <div className={`lp4-pillar ${flip ? "lp4-pillar-flip" : ""}`} ref={trackRef} style={{ ["--pn" as string]: n }}>
      <div className="lp4-pillar-pin">
        <div className="lp4-container">
          <div className="lp4-pillar-grid">
            <div className="lp4-pillar-copy">
              <div className="lp4-pillar-kicker">{pillar.kicker}</div>
              <h3 className="lp4-pillar-h">
                {pillar.headline.split("\n").map((line, k) => <span key={k}>{line}<br /></span>)}
              </h3>
              <p className="lp4-pillar-lead">{pillar.lead}</p>

              <div className="lp4-pblocks">
                {pillar.blocks.map((bl, i) => (
                  <div key={bl.title} className={`lp4-pblock ${i === idx ? "lp4-pblock-on" : ""}`}>
                    <span className="lp4-pblock-no">{String(i + 1).padStart(2, "0")}</span>
                    <span className="lp4-pblock-body">
                      <span className="lp4-pblock-t">{bl.title}</span>
                      <span className="lp4-pblock-d">{bl.desc}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="lp4-pillar-menus">
                {pillar.menus.map((m) => <span key={m} className="lp4-pillar-menu">{m}</span>)}
              </div>
            </div>

            <div className="lp4-pillar-stage">
              <div className="lp4-pillar-screen">
                {pillar.blocks.map((bl, i) => (
                  <Image
                    key={bl.src}
                    src={bl.src}
                    alt={bl.alt}
                    width={1200}
                    height={760}
                    sizes="(max-width: 1000px) 100vw, 620px"
                    className={i === idx ? "lp4-pshot lp4-pshot-on" : "lp4-pshot"}
                  />
                ))}
              </div>
              <div className="lp4-pdots">
                {pillar.blocks.map((bl, i) => (
                  <span key={bl.src} className={`lp4-pdot ${i === idx ? "lp4-pdot-on" : ""}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 기능 카드 아이콘
function FeatGlyph({ n }: { n: string }) {
  const q = { width: 40, height: 40, fill: "none", stroke: "currentColor", strokeWidth: 1.5, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (n) {
    case "approve": return <svg {...q}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
    case "pipeline": return <svg {...q}><rect x="2" y="4" width="7" height="6" rx="1.5" /><rect x="15" y="14" width="7" height="6" rx="1.5" /><path d="M9 7h4a2 2 0 012 2v6" /></svg>;
    case "sign": return <svg {...q}><path d="M3 18h18" /><path d="M6 14c2-6 4 4 6-1s3 2 5-3" /><path d="M7 3h10l4 4v6" /></svg>;
    case "hr": return <svg {...q}><circle cx="9" cy="8" r="3.4" /><path d="M3 20v-1.6A4.4 4.4 0 017.4 14h3.2" /><path d="M14 17.5l2 2 4.5-4.5" /></svg>;
    case "chat": return <svg {...q}><path d="M21 11.5a8.4 8.4 0 01-12.8 7.5L3 21l1.9-5.2A8.4 8.4 0 1121 11.5z" /></svg>;
    case "crm": return <svg {...q}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /></svg>;
    default: return <svg {...q}><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M13 2v7h7" /><path d="M8 15h8" /></svg>;
  }
}

export default function LandingPage() {
  const [on, setOn] = useState(false);
  const [day, setDay] = useState(0);   // 하루 타임라인 — 스크롤 진행률로 바뀐다
  const dayRef = useRef<HTMLElement>(null);
  const [eng, setEng] = useState(0);   // AI 엔진 탭
  const [cat, setCat] = useState(0);   // 전체 기능 — 선택된 메뉴 그룹
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  // 하루 섹션: 스크롤한 만큼 09:00 → 23:00 이 순서대로 넘어간다
  useEffect(() => {
    const el = dayRef.current; if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        if (total <= 0) return;
        const p = Math.min(1, Math.max(0, -r.top / total));
        setDay(Math.min(DAY.length - 1, Math.floor(p * DAY.length)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const h = () => {
      const y = window.scrollY;
      setOn(y > 8);
      // 히어로를 지나면 모바일 하단 CTA 노출 — 스크롤 어디에서든 가입 경로가 살아있게
      setShowSticky(y > 700);
    };
    h();
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);


  return (
    <div className="lp4-root">
      {/* ══ NAV ══ */}
      <nav className={`lp4-nav ${on ? "lp4-nav-on" : ""}`}>
        <div className="lp4-nav-inner">
          <div className="lp4-logo"><Logo size={25} /> OwnerView</div>
          <div className="lp4-menu">{NAV_LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</div>
          <div className="lp4-nav-right">
            <Link href="/auth" className="lp4-login">로그인</Link>
            <Link href="/auth" className="lp4-pill">무료로 시작하기</Link>
            {/* 모바일 전용 — 920px 미만에서 lp4-menu 가 숨겨져 섹션 이동 수단이 없었다 */}
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
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
          ))}
          <Link href="/auth" onClick={() => setMenuOpen(false)}>로그인</Link>
        </div>
      </nav>

      {/* ══ HERO ══ */}
      <header className="lp4-hero">
        <div className="lp4-hero-orbs" />
        <div className="lp4-hero-grid" />
        <div className="lp4-container">
          <div className="lp4-hero-inner">
            <h1 className="lp4-hero-title">회사 운영의 모든 것<br /><em>오너뷰</em>에서 쉽고 간편하게</h1>
            <p className="lp4-hero-sub">{HERO.sub}</p>
            <p className="lp4-hero-desc">{HERO.desc}</p>
            <div className="lp4-hero-cta">
              <Link href="/auth" className="lp4-btn lp4-btn-onink">무료로 시작하기 <Arrow /></Link>
              <Link href="/demo" className="lp4-btn lp4-btn-ghost-light">실제 화면 둘러보기</Link>
            </div>
            <div className="lp4-hero-checks">{HERO.checks.map((c) => <span key={c} className="lp4-hero-check"><Check /> {c}</span>)}</div>
          </div>
        </div>
        {/* 실제 오너뷰 대시보드 — 히어로 아래로 걸쳐 다음 섹션까지 이어진다 */}
        <div className="lp4-hero-shot">
          <ShotFrame src="/product/dashboard-v3.png" alt="오너뷰 위젯 대시보드 — 근태·일정·프로젝트·매출·미수금 위젯" priority />
        </div>
      </header>
      <div className="lp4-hero-spacer" />

      {/* ══ STATS ══ */}
      <section className="lp4-stats">
        <div className="lp4-container">
          <div className="lp4-stats-grid">
            {STATS.map((s) => (
              <div key={s.label} className="lp4-stat">
                <div className="lp4-stat-value">{s.value === 0 ? <>0<span className="lp4-stat-mute">{s.suffix}</span></> : <CountUp to={s.value} suffix={s.suffix} />}</div>
                <div className="lp4-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ AI ENGINES ══ */}
      <section className="lp4-section lp4-bg-dark" id="engines">
        <div className="lp4-dark-orbs" />
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">4 AI Engines</div>
            <h2 className="lp4-h2">4개의 AI 엔진이 <span className="lp4-underline">반복 업무를 대신 해요</span></h2>
            <p className="lp4-sub">사람을 대체하는 게 아니라, 매번 되풀이되는 일을 자동으로 처리해요.</p>
          </Reveal>

          {/* 탭으로 묶고, 고르면 우측 화면이 바뀐다 (먼데이 레퍼런스) */}
          <div className="lp4-etabs">
            {ENGINES.map((e, i) => (
              <button key={e.num} className={`lp4-etab ${i === eng ? "lp4-etab-on" : ""}`} onClick={() => setEng(i)}>
                <EngineGlyph n={e.num} />
                <span>{e.name}</span>
              </button>
            ))}
          </div>

          <div className="lp4-epanel" key={ENGINES[eng].num}>
            <div className="lp4-ecopy">
              <div className="lp4-eno">ENGINE {ENGINES[eng].num} · {ENGINES[eng].eng}</div>
              <div className="lp4-eline">{ENGINES[eng].headline}</div>
              <p className="lp4-eshort">{ENGINES[eng].short}</p>
              <div className="lp4-esteps">
                {ENGINES[eng].steps.map((st, j) => (
                  <div key={j} className="lp4-estep"><span className="lp4-edot">{j + 1}</span><span>{st}</span></div>
                ))}
              </div>
              <div className="lp4-erep">
                <span className="lp4-erep-cap">대체 인력 · {ENGINES[eng].replaces}</span>
                <span className="lp4-erep-cost">{ENGINES[eng].replacesCost} 절감</span>
              </div>
            </div>
            <div className="lp4-eshot">
              <Image src={ENGINES[eng].src} alt={ENGINES[eng].alt} width={1200} height={760} sizes="(max-width: 1000px) 100vw, 620px" />
            </div>
          </div>
        </div>
      </section>

      {/* ══ 하루 — 스크롤에 따라 09:00 → 23:00 이 순서대로 넘어간다 ══ */}
      <section className="lp4-daysec" id="day" ref={dayRef} style={{ ["--dn" as string]: DAY.length }}>
        <div className="lp4-daypin">
          <div className="lp4-container">
            <div className="lp4-sec-head lp4-sec-head-c lp4-day-head">
              <h2 className="lp4-h2">회사의 하루가 <span className="lp4-underline">이렇게 달라져요</span></h2>
            </div>

            <div className="lp4-tl">
              <div className="lp4-tl-line" />
              <div className="lp4-tl-fill" style={{ width: `${(day / (DAY.length - 1)) * 100}%` }} />
              {DAY.map((d, i) => (
                <button
                  key={d.time}
                  className={`lp4-tl-item ${i === day ? "lp4-tl-on" : ""} ${i < day ? "lp4-tl-done" : ""}`}
                  onClick={() => setDay(i)}
                  aria-current={i === day}
                >
                  <span className="lp4-tl-dot" />
                  <span className="lp4-tl-time">{d.time}</span>
                  <span className="lp4-tl-scene">{d.scene}</span>
                </button>
              ))}
            </div>

            <div className="lp4-tl-panel">
              <div className="lp4-tl-copy" key={DAY[day].time}>
                <div className="lp4-tl-before">
                  <span className="lp4-tl-tag">지금까지</span>
                  <p>{DAY[day].before}</p>
                </div>
                <div className="lp4-tl-after">
                  <span className="lp4-tl-tag lp4-tl-tag-on">오너뷰 · {DAY[day].menu}</span>
                  <p>{DAY[day].after}</p>
                </div>
              </div>

              {/* 실제 오너뷰 화면 — 신뢰를 위해 캡처를 쓰고, 위에 라이브 카드를 겹쳐 움직임을 준다 */}
              <div className="lp4-tl-stage">
                {DAY.map((d, i) => (
                  <Image
                    key={d.src}
                    src={d.src}
                    alt={d.alt}
                    width={1440}
                    height={900}
                    sizes="(max-width: 1000px) 100vw, 720px"
                    className={i === day ? "lp4-tl-shot lp4-tl-shot-on" : "lp4-tl-shot"}
                  />
                ))}
                <div className="lp4-tl-live" key={`lv-${DAY[day].time}`}>
                  {(() => { const C = LIVE[DAY_LIVE[day]]; return <C />; })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 3대 축 — 좌: 카피 블록 / 우: 스크롤에 따라 바뀌는 실제 화면 ══ */}
      <section className="lp4-pillars" id="pillars">
        {PILLARS.map((p, i) => (
          <PillarBlock key={p.key} pillar={p} flip={i % 2 === 1} />
        ))}
      </section>

      {/* ══ 전체 기능 — 메뉴별로 무엇을 할 수 있는지 (그룹 탭) ══ */}
      <section className="lp4-section lp4-bg-canvas" id="catalog">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">All features</div>
            <h2 className="lp4-h2">필요한 기능은 <span className="lp4-underline">메뉴마다 다 있어요</span></h2>
            <p className="lp4-sub">어느 메뉴에서 무엇을 할 수 있는지 한 장에 정리했어요.</p>
          </Reveal>

          <div className="lp4-cat-tabs">
            {CATALOG.map((g, i) => (
              <button
                key={g.key}
                className={`lp4-cat-tab ${i === cat ? "lp4-cat-tab-on" : ""}`}
                onClick={() => setCat(i)}
                aria-pressed={i === cat}
              >
                <span className="lp4-cat-tab-n">{g.group}</span>
                <span className="lp4-cat-tab-c">{g.menus.length}개 메뉴</span>
              </button>
            ))}
          </div>

          <div className="lp4-cat-panel" key={CATALOG[cat].key}>
            <p className="lp4-cat-lead">{CATALOG[cat].lead}</p>
            <div className="lp4-cat-grid">
              {CATALOG[cat].menus.map((m) => (
                <div key={m.name} className="lp4-cat-card">
                  <div className="lp4-cat-name">{m.name}</div>
                  <p className="lp4-cat-desc">{m.desc}</p>
                  <ul className="lp4-cat-items">
                    {m.items.map((it) => (
                      <li key={it} className="lp4-cat-item"><Check />{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ AI 자동화 — 사람이 하던 반복 작업을 무엇이 대신하는지 ══ */}
      <section className="lp4-section lp4-bg-tint" id="ai">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">AI Automation</div>
            <h2 className="lp4-h2">이건 <span className="lp4-underline">AI가 알아서 해요</span></h2>
            <p className="lp4-sub">매번 손으로 하던 일 8가지를 오너뷰가 대신 처리해요.</p>
          </Reveal>
          <div className="lp4-ai-grid">
            {AI_AUTOMATION.map((a) => (
              <Reveal key={a.name} className="lp4-ai-card">
                <span className="lp4-ai-tag">{a.tag}</span>
                <div className="lp4-ai-name">{a.name}</div>
                <p className="lp4-ai-desc">{a.desc}</p>
                <div className="lp4-ai-where">{a.where}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FEATURES — 카드 나열 ══ */}
      <section className="lp4-section lp4-bg-canvas" id="features">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <h2 className="lp4-h2">흩어진 7개 도구, 하나로 합쳐보세요</h2>
            <p className="lp4-sub">따로 결제하던 도구들이 하나의 데이터 위에서 같이 움직여요.</p>
          </Reveal>
          {/* 한 줄에 전부 두고 가로로 흐르게 — 마우스를 올리면 멈춘다 */}
          <div className="lp4-roll">
            <div className="lp4-roll-track">
              {[0, 1].map((dup) => (
                <div key={dup} className="lp4-roll-run" aria-hidden={dup === 1}>
                  {FEATURES.map((f) => (
                    <div key={f.tab} className={`lp4-fcard lp4-fcard-${f.tone}`}>
                      <div className="lp4-fcard-art"><FeatGlyph n={f.icon} /></div>
                      <div className="lp4-fcard-name">{f.tab}</div>
                      <div className="lp4-fcard-title">{f.title}</div>
                      <p className="lp4-fcard-desc">{f.desc}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ 모바일 — 언제 어디서든 같은 화면 ══ */}
      <section className="lp4-mobile" id="mobile">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <h2 className="lp4-h2">{MOBILE.title.split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}</h2>
            <p className="lp4-sub">{MOBILE.sub}</p>
          </Reveal>
          <Reveal>
            <div className="lp4-phone-wrap">
              <div className="lp4-phone">
                <Image src={MOBILE.src} alt={MOBILE.alt} width={390} height={844} sizes="330px" />
              </div>
              <div className="lp4-phone-points">
                {MOBILE.points.map((t) => (
                  <span key={t} className="lp4-phone-point"><Check /> {t}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══ FAQ ══ */}
      <section className="lp4-section lp4-bg-tint" id="faq">
        <div className="lp4-narrow">
          <Reveal className="lp4-sec-head"><div className="lp4-eyebrow">FAQ</div><h2 className="lp4-h2">자주 묻는 질문이에요</h2></Reveal>
          <div>
            {FAQS.map((faq, i) => (
              <div key={i} className={`lp4-faq ${openFaq === i ? "lp4-faq-open" : ""}`}>
                <button className="lp4-faq-btn" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                  {faq.q}
                  <svg className="lp4-faq-chev" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                <div className="lp4-faq-panel"><div className="lp4-faq-a">{faq.a}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FINAL CTA ══ */}
      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-container">
          <Reveal>
            <div className="lp4-final">
              <div className="lp4-final-orbs" />
              <div className="lp4-final-inner">
                <h2 className="lp4-final-h">회사 현황, 한눈에 보고 싶다면<br /><em>오너뷰로 시작해보세요</em></h2>
                <p className="lp4-final-p">거래처 목록과 거래내역은 엑셀만 올리면 바로 등록돼요. 가입 시 카드 등록 · 14일 무료.</p>
                <Link href="/auth" className="lp4-btn lp4-btn-onink">무료로 시작하기 <Arrow /></Link>
                <p className="lp4-final-note">이미 계정이 있으신가요? <Link href="/auth">로그인하기</Link></p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══ PARTNER — 대다수 방문자와 무관한 엔터프라이즈 폼은 최종 CTA 뒤로 ══ */}
      <section className="lp4-section lp4-bg-tint" id="partner">
        <div className="lp4-narrow">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Contact</div>
            <h2 className="lp4-h2">제휴·도입이 궁금하세요?</h2>
            <p className="lp4-sub">엔터프라이즈 도입, API 연동, 리셀러 제휴를 상담해 드릴게요.</p>
          </Reveal>
          <Reveal><PartnershipForm /></Reveal>
        </div>
      </section>

      {/* ══ FOOTER ══ */}
      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-top">
            <div className="lp4-logo"><Logo size={25} /> OwnerView <span className="lp4-footer-sub">Company Operating System</span></div>
            <div className="lp4-flinks"><a href="#tour">제품 화면</a><a href="#features">기능</a><a href="#pricing">가격</a><a href="#partner">제휴문의</a><a href="#faq">FAQ</a></div>
          </div>
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불규정</Link><a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a></div>
          </div>
        </div>
      </footer>

      {/* ══ 모바일 하단 고정 CTA ══ */}
      <div className={`lp4-sticky-cta ${showSticky ? "lp4-sticky-cta-on" : ""}`}>
        <Link href="/demo" className="lp4-btn lp4-btn-line">화면 보기</Link>
        <Link href="/auth" className="lp4-btn lp4-btn-brand">무료로 시작하기</Link>
      </div>
    </div>
  );
}
