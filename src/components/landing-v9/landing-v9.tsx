"use client";
// ══════════════════════════════════════════════════════════════
//  오너뷰 랜딩 v9 — 토스식 장면 랜딩 (2026-09-15 대표 확정)
//  목업 4(아티팩트 4fa10ad8)를 그대로 운영으로. 대표: "좋아 시작하자."
//
//  ▸ 본문 마크업은 sections.ts, 장면 움직임은 engine.js, 스타일은 app/landing-v9.css(.lp9m 안에 갇힘).
//  ▸ 머리·바닥은 공개 페이지 공용 site-shell(결정 227) — 스타일이 .lp8 에 걸려 있어 그 껍데기로 감싼다.
//  ▸ 자바스크립트가 죽어도 글은 보인다: 떠오르기(.rv.wait)는 엔진이 화면 밖 요소에만 붙인다.
//  ▸ 화면 속 숫자·거래처는 전부 가상 예시(결정 220).
// ══════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import "@/app/landing-v8.css";
import "@/app/landing-v9.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { LANDING_V9_HTML } from "./sections";
import { startLanding } from "./engine";

export default function LandingV9() {
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const stop = startLanding();
    return () => {
      stop();
      // 엔진이 붙인 조각(날아가는 칩 등)을 걷어 낸다 — 다시 붙을 때 두 벌이 되지 않게
      el.innerHTML = LANDING_V9_HTML;
    };
  }, []);

  return (
    <div className="lp9">
      <div className="lp9-head">
        <div className="lp8"><SiteHeader /></div>
      </div>
      {/* eslint-disable-next-line react/no-danger */}
      <main id="top" className="lp9m" ref={main} dangerouslySetInnerHTML={{ __html: LANDING_V9_HTML }} />
      <div className="lp8"><SiteFooter /></div>
    </div>
  );
}
