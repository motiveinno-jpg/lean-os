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
import Link from "next/link";
import "@/app/landing-v8.css";
import "@/app/landing-v9.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { TOPICS } from "@/components/landing-v8/content";
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
      <div className="lp8">
        {/* 관련 검색어 — v8 홈에 있던 내부 링크 27개(결정 224~226). v9 로 바꾸며 빠졌던 것을 되살림(2026-09-15).
            문구·주소는 content.ts TOPICS 단일 출처, 모양은 landing-v8.css 의 .topics 그대로 */}
        {/* 2026-09-15 사장님: "남기되 잘 안 보일 정도로 작게, 지금 디자인은 깨지 않게" — 숨기지는 않는다(검색엔진이 읽어야 함) */}
        <section className="lp9-topics" id="topics">
          <div className="container">
            <h4 className="lp8-topics-h">오너뷰로 대신할 수 있는 것</h4>
            <div className="topics">
              {TOPICS.map(([t, href]) => <Link key={t} href={href}>{t}</Link>)}
            </div>
          </div>
        </section>
        <SiteFooter />
      </div>
    </div>
  );
}
