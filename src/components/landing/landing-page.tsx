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
import { HERO, HERO_STRIP, HERO_INTRO, STATS, PILLARS, DAY, MOBILE, ENGINES, CATALOG, AI_AUTOMATION, FAQS, NAV_LINKS, FOOTER } from "@/components/landing/content";
import { LandingNav } from "@/components/landing/landing-nav";
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

// 숫자 카드 아이콘
function StatGlyph({ n }: { n: string }) {
  const p = { width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (n) {
    case "grid": return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>;
    case "spark": return <svg {...p}><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" /><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9L18 15z" /></svg>;
    case "save": return <svg {...p}><path d="M21 8l-7.5 7.5-4-4L3 18" /><path d="M15 8h6v6" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12h7" /></svg>;
  }
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


// 주요 기능 둘러보기 — 축 탭(프로젝트·인사·회계) → 기능 탭 → 우측 화면이 바뀐다.
//   핀 스크롤을 걷어낸 자리. 스크롤을 522vh 잡아먹던 걸 한 화면으로 줄이고,
//   대신 4초마다 다음 기능으로 저절로 넘어가 "계속 바뀌는" 느낌을 준다(직접 누르면 자동 진행 중단).
function PillarTabs() {
  const [ax, setAx] = useState(0);   // 축
  const [bl, setBl] = useState(0);   // 그 축의 기능
  const [auto, setAuto] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  // 화면에 들어와 있을 때만 돌린다
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => setLive(es[0].isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !live) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      setBl((v) => {
        const n = PILLARS[ax].blocks.length;
        if (v + 1 < n) return v + 1;
        setAx((k) => (k + 1) % PILLARS.length);   // 마지막 기능이면 다음 축으로
        return 0;
      });
    }, 4200);
    return () => clearInterval(t);
  }, [auto, live, ax]);

  const pick = (a: number, b: number) => { setAuto(false); setAx(a); setBl(b); };
  const P = PILLARS[ax];
  const B = P.blocks[bl];

  return (
    <section className="lp4-section lp4-bg-tint" id="pillars" ref={ref}>
      <div className="lp4-container">
        <Reveal className="lp4-sec-head lp4-sec-head-c">
          <div className="lp4-eyebrow">Core</div>
          <h2 className="lp4-h2">주요 기능, <span className="lp4-underline">여기서 둘러보세요</span></h2>
          <p className="lp4-sub">회사 운영의 세 축이 하나의 데이터 위에서 같이 움직여요.</p>
        </Reveal>

        {/* 축 탭 */}
        <div className="lp4-ax">
          {PILLARS.map((q, i) => (
            <button key={q.key} className={`lp4-ax-t ${i === ax ? "lp4-ax-on" : ""}`} onClick={() => pick(i, 0)}>
              {q.kicker}
            </button>
          ))}
        </div>

        <div className="lp4-mf">
          <div className="lp4-mf-copy">
            <div className="lp4-mf-kicker">{P.kicker}</div>
            <h3 className="lp4-mf-h">
              {P.headline.split("\n").map((line, k) => <span key={k}>{line}<br /></span>)}
            </h3>
            <p className="lp4-mf-lead">{P.lead}</p>

            {/* 기능 탭 — 참고 레퍼런스의 알약 버튼 */}
            <div className="lp4-mf-tabs">
              {P.blocks.map((q, i) => (
                <button key={q.tab} className={`lp4-mf-tab ${i === bl ? "lp4-mf-tab-on" : ""}`} onClick={() => pick(ax, i)}>
                  {q.tab}
                  {i === bl && auto && <span className="lp4-mf-tick" key={`${ax}-${bl}`} />}
                </button>
              ))}
            </div>

            <div className="lp4-mf-body" key={`${P.key}-${bl}`}>
              <div className="lp4-mf-t">{B.title}</div>
              <p className="lp4-mf-d">{B.desc}</p>
            </div>

            <div className="lp4-mf-menus">
              <span className="lp4-pillar-mcap">주요 기능</span>
              {P.menus.map((m) => <span key={m} className="lp4-pillar-menu">{m}</span>)}
              <Link href={`/features?g=${P.grp}`} className="lp4-pillar-more">전체 보기 <Arrow /></Link>
            </div>
          </div>

          {/* 원형 배경 위에 뜬 화면 — 바뀔 때 슬라이드 인, 주변 칩이 따라 뜬다 */}
          <div className="lp4-mf-stage">
            <span className="lp4-mf-orb" />
            <div className="lp4-mf-screen" key={B.src}>
              <Image src={B.src} alt={B.alt} width={1968} height={1320} sizes="(max-width: 1000px) 100vw, 800px" />
            </div>
            {B.chips.map((ch, i) => (
              <span key={`${B.src}-${ch}`} className={`lp4-mf-chip lp4-mf-chip-${i + 1}`}>{ch}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// 모바일 — 스크롤을 내리면 문구와 폰 화면이 순서대로 넘어간다.
//   좌: 큰 헤드라인(둘째 줄은 흐리게) + 설명 / 우: 실제 모바일 화면이 든 폰 목업.
function MobileScroll() {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const n = MOBILE.steps.length;

  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        if (total <= 0) return;
        const p = Math.min(1, Math.max(0, -r.top / total));
        setI(Math.min(n - 1, Math.floor(p * n)));
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

  const S = MOBILE.steps[i];
  return (
    <section className="lp4-mob" id="mobile" ref={ref} style={{ ["--mn" as string]: n }}>
      <div className="lp4-mob-pin">
        <div className="lp4-container lp4-mob-grid">
          <div className="lp4-mob-copy">
            <div className="lp4-mob-eyebrow">{MOBILE.eyebrow}</div>
            <h2 className="lp4-mob-title">
              {MOBILE.title.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
            </h2>
            <div className="lp4-mob-step" key={S.src}>
              <div className="lp4-mob-h">
                {S.head}<br /><em>{S.muted}</em>
              </div>
              <p className="lp4-mob-d">
                {S.desc.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
              </p>
            </div>
            <div className="lp4-mob-dots">
              {MOBILE.steps.map((st, k) => (
                <span key={st.src} className={`lp4-mob-dot ${k === i ? "lp4-mob-dot-on" : ""}`} />
              ))}
            </div>
          </div>

          <div className="lp4-mob-stage">
            <span className="lp4-mob-glow" />
            <div className="lp4-phone3d">
              <div className="lp4-phone3d-notch" />
              {MOBILE.steps.map((st, k) => (
                <Image
                  key={st.src}
                  src={st.src}
                  alt={st.alt}
                  width={1170}
                  height={2400}
                  sizes="(max-width: 999px) 80vw, 380px"
                  className={k === i ? "lp4-phone3d-img lp4-phone3d-on" : "lp4-phone3d-img"}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}



const NAV_AI = 99;   // 드롭다운에서 AI 자동화를 가리키는 값

export default function LandingPage() {
  const [on, setOn] = useState(false);
  const [day, setDay] = useState(0);   // 하루 타임라인 — 스크롤 진행률로 바뀐다
  const dayRef = useRef<HTMLElement>(null);
  const [eng, setEng] = useState(0);   // AI 엔진 탭
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drop, setDrop] = useState(false);   // 오너뷰 둘러보기 드롭다운
  const [navG, setNavG] = useState(0);       // 드롭다운에서 보고 있는 영역
  const [showSticky, setShowSticky] = useState(false);
  const footRef = useRef<HTMLElement>(null);
  // 드롭다운 — 바깥을 누르거나 ESC 를 누르면 닫는다
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
      // 히어로를 지나면 하단 고정 CTA 노출 — 스크롤 어디에서든 가입 경로가 살아있게
      const foot = footRef.current;
      const footTop = foot ? foot.getBoundingClientRect().top : Infinity;
      setShowSticky(y > 700 && footTop > window.innerHeight);
    };
    h();
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);


  return (
    <div className="lp4-root">
      <LandingNav />

      {/* ══ HERO ══ */}
      <header className="lp4-hero">
        <div className="lp4-hero-orbs" />
        <div className="lp4-hero-grid" />
        <div className="lp4-container">
          <div className="lp4-hero-inner">
            <h1 className="lp4-hero-title">
              {HERO.headline.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
            </h1>
            <p className="lp4-hero-sub">{HERO.sub}</p>
            <div className="lp4-hero-cta">
              <Link href="/auth" className="lp4-btn lp4-btn-onink">무료로 시작하기 <Arrow /></Link>
              <Link href="/demo" className="lp4-btn lp4-btn-ghost-light">실제 화면 둘러보기</Link>
            </div>
            <div className="lp4-hero-checks">{HERO.checks.map((c) => <span key={c} className="lp4-hero-check"><Check /> {c}</span>)}</div>
          </div>
        </div>
        {/* 실제 화면이 가로로 한 줄 흐른다 — "이게 다 된다"를 한 장면으로.
            렌더링·목업 대신 진짜 캡처를 쓰는 게 이 제품의 신뢰 근거다. 멈추지 않고 계속 흐른다. */}
        <div className="lp4-hero-strip" aria-hidden>
          <div className="lp4-strip-track">
            {[0, 1].map((dup) => (
              <div key={dup} className="lp4-strip-run">
                {HERO_STRIP.map((sc) => (
                  <div key={sc.src} className="lp4-strip-card">
                    <Image src={sc.src} alt={sc.alt} width={1968} height={1320} sizes="360px" priority={dup === 0} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 서비스 소개 — 후킹과 본문 사이를 잇는다 */}
        <div className="lp4-container">
          <Reveal className="lp4-hero-intro">
            {HERO_INTRO.map((l, k) => <p key={k} className={k === 0 ? "lp4-hero-intro-lead" : ""}>{l}</p>)}
          </Reveal>
        </div>
      </header>

      {/* ══ STATS — 아이콘 + 파스텔 타일. 숫자만 크게 세워두면 위 문단과 겉돈다 ══ */}
      <section className="lp4-stats">
        <div className="lp4-container">
          <div className="lp4-stats-grid">
            {STATS.map((s, i) => (
              <Reveal key={s.label} className={`lp4-stat lp4-stat-${i + 1}`}>
                <span className="lp4-stat-ico"><StatGlyph n={s.icon} /></span>
                <div className="lp4-stat-value">
                  {s.value === 0 ? <>0<span className="lp4-stat-suffix">{s.suffix}</span></> : <CountUp to={s.value} suffix={s.suffix} />}
                </div>
                <div className="lp4-stat-label">{s.label}</div>
                <div className="lp4-stat-note">{s.note}</div>
              </Reveal>
            ))}
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
                    sizes="(max-width: 1000px) 100vw, 820px"
                    className={i === day ? "lp4-tl-shot lp4-tl-shot-on" : "lp4-tl-shot"}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 주요 기능 둘러보기 — 축 탭 → 기능 탭 → 화면 전환 ══ */}
      <PillarTabs />

      {/* ══ AI ENGINES ══ */}
      <section className="lp4-section lp4-bg-canvas" id="engines">
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
              <Image src={ENGINES[eng].src} alt={ENGINES[eng].alt} width={1200} height={760} sizes="(max-width: 1000px) 100vw, 740px" />
            </div>
          </div>

          {/* 엔진이 실제로 대신하는 일 — 별도 섹션으로 또 나열하던 걸 여기 한 줄로 합쳤다 */}
          <div className="lp4-eauto">
            <span className="lp4-eauto-cap">이런 일들을 알아서 해요</span>
            <div className="lp4-eauto-chips">
              {AI_AUTOMATION.map((a) => <span key={a.name} className="lp4-eauto-chip">{a.name}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* ══ 전체 기능은 별도 페이지로 — 메인 스크롤을 짧게 유지한다 ══ */}
      <section className="lp4-section lp4-bg-tint" id="more">
        <div className="lp4-container">
          <Reveal>
            <Link href="/features" className="lp4-more">
              <div className="lp4-more-txt">
                <div className="lp4-more-h">이 밖에도 메뉴 20개가 더 있어요</div>
                <p className="lp4-more-p">거래처·세금·장부·결재·전자계약·통장·카드·대출까지. 어느 메뉴에서 무엇을 할 수 있는지 실제 화면으로 정리했어요.</p>
              </div>
              <span className="lp4-more-cta">기능 전체 보기 <Arrow /></span>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ══ 모바일 — 스크롤에 따라 문구·화면이 넘어간다 ══ */}
      <MobileScroll />

      {/* ══ FAQ ══ */}
      <section className="lp4-section lp4-bg-canvas" id="faq">
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
      <footer className="lp4-footer" ref={footRef}>
        <div className="lp4-container">
          <div className="lp4-footer-top">
            <div className="lp4-logo"><Logo size={25} /> OwnerView <span className="lp4-footer-sub">Company Operating System</span></div>
            <div className="lp4-flinks"><Link href="/features">오너뷰 둘러보기</Link><a href="#engines">AI 엔진</a><Link href="/pricing">가격</Link><a href="#partner">제휴문의</a><a href="#faq">FAQ</a></div>
          </div>
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불규정</Link><a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a></div>
          </div>
        </div>
      </footer>

      {/* ══ 스크롤하면 따라오는 시작 버튼 ══
           최종 CTA 섹션을 없앤 대신, 히어로를 지나면 어디서든 가입 경로가 살아있게 한다.
           데스크톱은 하단 가운데 떠 있는 알약, 모바일은 하단 전체 폭 바. */}
      <div className={`lp4-sticky-cta ${showSticky ? "lp4-sticky-cta-on" : ""}`}>
        <span className="lp4-sticky-copy">14일 무료 · 가입하면 지금 바로</span>
        <Link href="/auth" className="lp4-btn lp4-btn-brand">무료로 시작하기 <Arrow /></Link>
      </div>
    </div>
  );
}
