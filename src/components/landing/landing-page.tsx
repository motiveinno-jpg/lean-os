"use client";

// ══ OwnerView 랜딩 v5 — 장면 기반 (2026-07-28) ══
//   사장님: "애플 페이지처럼 사진 배열·화질·레이아웃이 깔끔하고, 스크롤할 때마다 화면이
//   스르륵 생겨나고, 화면이 전체를 차지하면서도 답답하지 않게. 기존 걸 유지하려 하지 말고 탈바꿈."
//
//   v4(섹션을 위에서 아래로 쌓는 문서 구조) → v5(장면 8개 + 꼬리 3섹션).
//   ▸ 한 장면 = 100vh 무대, 스크롤이 재생 헤드(scene.tsx 의 --p). 리렌더 없이 CSS 가 움직인다.
//   ▸ 세부(메뉴 18개 각각 · AI 자동화 8종)는 /features · /ai 가 맡는다 — 메인은 압축한다.
//   ▸ 문구·데이터는 content.ts 단일 출처. 스타일은 landing-v5.css(lp5-).
//     FAQ·제휴폼·푸터·상단바는 lp4-(landing.css) 를 그대로 재사용한다 — 잘 도는 걸 다시 만들지 않는다.
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import "@/app/landing.css";
import "@/app/landing-v5.css";
import { LandingNav } from "@/components/landing/landing-nav";
import { PartnershipForm } from "@/components/landing/partnership-form";
import { Scene, Rise } from "@/components/landing/scene";
import {
  HERO, HERO_INTRO, DAY, PILLARS, ENGINES, CATALOG, MOBILE, FAQS, FOOTER,
} from "@/components/landing/content";

const Arrow = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
  </svg>
);
const Check = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const Logo = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="10" fill="#5b54e8" />
    <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none" />
    <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
    <polyline points="12,20 15,18 18,19 22,14" stroke="#fdba74" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="22" cy="14" r="1.5" fill="#fdba74" />
  </svg>
);

/** 화면 한 장 — 실제 제품 캡처. sizes 를 정확히 줘야 큰 이미지가 과다 다운로드되지 않는다. */
function Shot({ src, alt, priority = false, sizes = "(max-width: 999px) 92vw, 1120px" }: {
  src: string; alt: string; priority?: boolean; sizes?: string;
}) {
  return (
    <div className="lp5-shot">
      <Image src={src} alt={alt} width={1968} height={1320} sizes={sizes} priority={priority} />
    </div>
  );
}

/** 크로스페이드 스택 — 같은 자리에서 화면만 바뀐다(장면 안에서 축·시간대가 넘어갈 때). */
function ShotStack({ items, active, sizes = "(max-width: 999px) 94vw, 1040px" }: {
  items: { src: string; alt: string }[]; active: number; sizes?: string;
}) {
  return (
    <div className="lp5-shot-stack">
      {items.map((it, i) => (
        <div key={it.src} className={`lp5-shot ${i === active ? "lp5-shot-on" : ""}`}>
          <Image src={it.src} alt={it.alt} width={1968} height={1320} sizes={sizes} />
        </div>
      ))}
    </div>
  );
}

// ══════════════════ 1. 히어로 ══════════════════
function SceneHero() {
  return (
    <Scene len={1.5} className="lp5-hero">
      {() => (
        <>
          <div className="lp5-hero-bg" />
          <div className="lp5-wrap lp5-hero-copy">
            <h1 className="lp5-hero-h">
              {HERO.headline.split("\n").map((l, i) => (
                <span key={i}>{i === 1 ? <span className="lp5-grad">{l}</span> : l}<br /></span>
              ))}
            </h1>
            <p className="lp5-hero-sub">{HERO.sub}</p>
            <div className="lp5-hero-cta">
              <Link href="/auth" className="lp5-btn lp5-btn-brand">무료로 시작하기 <Arrow /></Link>
              <Link href="/demo" className="lp5-btn lp5-btn-ghost">데모 보기</Link>
            </div>
            <div className="lp5-checks">
              {HERO.checks.map((c) => <span key={c} className="lp5-check"><Check /> {c}</span>)}
            </div>
          </div>
          <div className="lp5-hero-shot">
            <Shot src="/product/dashboard-v4.png" alt="오너뷰 대시보드" priority sizes="(max-width: 999px) 92vw, 1120px" />
          </div>
          <div className="lp5-hero-hint"><i />SCROLL</div>
        </>
      )}
    </Scene>
  );
}

// ══════════════════ 2. 통합 ══════════════════
//   흩어져 있던 도구들이 스크롤에 따라 가운데로 모이며 사라지고, 그 자리에 오너뷰가 남는다.
const SCATTER = [
  { t: "엑셀 견적서", x: "-430px", y: "-190px" },
  { t: "카톡 결재", x: "330px", y: "-215px" },
  { t: "통장 앱", x: "-500px", y: "40px" },
  { t: "카드사 앱", x: "470px", y: "10px" },
  { t: "수기 장부", x: "-360px", y: "215px" },
  { t: "메일 계약서", x: "395px", y: "205px" },
  { t: "급여 대장", x: "-90px", y: "-268px" },
  { t: "세무 자료 폴더", x: "120px", y: "262px" },
];

function SceneUnify() {
  return (
    <Scene len={1.7} beats={HERO_INTRO.length} className="lp5-unify">
      {(beat) => (
        <>
          {/* ⚠️ 궤도는 무대(100vh) 기준이어야 한다. 문구 박스 안에 두면 칩이 제목 위로 겹친다. */}
          <div className="lp5-orbit" aria-hidden>
            {SCATTER.map((s) => (
              <span key={s.t} className="lp5-chip" style={{ ["--x" as string]: s.x, ["--y" as string]: s.y }}>{s.t}</span>
            ))}
          </div>
          <div className="lp5-wrap lp5-unify-in">
          <div className="lp5-unify-copy">
            <div className="lp5-eyebrow">One Place</div>
            <h2 className="lp5-h lp5-h-sm">흩어져 있던 회사 일이<br /><span className="lp5-grad">하나로 모여요</span></h2>
            <div className="lp5-unify-lines">
              {HERO_INTRO.map((l, i) => (
                <p key={l} className={`lp5-unify-line ${i <= beat ? "lp5-unify-line-on" : ""}`}>{l}</p>
              ))}
            </div>
          </div>
          <div className="lp5-unify-core">
            <Shot src="/product/dashboard-v4.png" alt="오너뷰 대시보드" sizes="(max-width: 999px) 94vw, 820px" />
          </div>
          </div>
        </>
      )}
    </Scene>
  );
}

// ══════════════════ 3. 하루 ══════════════════
function SceneDay() {
  return (
    <Scene id="day" len={2.4} beats={DAY.length} className="lp5-day">
      {(beat) => {
        const d = DAY[beat];
        return (
          <div className="lp5-wrap lp5-day-grid">
            <div>
              <div className="lp5-eyebrow">Before &amp; After</div>
              <div className="lp5-day-time">{d.time}</div>
              <div className="lp5-day-scene">{d.scene}</div>
              <div className="lp5-day-ba">
                <div className="lp5-day-row">
                  <span className="lp5-day-tag lp5-day-tag-b">전</span>
                  <span className="lp5-day-b">{d.before}</span>
                </div>
                <div className="lp5-day-row">
                  <span className="lp5-day-tag lp5-day-tag-a">후</span>
                  <span className="lp5-day-a">{d.after}</span>
                </div>
              </div>
              <div className="lp5-day-dots">
                {DAY.map((x, i) => <span key={x.time} className={`lp5-day-dot ${i === beat ? "lp5-day-dot-on" : ""}`} />)}
              </div>
            </div>
            <ShotStack items={DAY.map((x) => ({ src: x.src, alt: x.alt }))} active={beat} />
          </div>
        );
      }}
    </Scene>
  );
}

// ══════════════════ 4. 세 축 ══════════════════
//   프로젝트 → 회계 → 인사. 무대는 고정, 좌측 문구와 우측 화면만 바뀐다.
function SceneAxes() {
  return (
    <Scene id="pillars" len={2.6} beats={PILLARS.length} className="lp5-ax">
      {(beat) => {
        const P = PILLARS[beat];
        return (
          <div className="lp5-wrap lp5-ax-grid">
            <div>
              <div className="lp5-eyebrow">Core</div>
              <div className="lp5-ax-kick lp5-grad">{P.kicker}</div>
              <div className="lp5-ax-head">
                {P.headline.split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}
              </div>
              <p className="lp5-ax-lead">{P.lead}</p>
              <div className="lp5-ax-menus">
                {P.menus.map((m) => <span key={m} className="lp5-ax-menu">{m}</span>)}
              </div>
              <div className="lp5-ax-steps">
                {PILLARS.map((x, i) => <span key={x.key} className={`lp5-ax-step ${i === beat ? "lp5-ax-step-on" : ""}`} />)}
              </div>
            </div>
            <ShotStack items={PILLARS.map((x) => ({ src: x.blocks[0].src, alt: x.blocks[0].alt }))} active={beat} />
          </div>
        );
      }}
    </Scene>
  );
}

// ══════════════════ 5. AI 엔진 ══════════════════
function SceneEngines() {
  return (
    <Scene id="engines" len={2.3} beats={ENGINES.length} tone="dark" className="lp5-eng">
      {(beat) => (
        <>
          <div className="lp5-eng-bg" />
          <div className="lp5-wrap lp5-eng-grid">
            <div>
              <div className="lp5-eyebrow">4 AI Engines</div>
              <h2 className="lp5-h lp5-h-sm lp5-eng-h">반복되던 일,<br /><span className="lp5-grad">이제 AI 몫이에요</span></h2>
              <div className="lp5-eng-list" style={{ marginTop: 28 }}>
                {ENGINES.map((e, i) => (
                  <div key={e.num} className={`lp5-eng-item ${i === beat ? "lp5-eng-item-on" : ""}`}>
                    <span className="lp5-eng-num">{e.num}</span>
                    <span>
                      <span className="lp5-eng-name">{e.name}</span>
                      <p className="lp5-eng-short">{e.short}</p>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <ShotStack items={ENGINES.map((e) => ({ src: e.src, alt: e.alt }))} active={beat} />
          </div>
        </>
      )}
    </Scene>
  );
}

// ══════════════════ 6. 커버리지 ══════════════════
//   메뉴 18개가 스크롤에 따라 하나씩 켜진다. 각각의 설명은 /features 가 맡는다.
function SceneCoverage() {
  const cells = CATALOG.flatMap((g) => g.menus.map((m) => ({ g: g.group, n: m.name, d: m.desc })));
  return (
    <Scene id="more" len={1.7} beats={cells.length} className="lp5-cov">
      {(beat) => (
        <div className="lp5-wrap">
          <div className="lp5-cov-head">
            <div className="lp5-eyebrow">Coverage</div>
            <h2 className="lp5-h lp5-h-sm">회사 운영, <span className="lp5-grad">오직 오너뷰 안에서</span></h2>
            <p className="lp5-lead" style={{ margin: "16px auto 0" }}>
              방금 본 세 축 아래로 메뉴 {cells.length}개가 이어져요. 재무부터 자산까지, 밖에서 따로 처리할 일이 없어요.
            </p>
          </div>
          <div className="lp5-cov-grid">
            {cells.map((c, i) => (
              <div key={c.n} className={`lp5-cov-cell ${i <= beat ? "lp5-cov-cell-on" : "lp5-cov-cell-off"}`}>
                <div className="lp5-cov-g">{c.g}</div>
                <div className="lp5-cov-n">{c.n}</div>
                <div className="lp5-cov-d">{c.d}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 34 }}>
            <Link href="/features" className="lp5-btn lp5-btn-ghost">메뉴별로 자세히 보기 <Arrow /></Link>
          </div>
        </div>
      )}
    </Scene>
  );
}

// ══════════════════ 7. 모바일 ══════════════════
//   여긴 스크롤이 아니라 시간으로 넘어간다 — 폰 화면은 가만히 두고 봐도 돌아가야 한다.
function SceneMobile() {
  const [i, setI] = useState(0);
  const n = MOBILE.steps.length;
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 3600);
    return () => clearInterval(t);
  }, [n]);
  const S = MOBILE.steps[i];
  return (
    <Scene id="mobile" len={1.35} className="lp5-mob">
      {() => (
        <div className="lp5-wrap lp5-mob-grid">
          <div className="lp5-mob-copy">
            <div className="lp5-eyebrow">{MOBILE.eyebrow}</div>
            <h2 className="lp5-h lp5-h-sm">
              {MOBILE.title.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
            </h2>
            <p className="lp5-lead">{MOBILE.sub}</p>
            <div className="lp5-mob-step">
              <div className="lp5-mob-h">{S.head}<br /><em>{S.muted}</em></div>
              <p className="lp5-mob-d">
                {S.desc.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
              </p>
              <div className="lp5-mob-dots">
                {MOBILE.steps.map((st, k) => <span key={st.src} className={`lp5-mob-dot ${k === i ? "lp5-mob-dot-on" : ""}`} />)}
              </div>
            </div>
          </div>
          <div className="lp5-phone">
            <div className="lp5-phone-notch" />
            {MOBILE.steps.map((st, k) => (
              <Image key={st.src} src={st.src} alt={st.alt} width={1170} height={2400}
                sizes="(max-width: 999px) 78vw, 340px" className={k === i ? "lp5-phone-on" : ""} />
            ))}
          </div>
        </div>
      )}
    </Scene>
  );
}

// ══════════════════ 8. 마무리 ══════════════════
function SceneEnd() {
  return (
    <Scene len={1.1} tone="dark" className="lp5-end">
      {() => (
        <>
          <div className="lp5-end-bg" />
          <div className="lp5-wrap lp5-end-in">
            <Rise as="h2" className="lp5-h">회사 운영, <span className="lp5-grad">오늘부터 달라져요</span></Rise>
            <Rise delay={90}>
              <p className="lp5-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                가입하면 바로 씁니다. 구축도, 교육도 필요 없어요.
              </p>
            </Rise>
            <Rise delay={170}>
              <div className="lp5-hero-cta">
                <Link href="/auth" className="lp5-btn lp5-btn-brand">무료로 시작하기 <Arrow /></Link>
                <Link href="/pricing" className="lp5-btn lp5-btn-ghost">가격 보기</Link>
              </div>
            </Rise>
          </div>
        </>
      )}
    </Scene>
  );
}

// ══════════════════ 페이지 ══════════════════
export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="lp4-root lp5-root">
      <LandingNav />

      <SceneHero />
      <SceneUnify />
      <SceneDay />
      <SceneAxes />
      <SceneEngines />
      <SceneCoverage />
      <SceneMobile />
      <SceneEnd />

      {/* ══ 꼬리 — 장면 연출이 필요 없는 실무 구간. lp4- 를 그대로 쓴다 ══ */}
      <section className="lp4-section lp4-bg-canvas" id="faq">
        <div className="lp4-narrow">
          <Rise className="lp4-sec-head"><div className="lp4-eyebrow">FAQ</div><h2 className="lp4-h2">자주 묻는 질문이에요</h2></Rise>
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

      <section className="lp4-section lp4-bg-tint" id="partner">
        <div className="lp4-narrow">
          <Rise className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Contact</div>
            <h2 className="lp4-h2">제휴·도입이 궁금하세요?</h2>
            <p className="lp4-sub">엔터프라이즈 도입, API 연동, 리셀러 제휴를 상담해 드릴게요.</p>
          </Rise>
          <Rise><PartnershipForm /></Rise>
        </div>
      </section>

      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-top">
            <div className="lp4-logo"><Logo size={25} /> OwnerView <span className="lp4-footer-sub">Company Operating System</span></div>
            <div className="lp4-flinks"><Link href="/features">오너뷰 알아보기</Link><a href="#engines">AI 엔진</a><Link href="/pricing">가격</Link><a href="#partner">제휴문의</a><a href="#faq">FAQ</a></div>
          </div>
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불규정</Link><a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
