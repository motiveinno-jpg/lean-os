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
import { useEffect, useRef, useState, type ReactNode } from "react";
import "@/app/landing.css";
import "@/app/landing-v5.css";
import { LandingNav } from "@/components/landing/landing-nav";
import { PartnershipForm } from "@/components/landing/partnership-form";
import { Scene, Rise, useNarrow } from "@/components/landing/scene";
import {
  HERO, HERO_INTRO, DAY, PILLARS, ENGINES, AI_AUTOMATION, CATALOG, MOBILE, FAQS, FOOTER,
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
  const narrow = useNarrow();
  // 좁은 화면 + 모든 화면에 모바일 대응본이 있을 때만 폰으로 바꾼다(한 장이라도 없으면 섞이니 그대로 둔다)
  const mob = items.every((it) => MOBILE_OF[it.src]);
  if (narrow && mob) {
    return (
      <div className="lp5-phone lp5-phone-solo">
        <div className="lp5-phone-notch" />
        {items.map((it, i) => (
          <Image key={it.src} src={MOBILE_OF[it.src]} alt={it.alt} width={1170} height={2400}
            sizes="66vw" className={i === active ? "lp5-phone-on" : ""} />
        ))}
      </div>
    );
  }
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

/** 데스크톱 캡처 → 같은 기능의 모바일 캡처.
 *   ⚠️ 폰에서 데스크톱 화면을 320px 로 줄이면 글자가 안 읽혀 전달이 0 이 된다.
 *      /demo 를 390px 뷰포트로 열어 실제 앱이 리플로우된 화면을 그대로 찍은 것들이다. */
const MOBILE_OF: Record<string, string> = {
  "/product/dashboard-v5.png":   "/product/m-dash-v2.png",
  "/product/f-estimate-v1.png":  "/product/m-estimate.png",
  "/product/f-settlement-v1.png":"/product/m-settlement.png",
  "/product/f-hr-v1.png":        "/product/m-payroll.png",
  "/product/f-flow-v1.png":      "/product/m-outlook.png",
  "/product/f-projects-v1.png":  "/product/m-hub.png",
  "/product/f-acct-v1.png":      "/product/m-analytics.png",
  "/product/f-bank-v1.png":      "/product/m-bank.png",
};

/** 폰 목업 한 대 — 좁은 화면에서 데스크톱 캡처 대신 들어간다. */
function PhoneShot({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="lp5-phone lp5-phone-solo">
      <div className="lp5-phone-notch" />
      <Image src={src} alt={alt} width={1170} height={2400} sizes="74vw" priority={priority} className="lp5-phone-on" />
    </div>
  );
}

/** 화면 다섯 장이 부채꼴로 펼쳐지는 묶음 — 페이지 최상단.
 *  ⚠️ 스크롤이 아니라 "페이지가 열리면" 퍼진다. 첫 화면에서 바로 보여야 하는 연출이라
 *     스크롤을 기다리게 하면 아무도 못 본다. --sp 를 CSS 애니메이션이 0→1 로 올린다.
 *  ⚠️ 마름모 실루엣이 되게 배열한다 — 가운데가 가장 크고, 옆으로 갈수록 작아진다.
 *     세로 중심은 다섯 장 모두 같다. 크기만 줄어드니 위아래가 동시에 좁아져 마름모가 된다.
 *     (옆 장을 아래로 내렸더니 "메인만 혼자 위에 있는" 꼴이 됐다 — fy 를 없앴다.)
 *  fx = 자기 폭 기준 가로 이동(%), fs = 최종 크기. 회전은 넣지 않는다. */
const FAN = [
  { src: "/product/f-approvals-v1.png", alt: "오너뷰 결재 허브",         fx: "-98%", fs: 0.56, z: 1 },
  { src: "/product/f-projects-v1.png",  alt: "오너뷰 프로젝트 파이프라인", fx: "-58%", fs: 0.76, z: 2 },
  { src: "/product/dashboard-v5.png",   alt: "오너뷰 대시보드",           fx: "0%",   fs: 1,    z: 3 },
  { src: "/product/f-bank-v1.png",      alt: "오너뷰 거래 장부",          fx: "58%",  fs: 0.76, z: 2 },
  { src: "/product/f-hr-v1.png",        alt: "오너뷰 급여 배치",          fx: "98%",  fs: 0.56, z: 1 },
];

function Fan({ priority = false }: { priority?: boolean }) {
  return (
    <div className="lp5-fan lp5-fan-in">
      {FAN.map((f, i) => (
        <div key={f.src} className="lp5-fan-item" style={{
          ["--fx" as string]: f.fx, ["--fs" as string]: f.fs, zIndex: f.z,
        }}>
          <Image src={f.src} alt={f.alt} width={2288} height={1802}
            sizes="(max-width: 999px) 60vw, 520px" priority={priority && i === 2} />
        </div>
      ))}
    </div>
  );
}

// ══════════════════ 1. 히어로 ══════════════════
function SceneHero() {
  const narrow = useNarrow();
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
            {narrow
              ? <PhoneShot src="/product/m-dash-v2.png" alt="휴대폰에서 본 오너뷰 대시보드" priority />
              : <Fan priority />}
          </div>
          <div className="lp5-hero-hint"><i />SCROLL</div>
        </>
      )}
    </Scene>
  );
}

// ══════════════════ 2. 통합 ══════════════════
//   흩어져 있던 도구들이 스크롤에 따라 가운데로 모이며 사라지고, 그 자리에 오너뷰가 남는다.
// 흩어진 도구들 — 무대 중앙(0,0) 기준 좌표.
//   ⚠️ 사장님: "되도록 흩어져 있는 라인 위로는 배치를 안 하는 게 좋을 듯" →
//      문구 아래(y >= -20)에만 둔다. 제목 위로는 하나도 올리지 않는다.
//   ⚠️ "너무 일정하게 배치되어 있어서 흩어진 느낌이 덜하다" →
//      x·y 를 격자에서 일부러 어긋내고, 기울기(rot)·크기(sc)·모이는 시점(d)까지 제각각으로 둔다.
//      d 가 다르면 칩들이 한 덩어리로 움직이지 않고 따로따로 빨려들어간다.
//   ⚠️ 아이콘은 실제 서비스 로고를 쓰지 않는다 — 남의 상표를 "불편하다"는 맥락에 쓰면
//      분쟁 소지가 있다. 색·형태만으로 무엇인지 알아보게 만든다.
const SCATTER = [
  { t: "엑셀 견적서",    i: "sheet",  c: "#1D8A54", x: "-598px", y: "18px",   rot: "-7deg",  sc: 1.06, d: 0.00 },
  { t: "카톡 결재",      i: "chat",   c: "#E5B800", x: "512px",  y: "-8px",   rot: "6deg",   sc: 1.02, d: 0.06 },
  { t: "통장 앱",        i: "bank",   c: "#2F6FED", x: "-352px", y: "148px",  rot: "4deg",   sc: 0.93, d: 0.11 },
  { t: "카드사 앱",      i: "card",   c: "#5B4BE8", x: "643px",  y: "176px",  rot: "-5deg",  sc: 0.97, d: 0.03 },
  { t: "수기 장부",      i: "book",   c: "#B4762A", x: "-655px", y: "232px",  rot: "8deg",   sc: 1.09, d: 0.14 },
  { t: "메일 계약서",    i: "mail",   c: "#D94A3D", x: "266px",  y: "104px",  rot: "-3deg",  sc: 0.9,  d: 0.09 },
  { t: "급여 대장",      i: "won",    c: "#0E8F6F", x: "-142px", y: "268px",  rot: "-9deg",  sc: 1.04, d: 0.17 },
  { t: "세무 자료 폴더", i: "folder", c: "#E08422", x: "398px",  y: "312px",  rot: "5deg",   sc: 0.95, d: 0.05 },
  { t: "종이 근태표",    i: "clock",  c: "#5B6472", x: "-480px", y: "372px",  rot: "-4deg",  sc: 0.88, d: 0.2 },
  // ⚠️ 원래 (620,-26) 이라 "카톡 결재"(512,-8) 와 가로 108px 밖에 안 떨어져 겹쳤다
  { t: "드라이브 서류함", i: "drive", c: "#2C9C63", x: "318px",  y: "-34px",  rot: "9deg",   sc: 0.91, d: 0.13 },
  { t: "달력 일정",      i: "cal",    c: "#C93B3B", x: "96px",   y: "382px",  rot: "7deg",   sc: 1.0,  d: 0.08 },
  { t: "문자 알림",      i: "bell",   c: "#3AA35C", x: "-268px", y: "56px",   rot: "3deg",   sc: 0.86, d: 0.16 },
];

/** 칩 아이콘 — 색 있는 타일. 로고가 아니라 "무슨 도구인지" 알아보게 하는 형태다. */
function ChipIcon({ n, c }: { n: string; c: string }) {
  const p = { width: 15, height: 15, fill: "none", stroke: "#fff", strokeWidth: 2,
    viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let g;
  switch (n) {
    case "sheet":  g = <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9.5h18M3 15h18M9.5 3v18"/></svg>; break;
    case "chat":   g = <svg {...p}><path d="M12 4c4.7 0 8.5 2.9 8.5 6.5S16.7 17 12 17c-.8 0-1.6-.1-2.3-.3L5 19l1.2-3.2C4.6 14.6 3.5 12.7 3.5 10.5 3.5 6.9 7.3 4 12 4z"/></svg>; break;
    case "bank":   g = <svg {...p}><path d="M3.5 10L12 4.5 20.5 10"/><path d="M6 10.5v8M18 10.5v8M10 10.5v8M14 10.5v8M3 19h18"/></svg>; break;
    case "card":   g = <svg {...p}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/></svg>; break;
    case "book":   g = <svg {...p}><path d="M5 4.5A1.5 1.5 0 016.5 3H19v18H6.5A1.5 1.5 0 015 19.5v-15z"/><path d="M8.5 8h7M8.5 12h5"/></svg>; break;
    case "mail":   g = <svg {...p}><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 8l9 6 9-6"/></svg>; break;
    case "won":    g = <svg {...p}><path d="M4 7.5l3 9 3-7 3 7 3-9"/><path d="M2.5 11.5h19"/></svg>; break;
    case "folder": g = <svg {...p}><path d="M3 7.5A2 2 0 015 5.5h3.6l2 2H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-9z"/></svg>; break;
    case "clock":  g = <svg {...p}><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2"/></svg>; break;
    case "drive":  g = <svg {...p}><path d="M12 3.5l6.5 11h-13l6.5-11z"/><path d="M5.5 14.5L3 19h18l-2.5-4.5"/></svg>; break;
    case "cal":    g = <svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/></svg>; break;
    default:       g = <svg {...p}><path d="M18 8.5A6 6 0 006 8.5c0 6.5-2.8 8.5-2.8 8.5h17.6S18 15 18 8.5z"/><path d="M13.6 20.5a2 2 0 01-3.2 0"/></svg>; break;
  }
  return <span className="lp5-chip-ico" style={{ background: c }}>{g}</span>;
}

function SceneUnify() {
  const narrow = useNarrow();
  return (
    <Scene len={1.7} beats={HERO_INTRO.length} className="lp5-unify">
      {(beat) => (
        <>
          {/* ⚠️ 궤도는 무대(100vh) 기준이어야 한다. 문구 박스 안에 두면 칩이 제목 위로 겹친다. */}
          <div className="lp5-orbit" aria-hidden>
            {SCATTER.map((s) => (
              <span key={s.t} className="lp5-chip" style={{
                ["--x" as string]: s.x, ["--y" as string]: s.y,
                ["--rot" as string]: s.rot, ["--sc" as string]: s.sc, ["--d" as string]: s.d,
              }}>
                <ChipIcon n={s.i} c={s.c} />{s.t}
              </span>
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
            {narrow
              ? <PhoneShot src="/product/m-money-v2.png" alt="휴대폰에서 본 오너뷰 경영 요약" />
              : <Shot src="/product/dashboard-v5.png" alt="오너뷰 대시보드" sizes="(max-width: 999px) 94vw, 1000px" />}
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
          <div className="lp5-wrap">
            {/* ⚠️ v5 로 옮기면서 섹션 후킹 문구가 빠졌었다. 장면이 바뀌어도 "이 섹션이 무슨 말을
                하려는지"는 남아 있어야 한다 — eyebrow 만으로는 전달되지 않는다. */}
            <div className="lp5-sec-head">
              <div className="lp5-eyebrow">Before &amp; After</div>
              <h2 className="lp5-h lp5-h-sm">오너뷰로 하루가 <span className="lp5-grad">이렇게 달라져요</span></h2>
              <p className="lp5-lead">어떻게 달라지는지, 시간대별로 보여드릴게요.</p>
            </div>
            <div className="lp5-day-grid">
              {/* key 를 붙여 구간이 바뀔 때마다 다시 마운트 → 문구가 툭 갈리지 않고 스르륵 바뀐다 */}
              <div className="lp5-swap" key={d.time}>
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
              </div>
              <ShotStack items={DAY.map((x) => ({ src: x.src, alt: x.alt }))} active={beat} />
            </div>
            <div className="lp5-day-dots">
              {DAY.map((x, i) => <span key={x.time} className={`lp5-day-dot ${i === beat ? "lp5-day-dot-on" : ""}`} />)}
            </div>
          </div>
        );
      }}
    </Scene>
  );
}

/** 자동 재생 레일 — 스크롤이 아니라 시간으로 넘어간다.
 *  사장님: "스크롤에 따라 화면 넘기기 삭제 (모바일에서 보기가 힘듦).
 *   밑에 자동재생·일시정지 버튼과 왼쪽 순서 기능, 점을 누르면 바로 그 페이지로."
 *  ⚠️ 화면에 들어와 있을 때만 돈다. 안 보이는 레일이 계속 타이머를 돌리면 배터리만 먹는다.
 *  ⚠️ 마지막 칸에서 트랙 오른쪽 끝이 화면 오른쪽에 닿으면 더 안 민다 — 안 그러면 오른쪽이 텅 빈다. */
function Rail({ cards, tall = false, wide = false, ms = 4600 }: { cards: ReactNode[]; tall?: boolean; wide?: boolean; ms?: number }) {
  const n = cards.length;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => setLive(es[0].isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !live) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [playing, live, n, ms]);

  return (
    <div ref={ref}>
      <div className={`lp5-rail-view ${wide ? "lp5-rail-view-full" : ""}`}>
        <div className={`lp5-rail-track ${tall ? "lp5-rail-tall" : ""} ${wide ? "lp5-rail-wide" : ""}`}
          style={{ ["--n" as string]: n, ["--i" as string]: i }}>
          {cards}
        </div>
      </div>
      <div className="lp5-rail-bar">
        <div className="lp5-rail-dots">
          {cards.map((_, k) => (
            <button key={k} type="button" onClick={() => setI(k)}
              className={`lp5-rail-dot ${k === i ? "lp5-rail-dot-on" : ""}`}
              aria-label={`${k + 1}번째 보기`} aria-current={k === i} />
          ))}
        </div>
        <button type="button" className="lp5-rail-play" onClick={() => setPlaying((v) => !v)}
          aria-label={playing ? "자동 재생 멈춤" : "자동 재생"}>
          {playing
            ? <svg width="13" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>
            : <svg width="13" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4c0 .9 1 1.4 1.7.9l10.7-7.2c.6-.4.6-1.4 0-1.8L8.7 3.9c-.7-.5-1.7 0-1.7.9z"/></svg>}
        </button>
        <span className="lp5-rail-count">{i + 1} / {n}</span>
      </div>
    </div>
  );
}

// ══════════════════ 4. 세 축 — 자동 재생 레일 ══════════════════
//   사장님: "위에서부터 다 같은 형식이라 느낌이 너무 똑같음. 좌측 제목 + 가로로 움직이는 형태로."
//   앞뒤 장면이 전부 [좌 문구 / 우 화면] 이라, 여기만 가로 레일로 리듬을 끊는다.
//   레일은 --p 로 연속 이동한다(구간 단위로 튀지 않게). 점은 현재 구간만 표시.
function SceneAxes() {
  // 카드 구조는 하나로 고정한다 — 좌측 상단 기능명, 그 아래 설명, 그 아래 화면.
  //   ⚠️ 화면을 확대해 일부만 잘라 보여줬더니 설명과 다른 부분이 나왔다. 기능이 있는 자리가
  //      화면마다 다르기 때문이다(상단 카드 / 가운데 표 / 하단 목록). 이미지마다 손으로 좌표를
  //      맞추지 않는 한 틀린다 → 화면 위쪽부터 폭 전체를 보여준다. 패널 제목·요약이 카드 설명과
  //      같은 말을 하고 있어 설명과 화면이 항상 맞는다.
  const cards = PILLARS.flatMap((P) =>
    P.blocks.map((b) => ({ kicker: P.kicker, tab: b.tab, title: b.title, desc: b.desc, src: b.src, alt: b.alt })),
  );
  return (
    <section id="pillars" className="lp5-sect">
      <div className="lp5-wrap">
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">Core</div>
          <h2 className="lp5-h lp5-h-sm">일은 줄이고, <span className="lp5-grad">효율과 성과는 높여요</span></h2>
          <p className="lp5-lead">회사 운영의 세 축이 하나의 데이터 위에서 같이 움직여요.</p>
        </Rise>
        <Rail wide cards={cards.map((c) => (
          <article key={c.src + c.tab} className="lp5-rail-card">
            <div className="lp5-rail-over">
              <span className="lp5-rail-kick">{c.kicker} · {c.tab}</span>
              <h3 className="lp5-rail-title">{c.title}</h3>
              <p className="lp5-rail-desc">{c.desc}</p>
            </div>
            <div className="lp5-rail-shot">
              <Image src={c.src} alt={c.alt} width={2288} height={1802}
                sizes="(max-width: 999px) 86vw, 1040px" />
            </div>
          </article>
        ))} />
      </div>
    </section>
  );
}

// ══════════════════ 5. AI — 어두운 장면 + 가로 레일 ══════════════════
//   사장님: "뒤 배경색은 마음에 들어. 근데 이미지를 더 키우고 설명이 들어가되 가로로 넘어가고,
//   AI 자동화에 있는 부분을 가져와도 될 것 같아. 이미지는 핵심적인 부분만 보여줘도 좋을 것 같아."
//   ⚠️ 카드 안의 화면은 전체를 축소해 넣지 않는다 — 세로 카드에 꽉 채우고 좌상단(헤더+핵심 카드가
//      있는 자리)을 확대해 잘라 보여준다. 전체를 넣으면 아무것도 안 읽힌다.
function SceneAI() {
  // 엔진(큰 묶음) + 자동화(세부 기능)를 한 레일에 합친다.
  //   ⚠️ 중복 판정 기준은 "같은 화면을 쓰는가" 다 — 생존 레이더/현금 소진 예측,
  //      거래처 자산화/휴면 감지처럼 같은 화면을 가리키면 같은 이야기를 두 번 하는 셈이라
  //      더 큰 묶음인 엔진 쪽만 남긴다. (사장님: "중복되는 내용은 한 개만 노출")
  const engineCards = ENGINES.map((e) => ({
    kind: "엔진", name: e.name, tag: e.eng, desc: e.short, where: "", src: e.src, alt: e.alt,
  }));
  const used = new Set(engineCards.map((e) => e.src));
  const autoCards = AI_AUTOMATION.filter((a) => !used.has(a.src)).map((a) => ({
    kind: "자동화", name: a.name, tag: a.tag, desc: a.desc, where: a.where, src: a.src, alt: a.alt,
  }));
  const items = [...engineCards, ...autoCards];
  return (
    <section id="engines" className="lp5-sect lp5-sect-dark">
      <div className="lp5-eng-bg" />
      <div className="lp5-wrap" style={{ position: "relative", zIndex: 1 }}>
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">AI Automation</div>
          <h2 className="lp5-h lp5-h-sm lp5-eng-h">반복되던 일,<br /><span className="lp5-grad">이제 AI 몫이에요</span></h2>
          <p className="lp5-lead">
            사람을 대체하는 게 아니라, 매번 되풀이되는 일을 AI가 먼저 처리해 둬요.
            엔진 {engineCards.length}개와 자동화 {autoCards.length}가지가 나눠서 맡아요.
          </p>
        </Rise>
        <Rail tall cards={items.map((a) => (
          <article key={a.name} className="lp5-rail-card">
            <div className="lp5-rail-crop">
              <Image src={a.src} alt={a.alt} width={2288} height={1802} sizes="(max-width: 999px) 74vw, 440px" />
            </div>
            <div className="lp5-rail-note">
              <span className={`lp5-rail-kind ${a.kind === "엔진" ? "lp5-rail-kind-e" : ""}`}>{a.kind}</span>
              <b>{a.name}</b> <span className="lp5-rail-tag">{a.tag}</span>
              <p>{a.desc}</p>
              {a.where && <span className="lp5-rail-where">{a.where}</span>}
            </div>
          </article>
        ))} />
      </div>
    </section>
  );
}

// ══════════════════ 6. 커버리지 ══════════════════
//   메뉴 18개가 스크롤에 따라 하나씩 켜진다. 각각의 설명은 /features 가 맡는다.
function SceneCoverage() {
  const cells = CATALOG.flatMap((g) => g.menus.map((m) => ({ g: g.group, n: m.name, d: m.desc })));
  return (
    <Scene id="more" len={1.15} className="lp5-cov">
      {() => (
        <div className="lp5-wrap">
          <div className="lp5-cov-head">
            <div className="lp5-eyebrow">Coverage</div>
            <h2 className="lp5-h lp5-h-sm">회사 운영, <span className="lp5-grad">오직 오너뷰 안에서</span></h2>
            <p className="lp5-lead" style={{ margin: "16px auto 0" }}>
              방금 본 세 축 아래로 메뉴 {cells.length}개가 이어져요. 재무부터 자산까지, 밖에서 따로 처리할 일이 없어요.
            </p>
          </div>
          <div className="lp5-cov-grid">
            {/* 사장님: "메뉴 생성되는 쪽은 스크롤이 의미없이 많다" — 18칸을 한 칸씩 켜면
                그만큼의 스크롤을 써야 한다. 진입하면 계단식으로 한 번에 떠오르게 바꿈. */}
            {cells.map((c, i) => (
              <Rise key={c.n} delay={i * 34} className="lp5-cov-cell">
                <div className="lp5-cov-g">{c.g}</div>
                <div className="lp5-cov-n">{c.n}</div>
                <div className="lp5-cov-d">{c.d}</div>
              </Rise>
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
      <SceneAxes />
      <SceneAI />
      <SceneCoverage />
      {/* 사장님: "오너뷰로 하루가 이렇게 달라져요를 모바일 위로" —
          기능을 다 보여준 뒤 "그래서 하루가 이렇게 바뀐다"로 받고, 바로 "밖에서도 된다"로 잇는다 */}
      <SceneDay />
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
