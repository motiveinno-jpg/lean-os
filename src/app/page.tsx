"use client";

// OwnerView 랜딩 — 따뜻한 에디토리얼 디자인 (2026-07-23 개편, preview2 승인 반영).
//   콘텐츠는 content.ts, 스타일은 landing.css(lp4- 네임스페이스). 문구·가격·CTA 기존 유지.
import "./landing.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HERO, STATS, PROBLEMS, FEATURES, ENGINES, COMPETITORS, PLANS, FAQS, NAV_LINKS, FOOTER } from "@/components/landing/content";

function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="#1a1613" />
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none" />
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <polyline points="12,20 15,18 18,19 22,14" stroke="#ea580c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="22" cy="14" r="1.5" fill="#ea580c" />
    </svg>
  );
}
const Check = () => (<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }), { threshold: 0.12 });
    io.observe(el); return () => io.disconnect();
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

export default function LandingPage() {
  const [on, setOn] = useState(false);
  const [tab, setTab] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [team, setTeam] = useState(8);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const h = () => setOn(window.scrollY > 8);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const compTotal = COMPETITORS.reduce((s, c) => s + (c.perSeat ? c.price * team : c.price), 0);
  const owvTotal = 79500 + Math.max(0, team - 5) * 10000;
  const savePct = Math.round(((compTotal - owvTotal) / compTotal) * 100);
  const won = (n: number) => "₩" + n.toLocaleString("ko-KR");
  const f = FEATURES[tab];

  return (
    <div className="lp4-root">
      {/* NAV */}
      <nav className={`lp4-nav ${on ? "lp4-nav-on" : ""}`}>
        <div className="lp4-nav-inner">
          <div className="lp4-logo"><Logo size={25} /> OwnerView</div>
          <div className="lp4-menu">{NAV_LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</div>
          <div className="lp4-nav-right">
            <Link href="/auth" className="lp4-login">로그인</Link>
            <Link href="/auth" className="lp4-pill">무료로 시작하기</Link>
          </div>
        </div>
      </nav>

      {/* HERO (dark warm) */}
      <header className="lp4-hero">
        <div className="lp4-hero-dots" />
        <div className="lp4-container">
          <div className="lp4-hero-inner">
            <Reveal>
              <span className="lp4-hero-badge"><span className="lp4-hero-badge-dot" />{HERO.badge}</span>
              <h1 className="lp4-hero-title">중소기업 대표를 위한<br /><em>올인원 운영 플랫폼</em></h1>
              <p className="lp4-hero-sub">{HERO.sub}</p>
              <p className="lp4-hero-desc">{HERO.desc}</p>
              <div className="lp4-hero-cta">
                <Link href="/auth" className="lp4-btn lp4-btn-onwhite">무료로 시작하기
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" /></svg>
                </Link>
                <Link href="/demo" className="lp4-btn lp4-btn-outline-light">데모 체험</Link>
              </div>
              <div className="lp4-hero-checks">{HERO.checks.map((c) => <span key={c} className="lp4-hero-check"><Check /> {c}</span>)}</div>
            </Reveal>
            <Reveal>
              <div className="lp4-mock-float">
                <div className="lp4-mock-window">
                  <div className="lp4-mock-bar">
                    <span className="lp4-mock-dot" style={{ background: "#f87171" }} />
                    <span className="lp4-mock-dot" style={{ background: "#fbbf24" }} />
                    <span className="lp4-mock-dot" style={{ background: "#34d399" }} />
                    <span style={{ marginLeft: 10, fontSize: 12, color: "#a8a29e", fontWeight: 600 }}>경영 대시보드</span>
                  </div>
                  <div className="lp4-mock-body">
                    <div className="lp4-kpi"><div className="lp4-kpi-label">현금 잔고</div><div className="lp4-kpi-value">₩8.2억</div><div className="lp4-kpi-sub" style={{ color: "#047857" }}>+12% ▲</div></div>
                    <div className="lp4-kpi"><div className="lp4-kpi-label">이번 달 매출</div><div className="lp4-kpi-value">₩4.5억</div><div className="lp4-kpi-sub" style={{ color: "#047857" }}>+23% ▲</div></div>
                    <div className="lp4-kpi"><div className="lp4-kpi-label">미수금</div><div className="lp4-kpi-value">₩1.2억</div><div className="lp4-kpi-sub" style={{ color: "#ea580c" }}>30일 초과 1건</div></div>
                    <div className="lp4-kpi"><div className="lp4-kpi-label">결재 대기</div><div className="lp4-kpi-value">5건</div><div className="lp4-kpi-sub" style={{ color: "#2563eb" }}>승인 필요</div></div>
                    <div className="lp4-mock-wide">
                      <div className="lp4-brief-head"><span>◆</span> AI 브리핑 — 오늘 챙길 것</div>
                      <div className="lp4-brief-line"><span style={{ color: "#ea580c" }}>●</span> <b>미수금 1.2억</b> 회수 우선 — A사 30일 초과</div>
                      <div className="lp4-brief-line"><span style={{ color: "#2563eb" }}>●</span> <b>결재 5건</b> 지급 승인 대기</div>
                      <div className="lp4-bars">{[40, 62, 48, 78, 90, 70].map((h, i) => <div key={i} className="lp4-bar-col" style={{ height: `${h}%` }} />)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </header>

      {/* STATS */}
      <section className="lp4-stats">
        <div className="lp4-container">
          <div className="lp4-stats-grid">
            {STATS.map((s) => (
              <div key={s.label} className="lp4-stat">
                <div className="lp4-stat-value">{s.value === 0 ? <>0<span style={{ color: "#a8a29e" }}>{s.suffix}</span></> : <CountUp to={s.value} suffix={s.suffix} />}</div>
                <div className="lp4-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="lp4-section lp4-bg-cream">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow" style={{ justifyContent: "center" }}>Pain → Solution</div>
            <h2 className="lp4-h2">대표님, 이거 다 <span className="lp4-underline">혼자</span> 하고 계시죠?</h2>
            <p className="lp4-sub">회계사 부르고, 세무사 연락하고, 엑셀 정리하고, 계약서 찾고… 카드에 마우스를 올리면 해결책이 보입니다.</p>
          </Reveal>
          <div className="lp4-pain-grid">
            {PROBLEMS.map((p) => (
              <Reveal key={p.keyword}><div className="lp4-pain">
                <span className="lp4-pain-badge">{p.keyword}</span>
                <div className="lp4-pain-pain">{p.pain}</div>
                <div className="lp4-pain-solve"><b>→</b><span>{p.solve}</span></div>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="lp4-section lp4-bg-stone" id="features">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow" style={{ justifyContent: "center" }}>Product</div>
            <h2 className="lp4-h2">흩어진 7개 도구를, 하나의 흐름으로</h2>
            <p className="lp4-sub">탭을 눌러 각 기능이 실제로 어떻게 연결되는지 확인하세요.</p>
          </Reveal>
          <div className="lp4-feat-grid">
            <div className="lp4-feat-tabs">
              {FEATURES.map((ft, i) => (
                <button key={ft.tab} className={`lp4-feat-tab ${i === tab ? "lp4-feat-tab-on" : ""}`} onClick={() => setTab(i)}>
                  <span className="lp4-feat-tab-num">{String(i + 1).padStart(2, "0")}</span>{ft.tab}
                </button>
              ))}
            </div>
            <div className="lp4-feat-panel" key={tab}>
              <div className="lp4-feat-replaces">대체: {f.replaces}</div>
              <div className="lp4-feat-title">{f.title}</div>
              <div className="lp4-feat-desc">{f.desc}</div>
              <div className="lp4-feat-flow">
                {["요청·작성", "자동 처리·연결", "완료·기록"].map((c, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <span className="lp4-feat-step"><b>{i + 1}</b> {c}</span>
                    {i < 2 && <span className="lp4-feat-arrow">→</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ENGINES */}
      <section className="lp4-section lp4-bg-cream" id="engines">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow" style={{ justifyContent: "center" }}>4 Engines</div>
            <h2 className="lp4-h2">4개의 자동화 엔진이 회사를 대신 돌립니다</h2>
            <p className="lp4-sub">사람을 대체하는 게 아니라, 대표가 하던 반복 업무를 엔진이 맡습니다.</p>
          </Reveal>
          <div className="lp4-eng-steps">
            {ENGINES.map((e, i) => (
              <Reveal key={e.num}><div className={`lp4-eng lp4-eng-${i}`}>
                <div className="lp4-eng-num">ENGINE {e.num}</div>
                <div className="lp4-eng-name">{e.name}</div>
                <div className="lp4-eng-eng">{e.eng}</div>
                <div className="lp4-eng-head">{e.headline}</div>
                <div className="lp4-eng-desc">{e.desc}</div>
                <div className="lp4-eng-list">
                  {e.steps.map((st, j) => <div key={j} className="lp4-eng-step"><span className="lp4-eng-step-dot">{j + 1}</span><span>{st}</span></div>)}
                </div>
                <div className="lp4-eng-rep">대체: {e.replaces} · <b>{e.replacesCost}</b> 절감</div>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section className="lp4-section lp4-bg-stone" id="compare">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow" style={{ justifyContent: "center" }}>Compare</div>
            <h2 className="lp4-h2">따로 쓰면 인원마다 늘어납니다</h2>
            <p className="lp4-sub">7개 도구를 각각 구독하는 방식과, 오너뷰 정액을 나란히 비교해 보세요.</p>
          </Reveal>
          <div className="lp4-cmp-grid">
            <Reveal><div className="lp4-cmp">
              <div className="lp4-cmp-title">개별 도구를 따로 쓰는 방식</div>
              <div style={{ marginTop: 14 }}>
                {COMPETITORS.map((c) => (
                  <div key={c.full} className="lp4-cmp-row"><span className="lp4-cmp-name">{c.cat} · {c.full}{c.perSeat ? " (인원당)" : ""}</span><span className="lp4-cmp-price">{won(c.perSeat ? c.price * team : c.price)}</span></div>
                ))}
              </div>
              <div className="lp4-cmp-total"><span style={{ color: "#57534e", fontSize: 14 }}>{team}명 기준 월</span><span className="lp4-cmp-total-val" style={{ color: "#ea580c" }}>{won(compTotal)}</span></div>
            </div></Reveal>
            <Reveal><div className="lp4-cmp lp4-cmp-hl">
              <div className="lp4-cmp-title">OwnerView 하나로</div>
              <div style={{ marginTop: 14 }}>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">프로 (기본 5명 포함)</span><span className="lp4-cmp-price">₩79,500</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">추가 {Math.max(0, team - 5)}명 × ₩10,000</span><span className="lp4-cmp-price">{won(Math.max(0, team - 5) * 10000)}</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">전 기능 포함 · VAT 별도</span><span className="lp4-cmp-price" style={{ color: "#34d399" }}>포함</span></div>
              </div>
              <div className="lp4-cmp-total"><span style={{ color: "rgba(255,255,255,.72)", fontSize: 14 }}>{team}명 기준 월</span><span className="lp4-cmp-total-val">{won(owvTotal)}</span></div>
              <div style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: "#fdba74" }}>매월 약 {won(compTotal - owvTotal)} 절감 ({savePct}%)</div>
            </div></Reveal>
          </div>
          <div className="lp4-calc">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 10 }}><span style={{ color: "#57534e" }}>팀 인원</span><b>{team}명</b></div>
            <input type="range" min={1} max={50} value={team} onChange={(e) => setTeam(Number(e.target.value))} className="lp4-slider" />
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="lp4-section lp4-bg-cream" id="pricing">
        <div className="lp4-container">
          <Reveal className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow" style={{ justifyContent: "center" }}>Pricing</div>
            <h2 className="lp4-h2">가입 시 카드 등록 · 14일 무료 · 이후 자동 결제</h2>
            <p className="lp4-sub">14일 내 해지하면 첫 결제가 발생하지 않습니다. 기본 5명 포함 · 추가 1명당 ₩10,000/월.</p>
          </Reveal>
          <div className="lp4-price-grid">
            {PLANS.map((p) => (
              <Reveal key={p.name}><div className={`lp4-price ${p.hl ? "lp4-price-hl" : ""}`}>
                {p.hl && <span className="lp4-price-best">BEST</span>}
                <div className="lp4-price-name">{p.name}</div>
                <div className="lp4-price-desc">{p.desc}</div>
                {p.regularPrice ? <div className="lp4-price-reg">₩{p.regularPrice}{p.discount && <span className="lp4-price-off">{p.discount} 할인</span>}</div> : <div style={{ height: 14, marginTop: 16 }} />}
                <div className="lp4-price-amt">{p.price === "별도 협의" ? "별도 협의" : `₩${p.price}`}<span className="lp4-price-unit">{p.unit && ` ${p.unit}`}</span></div>
                <div className="lp4-price-period">{p.period}</div>
                <ul className="lp4-price-feats">{p.features.map((ft, i) => <li key={i} className="lp4-price-feat"><Check />{ft}</li>)}</ul>
                <Link href={p.name === "엔터프라이즈" ? "#partner" : p.slug ? `/auth?plan=${p.slug}` : "/auth"} className={`lp4-price-cta ${p.hl ? "lp4-price-cta-dark" : "lp4-price-cta-line"}`}>
                  {p.name === "엔터프라이즈" ? "도입 문의" : "14일 무료로 시작"}
                </Link>
              </div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp4-section lp4-bg-stone" id="faq">
        <div className="lp4-narrow">
          <Reveal className="lp4-sec-head"><div className="lp4-eyebrow">FAQ</div><h2 className="lp4-h2">자주 묻는 질문</h2></Reveal>
          <div>
            {FAQS.map((faq, i) => (
              <div key={i} className={`lp4-faq ${openFaq === i ? "lp4-faq-open" : ""}`}>
                <button className="lp4-faq-btn" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {faq.q}
                  <svg className="lp4-faq-chev" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                <div className="lp4-faq-panel"><div className="lp4-faq-a">{faq.a}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PARTNER */}
      <section className="lp4-section lp4-bg-cream" id="partner">
        <div className="lp4-narrow">
          <Reveal className="lp4-sec-head lp4-sec-head-c"><div className="lp4-eyebrow" style={{ justifyContent: "center" }}>Contact</div><h2 className="lp4-h2">제휴 &amp; 도입 문의</h2><p className="lp4-sub">Enterprise 도입, API 연동, 리셀러 제휴를 상담해 드립니다.</p></Reveal>
          <Reveal>
            {sent ? (
              <div className="lp4-form" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#047857" }}>문의가 접수되었습니다</div>
                <p style={{ fontSize: 14, color: "#57534e", marginTop: 6 }}>영업일 기준 1일 이내에 회신드리겠습니다.</p>
              </div>
            ) : (
              <div className="lp4-form">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <div><label className="lp4-flabel">회사명 *</label><input className="lp4-input" placeholder="(주)회사명" /></div>
                  <div><label className="lp4-flabel">담당자명 *</label><input className="lp4-input" placeholder="홍길동" /></div>
                  <div><label className="lp4-flabel">이메일 *</label><input className="lp4-input" placeholder="email@company.com" /></div>
                  <div><label className="lp4-flabel">연락처</label><input className="lp4-input" placeholder="010-0000-0000" /></div>
                </div>
                <div style={{ marginBottom: 16 }}><label className="lp4-flabel">문의 내용 *</label><textarea className="lp4-input" rows={4} placeholder="도입 규모, 필요 기능, 연동 요구사항 등을 알려주세요" style={{ resize: "none" }} /></div>
                <button onClick={() => setSent(true)} className="lp4-btn lp4-btn-dark" style={{ width: "100%", justifyContent: "center" }}>문의 보내기</button>
                <p style={{ fontSize: 11, textAlign: "center", color: "#a8a29e", marginTop: 12 }}>제출된 정보는 상담 목적으로만 사용되며, 개인정보처리방침에 따라 관리됩니다.</p>
              </div>
            )}
          </Reveal>
        </div>
      </section>

      {/* FINAL CTA (dark) */}
      <section className="lp4-section lp4-bg-cream" style={{ paddingTop: 0 }}>
        <div className="lp4-container">
          <Reveal>
            <div className="lp4-final">
              <div className="lp4-final-dots" />
              <h2 className="lp4-final-h">회사 현황, 한눈에 보고 싶다면<br /><em>OwnerView를 시작하세요</em></h2>
              <p style={{ fontSize: 17, color: "rgba(255,255,255,.72)", margin: "18px 0 30px", position: "relative", zIndex: 2 }}>거래처 목록·거래내역은 엑셀만 올리면 바로 등록. 가입 시 카드 등록 · 14일 무료.</p>
              <div style={{ position: "relative", zIndex: 2 }}><Link href="/auth" className="lp4-btn lp4-btn-onwhite" style={{ padding: "15px 38px", fontSize: 16 }}>무료로 시작하기</Link></div>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,.55)", marginTop: 22, position: "relative", zIndex: 2 }}>이미 계정이 있으신가요? <Link href="/auth" style={{ color: "#fff", fontWeight: 600, textDecoration: "underline" }}>로그인</Link></p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-top">
            <div className="lp4-logo"><Logo size={25} /> OwnerView <span style={{ fontSize: 12, color: "#a8a29e", fontWeight: 400, marginLeft: 6 }}>Company Operating System</span></div>
            <div className="lp4-flinks"><a href="#features">기능</a><a href="#pricing">가격</a><a href="#partner">제휴문의</a><a href="#faq">FAQ</a></div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 20, alignItems: "flex-end" }}>
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불규정</Link><a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
