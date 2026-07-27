"use client";

// /ai — AI 자동화 전용 페이지 (2026-07-27).
//   사장님: "AI엔진과 AI자동화 차이점이 뭔지? AI자동화는 별도 상단 메뉴로 꺼내는 게 좋겠고,
//   텍스트로만 되어 있는데 중요한 기능이니 이미지·움직이는 이미지 등 다양하게 써서 설명할 것"
//   → 엔진(4개 묶음)과 자동화(8가지 개별 기능)를 한 페이지에서 같이 설명한다.
//      엔진은 자동화를 묶은 이름일 뿐이라 따로 두면 같은 말을 두 번 하게 된다.
//   화면은 전부 실제 오너뷰 캡처. 4초마다 저절로 다음 자동화로 넘어간다.

import "@/app/landing.css";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { AI_AUTOMATION, ENGINES, FOOTER } from "@/components/landing/content";

const Check = () => (<svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);
const Arrow = () => (<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" /></svg>);

function EngineGlyph({ n }: { n: string }) {
  const p = { width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.9, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (n) {
    case "01": return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12L18.4 5.6" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
    case "02": return <svg {...p}><path d="M4 4h7l3 3v4" /><path d="M4 4v13h6" /><rect x="12" y="12" width="8" height="8" rx="1.6" /><path d="M14.5 16.2l1.5 1.5 3-3" /></svg>;
    case "03": return <svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3.5 20v-1.4A4.6 4.6 0 018.1 14h1.8" /><path d="M14 17.5l2 2 4.5-4.5" /></svg>;
    default: return <svg {...p}><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M7.9 8.6l2.6 7.2M16.1 8.6l-2.6 7.2M8.4 7h7.2" /></svg>;
  }
}

export default function AiView() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 주소로 특정 자동화를 열어 둘 수 있게 (?a=3)
  useEffect(() => {
    // ⚠️ get("a") 가 null 이면 Number(null) === 0 이라 항상 첫 항목으로 고정되고 자동 진행이 꺼진다.
    const raw = new URLSearchParams(window.location.search).get("a");
    if (raw === null) return;
    const a = Number(raw);
    if (Number.isInteger(a) && a >= 0 && a < AI_AUTOMATION.length) { setI(a); setAuto(false); }
  }, []);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => setLive(es[0].isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !live) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % AI_AUTOMATION.length), 4200);
    return () => clearInterval(t);
  }, [auto, live]);

  const pick = (k: number) => {
    setAuto(false); setI(k);
    window.history.replaceState(null, "", `?a=${k}`);
  };
  const A = AI_AUTOMATION[i];

  return (
    <div className="lp4-root">
      <LandingNav solid />

      {/* 머리 */}
      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">AI Automation</div>
            <h1 className="lp4-h2">사람이 매번 하던 일, <span className="lp4-underline">{AI_AUTOMATION.length}가지를 AI가 해요</span></h1>
            <p className="lp4-sub">
              오너뷰는 이 {AI_AUTOMATION.length}가지를 4개의 엔진으로 묶어 돌려요.
              무엇을 대신하는지 실제 화면으로 보여드릴게요.
            </p>
          </div>

          {/* 자동화 하나씩 — 좌 목록 / 우 실제 화면. 4.2초마다 저절로 넘어간다 */}
          <div className="lp4-aiw" ref={ref}>
            <div className="lp4-aiw-list">
              {AI_AUTOMATION.map((a, k) => (
                <button
                  key={a.name}
                  className={`lp4-aiw-item ${k === i ? "lp4-aiw-item-on" : ""}`}
                  onClick={() => pick(k)}
                  onMouseEnter={() => pick(k)}
                  aria-pressed={k === i}
                >
                  <span className="lp4-aiw-n">{a.name}</span>
                  <span className="lp4-aiw-t">{a.tag}</span>
                  {k === i && auto && <span className="lp4-aiw-tick" key={`t-${i}`} />}
                </button>
              ))}
            </div>

            <div className="lp4-aiw-view" key={A.name}>
              <div className="lp4-aiw-shot">
                <Image src={A.src} alt={A.alt} width={1968} height={1320} sizes="(max-width: 1000px) 100vw, 860px" priority={i === 0} />
              </div>
              <div className="lp4-aiw-meta">
                <div className="lp4-aiw-head">{A.name}</div>
                <p className="lp4-aiw-desc">{A.desc}</p>
                <span className="lp4-aiw-where"><Check /> {A.where}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4개 엔진 — 위 8가지를 무엇으로 묶었는지 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <h2 className="lp4-h2">이 자동화들을 <span className="lp4-underline">4개의 엔진으로 묶었어요</span></h2>
            <p className="lp4-sub">엔진은 자동화를 목적별로 묶은 이름이에요. 따로 켜고 끌 필요 없이 가입하면 전부 돌아가요.</p>
          </div>
          <div className="lp4-eng4">
            {ENGINES.map((e) => (
              <div key={e.num} className="lp4-eng4-card">
                <span className="lp4-eng4-ico"><EngineGlyph n={e.num} /></span>
                <div className="lp4-eng4-no">ENGINE {e.num}</div>
                <div className="lp4-eng4-n">{e.name}</div>
                <p className="lp4-eng4-d">{e.short}</p>
                <div className="lp4-eng4-f">
                  {e.features.map((f) => <span key={f} className="lp4-pillar-menu">{f}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">14일 써보고 결정하세요</h2>
          <p className="lp4-sub">가입하면 이 자동화가 전부 켜진 상태로 시작해요.</p>
          <div className="lp4-feat-cta">
            <Link href="/auth" className="lp4-btn lp4-btn-brand">무료로 시작하기 <Arrow /></Link>
            <Link href="/features" className="lp4-btn lp4-btn-line">기능 둘러보기</Link>
          </div>
        </div>
      </section>

      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks">
              <Link href="/">홈</Link><Link href="/features">기능</Link><Link href="/pricing">가격</Link>
              <Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
