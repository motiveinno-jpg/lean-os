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
import { HERO, STATS, PROBLEMS, SCREENS, FEATURES, ENGINES, COMPETITORS, PLANS, FAQS, NAV_LINKS, FOOTER } from "@/components/landing/content";
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
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [team, setTeam] = useState(8);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);

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
            <h1 className="lp4-hero-title">중소기업 대표를 위한<br /><em>AI 올인원 운영 플랫폼</em></h1>
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

      {/* ══ PROBLEM ══ */}
      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Pain → Solution</div>
            <h2 className="lp4-h2">대표님, 이거 다 <span className="lp4-underline">혼자</span> 하고 계시죠?</h2>
            <p className="lp4-sub">회계사 부르고, 세무사 연락하고, 엑셀 정리하고, 계약서 찾고… 오너뷰가 각각을 어떻게 없애는지 아래에서 확인하세요.</p>
          </Reveal>
          <div className="lp4-pain-grid">
            {PROBLEMS.map((p) => (
              <Reveal key={p.keyword}><div className="lp4-pain lp4-card">
                <span className="lp4-pain-badge">{p.keyword}</span>
                <div className="lp4-pain-pain">{p.pain}</div>
                <div className="lp4-pain-solve"><b>→</b><span>{p.solve}</span></div>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 제품 실물 화면 투어 ══ */}
      <section className="lp4-section lp4-bg-tint" id="tour">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Real Product</div>
            <h2 className="lp4-h2">렌더링이 아니라, <span className="lp4-underline">진짜 화면</span>입니다</h2>
            <p className="lp4-sub">아래 이미지는 전부 실제 오너뷰에서 그대로 캡처한 화면입니다. 지금 가입하면 보이는 그 화면입니다.</p>
          </Reveal>

          <div className="lp4-tour-tabs">
            {SCREENS.map((s, i) => (
              <button key={s.key} className={`lp4-tour-tab ${i === tour ? "lp4-tour-tab-on" : ""}`} onClick={() => setTour(i)}>
                {s.tab}
              </button>
            ))}
          </div>

          <div className="lp4-tour-panel">
            <div>
              <div className="lp4-tour-title">{scr.title}</div>
              <p className="lp4-tour-desc">{scr.desc}</p>
              <span className="lp4-tour-note"><Check /> 실제 서비스 화면 캡처</span>
            </div>
            <div className="lp4-tour-shot" key={scr.key}>
              <Image src={scr.src} alt={scr.alt} width={1440} height={900} sizes="(max-width: 1000px) 100vw, 760px" />
            </div>
          </div>
        </div>
      </section>

      {/* ══ FEATURES ══ */}
      <section className="lp4-section lp4-bg-canvas" id="features">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Product</div>
            <h2 className="lp4-h2">흩어진 7개 도구를, 하나의 흐름으로</h2>
            <p className="lp4-sub">따로 결제하던 도구들이 하나의 데이터 위에서 연결됩니다.</p>
          </Reveal>
          <div className="lp4-feat-grid">
            {FEATURES.map((f, i) => (
              <Reveal key={f.tab}><div className="lp4-feat lp4-card">
                <span className="lp4-feat-num">{String(i + 1).padStart(2, "0")}</span>
                <div className="lp4-feat-tab">{f.tab}</div>
                <div className="lp4-feat-title">{f.title}</div>
                <p className="lp4-feat-desc">{f.desc}</p>
                <div className="lp4-feat-replaces">대체 <b>{f.replaces}</b></div>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ AI ENGINES ══ */}
      <section className="lp4-section lp4-bg-tint" id="engines">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">4 AI Engines</div>
            <h2 className="lp4-h2">4개의 AI 엔진이 회사를 대신 돌립니다</h2>
            <p className="lp4-sub">사람을 대체하는 게 아니라, 대표가 하던 반복 업무를 엔진이 맡습니다.</p>
          </Reveal>
          <div className="lp4-eng-grid">
            {ENGINES.map((e) => (
              <Reveal key={e.num}><div className="lp4-eng lp4-card">
                <div className="lp4-eng-head">
                  <span className="lp4-eng-chip">{e.num}</span>
                  <div>
                    <div className="lp4-eng-name">{e.name}</div>
                    <div className="lp4-eng-eng">{e.eng}</div>
                  </div>
                </div>
                <div className="lp4-eng-line">{e.headline}</div>
                <p className="lp4-eng-desc">{e.desc}</p>
                <div className="lp4-eng-steps">
                  {e.steps.map((st, j) => <div key={j} className="lp4-eng-step"><span className="lp4-eng-dot">{j + 1}</span><span>{st}</span></div>)}
                </div>
                <div className="lp4-eng-tags">
                  {e.features.map((ft) => <span key={ft} className="lp4-eng-tag">{ft}</span>)}
                </div>
                <div className="lp4-eng-rep">대체: {e.replaces} · <b>{e.replacesCost}</b> 절감</div>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ COMPARE ══ */}
      <section className="lp4-section lp4-bg-canvas" id="compare">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Compare</div>
            <h2 className="lp4-h2">따로 쓰면 인원마다 늘어납니다</h2>
            <p className="lp4-sub">7개 도구를 각각 구독하는 방식과, 오너뷰 정액을 나란히 비교해 보세요.</p>
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
      <section className="lp4-section lp4-bg-tint" id="pricing">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Pricing</div>
            <h2 className="lp4-h2">가입 시 카드 등록 · 14일 무료 · 이후 자동 결제</h2>
            <p className="lp4-sub">14일 내 해지하면 첫 결제가 발생하지 않습니다. 기본 5명 포함 · 추가 1명당 ₩10,000/월.</p>
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
                <div className="lp4-price-amt">{p.price === "별도 협의" ? "별도 협의" : `₩${p.price}`}<span className="lp4-price-unit">{p.unit && ` ${p.unit}`}</span></div>
                <div className="lp4-price-period">{p.period}</div>
                <ul className="lp4-price-feats">{p.features.map((ft, i) => <li key={i} className="lp4-price-feat"><Check />{ft}</li>)}</ul>
                <Link href={p.name === "엔터프라이즈" ? "#partner" : p.slug ? `/auth?plan=${p.slug}` : "/auth"} className={`lp4-price-cta ${p.hl ? "lp4-price-cta-brand" : "lp4-price-cta-line"}`}>
                  {p.name === "엔터프라이즈" ? "도입 문의" : "14일 무료로 시작"}
                </Link>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FAQ ══ */}
      <section className="lp4-section lp4-bg-canvas" id="faq">
        <div className="lp4-narrow">
          <Reveal className="lp4-sec-head"><div className="lp4-eyebrow">FAQ</div><h2 className="lp4-h2">자주 묻는 질문</h2></Reveal>
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
                <h2 className="lp4-final-h">회사 현황, 한눈에 보고 싶다면<br /><em>OwnerView를 시작하세요</em></h2>
                <p className="lp4-final-p">거래처 목록·거래내역은 엑셀만 올리면 바로 등록. 가입 시 카드 등록 · 14일 무료.</p>
                <Link href="/auth" className="lp4-btn lp4-btn-onink">무료로 시작하기 <Arrow /></Link>
                <p className="lp4-final-note">이미 계정이 있으신가요? <Link href="/auth">로그인</Link></p>
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
            <h2 className="lp4-h2">제휴 &amp; 도입 문의</h2>
            <p className="lp4-sub">Enterprise 도입, API 연동, 리셀러 제휴를 상담해 드립니다.</p>
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
