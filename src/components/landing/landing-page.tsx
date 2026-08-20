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
import "@/app/landing-v6.css";
import { LandingNav } from "@/components/landing/landing-nav";
import { PartnershipForm } from "@/components/landing/partnership-form";
import { Scene, Rise, useNarrow } from "@/components/landing/scene";
import { AiDemoRail } from "@/components/landing/ai-demo-rail";
import { SwipeDeck } from "@/components/landing/swipe-deck";

import {
  HERO, HERO_INTRO, PAINS, DAY, PILLARS, CATALOG, MOBILE,
  PLANS, CASES, CASES_NOTE, FAQS, FOOTER,
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

/** 문장 단위로 줄을 나눈다.
 *  ⚠️ 두 문장을 한 덩어리로 흘리면 "…애매한 것만 / 확인해 달라고 해요." 처럼 첫 문장의 끝과
 *     둘째 문장의 시작이 한 줄에 섞여, 어디서 끊어 읽어야 할지 알 수 없다(사장님 지적).
 *     마침표에서 줄을 바꾸면 한 줄이 곧 한 문장이 된다.
 *  ⚠️ 나누는 기준은 "마침표 + 공백" 이다. 그냥 마침표로 자르면 "4.5%" 나 "3.545%" 같은
 *     소수점까지 문장 끝으로 보고 끊어 버린다(급여 카드에 실제로 들어 있다). */
function Sentences({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\.\s+/).map((s, i, a) => (i < a.length - 1 ? `${s}.` : s)).filter(Boolean);
  return (
    <p className={className}>
      {parts.map((s, i) => <span key={i} className="lp5-sent">{s}</span>)}
    </p>
  );
}

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
  "/product/dashboard-v6.png":   "/product/m-dash-v4.png",
  "/product/f-estimate-v4.png":  "/product/m-estimate-v3.png",
  "/product/f-settlement-v4.png":"/product/m-settlement-v3.png",
  "/product/f-payroll-v4.png":   "/product/m-payroll-v3.png",
  "/product/f-flow-v4.png":      "/product/m-outlook-v3.png",
  "/product/f-projects-v5.png":  "/product/m-hub-v4.png",
  "/product/f-acct-v4.png":      "/product/m-analytics-v3.png",
  "/product/f-bank-v4.png":      "/product/m-bank-v3.png",
  "/product/f-hr-v4.png":        "/product/m-leave-v3.png",
  "/product/f-ai-brief-v4.png":  "/product/m-brief-v3.png",
};

/** 코어 카드 전용 조각 — 패널 헤더를 뺀 "그 기능 블록"만 잘라 둔 캡처.
 *   ⚠️ 예전엔 전체 화면 캡처를 좌표로 확대·크롭해 썼다. 기능이 있는 자리가 화면마다 달라
 *      반드시 설명과 어긋났고, 카드 제목과 캡처 안 패널 제목이 같은 말을 두 번 했다.
 *      → 좌표가 아니라 DOM 으로 자른다(.pp-head 를 숨기고 패널을 찍는다). cap 스크립트 참고.
 *   /features 는 계속 전체 화면(f-*.png)을 쓰므로 파일을 따로 둔다. */

const CORE_SHOT: Record<string, string> = {
  "/product/f-projects-v5.png":   "/product/c-projects-v4.png",
  "/product/f-estimate-v4.png":   "/product/c-estimate-v3.png",
  "/product/f-settlement-v4.png": "/product/c-settlement-v3.png",
  "/product/f-acct-v4.png":       "/product/c-acct-v3.png",
  "/product/f-bank-v4.png":       "/product/c-bank-v3.png",
  "/product/f-tax-v4.png":        "/product/c-tax-v3.png",
  "/product/f-payroll-v4.png":    "/product/c-hr-v3.png",
  "/product/f-members-v4.png":    "/product/c-members-v3.png",
  "/product/f-hr-v4.png":         "/product/c-leave-v3.png",
};

/** 화면 다섯 장이 마름모로 펼쳐지는 묶음 — 페이지 최상단.
 *  ⚠️ 스크롤이 아니라 "페이지가 열리면" 퍼진다. 첫 화면에서 바로 보여야 하는 연출이라
 *     스크롤을 기다리게 하면 아무도 못 본다. --sp 를 CSS 애니메이션이 0→1 로 올린다.
 *  ⚠️ 가운데가 가장 크고 옆으로 갈수록 작아진다. 세로 중심은 다섯 장 모두 같아서
 *     크기만 줄어도 위아래가 동시에 좁아져 마름모가 된다.
 *  ⚠️ 자리(슬롯)는 고정이고 어떤 화면이 어느 자리에 앉을지만 바뀐다 — 옆 카드를 누르면
 *     그 카드가 가운데 자리로 온다. 슬롯마다 비율(aspect)을 달리 주면 전환이 튀므로
 *     비율은 하나로 통일하고 크기(scale)로만 마름모를 만든다. */
const FAN = [
  { src: "/product/hero-appr-v2.png", alt: "오너뷰 결재 허브" },
  { src: "/product/hero-hub-v2.png",  alt: "오너뷰 프로젝트" },
  { src: "/product/hero-dash-v2.png", alt: "오너뷰 대시보드" },
  { src: "/product/hero-bank-v2.png", alt: "오너뷰 통장" },
  { src: "/product/hero-hr-v2.png",   alt: "오너뷰 구성원" },
];
/** 자리 5개 — 왼쪽 끝부터. fx = 자기 폭 기준 가로 이동, fs = 크기. */
const FAN_SLOTS = [
  { fx: "-114%", fs: 0.52 },
  { fx: "-66%",  fs: 0.80 },
  { fx: "0%",    fs: 1.34 },
  { fx: "66%",   fs: 0.80 },
  { fx: "114%",  fs: 0.52 },
];

function Fan({ priority = false }: { priority?: boolean }) {
  const [active, setActive] = useState(2);   // 가운데 자리에 앉을 화면
  const [ready, setReady] = useState(false); // 펼침 애니메이션이 끝나야 전환을 켠다
  const [manual, setManual] = useState(false);
  const n = FAN.length;
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1900);
    return () => clearTimeout(t);
  }, []);
  /* 자동 롤링 — 펼침이 끝나면 가운데 화면이 저절로 넘어간다(웹·폰 동일, 사장님 지시 2026-07-30).
     ⚠️ 한 번이라도 손을 대면 멈춘다 — 보고 있는 화면이 저절로 바뀌면 오히려 방해가 된다.
     ⚠️ 모션 최소화 설정이면 돌리지 않는다. */
  useEffect(() => {
    if (!ready || manual) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setActive((v) => (v + 1) % n), 3400);
    return () => clearInterval(t);
  }, [ready, manual, n]);
  return (
    <div className={`lp5-fan lp5-fan-in ${ready ? "lp5-fan-ready" : ""}`}>
      {FAN.map((f, i) => {
        // 가운데(2번 자리)에 active 가 오도록 회전시킨다
        const slot = (i - active + 2 + n) % n;
        const S = FAN_SLOTS[slot];
        const center = slot === 2;
        return (
          <button
            key={f.src} type="button"
            className={`lp5-fan-item ${center ? "lp5-fan-center" : ""}`}
            onClick={() => { setManual(true); setActive(i); }}
            aria-label={`${f.alt} 크게 보기`} aria-current={center}
            style={{
              ["--fx" as string]: S.fx, ["--fs" as string]: S.fs,
              // ⚠️ transform: scale() 이 테두리 굵기까지 줄인다. 1/fs 로 미리 부풀려 넘긴다.
              ["--bw" as string]: `${(1 / S.fs).toFixed(2)}px`,
              zIndex: 3 - Math.abs(slot - 2),
            }}
          >
            {/* ⚠️ sizes 는 "가장 커졌을 때"(가운데 자리) 기준으로 잡는다. 옆자리 기준으로 잡으면
                클릭해서 가운데로 왔을 때 확대돼 흐려진다. */}
            <Image src={f.src} alt={f.alt} width={2240} height={1400}
              sizes="(max-width: 999px) 78vw, 880px" priority={priority && i === 2} />
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════ 1. 히어로 ══════════════════
function SceneHero() {
  return (
    <Scene len={1.15} className="lp5-hero">
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
            {/* ⚠️ 좁은 화면에서 폰 목업으로 바꿔 끼우던 걸 걷어냈다 — 사장님: "메인은 웹과
                동일하게 마름모 형태로". 카드만 작아지고 연출은 같다. */}
            <Fan priority />
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

/** 열어둔 창 12개 — 창마다 실제 데이터가 들어 있다. 앞 4개는 타일로, 뒤 8개는 행으로 앉는다
 *  (순서가 곧 도착지 순서다 — 시점은 landing-v6.css 의 nth-child 로 맞춘다).
 *  ⚠️ 창 안의 값과 도착지의 값은 반드시 같아야 한다. 사장님: "12개에 있던 데이터가 깔끔하게
 *     정리되어 한눈에 보인다는 게 보여야 신뢰가 생긴다." 숫자가 달라지면 그 신뢰가 깨진다. */
const WINDOWS = [
  { app: "문자 알림",       i: "bell",   c: "#3AA35C", src: "잔고 알림",     dest: "통장 잔액",      val: "2억 3,040만" },
  { app: "엑셀 견적서",     i: "sheet",  c: "#1D8A54", src: "이번 달 합계",  dest: "이번 달 매출",   val: "4,500만" },
  { app: "수기 장부",       i: "book",   c: "#B4762A", src: "못 받은 돈",    dest: "미수금",         val: "1,200만" },
  { app: "카톡 결재",       i: "chat",   c: "#E5B800", src: "결재 요청",     dest: "결재 대기",      val: "3건" },
  { app: "통장 앱",         i: "bank",   c: "#2F6FED", src: "입금",          dest: "입금 · 기업은행", val: "3,300,000" },
  { app: "카드사 앱",       i: "card",   c: "#5B4BE8", src: "카드 승인",     dest: "카드 승인 · AWS", val: "412,300" },
  { app: "세무 자료 폴더",  i: "folder", c: "#E08422", src: "발행 건수",     dest: "세금계산서 발행", val: "12건" },
  { app: "메일 계약서",     i: "mail",   c: "#D94A3D", src: "체결 건수",     dest: "용역계약 체결",   val: "2건" },
  { app: "급여 대장",       i: "won",    c: "#0E8F6F", src: "7월 급여",      dest: "7월 급여 지급",   val: "4,830,000" },
  { app: "종이 근태표",     i: "clock",  c: "#5B6472", src: "이번 주 근태",  dest: "이번 주 근태",    val: "5명" },
  { app: "달력 일정",       i: "cal",    c: "#C93B3B", src: "다가오는 일정", dest: "다가오는 일정",   val: "3건" },
  { app: "드라이브 서류함", i: "drive",  c: "#2C9C63", src: "보관 문서",     dest: "보관 문서",       val: "8건" },
];

/** 창 12개 → 오너뷰 창 하나. 무대 안에 들어가는 본체(데스크톱·폰 공용).
 *  winsRef — 폰에서 "언제 합쳐질지"를 정하는 기준점(창 묶음). 사용자가 창까지 스크롤해
 *  내려온 순간부터 합쳐져야 "모이는 모습"을 볼 수 있다. */
function UnifyStage({ winsRef }: { winsRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="lp5-uni-stage">
      <div className="lp5-uni-wins" ref={winsRef} aria-hidden>
        {WINDOWS.map((w) => (
          <div key={w.app} className="lp5-uni-win">
            <div className="lp5-uni-win-bar">
              <ChipIcon n={w.i} c={w.c} /><span>{w.app}</span><b>×</b>
            </div>
            <div className="lp5-uni-win-body">
              <span className="lp5-uni-win-k">{w.src}</span>
              <span className="lp5-uni-win-v">{w.val}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="lp5-uni-own">
        <div className="lp5-uni-own-bar">
          <span className="lp5-uni-own-tab"><i />오너뷰</span>
          <span className="lp5-uni-own-note">여러 앱의 데이터가 한번에 정리돼요</span>
        </div>
        <div className="lp5-uni-own-body">
          <div className="lp5-uni-tiles">
            {WINDOWS.slice(0, 4).map((w) => (
              <div key={w.dest} className="lp5-uni-tile">
                <span className="lp5-uni-tile-k"><i style={{ background: w.c }} />{w.dest}</span>
                <span className="lp5-uni-tile-v">{w.val}</span>
              </div>
            ))}
          </div>
          <div className="lp5-uni-rows">
            {WINDOWS.slice(4).map((w) => (
              <div key={w.dest} className="lp5-uni-row">
                <i style={{ background: w.c }} /><span>{w.dest}</span><b>{w.val}</b>
              </div>
            ))}
          </div>
        </div>
        <span className="lp5-uni-count">창 12개 → 1개</span>
      </div>
    </div>
  );
}

function UnifyHead() {
  return (
    <>
      <div className="lp5-eyebrow">One Place</div>
      <h2 className="lp5-h lp5-h-sm">흩어져 있던 회사 일이<br /><span className="lp5-grad">하나로 모여요</span></h2>
      <div className="lp5-uni-lines">
        {/* 재생이 시작되면 계단식으로 한 줄씩 뜬다 — beat 대신 CSS 지연으로 처리한다 */}
        {HERO_INTRO.map((l) => <p key={l} className="lp5-uni-line">{l}</p>)}
      </div>
    </>
  );
}

// ⚠️ 이전 연출(칩 12개가 중앙으로 모여 사라지고 그 자리에 대시보드 캡처가 뜨는 방식)은
//    1512px·390px 실측에서 ① 시작이 빈 화면 ② 칩이 모이는 게 아니라 사라짐 ③ 도착한 캡처는
//    글자가 안 읽힘 — "사라졌다 + 다른 게 나타났다"로 읽혀 폐기했다(사장님: 웹도 부자연스럽다).
/** 폰 전용 — 핀을 쓰지 않는다. 무대(100vh, overflow:hidden)에 세로 내용이 다 안 들어가 잘린다.
 *  ⚠️ 훅을 부모(SceneUnify)에 두면 안 된다. narrow 는 마운트 뒤에 true 가 되므로 첫 렌더에서는
 *     이 분기가 없고, 그때 만들어진 옵저버는 붙을 요소가 없다 — 그 뒤로 다시 만들지 않아
 *     폰에서 연출이 아예 멈춰 있었다(실측). 분기를 컴포넌트로 떼어 마운트 시점에 훅이 돌게 한다.
 *  ⚠️ 폰 무대는 한 화면보다 크다 — 기본 임계값(85%)은 영원히 만족되지 않으므로 낮춘다. */
function UnifyFlat() {
  const stageRef = useRef<HTMLDivElement>(null);
  const winsRef = useRef<HTMLDivElement>(null);
  /* ⚠️ 구간에 발만 걸쳐도 재생되면, 사용자가 창까지 스크롤해 내려왔을 때는 이미 다 합쳐져 있다
        (사장님: "모바일에서는 이미 합쳐져 있어서, 스크롤 내린 이후 합쳐지는 모습이 보여야 한다").
        · 트리거: 창 묶음이 화면 "가운데 밴드"에 들어왔을 때. rootMargin 으로 위 25%·아래 35% 를
          잘라내면, 화면 아래쪽에 살짝 걸친 상태로는 안 걸린다.
        · 그 뒤로도 0.7초를 더 기다린다 — 창 12개를 먼저 보고 나서 닫히기 시작해야 한다. */
  useEffect(() => {
    const stage = stageRef.current, wins = winsRef.current;
    if (!stage || !wins) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stage.classList.add("lp5-play");
      return;
    }
    let t = 0;
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      t = window.setTimeout(() => stage.classList.add("lp5-play"), 700);
    }, { rootMargin: "-25% 0px -35% 0px" });
    io.observe(wins);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);
  return (
    <section id="unify" className="lp5-sect">
      <div ref={stageRef} className="lp5-wrap lp5-uni-flat">
        <UnifyHead />
        <UnifyStage winsRef={winsRef} />
      </div>
    </section>
  );
}

function SceneUnify() {
  const narrow = useNarrow();
  if (narrow) return <UnifyFlat />;
  return (
    <Scene id="unify" len={1.0} playOnView className="lp5-uni">
      {() => (
        <div className="lp5-wrap lp5-uni-in">
          <UnifyHead />
          <UnifyStage />
        </div>
      )}
    </Scene>
  );
}

// ══════════════════ 2.5 공감 — 이런 게 힘드셨죠 ══════════════════
//   ⚠️ 히어로 다음이 바로 "하나로 모여요" 라 방문자가 자기 문제를 확인하는 구간이 없었다.
//      공감 → 해결 순서가 되면 뒤따르는 기능 설명의 설득력이 달라진다 (경쟁사 비교, 2026-07-29).
function PainIcon({ n }: { n: string }) {
  const p = { width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (n === "scatter") return <svg {...p}><rect x="2.5" y="3" width="8" height="6" rx="1.6"/><rect x="13.5" y="6.5" width="8" height="6" rx="1.6"/><rect x="4.5" y="14" width="8" height="6.5" rx="1.6"/></svg>;
  if (n === "sort") return <svg {...p}><path d="M4 6.5h16M6.5 12h11M9.5 17.5h5"/></svg>;
  return <svg {...p}><path d="M3 17.5l5.5-5.5 3.5 3.5L21 6"/><path d="M21 11V6h-5"/></svg>;
}

function ScenePains() {
  return (
    <section className="lp5-sect lp5-sect-tint">
      <div className="lp5-wrap">
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">Before OwnerView</div>
          <h2 className="lp5-h lp5-h-sm">이런 게 <span className="lp5-grad">힘드셨죠</span></h2>
          {/* ⚠️ "대표님들이 실제로 하시는 말이에요" 였다 — 인터뷰 인용이 아니라 우리가 쓴 문장이라
              사실이 아니다(PAINS 주석 참조). 도입 사례를 자사 실측만 실은 것과 같은 기준으로 바꾼다.
              자사가 직접 쓴다는 사실은 아래 도입 사례 구간과도 이어진다. */}
          <Sentences className="lp5-lead" text="저희도 똑같이 겪던 일이에요. 오너뷰는 여기서 시작했어요." />
        </Rise>
        <div className="lp5-pain-grid">
          {PAINS.map((x, i) => (
            <Rise key={x.icon} delay={i * 70} className="lp5-pain">
              <span className="lp5-pain-ico"><PainIcon n={x.icon} /></span>
              <blockquote className="lp5-pain-q">
                {x.quote.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
              </blockquote>
              <Sentences className="lp5-pain-d" text={x.detail} />
              <div className="lp5-pain-a">{x.solve}</div>
            </Rise>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════ 3. 하루 ══════════════════
//   ⚠️ 5구간 → 3구간. 11:00 견적·17:00 입금은 바로 위 기능 그리드와 내용이 겹친다.
//      아침(대시보드) · 낮(인사) · 밤(액션 플랜) 세 장면이면 하루가 충분히 그려진다.
const DAY_3 = DAY.filter((d) => ["09:00", "14:00", "23:00"].includes(d.time));

/** 폰에서 본 하루 — 시간대 한 장이 카드 한 장이 된다(설명 + 그 화면).
 *  ⚠️ 폰에서 이 구간은 핀 고정 장면이었다. 제목·시간·비포/애프터가 한 화면을 다 먹어
 *     폰 화면은 접힌 아래에 있었고, 보려고 스크롤하면 다음 시간대로 넘어가 버렸다(사장님 지적).
 *     스크롤에서 떼어내고 스와이프로 넘기게 한다 — 폰에서는 이게 가장 편하다. */
function DayDeck() {
  return (
    <section id="day" className="lp5-sect">
      <div className="lp5-wrap">
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">Before &amp; After</div>
          <h2 className="lp5-h lp5-h-sm">오너뷰로 <span className="lp5-grad">달라지는 하루를 보여드려요</span></h2>
          <p className="lp5-lead">지금 방식과 오너뷰를 시간대별로 나란히 놨어요.</p>
        </Rise>
      </div>
      <SwipeDeck
        label="시간대별 하루"
        slides={DAY_3.map((d) => (
          <div key={d.time} className="lp5-deck-card">
            <div className="lp5-deck-kick">
              <span className="lp5-deck-time">{d.time}</span>
              <span className="lp5-deck-scene">{d.scene}</span>
            </div>
            <div className="lp5-day-ba">
              <div className="lp5-day-row">
                <span className="lp5-day-tag lp5-day-tag-b">비포</span>
                <span className="lp5-day-b">{d.before}</span>
              </div>
              <div className="lp5-day-row">
                <span className="lp5-day-tag lp5-day-tag-a">애프터</span>
                <span className="lp5-day-a">{d.after}</span>
              </div>
            </div>
            <div className="lp5-deck-shot">
              <Image src={MOBILE_OF[d.src] ?? d.src} alt={d.alt} width={1170} height={2400} sizes="84vw" />
            </div>
          </div>
        ))}
      />
    </section>
  );
}

function SceneDay() {
  const narrow = useNarrow();
  if (narrow) return <DayDeck />;
  // ⚠️ len 은 "시간대 하나 넘기는 데 필요한 스크롤"을 정한다.
  //    고정 이동거리 = (len - 1) × 100vh, 구간당 = 그 값 ÷ 5.
  //    2.4 였을 때 구간당 266px = 휠 2.66칸이라 3·3·3·2 로 들쭉날쭉했다(사장님 지적).
  //    2.0 이면 구간당 190px = 휠 2칸 이내로 균일해진다.
  return (
    <Scene id="day" len={1.6} beats={DAY_3.length} pinMobile className="lp5-day">
      {(beat) => {
        const d = DAY_3[beat];
        return (
          <div className="lp5-wrap">
            {/* ⚠️ v5 로 옮기면서 섹션 후킹 문구가 빠졌었다. 장면이 바뀌어도 "이 섹션이 무슨 말을
                하려는지"는 남아 있어야 한다 — eyebrow 만으로는 전달되지 않는다. */}
            <div className="lp5-sec-head">
              <div className="lp5-eyebrow">Before &amp; After</div>
              <h2 className="lp5-h lp5-h-sm">오너뷰로 <span className="lp5-grad">달라지는 하루를 보여드려요</span></h2>
              {/* ⚠️ "어떻게 달라지는지, 시간대별로 보여드릴게요" 였다 — 제목의 '달라지'·'보여드리'를
                  두 번씩 되풀이해 리드가 아무 정보도 더하지 못했다. 비포/애프터 구조를 설명하게 바꾼다. */}
              <p className="lp5-lead">지금 방식과 오너뷰를 시간대별로 나란히 놨어요.</p>
            </div>
            <div className="lp5-day-grid">
              {/* key 를 붙여 구간이 바뀔 때마다 다시 마운트 → 문구가 툭 갈리지 않고 스르륵 바뀐다 */}
              <div className="lp5-swap" key={d.time}>
                <div className="lp5-day-time">{d.time}</div>
                <div className="lp5-day-scene">{d.scene}</div>
                <div className="lp5-day-ba">
                  <div className="lp5-day-row">
                    <span className="lp5-day-tag lp5-day-tag-b">비포</span>
                    <span className="lp5-day-b">{d.before}</span>
                  </div>
                  <div className="lp5-day-row">
                    <span className="lp5-day-tag lp5-day-tag-a">애프터</span>
                    <span className="lp5-day-a">{d.after}</span>
                  </div>
                </div>
              </div>
              <ShotStack items={DAY_3.map((x) => ({ src: x.src, alt: x.alt }))} active={beat} />
            </div>
            <div className="lp5-day-dots">
              {DAY_3.map((x, i) => <span key={x.time} className={`lp5-day-dot ${i === beat ? "lp5-day-dot-on" : ""}`} />)}
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
function Rail({ cards, tall = false, wide = false, arrows = false, ms = 4600, label = "갤러리" }: {
  cards: ReactNode[]; tall?: boolean; wide?: boolean; arrows?: boolean; ms?: number; label?: string;
}) {
  const n = cards.length;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => setLive(es[0].isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ⚠️ 예전엔 트랙을 transform 으로 밀었다. 그러면 사용자가 직접 넘길 방법이 화살표뿐이라
  //    트랙패드 가로 스크롤·드래그·관성이 전부 죽는다. 애플 갤러리처럼 네이티브 스크롤 +
  //    scroll-snap 으로 바꿨다 — 브라우저가 스냅·관성·접근성을 알아서 처리한다.
  const goTo = (k: number, smooth = true) => {
    const v = viewRef.current; if (!v) return;
    const card = v.firstElementChild?.children[k] as HTMLElement | undefined;
    if (!card) return;
    v.scrollTo({ left: card.offsetLeft - (v.firstElementChild as HTMLElement).offsetLeft, behavior: smooth ? "smooth" : "auto" });
  };
  // 스크롤이 멈추면 가장 가까운 카드를 현재 항목으로 삼는다(직접 스크롤해도 표시가 따라온다)
  useEffect(() => {
    const v = viewRef.current; if (!v) return;
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const kids = [...(v.firstElementChild?.children ?? [])] as HTMLElement[];
        const base = (v.firstElementChild as HTMLElement).offsetLeft;
        let best = 0, bd = Infinity;
        kids.forEach((c, k) => { const d = Math.abs(c.offsetLeft - base - v.scrollLeft); if (d < bd) { bd = d; best = k; } });
        setI(best);
        setPlaying(false);   // 직접 넘기면 자동 재생은 멈춘다
      }, 120);
    };
    v.addEventListener("scroll", onScroll, { passive: true });
    return () => { v.removeEventListener("scroll", onScroll); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (arrows || !playing || !live) return;   // 화살표 모드는 자동 재생하지 않는다
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => { const k = (v + 1) % n; goTo(k); return k; }), ms);
    return () => clearInterval(t);
  }, [arrows, playing, live, n, ms]);

  // 키보드 ← → 로도 넘긴다 (애플 갤러리와 동일)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const k = Math.min(n - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)));
    setI(k); setPlaying(false); goTo(k);
  };
  const move = (k: number) => { const c = Math.min(n - 1, Math.max(0, k)); setI(c); setPlaying(false); goTo(c); };

  return (
    <div ref={ref}>
      <div ref={viewRef} className={`lp5-rail-view ${wide ? "lp5-rail-view-full" : ""}`}
        role="group" aria-roledescription="갤러리" aria-label={label}
        tabIndex={0} onKeyDown={onKeyDown}>
        <ul className={`lp5-rail-track ${tall ? "lp5-rail-tall" : ""} ${wide ? "lp5-rail-wide" : ""}`}
          style={{ ["--n" as string]: n }}>
          {cards.map((c, k) => <li key={k} className="lp5-rail-slot">{c}</li>)}
        </ul>
      </div>
      <div className="lp5-rail-bar">
        {arrows ? (
          // 사장님: "자동 재생이 아니라 화살표로 움직이고" — 읽는 속도를 사용자가 정한다
          <div className="lp5-rail-arrows">
            <button type="button" aria-label={`${label} 내 이전 항목`} disabled={i === 0} onClick={() => move(i - 1)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button type="button" aria-label={`${label} 내 다음 항목`} disabled={i >= n - 1} onClick={() => move(i + 1)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        ) : (
        <div className="lp5-rail-dots">
          {cards.map((_, k) => (
            <button key={k} type="button" onClick={() => move(k)}
              className={`lp5-rail-dot ${k === i ? "lp5-rail-dot-on" : ""}`}
              aria-label={`${label} ${k + 1}번째 항목`} aria-current={k === i} />
          ))}
        </div>)}
        {!arrows && (
        <button type="button" className="lp5-rail-play" onClick={() => setPlaying((v) => !v)}
          aria-label={playing ? "자동 재생 멈춤" : "자동 재생"}>
          {playing
            ? <svg width="13" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>
            : <svg width="13" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4c0 .9 1 1.4 1.7.9l10.7-7.2c.6-.4.6-1.4 0-1.8L8.7 3.9c-.7-.5-1.7 0-1.7.9z"/></svg>}
        </button>)}
        {/* 위치를 소리로도 알린다 — 애플 갤러리와 동일 */}
        <span className="lp5-rail-count" aria-live="polite">{i + 1} / {n}</span>
      </div>
    </div>
  );
}

// ══════════════════ 4. 주요 기능 — 축마다 한 줄 ══════════════════
//   ⚠️ 캐러셀이었다. 넘겨야만 보이는 구조라 스크롤만 하는 방문자에게 19개 중 2~3개만 전달됐다
//      (경쟁사 비교 실측, 2026-07-29). 9개를 전부 펼쳐 스크롤만으로 다 보이게 한다.
//   ⚠️ 처음엔 2열 + 첫 칸 전폭이었다. 화질은 좋았지만 절반짜리가 네 줄 내려가 이 구간 하나가
//      2.17화면을 먹었다(사장님: "9개가 길어지다 보니 페이지가 엄청 길어진다").
//      → 축마다 한 줄(3열)로 바꿔 1.27화면. 줄마다 넓은 칸의 자리가 왼쪽→가운데→오른쪽으로
//      옮겨 다녀(wide = j === r) 눈이 지그재그로 따라가고, 세 축 구조가 배치로 읽힌다.
//   ⚠️ 3열이면 좁은 칸이 323px 이라 화면을 칸 폭에 맞춰 "줄이면" 0.33배로 뭉개진다.
//      그래서 아홉 칸 모두 화면을 줄이지 않고 "잘라서" 넣는다 — 이미지 CSS 폭을 640px 로
//      못박고 칸이 잘라내게 한다(landing-v6.css). 넓은 칸은 92%, 좁은 칸은 50% 가 보이고
//      글자 크기는 아홉 장이 전부 같다(앱의 0.65배 — 개편 전 벤토와 같은 값).
//   ⚠️ 넓은 칸만 화면 전체를 넣어 봤더니 0.60배로 그려져 좁은 칸(0.68배)보다 글자가 작았다.
//      크기 위계가 뒤집혀 보이므로 배율은 반드시 아홉 칸을 하나로 맞춘다.
const AXIS_COLOR: Record<string, string> = {
  "프로젝트": "#5B4BE8", "회계": "#2F6FED", "인사": "#0E8F6F",
};

/** 폰에서만 보이는 "옆으로 넘겨보세요" 안내. 넓은 화면에선 CSS 가 숨긴다. */
const SwipeHint = ({ n }: { n: number }) => (
  <div className="lp5-swipe-hint" aria-hidden>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    옆으로 넘겨서 {n}개 다 보기
  </div>
);

/** 폰에서 본 주요 기능 — 축마다 레일 3개(도트 없음)를 카드 한 벌로 합친다.
 *  ⚠️ 폰에서 이 구간이 1.82화면이었고, 축 세 줄을 각각 따로 넘겨야 했다. 어디까지 봤는지
 *     알려주는 표시도 없었다(사장님: 모바일 통일). 조작을 하루·자리에 없어도·AI 와 하나로 맞춘다.
 *  ⚠️ 화면 칸은 폰 크롬을 씌우지 않는다 — 여기 캡처는 데스크톱 화면이라 폰 목업에 넣으면 거짓이다. */
function AxesDeck() {
  const cards = PILLARS.flatMap((P) =>
    P.blocks.map((b) => (
      <div key={`${P.kicker}-${b.tab}`} className="lp5-deck-card">
        <div className="lp5-deck-kick">
          <span className="lp5-axtag-dot" style={{ background: AXIS_COLOR[P.kicker] ?? "#5B4BE8" }} />
          <span className="lp5-deck-n">{P.kicker} · {b.tab}</span>
        </div>
        <b className="lp5-deck-head">{b.title}</b>
        <p className="lp5-deck-desc">
          {b.desc.split(/\.\s+/).filter(Boolean).map((l, j, a) => (
            <span key={j}>{j < a.length - 1 ? `${l}.` : l}</span>
          ))}
        </p>
        <div className="lp5-deck-shot-flat">
          <Image src={CORE_SHOT[b.src] ?? b.src} alt={b.alt} width={1968} height={984} sizes="580px" />
        </div>
      </div>
    )),
  );
  return (
    <section id="pillars" className="lp5-sect">
      <div className="lp5-wrap">
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">Core</div>
          <h2 className="lp5-h lp5-h-sm">일은 줄이고, <span className="lp5-grad">효율과 성과는 높여요</span></h2>
          <p className="lp5-lead">프로젝트·회계·인사가 하나의 데이터 위에서 같이 움직여요.</p>
        </Rise>
      </div>
      <SwipeDeck label="주요 기능" slides={cards} ms={5600} />
    </section>
  );
}

function SceneAxes() {
  const narrow = useNarrow();
  if (narrow) return <AxesDeck />;
  return (
    <section id="pillars" className="lp5-sect">
      <div className="lp5-wrap">
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">Core</div>
          <h2 className="lp5-h lp5-h-sm">일은 줄이고, <span className="lp5-grad">효율과 성과는 높여요</span></h2>
          {/* ⚠️ "회사 운영의 세 축이…" 였다 — 히어로("회사 운영의 모든 것")·마무리와 '회사 운영'이
              세 번 겹쳐 들렸다. 축 이름을 직접 부르면 아래 카드 kicker(프로젝트·회계·인사)와도 맞는다. */}
          <p className="lp5-lead">프로젝트·회계·인사가 하나의 데이터 위에서 같이 움직여요.</p>
        </Rise>

        <div className="lp5-axrows">
          {PILLARS.map((P, r) => (
            <Rise key={P.kicker} delay={r * 70}>
              <div className="lp5-axtag">
                <span className="lp5-axtag-dot" style={{ background: AXIS_COLOR[P.kicker] ?? "#5B4BE8" }} />
                <b>{P.kicker}</b>
                <i />
              </div>
              <div className={`lp5-axrow lp5-axrow-${r + 1} lp5-swipe`}>
                {P.blocks.map((b, j) => {
                  const wide = j === r;
                  return (
                    <div key={b.tab} className={`lp5-bt ${wide ? "" : "lp5-bt-sm"}`}>
                      <div className="lp5-bt-copy">
                        <span className="lp5-bt-kick">{P.kicker} · {b.tab}</span>
                        <h3 className="lp5-bt-title">{b.title}</h3>
                        <Sentences className="lp5-bt-desc" text={b.desc} />
                      </div>
                      {/* ⚠️ sizes 는 "칸 폭"이 아니라 "화면이 그려지는 폭"으로 준다.
                          잘라 넣기 때문에 칸이 좁아도 이미지는 640px 로 그려진다 —
                          칸 폭으로 주면 750px 짜리가 내려와 잘린 화면이 흐려진다(실측). */}
                      <div className="lp5-bt-shot">
                        <Image src={CORE_SHOT[b.src] ?? b.src} alt={b.alt} width={1968} height={984}
                          sizes="(max-width: 720px) 580px, 660px" />
                      </div>
                    </div>
                  );
                })}
              </div>
              <SwipeHint n={P.blocks.length} />
            </Rise>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════ 5. AI — 데모 카드 6장(1열 캐러셀) + 자동화 목록 ══════════════════
//   ⚠️ 정지 캡처 4장이었다(a-*.png). 화면만 보여주니 "그래서 뭐가 자동인지"가 안 보였다.
//      사장님: "애플 인텔리전스처럼 1열로 화면 꽉 차게, 기능이 일하는 모습을 예시로."
//      → 기능이 일하는 모습을 코드로 그려 재생한다(ai-demo-rail.tsx). 영상 파일이 아니다.
//   ⚠️ 카드 6장의 kind 는 정직하게 쓴다 — 모델이 판단하는 4개만 "AI 판단",
//      현금 예측·계약 초안은 "자동 처리"(계산·서식 치환이므로 AI라고 말하지 않는다).
//   레일은 화면 폭을 꽉 써야 해서 lp5-wrap 밖에 둔다.
function SceneAI() {
  return (
    <section id="engines" className="lp5-sect lp5-sect-dark">
      <div className="lp5-eng-bg" />
      <div className="lp5-wrap lp5-eng-layer">
        <Rise className="lp5-sec-head">
          <div className="lp5-eyebrow">AI Automation</div>
          <h2 className="lp5-h lp5-h-sm lp5-eng-h">반복되던 일,<br /><span className="lp5-grad">이제 AI 몫이에요</span></h2>
          {/* ⚠️ 뒤 문장이 "엔진 4개와 자동화 6가지가 나눠서 맡아요" 였다 — 바로 아래 목록 제목
              ("여기에 자동화 6가지가 더 붙어요")과 같은 숫자를 두 번 말했다. 구성 설명 대신
              "어디까지 AI가 하고 어디부터 사람이 하는지"를 말하게 바꾼다. */}
          <Sentences className="lp5-lead"
            text="사람을 대체하는 게 아니에요. 매번 되풀이되는 일을 AI가 먼저 해두고, 판단이 필요한 것만 남겨요." />
        </Rise>
      </div>

      {/* ⚠️ 아래에 "이 밖에도 AI가 알아서 하는 일 3가지" 목록 박스와 "자동화 전체 보기" 버튼이 있었다.
          사장님: (1) 그 3가지도 카드로 넣자 → 07~09 카드로 승격,
                  (2) 위에서 다 설명하는데 전체 보기 버튼이 필요하냐 → 삭제,
                  (3) 검정 박스 위 설명 글씨가 잘 안 보인다 → 박스 자체를 없애 해결.
          ⚠️ 버튼 글씨가 안 보인 건 스타일 버그이기도 했다 — .lp5-btn-ghost 는 .lp5-scene-dark
             에서만 흰 글씨가 되고 이 구간은 .lp5-sect-dark 라 어두운 글씨가 그대로 나왔다.
          /ai 페이지는 상단 메뉴(AI 자동화 메가메뉴)에서 계속 들어갈 수 있다. */}
      <div className="lp5-eng-layer">
        <AiDemoRail />
      </div>
    </section>
  );
}

// ══════════════════ 6. 커버리지 — 실제 사이드바 그룹 그대로 ══════════════════
//   ⚠️ 그룹·메뉴 수는 CATALOG 에서 파생한다. 숫자를 손으로 적지 말 것 —
//      2026-08-20 감사에서 "메뉴 18개/20개·네 영역·기능 30가지"가 전부 실제(7그룹 34메뉴)와 어긋나 있었다.
const GROUP_COLOR: Record<string, string> = {
  "홈": "#5B4BE8", "파이낸스": "#2F6FED", "분석": "#0E8F6F", "워크스페이스": "#7C3AED",
  "인사관리": "#E08422", "회사 관리": "#0F766E", "도움말": "#64748B",
};

function SceneCoverage() {
  const total = CATALOG.reduce((n, g) => n + g.menus.length, 0);
  return (
    <section id="more" className="lp5-sect">
      <div className="lp5-wrap">
        <Rise className="lp5-sec-head lp5-sec-head-c">
          <div className="lp5-eyebrow">Coverage</div>
          {/* ⚠️ 제목이 "회사 운영, 오직 오너뷰 안에서" 였다 — 히어로·마무리와 '회사 운영'이 겹쳤고,
              사장님이 원한 건 "이 밖에도 많다"는 이야기였다(그래서 리드가 '이게 다가 아니에요').
              제목도 같은 방향으로 옮기고, 리드는 아래 네 카드를 직접 가리키게 한다. */}
          <h2 className="lp5-h lp5-h-sm">필요한 기능은 <span className="lp5-grad">이미 다 들어 있어요</span></h2>
          <Sentences className="lp5-lead lp5-lead-c"
            text={`이게 다가 아니에요. 아래 ${CATALOG.length}개 영역에 메뉴 ${total}개가 들어 있어요. 앱을 더 쓰지 않아도 돼요.`} />
        </Rise>
        <div className="lp5-cov4 lp5-swipe">
          {CATALOG.map((g, i) => (
            <Rise key={g.key} delay={i * 60} className="lp5-covg">
              {/* ⚠️ 카드 맨 위에 색 띠를 가로로 깔았었다 — 사장님: "박스 윗줄이 디자인적으로 별로".
                  구성은 그대로 두고 색만 이름 옆 점으로 옮긴다(코어의 축 라벨과 같은 방식). */}
              <div className="lp5-covg-name">
                <span className="lp5-covg-dot" style={{ background: GROUP_COLOR[g.group] ?? "#5B4BE8" }} />
                {g.group}
              </div>
              <Sentences className="lp5-covg-lead" text={g.lead} />
              <ul className="lp5-covg-list">
                {g.menus.map((m) => <li key={m.name}>{m.name}</li>)}
              </ul>
            </Rise>
          ))}
        </div>
        <SwipeHint n={CATALOG.length} />
        <div className="lp5-cov-more">
          {/* ⚠️ CTA 이름 정리 — "자세히 보기"가 여기와 요금제 두 곳에 있어 뭐가 다른지 알 수 없었다.
              목적지가 다르면 이름도 달라야 한다: 목록은 "전부 보기", 요금제는 "비교하기". */}
          <Link href="/features" className="lp5-btn lp5-btn-ghost">메뉴 {total}개 전부 보기 <Arrow /></Link>
        </div>
      </div>
    </section>
  );
}

// ══════════════════ 6.5 신뢰 — 도입 사례 + 가격 미리보기 ══════════════════
//   ⚠️ CASES 는 프로덕션 실측 스냅샷이다. "세금계산서 자동 수집"은 발행분이 아니므로
//      라벨을 바꾸면 거짓이 된다(content.ts 주석 참조).
//   ⚠️ 가격을 못 찾아 이탈하는 게 흔한 누수다. 메뉴에만 두지 않고 본문에 미리보기를 둔다.
function SceneProof() {
  const c = CASES[0];
  const shown = PLANS.filter((p) => p.slug || p.price === "0").slice(0, 3);
  return (
    <section className="lp5-sect lp5-sect-tint">
      <div className="lp5-wrap">
        <div className="lp5-proof">
          <Rise className="lp5-case">
            <div className="lp5-eyebrow">In Use</div>
            {/* ⚠️ "만든 회사가 매일 씁니다" 였다 — 페이지에서 유일하게 남은 격식체라 톤이 튀었고,
                사장님이 직접 "만든 회사도 직접 쓰고 있어요" 로 제안. 해요체 규칙과도 맞는다. */}
            <h3 className="lp5-case-h">만든 회사도 직접 쓰고 있어요</h3>
            <Sentences className="lp5-case-note" text={c.note} />
            <div className="lp5-case-nums">
              {c.metrics.map((m) => (
                <div key={m.label}><b>{m.value}</b><span>{m.label}</span></div>
              ))}
            </div>
            <span className="lp5-case-foot">{[c.masked, c.industry, c.plan].filter(Boolean).join(" · ")}<br />{CASES_NOTE}</span>
          </Rise>

          <Rise delay={90} className="lp5-price">
            <div className="lp5-eyebrow">Pricing</div>
            {/* ⚠️ 처음엔 "인원이 늘어도 그대로예요" 였는데 사실이 아니라(기본 5명 포함, 6명째부터
                1인당 ₩10,000/월) "5명까지는 이 가격 그대로예요" 로 고쳤었다. 그랬더니 이번엔
                사장님: "5명이 강조되면 가입률이 떨어진다. 팩트는 좋지만 가입을 망설이게 하는 건
                여기서 굳이 앞세우지 말고, 회사 규모·일하는 방식에 맞춰 고른다는 느낌으로."
                → 거짓말은 하지 않되 인원 조건을 제목에서 내리고, 정확한 조건은 요금제로 보낸다.
                  (지금 문구는 "그대로" 같은 약속을 하지 않으므로 조건을 숨겨도 오해가 안 생긴다)
                ⚠️ "회사 규모" 도 뺐다(2026-07-30) — 규모는 곧 인원이고, 인원은 곧 비용이라
                   읽혀 같은 망설임을 만든다. "일하는 방식에 맞게" 는 사장님이 좋다고 한 표현이라 남긴다. */}
            <h3 className="lp5-case-h">필요한 만큼, 일하는 방식에 맞게</h3>
            <div className="lp5-price-rows">
              {shown.map((p) => (
                <div key={p.name} className={`lp5-price-row ${p.hl ? "lp5-price-hl" : ""}`}>
                  <div>
                    <b>{p.name}</b>
                    <span>{p.desc}</span>
                  </div>
                  {/* 정가가 없는 요금제(울트라)는 ₩·/월 을 붙이지 않는다 — "₩비용 협의 /월" 이 된다. */}
                  <div className="lp5-price-amt">
                    {p.price === "0" ? <em>0원</em> : p.price.includes("협의") ? <em>{p.price}</em> : <em>₩{p.price}</em>}
                    <span>{p.price === "0" || p.price.includes("협의") ? "" : "/월"}</span>
                  </div>
                </div>
              ))}
            </div>
            <span className="lp5-price-note">VAT 별도 · 인원과 발행 건수 조건은 요금제에서 확인하세요.</span>
            <Link href="/pricing" className="lp5-btn lp5-btn-ghost">요금제 비교하기 <Arrow /></Link>
          </Rise>
        </div>
      </div>
    </section>
  );
}

// ══════════════════ 7. 자리에 없어도 — 결재·승인 ══════════════════
//   ⚠️ "회사 밖에서도 PC에서 보던 화면 그대로" 였다. 사장님: "위쪽 분위기랑 동떨어진다."
//      그건 반응형이 된다는 기술 얘기라 혼자만 층위가 달랐다 → 밖에서 실제로 멈추는 건
//      화면이 아니라 결정이다. 결재·승인으로 다시 잡았다(content.ts MOBILE 주석 참조).
//   ⚠️ 시각 언어도 주변에 맞춘다. 핀 고정 장면(Scene)을 걷어내고 다른 구간과 같은
//      "틴트 섹션 + 가운데 제목 + 카드" 로 바꾼다 — 이 구간만 무대처럼 떠 있어 더 붕 떴다.
//   여긴 스크롤이 아니라 시간으로 넘어간다 — 폰 화면은 가만히 두고 봐도 돌아가야 한다.
function SceneMobile() {
  const narrow = useNarrow();
  const [i, setI] = useState(0);
  // 한 번이라도 손을 대면 자동 넘김을 멈춘다.
  //   ⚠️ 자동으로만 넘어가면 지나간 단계를 다시 볼 방법이 없다(사장님 지적).
  //      스와이프·점 클릭으로 앞뒤로 오갈 수 있게 하고, 그때부터는 사용자가 속도를 정한다.
  const [manual, setManual] = useState(false);
  const n = MOBILE.steps.length;
  useEffect(() => {
    if (manual || narrow) return;      // 폰은 아래 SwipeDeck 이 따로 돈다
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 3600);
    return () => clearInterval(t);
  }, [manual, n, narrow]);

  const go = (k: number) => { setManual(true); setI(Math.min(n - 1, Math.max(0, k))); };
  // 손가락으로 넘기기 — 세로 스크롤은 막지 않는다(가로 이동이 더 클 때만 넘김으로 친다)
  const touch = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, locked: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current; if (!t || t.locked) return;
    const dx = e.touches[0].clientX - t.x, dy = e.touches[0].clientY - t.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    t.locked = true;
    go(i + (dx < 0 ? 1 : -1));
  };
  const onTouchEnd = () => { touch.current = null; };

  const head = (
    <Rise className="lp5-sec-head lp5-sec-head-c">
      <div className="lp5-eyebrow">{MOBILE.eyebrow}</div>
      <h2 className="lp5-h lp5-h-sm">
        {MOBILE.title.split("\n").map((l, k) => <span key={k}>{l}<br /></span>)}
      </h2>
      <Sentences className="lp5-lead lp5-lead-c" text={MOBILE.sub} />
    </Rise>
  );

  /* ⚠️ 폰에서는 목업 한 대와 설명 네 줄이 따로 놀아, 지금 보이는 화면이 어느 설명인지
        맞춰가며 봐야 했다(사장님 지적). 한 카드에 설명과 그 화면을 같이 넣고 스와이프로 넘긴다. */
  if (narrow) {
    return (
      <section id="mobile" className="lp5-sect lp5-sect-tint">
        <div className="lp5-wrap">{head}</div>
        <SwipeDeck
          label="폰으로 오는 일"
          slides={MOBILE.steps.map((st, k) => (
            <div key={st.src} className="lp5-deck-card">
              <div className="lp5-deck-kick">
                <span className="lp5-deck-n">{String(k + 1).padStart(2, "0")}</span>
                <b className="lp5-deck-head">{st.head} <em>{st.muted}</em></b>
              </div>
              <p className="lp5-deck-desc">
                {st.desc.split("\n").map((l, j) => <span key={j}>{l}</span>)}
              </p>
              <div className="lp5-deck-shot">
                <Image src={st.src} alt={st.alt} width={1170} height={2400} sizes="84vw" />
              </div>
            </div>
          ))}
        />
      </section>
    );
  }

  return (
    <section id="mobile" className="lp5-sect lp5-sect-tint">
      <div className="lp5-wrap">
        {head}

        <Rise className="lp5-move" delay={80}>
          <div className="lp5-move-phone" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            <div className="lp5-phone">
              <div className="lp5-phone-notch" />
              {MOBILE.steps.map((st, k) => (
                <Image key={st.src} src={st.src} alt={st.alt} width={1170} height={2400}
                  sizes="(max-width: 720px) 62vw, 320px" className={k === i ? "lp5-phone-on" : ""} />
              ))}
            </div>
          </div>

          {/* 폰으로 오는 것들을 목록으로 세워 둔다 — 지금 보이는 화면이 어느 항목인지 표시.
              한 장씩 자동으로 넘어가지만, 누르면 그때부터 사용자가 고른다. */}
          <ul className="lp5-move-list">
            {MOBILE.steps.map((st, k) => (
              <li key={st.src}>
                <button type="button" onClick={() => go(k)} aria-current={k === i}
                  className={`lp5-move-item ${k === i ? "lp5-move-item-on" : ""}`}>
                  <span className="lp5-move-n">{String(k + 1).padStart(2, "0")}</span>
                  <span className="lp5-move-tx">
                    <b>{st.head} <em>{st.muted}</em></b>
                    {st.desc.split("\n").map((l, j) => <span key={j}>{l}<br /></span>)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Rise>
      </div>
    </section>
  );
}

// ══════════════════ 8. 마무리 ══════════════════
function SceneEnd() {
  return (
    <Scene len={1.0} tone="dark" className="lp5-end">
      {() => (
        <>
          <div className="lp5-end-bg" />
          <div className="lp5-wrap lp5-end-in">
            {/* ⚠️ "회사 운영, 오늘부터 달라져요" 였다 — 히어로·커버리지와 '회사 운영'이 세 번 겹쳤다.
                바로 위 하루 구간이 09:00 로 시작하므로 "내일 아침"으로 받으면 그 장면과 이어진다. */}
            <Rise as="h2" className="lp5-h">내일 아침부터 <span className="lp5-grad">달라져요</span></Rise>
            <Rise delay={90}>
              {/* ⚠️ "가입하면 바로 씁니다" — 페이지에서 유일한 격식체라 톤이 튀었다(content.ts 규칙). */}
              <p className="lp5-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                가입하고 계좌만 연결하면 끝이에요. 구축도, 교육도 없어요.
              </p>
            </Rise>
            <Rise delay={170}>
              {/* ⚠️ 두 번째 버튼이 "가격 보기"(/pricing) 였다 — 바로 앞 구간의 "요금제 비교하기"와
                  목적지가 같아 같은 걸 두 번 권하는 꼴이었다. 마지막은 "시작 / 물어보기" 두 갈래로 나눈다. */}
              <div className="lp5-hero-cta">
                <Link href="/auth" className="lp5-btn lp5-btn-brand">무료로 시작하기 <Arrow /></Link>
                <Link href="/#partner" className="lp5-btn lp5-btn-ghost">도입 상담하기</Link>
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
      <ScenePains />
      <SceneUnify />
      <SceneAxes />
      <SceneAI />
      <SceneCoverage />
      {/* 사장님: "오너뷰로 하루가 이렇게 달라져요를 모바일 위로" —
          기능을 다 보여준 뒤 "그래서 하루가 이렇게 바뀐다"로 받고, 바로 "밖에서도 된다"로 잇는다 */}
      <SceneDay />
      <SceneMobile />
      {/* ⚠️ 사례·가격을 커버리지 뒤에 뒀더니 "증거·결정"이 "설명"을 앞질렀다.
          가격을 본 사람이 다시 기능 설명으로 되돌아가면 결정이 흐려진다.
          기(제품) → 승(문제) → 전(해결·범위·하루·어디서든) → 결(증거·가격 → 시작) 순으로 되돌린다. */}
      <SceneProof />
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
          {/* 무료 도구 — 검색 유입용 계산기 4종 내부 링크 (2026-08-13 사장님) */}
          <div className="lp4-footer-tools">
            <span className="lp4-footer-tools-label">무료 도구</span>
            <div className="lp4-flinks">
              <Link href="/tools/leave-calculator">연차 계산기</Link>
              <Link href="/tools/severance-calculator">퇴직금 계산기</Link>
              <Link href="/tools/insurance-calculator">4대보험 계산기</Link>
              <Link href="/tools/salary-calculator">실수령액 계산기</Link>
            </div>
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
