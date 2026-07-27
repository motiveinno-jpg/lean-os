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
import { HERO, STATS, SCREENS, PILLARS, DAY, HERO_ROTATE, FLOW, CASES, CASES_NOTE, FEATURES, ENGINES, COMPETITORS, PLANS, FAQS, NAV_LINKS, FOOTER } from "@/components/landing/content";
import { PartnershipForm } from "@/components/landing/partnership-form";

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

export default function LandingPage() {
  const [on, setOn] = useState(false);
  const [tour, setTour] = useState(0);
  const [feat, setFeat] = useState(0); // 기능 리스트 — 열린 항목
  const [word, setWord] = useState(0); // 히어로 회전 단어
  const [tourAuto, setTourAuto] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [team, setTeam] = useState(8);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  // 견적→정산 흐름: 화면에 들어오면 자동으로 단계가 넘어가고, 사용자가 누르면 자동 진행을 멈춘다
  const [flow, setFlow] = useState(0);
  const [flowAuto, setFlowAuto] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);
  const flowPinned = useRef(false); // 사용자가 단계를 직접 고르면 자동 진행을 재개하지 않는다

  useEffect(() => {
    const el = flowRef.current; if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (es) => setFlowAuto(es[0].isIntersecting && !flowPinned.current),
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!flowAuto) return;
    const t = setTimeout(() => setFlow((i) => (i + 1) % FLOW.length), 4200);
    return () => clearTimeout(t);
  }, [flow, flowAuto]);

  // 제품 화면 투어도 같은 방식으로 자동 순환 — 정적 탭이라 "심플하다"는 지적을 받았다
  const tourRef = useRef<HTMLDivElement>(null);
  const tourPinned = useRef(false);
  useEffect(() => {
    const el = tourRef.current; if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (es) => setTourAuto(es[0].isIntersecting && !tourPinned.current),
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!tourAuto) return;
    const t = setTimeout(() => setTour((i) => (i + 1) % SCREENS.length), 5000);
    return () => clearTimeout(t);
  }, [tour, tourAuto]);

  useEffect(() => {
    const t = setInterval(() => setWord((i) => (i + 1) % HERO_ROTATE.length), 2000);
    return () => clearInterval(t);
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

  const compTotal = COMPETITORS.reduce((s, c) => s + (c.perSeat ? c.price * team : c.price), 0);
  const owvTotal = 79500 + Math.max(0, team - 5) * 10000;
  const savePct = Math.round(((compTotal - owvTotal) / compTotal) * 100);
  const won = (n: number) => "₩" + n.toLocaleString("ko-KR");
  const scr = SCREENS[tour];

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
            <span className="lp4-hero-badge"><span className="lp4-hero-badge-dot" />{HERO.badge}</span>
            {/* 회전 단어 — 3대 축을 첫 화면에서 즉시 인지시킨다 */}
            <h1 className="lp4-hero-title">
              <span className="lp4-rotate">
                <span className="lp4-rotate-word" key={HERO_ROTATE[word]}>{HERO_ROTATE[word]}</span>
              </span>
              <span className="lp4-hero-fixed">까지,</span>
              <br /><em>오너뷰 하나로</em>
            </h1>
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
          <ShotFrame src={SCREENS[0].src} alt={SCREENS[0].alt} priority />
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

      {/* ══ 기능 티커 — 정적인 화면에 흐름을 주고, 한눈에 커버 범위를 훑게 한다 ══ */}
      <div className="lp4-ticker" aria-hidden="true">
        <div className="lp4-ticker-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="lp4-ticker-run">
              {["AI 모닝 브리핑", "현금 90일 예측", "위젯 대시보드", "견적 → 계약 자동화", "전자서명 · 직인", "3-Way 입금 매칭",
                "4대보험 자동 계산", "급여명세서 자동 발송", "근태 · 연차", "전자결재", "세금계산서 국세청 발행", "거래처 원장",
                "은행 · 카드 실계좌 연동", "AI 거래 분류", "파트너 포털", "전표 자동 기장"].map((t) => (
                <span key={t} className="lp4-ticker-item">{t}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ══ 대표님의 하루 — 지금 방식 vs 오너뷰 ══ */}
      <section className="lp4-section lp4-bg-canvas" id="day">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">A Day of the Owner</div>
            <h2 className="lp4-h2">대표님의 하루가 <span className="lp4-underline">이렇게 바뀌어요</span></h2>
            <p className="lp4-sub">기능 목록 말고, 하루 동안 무엇이 사라지는지로 보여드릴게요.</p>
          </Reveal>

          <div className="lp4-day">
            <div className="lp4-day-legend">
              <span className="lp4-day-leg lp4-day-leg-before">지금까지</span>
              <span className="lp4-day-leg lp4-day-leg-after">오너뷰</span>
            </div>
            {DAY.map((d) => (
              <Reveal key={d.time}>
                <div className="lp4-day-row">
                  <div className="lp4-day-time">
                    <b>{d.time}</b>
                    <span>{d.scene}</span>
                  </div>
                  <div className="lp4-day-before">
                    <span className="lp4-day-tag">지금까지</span>
                    <p>{d.before}</p>
                  </div>
                  <div className="lp4-day-arrow"><Arrow /></div>
                  <div className="lp4-day-after">
                    <span className="lp4-day-tag lp4-day-tag-on">오너뷰 · {d.menu}</span>
                    <p>{d.after}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 3대 축 — 프로젝트 · 인사 · 회계. 오너뷰의 핵심 소구점 ══ */}
      <section className="lp4-pillars" id="pillars">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">One ERP, Three Pillars</div>
            <h2 className="lp4-h2">회사 운영은 <span className="lp4-underline">세 가지</span>로 나뉘어요</h2>
            <p className="lp4-sub">프로젝트를 굴리고, 사람을 챙기고, 돈을 정리해요. 오너뷰는 이 셋을 각각 제대로 해요.</p>
          </Reveal>
        </div>

        {PILLARS.map((p, i) => (
          <div key={p.key} className={`lp4-pillar ${i % 2 === 1 ? "lp4-pillar-alt" : ""}`}>
            <div className="lp4-container">
              <div className="lp4-pillar-grid">
                <Reveal className="lp4-pillar-copy">
                  <div className="lp4-pillar-no">{p.no}</div>
                  <div className="lp4-pillar-kicker">{p.kicker}</div>
                  <h3 className="lp4-pillar-h">{p.headline.split("\n").map((line, k) => <span key={k}>{line}<br /></span>)}</h3>
                  <p className="lp4-pillar-lead">{p.lead}</p>

                  <div className="lp4-pillar-stats">
                    {p.stats.map((s) => (
                      <div key={s.l} className="lp4-pillar-stat"><b>{s.v}</b><span>{s.l}</span></div>
                    ))}
                  </div>

                  {/* 고민 → 해소. 방문자가 자기 상황을 바로 대입할 수 있게 질문형으로 */}
                  <div className="lp4-pains">
                    {p.pains.map((x) => (
                      <div key={x.q} className="lp4-pain-qa">
                        <div className="lp4-pain-q"><span className="lp4-pain-mark">?</span>{x.q}</div>
                        <div className="lp4-pain-a"><span className="lp4-pain-arrow">→</span>{x.a}</div>
                      </div>
                    ))}
                  </div>

                  <div className="lp4-pillar-menus">
                    {p.menus.map((m) => <span key={m} className="lp4-pillar-menu">{m}</span>)}
                  </div>
                </Reveal>

                <Reveal className="lp4-pillar-shot">
                  <Image src={p.src} alt={p.alt} width={1200} height={760} sizes="(max-width: 1000px) 100vw, 700px" />
                </Reveal>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ══ 제품 실물 화면 투어 ══ */}
      <section className="lp4-section lp4-bg-tint" id="tour">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Real Product</div>
            <h2 className="lp4-h2">렌더링이 아닌 <span className="lp4-underline">실제 서비스 화면</span>이에요</h2>
            <p className="lp4-sub">아래 이미지는 전부 실제 오너뷰 화면을 그대로 캡처한 거예요. 가입하면 똑같은 화면을 쓰실 수 있어요.</p>
          </Reveal>

          <div className="lp4-tour-tabs">
            {SCREENS.map((s, i) => (
              <button
                key={s.key}
                className={`lp4-tour-tab ${i === tour ? "lp4-tour-tab-on" : ""}`}
                onClick={() => { tourPinned.current = true; setTourAuto(false); setTour(i); }}
              >
                {s.tab}
                {i === tour && tourAuto && <span className="lp4-tour-tab-bar" key={`tb${tour}`} />}
              </button>
            ))}
          </div>

          <div className="lp4-tour-panel" ref={tourRef}>
            <div className="lp4-tour-copy" key={`c${scr.key}`}>
              <div className="lp4-tour-step">SCREEN {String(tour + 1).padStart(2, "0")} / {String(SCREENS.length).padStart(2, "0")}</div>
              <div className="lp4-tour-title">{scr.title}</div>
              <p className="lp4-tour-desc">{scr.desc}</p>
              <span className="lp4-tour-note"><Check /> 실제 서비스 화면이에요</span>
            </div>
            {/* 화면 위에 기능 위치를 짚어주는 주석 — 처음 보는 방문자가 어디를 봐야 할지 알 수 있게 */}
            <div className="lp4-tour-stage">
              <div className="lp4-tour-shot" key={scr.key}>
                <Image src={scr.src} alt={scr.alt} width={1440} height={900} sizes="(max-width: 1000px) 100vw, 760px" />
                {scr.callouts?.map((c, i) => (
                  <span
                    key={c.text}
                    className="lp4-callout"
                    style={{ left: `${c.x}%`, top: `${c.y}%`, animationDelay: `${0.35 + i * 0.22}s` }}
                  >
                    <span className="lp4-callout-pulse" />
                    <span className="lp4-callout-label">{c.text}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 견적 → 정산 흐름 (자동 진행 + 클릭) ══ */}
      <section className="lp4-section lp4-bg-canvas" id="flow">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">End to End</div>
            <h2 className="lp4-h2">견적부터 정산까지, <span className="lp4-underline">끊기지 않고</span> 이어져요</h2>
            <p className="lp4-sub">앞 단계에서 만든 정보가 다음 단계로 그대로 넘어가요. 아래는 실제 서비스 화면이에요.</p>
          </Reveal>

          <div className="lp4-flow" ref={flowRef}>
            {/* 좌: 단계 목록 — 진행 중인 단계에 진행 바가 채워진다 */}
            <div className="lp4-flow-steps">
              {FLOW.map((f, i) => (
                <button
                  key={f.key}
                  className={`lp4-flow-step ${i === flow ? "lp4-flow-step-on" : ""} ${i < flow ? "lp4-flow-step-done" : ""}`}
                  onClick={() => { flowPinned.current = true; setFlowAuto(false); setFlow(i); }}
                  aria-current={i === flow}
                >
                  <span className="lp4-flow-num">{i < flow ? <Check /> : f.step}</span>
                  <span className="lp4-flow-text">
                    <span className="lp4-flow-tab">{f.tab}</span>
                    <span className="lp4-flow-title">{f.title}</span>
                    {i === flow && <span className="lp4-flow-desc">{f.desc}</span>}
                  </span>
                  {i === flow && flowAuto && <span className="lp4-flow-progress" key={`p${flow}`} />}
                </button>
              ))}
            </div>

            {/* 우: 단계에 대응하는 실제 화면 */}
            <div className="lp4-flow-stage">
              {FLOW.map((f, i) => (
                <div key={f.key} className={`lp4-flow-shot ${i === flow ? "lp4-flow-shot-on" : ""}`} aria-hidden={i !== flow}>
                  <Image src={f.src} alt={f.alt} width={1180} height={860} sizes="(max-width: 1000px) 100vw, 660px" />
                </div>
              ))}
              <div className="lp4-flow-dots">
                {FLOW.map((f, i) => (
                  <button
                    key={f.key}
                    className={`lp4-flow-dot ${i === flow ? "lp4-flow-dot-on" : ""}`}
                    onClick={() => { flowPinned.current = true; setFlowAuto(false); setFlow(i); }}
                    aria-label={f.tab}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ FEATURES ══ */}
      <section className="lp4-section lp4-bg-tint" id="features">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Product</div>
            <h2 className="lp4-h2">흩어진 7개 도구, 하나로 합쳐보세요</h2>
            <p className="lp4-sub">따로 결제하던 도구들이 하나의 데이터 위에서 같이 움직여요.</p>
          </Reveal>
          {/* 큰 타이포 리스트 — 카드 나열보다 훑기 쉽고, 고른 항목만 펼쳐 읽는다 */}
          <div className="lp4-feat-list">
            {FEATURES.map((f, i) => (
              <button
                key={f.tab}
                className={`lp4-feat-row ${i === feat ? "lp4-feat-row-on" : ""}`}
                onClick={() => setFeat(i === feat ? -1 : i)}
                aria-expanded={i === feat}
              >
                <span className="lp4-feat-idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="lp4-feat-body">
                  <span className="lp4-feat-name">{f.tab}</span>
                  <span className="lp4-feat-sum">{f.title}</span>
                  {i === feat && (
                    <span className="lp4-feat-more">
                      <span className="lp4-feat-desc">{f.desc}</span>
                      <span className="lp4-feat-rep">이 기능이 대신해요 · <b>{f.replaces}</b></span>
                    </span>
                  )}
                </span>
                <span className="lp4-feat-plus">{i === feat ? "−" : "+"}</span>
              </button>
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
          <div className="lp4-eng-grid">
            {ENGINES.map((e) => (
              <Reveal key={e.num}><div className="lp4-eng lp4-card">
                <div className="lp4-eng-head">
                  <span className="lp4-eng-chip"><EngineGlyph n={e.num} /></span>
                  <div className="lp4-eng-id">
                    <div className="lp4-eng-name">{e.name}</div>
                    <div className="lp4-eng-eng">ENGINE {e.num} · {e.eng}</div>
                  </div>
                </div>
                <div className="lp4-eng-line">{e.headline}</div>
                {/* 3단계 처리 흐름 — 설명 문단 대신 시각적 파이프라인으로 (텍스트 과다 해소) */}
                <div className="lp4-eng-steps">
                  {e.steps.map((st, j) => <div key={j} className="lp4-eng-step"><span className="lp4-eng-dot">{j + 1}</span><span>{st}</span></div>)}
                </div>
                <div className="lp4-eng-tags">
                  {e.features.map((ft) => <span key={ft} className="lp4-eng-tag">{ft}</span>)}
                </div>
                <div className="lp4-eng-rep">
                  <span className="lp4-eng-rep-cap">대체 인력 · {e.replaces}</span>
                  <span className="lp4-eng-rep-cost">{e.replacesCost} 절감</span>
                </div>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ COMPARE ══ */}
      <section className="lp4-section lp4-bg-tint" id="compare">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Compare</div>
            <h2 className="lp4-h2">따로 쓰면 인원마다 늘어나요</h2>
            <p className="lp4-sub">7개 도구를 따로 구독할 때와 오너뷰 정액제를 같은 조건으로 비교해봤어요.</p>
          </Reveal>
          <div className="lp4-cmp-grid">
            <Reveal><div className="lp4-cmp lp4-card">
              <div className="lp4-cmp-title">개별 도구를 따로 쓰는 방식</div>
              <div className="lp4-cmp-rows">
                {COMPETITORS.map((c) => (
                  <div key={c.full} className="lp4-cmp-row">
                    <span className="lp4-cmp-name">{c.cat} · {c.full}{c.perSeat ? " (인원당)" : ""}</span>
                    <span className="lp4-cmp-price">{won(c.perSeat ? c.price * team : c.price)}</span>
                  </div>
                ))}
              </div>
              <div className="lp4-cmp-total">
                <span className="lp4-cmp-total-cap">{team}명 기준 월</span>
                <span className="lp4-cmp-total-val lp4-cmp-total-warn">{won(compTotal)}</span>
              </div>
            </div></Reveal>
            <Reveal><div className="lp4-cmp lp4-card lp4-cmp-hl">
              <div className="lp4-cmp-title">OwnerView 하나로</div>
              <div className="lp4-cmp-rows">
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">프로 (기본 5명 포함)</span><span className="lp4-cmp-price">₩79,500</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">추가 {Math.max(0, team - 5)}명 × ₩10,000</span><span className="lp4-cmp-price">{won(Math.max(0, team - 5) * 10000)}</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">전 기능 포함 · VAT 별도</span><span className="lp4-cmp-price lp4-cmp-inc">포함</span></div>
              </div>
              <div className="lp4-cmp-total">
                <span className="lp4-cmp-total-cap">{team}명 기준 월</span>
                <span className="lp4-cmp-total-val">{won(owvTotal)}</span>
              </div>
              <div className="lp4-cmp-save">매월 약 {won(compTotal - owvTotal)} 절감 ({savePct}%)</div>
            </div></Reveal>
          </div>
          <div className="lp4-calc lp4-card">
            <div className="lp4-calc-head"><span>팀 인원</span><b>{team}명</b></div>
            <input type="range" min={1} max={50} value={team} onChange={(e) => setTeam(Number(e.target.value))} className="lp4-slider" aria-label="팀 인원" />
          </div>
        </div>
      </section>

      {/* ══ PRICING ══ */}
      <section className="lp4-section lp4-bg-canvas" id="pricing">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Pricing</div>
            <h2 className="lp4-h2">14일 써보고 결정하세요</h2>
            <p className="lp4-sub">가입할 때 카드만 등록해요. 14일 안에 해지하면 첫 결제는 없어요.</p>
          </Reveal>
          <div className="lp4-price-grid">
            {PLANS.map((p) => (
              <Reveal key={p.name}><div className={`lp4-price lp4-card ${p.hl ? "lp4-price-hl" : ""}`}>
                {p.hl && <span className="lp4-price-best">BEST</span>}
                <div className="lp4-price-name">{p.name}</div>
                <div className="lp4-price-desc">{p.desc}</div>
                {p.regularPrice
                  ? <div className="lp4-price-reg">₩{p.regularPrice}{p.discount && <span className="lp4-price-off">{p.discount} 할인</span>}</div>
                  : <div className="lp4-price-reg-empty" />}
                <div className={`lp4-price-amt ${p.price === "별도 협의" ? "lp4-price-amt-text" : ""}`}>{p.price === "별도 협의" ? "별도 협의" : `₩${p.price}`}<span className="lp4-price-unit">{p.unit && ` ${p.unit}`}</span></div>
                <div className="lp4-price-period">{p.period}</div>
                <ul className="lp4-price-feats">{p.features.map((ft, i) => <li key={i} className="lp4-price-feat"><Check />{ft}</li>)}</ul>
                <Link href={p.name === "엔터프라이즈" ? "#partner" : p.slug ? `/auth?plan=${p.slug}` : "/auth"} className={`lp4-price-cta ${p.hl ? "lp4-price-cta-brand" : "lp4-price-cta-line"}`}>
                  {p.name === "엔터프라이즈" ? "도입 문의하기" : "14일 무료로 시작하기"}
                </Link>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 도입 사례 — 실제 운영 계정 수치만. 회사명은 마스킹 ══ */}
      <section className="lp4-section lp4-bg-canvas" id="cases">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">In Production</div>
            <h2 className="lp4-h2">만든 회사가 <span className="lp4-underline">직접 쓰고</span> 있어요</h2>
            <p className="lp4-sub">{CASES_NOTE}</p>
          </Reveal>
          <div className="lp4-case-grid">
            {CASES.map((c) => (
              <Reveal key={c.masked}><div className="lp4-case lp4-card">
                <div className="lp4-case-head">
                  <span className="lp4-case-mark">{c.masked.slice(0, 1)}</span>
                  <div className="lp4-case-id">
                    <div className="lp4-case-name">{c.masked}</div>
                    <div className="lp4-case-meta">{c.industry} · {c.size} · {c.plan}</div>
                  </div>
                  <span className="lp4-case-private">회사명 비공개</span>
                </div>
                <p className="lp4-case-note">{c.note}</p>
                <div className="lp4-case-metrics">
                  {c.metrics.map((m) => (
                    <div key={m.label} className="lp4-case-metric">
                      <div className="lp4-case-metric-value">{m.value}</div>
                      <div className="lp4-case-metric-label">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div></Reveal>
            ))}
          </div>
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
