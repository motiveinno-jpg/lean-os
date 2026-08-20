"use client";

// 데모 체험 (/demo) — 랜딩 히어로의 "데모 보기"로 들어온다.
//
// 2026-08-20 전면 재작성. 왜 바꿨나:
//   예전 데모는 앱 화면을 손으로 흉내 낸 목업 4,000줄이었다. 앱이 바뀔 때마다 같이 고쳐야 하는데
//   실제로는 안 고쳐져서, 사이드바는 1단 구버전 · 메뉴에는 없어진 '거래 장부/전표입력' ·
//   대시보드는 런웨이/번레이트 시절 위젯을 보여주고 있었다(사장님 지적).
//   목업은 원리상 계속 어긋난다 → 사이드바만 진짜로 만들고, 본문은 **실제 앱 화면 캡처**를 띄운다.
//
// 구조: 아이콘 레일(그룹 7개) + 메뉴 패널 + 본문(그 메뉴의 실제 화면).
//   ⚠️ 메뉴 목록·아이콘·화면 이미지는 전부 landing/content.ts 의 CATALOG 하나에서 온다.
//      사이드바가 바뀌면 CATALOG 만 고치면 랜딩·둘러보기·데모가 함께 따라온다.
//   ⚠️ 본문 캡처(f-*.png)는 "브레드크럼 헤더 + 본문" 구도라 왼쪽에 사이드바를 붙이면
//      실제 앱 화면이 그대로 이어진다. 그래서 데모는 자체 헤더를 그리지 않는다.
//      다시 찍는 법: deliverables/landing-capture/README.md

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { CATALOG } from "@/components/landing/content";
import { MenuGlyph } from "@/components/landing/features-view";

const DEMO_USER = "김대표";

/** 레일에 쓰는 짧은 이름 — 실제 사이드바 NAV_GROUPS 의 short 와 같게. */
const SHORT: Record<string, string> = {
  "홈": "홈", "파이낸스": "파이낸스", "분석": "분석", "워크스페이스": "워크",
  "인사관리": "인사", "회사 관리": "회사", "도움말": "도움말",
};
/** 그룹 아이콘 — 실제 사이드바 그룹 아이콘과 같은 모양을 CATALOG 아이콘 이름으로 고른다. */
const GROUP_ICON: Record<string, string> = {
  "홈": "chart", "파이낸스": "wallet", "분석": "trend", "워크스페이스": "briefcase",
  "인사관리": "user", "회사 관리": "sheet", "도움말": "book",
};

const Glyph = ({ d, w = 16 }: { d: string; w?: number }) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const Mark = () => (
  <span className="demo2-mark">
    <svg width="19" height="19" viewBox="0 0 40 40" fill="none">
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.6" />
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <polyline points="12,20 15,18 18,19 22,14" stroke="#93c5fd" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

export default function DemoPage() {
  // 레일에서 고른 그룹(메뉴 목록이 바뀜)과, 본문에 띄운 메뉴는 따로 둔다 —
  //   실제 앱도 그룹을 훑어보는 동안 본문은 그대로 있는다.
  const [railIdx, setRailIdx] = useState(0);
  const [pick, setPick] = useState({ g: 0, m: 0 });
  const group = CATALOG[railIdx];
  const shown = CATALOG[pick.g].menus[pick.m];

  return (
    <div className="demo-root">
      <div className="demo-banner">
        데모 모드입니다. 실제 화면을 그대로 보여드려요 — 내 회사 데이터로 쓰시려면{" "}
        <Link href="/auth" className="underline font-bold">무료로 시작하기</Link> 를 눌러주세요.
      </div>

      <div className="demo2-shell">
        {/* ── 아이콘 레일 — 그룹 7개 ── */}
        <aside className="demo2-rail chrome-glass">
          <Mark />
          <div className="demo2-rail-list">
            {CATALOG.map((g, i) => (
              <button key={g.key} type="button" onClick={() => setRailIdx(i)}
                className={`demo2-rail-item ${i === railIdx ? "is-on" : ""}`}>
                <MenuGlyph n={GROUP_ICON[g.group] || "chart"} />
                <span>{SHORT[g.group] || g.group}</span>
              </button>
            ))}
          </div>
          <div className="demo2-rail-foot">
            <Glyph d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
            <Glyph d="M15 18l-6-6 6-6" />
            <Glyph d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </div>
        </aside>

        {/* ── 메뉴 패널 ── */}
        <aside className="demo2-panel chrome-glass">
          <div className="demo2-brand">
            <div className="demo2-brand-txt">
              <b>OwnerView</b>
              <span>{DEMO_USER} <i className="demo2-badge">마스터</i></span>
            </div>
            <span className="demo2-clock">출근</span>
          </div>
          <div className="demo2-search">
            <Glyph d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5" w={14} />
            <span>검색</span><kbd>⌘K</kbd>
          </div>
          <div className="demo2-grp">
            <span>{group.group}</span><small>{group.menus.length}</small>
          </div>
          <nav className="demo2-menu">
            {group.menus.map((m, i) => {
              const on = pick.g === railIdx && pick.m === i;
              return (
                <button key={m.name} type="button"
                  onClick={() => { setPick({ g: railIdx, m: i }); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className={`demo2-menu-item ${on ? "is-on" : ""}`}>
                  <MenuGlyph n={m.icon} />
                  <span>{m.name}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── 본문 — 고른 메뉴의 실제 화면 ── */}
        <main className="demo2-main">
          {/* 모바일 — 레일·패널이 숨겨지므로 여기서 그룹·메뉴를 고른다(가로 스크롤 칩). */}
          <div className="demo2-mnav md:hidden">
            <div className="demo2-mnav-row">
              {CATALOG.map((g, i) => (
                <button key={g.key} type="button" onClick={() => setRailIdx(i)}
                  className={`demo2-mchip ${i === railIdx ? "is-on" : ""}`}>{SHORT[g.group] || g.group}</button>
              ))}
            </div>
            <div className="demo2-mnav-row demo2-mnav-sub">
              {group.menus.map((m, i) => (
                <button key={m.name} type="button"
                  onClick={() => setPick({ g: railIdx, m: i })}
                  className={`demo2-mchip ${pick.g === railIdx && pick.m === i ? "is-on" : ""}`}>{m.name}</button>
              ))}
            </div>
          </div>
          <div className="demo2-shot">
            {/* 캡처마다 세로 길이가 달라 높이를 고정하지 않는다(잘리면 화면을 오해한다). */}
            <Image key={shown.src} src={shown.src} alt={shown.alt} width={2288} height={1432}
              sizes="(max-width: 1100px) 96vw, 1180px" priority />
          </div>
          <div className="demo2-cap">
            {/* ⚠️ 레일에서 고른 그룹(group)이 아니라 '지금 보고 있는 화면'의 그룹을 적는다 —
                그룹만 훑어볼 때 "파이낸스 › 대시보드" 처럼 어긋난다. */}
            <div className="demo2-cap-t">{CATALOG[pick.g].group} › {shown.name}</div>
            <p>{shown.desc}</p>
            <div className="demo2-cap-items">
              {shown.items.map((it) => <span key={it}>{it}</span>)}
            </div>
          </div>
        </main>
      </div>

      {/* 버튼은 globals.css 의 공용 클래스로 — 랜딩 전용 lp5-btn 은 landing-v5/v6.css 에 있어
          /demo 에서는 로드되지 않아 스타일이 안 먹는다(2026-08-20 실측). */}
      <div className="demo2-foot">
        <Link href="/" className="btn-secondary no-underline">랜딩 페이지로 돌아가기</Link>
        <Link href="/auth" className="btn-primary no-underline">무료로 시작하기</Link>
      </div>
    </div>
  );
}
