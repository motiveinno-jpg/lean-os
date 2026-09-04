"use client";

// ══ OwnerView 랜딩 v7 (2026-09-04) ══
//   기획: docs/20260904_PLAN_landing_v7_odoo_benchmark.md (결정 174~194)
//   ▸ 문구·데이터는 content.ts 단일 출처. 정지 스타일은 landing-v7.css(lp7-).
//   ▸ 움직임은 전부 GSAP + ScrollTrigger. 구간마다 **다른 효과 하나씩** (결정 191 — 같은 효과 반복 금지).
//
//   모션 규칙 (motion-design 스킬 · Corporate 아키타입):
//     · 서명 이징  : 등장 power3.out / 화면 안 power2.inOut / 튀는 것 back.out(1.6~2)
//     · 길이 팔레트: 빠름 .25s · 표준 .5s · 느림 .9s  (히어로 시퀀스 총합 2.4s 이내)
//     · 세 층      : 주(주인공) + 보조(그림자·아이콘) + 배경(빛·격자) 를 항상 같이 둔다
//     · 1/3 규칙   : 한 번에 움직이는 요소는 전체의 1/3 이하, 스태거 총합 500ms 이내
//   성능 (gsap-performance):
//     · transform·opacity 만 움직인다. width/top/left 는 쓰지 않는다(커서도 x/y 로 계산).
//     · 반복 타임라인은 화면 밖이면 pause — ScrollTrigger onToggle 로 껐다 켠다.
//   접근성 (gsap-core matchMedia):
//     · prefers-reduced-motion 이면 반복·등장 모두 만들지 않고 최종 상태로 둔다.
//   정리 (gsap-react):
//     · useGSAP({ scope }) 가 언마운트 때 전부 revert 한다. 셀렉터는 scope 안으로 제한된다.

import Link from "next/link";
import Image from "next/image";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import "@/app/landing-v7.css";
import {
  HERO, HERO_VIDEO_SRC, HERO_SCENES, SECTION_HEAD, SECTIONS,
  FLOW, STEPS, PRICING, TOOLS, TRUST, CTA, NAV, FOOTER,
} from "@/components/landing-v7/content";

// GSAP 은 브라우저에서만 돈다 — SSR 중에는 등록하지 않는다.
if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger);

/* ── 작은 부품 ───────────────────────────────────────────── */
const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const CheckPath = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12l5 5 11-11" />
  </svg>
);
const Logo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />
  </svg>
);
const FlowArrow = () => (
  <svg width="70" height="24" viewBox="0 0 70 24" fill="none" stroke="#c7c7d1" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path className="lp7-arrow-dash" d="M4 12h56" />
    <path d="M54 5l8 7-8 7" stroke="#4f46e5" strokeWidth="2.2" strokeLinejoin="round" />
  </svg>
);

const won = (n: number) => n.toLocaleString("ko-KR");

/* ── 챕터별 위젯 ─────────────────────────────────────────── */
//  각 챕터의 "떠 있는 작은 판". 화면 캡처만으로는 못 보여주는 동작을 여기서 보여준다.
function ChapterWidget({ k }: { k: string }) {
  if (k === "kpi") return (
    <div className="lp7-wg lp7-wg-kpi" data-wg="kpi">
      <div className="lp7-wg-t">월별 매출 · 채널별 <span className="lp7-wg-sub">— 표기 예시</span></div>
      <div className="lp7-kpi-row">
        <div className="lp7-bars">
          <div><span>6월</span></div>
          <div><span>7월</span></div>
          <div><span>8월</span></div>
          <div className="on"><span>9월</span></div>
        </div>
        <div className="lp7-ring-wrap">
          <svg viewBox="0 0 100 100" width="110" height="110" aria-hidden>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#e6e8f0" strokeWidth="10" />
            <circle className="lp7-ring" cx="50" cy="50" r="40" fill="none" stroke="#4f46e5" strokeWidth="10" strokeLinecap="round" transform="rotate(-90 50 50)" />
          </svg>
          <div className="lp7-ring-txt"><b data-count="78" data-suffix="%">0%</b><span>목표 달성률</span></div>
        </div>
      </div>
      <div className="lp7-legend"><span>스마트스토어 41%</span><span>쿠팡 33%</span><span>자사몰 26%</span></div>
    </div>
  );
  if (k === "project") return (
    <div className="lp7-wg lp7-wg-stages" data-wg="project">
      <div className="lp7-wg-t">A사 납품 건 · 단계 진행 <span className="lp7-wg-sub">— 단계는 업무마다 다르게</span></div>
      <div className="lp7-stages">
        <div className="lp7-stage-card">A사 납품<br /><span>담당 김수연</span></div>
        {["기획", "견적", "계약", "진행", "검수", "납품", "정산"].map((s) => <span key={s}>{s}</span>)}
      </div>
      <div className="lp7-meta"><span>마감 9/18</span><span>체크리스트 5/8</span><span>댓글 3</span><span>계약 서명 완료</span></div>
    </div>
  );
  if (k === "calendar") return (
    <div className="lp7-wg lp7-wg-cal" data-wg="calendar">
      <div className="lp7-wg-t">9월 셋째 주 · 공용 캘린더</div>
      <div className="lp7-cal">
        {["월", "화", "수", "목", "금", "토", "일"].map((d) => <span key={d}>{d}</span>)}
        <span>14</span><span>15</span><span className="ev">16 납품</span><span>17</span><span className="ev">18 회의</span><span>19</span><span>20</span>
      </div>
      <div className="lp7-rem">납품 D-1 · 내일 아침 9시 알림</div>
      <div className="lp7-tags"><span>매주 반복</span><span>부서 공개</span><span>알림 3개</span><span>부가세 신고 D-7</span></div>
    </div>
  );
  if (k === "files") return (
    <div className="lp7-wg lp7-wg-files" data-wg="files">
      <div className="lp7-wg-t">상세페이지_최종.psd</div>
      <div className="lp7-vstack">
        <div><span>v3 · 9/10 · 디자인팀</span><em>412MB</em></div>
        <div><span>v4 · 9/12 · 디자인팀</span><em>418MB</em></div>
        <div><span>v5 · 방금 · 김수연</span><em>420MB</em></div>
      </div>
      <div className="lp7-srow"><span>회사 저장공간</span><span>124 GB / 200 GB</span></div>
      <div className="lp7-sbar"><i /></div>
    </div>
  );
  if (k === "hr") return (
    <div className="lp7-wg lp7-wg-hr" data-wg="hr">
      <div className="lp7-wg-t">휴가 신청 · 결재 허브</div>
      <div className="lp7-stamp">승인</div>
      <div className="lp7-lv"><span>이지은 · 연차</span><span>9/23 ~ 9/24 (2일)</span></div>
      <div className="lp7-lv"><span>잔여 연차</span><span><b>11.5일 → 9.5일</b></span></div>
      <div className="lp7-lv"><span>급여 반영</span><span className="lp7-hi">9월 명세서 자동</span></div>
    </div>
  );
  if (k === "accounting") return (
    <div className="lp7-wg lp7-wg-ledger" data-wg="accounting">
      <div className="lp7-wg-t">오늘 자동 수집 → 전표</div>
      <div className="lp7-lg">
        <div><span>09:02</span><span>국민은행 입금 · (주)미라클</span><b>+2,860,000</b></div>
        <div><span>09:02</span><span>세금계산서 매칭 · 확정</span><b className="ok">전표 생성</b></div>
        <div><span>10:15</span><span>신한카드 승인 · 광고 대행</span><b>−450,000</b></div>
        <div><span>10:15</span><span>계정과목 · 광고선전비</span><b className="ok">전표 생성</b></div>
        <div><span>11:40</span><span>스마트스토어 정산 입금</span><b>+5,120,300</b></div>
      </div>
    </div>
  );
  if (k === "board") return (
    <div className="lp7-wg lp7-wg-board" data-wg="board">
      <div className="lp7-tabs">{["공지", "매뉴얼", "교육자료", "자유"].map((t) => <span key={t}>{t}</span>)}</div>
      <div className="lp7-srch">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8a96" strokeWidth="2.4" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
        <em data-type="CS 응대 매뉴얼 교환" /><i className="lp7-caret" />
      </div>
      <div className="lp7-list">
        <span>· CS 응대 매뉴얼 — 교환·반품 기준 (v2)</span>
        <span>· 상품등록 가이드 — 옵션·재고 연결</span>
        <span>· 물류 매뉴얼 — 출고 마감 시간</span>
      </div>
    </div>
  );
  if (k === "chat") return (
    <div className="lp7-wg lp7-wg-chat" data-wg="chat">
      <div className="lp7-wg-t"># A사 납품 · 프로젝트 채널</div>
      <div className="lp7-bubs">
        <div className="lp7-bub you">@김수연 검수 의견서 확인 부탁드립니다</div>
        <div className="lp7-bub me">확인했습니다. 오늘 납품 일정까지 잡아 둘게요</div>
        <div className="lp7-read">읽음 · 14:22</div>
        <div className="lp7-bub you file">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3a3a46" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L16 7" /></svg>
          검수의견서_최종.zip · 1.2GB
        </div>
      </div>
    </div>
  );
  return null;
}

/* ── 본체 ───────────────────────────────────────────────── */
export default function LandingV7() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();

    // 움직임 줄이기를 켠 사람에게는 애니메이션을 아예 만들지 않는다 — 화면은 이미 최종 상태다.
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const q = gsap.utils.selector(root);
      const cleanups: Array<() => void> = [];

      /** 화면 안에서만 도는 반복 타임라인 (성능 — 밖이면 멈춘다) */
      const loop = (trigger: Element | null, tl: gsap.core.Timeline) => {
        if (!trigger) { tl.kill(); return; }
        tl.pause();
        ScrollTrigger.create({
          trigger, start: "top 88%", end: "bottom 12%",
          onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
        });
      };
      /** 스크롤 등장 — 페이지 전체의 기본 리듬 */
      const reveal = (targets: gsap.TweenTarget, vars: gsap.TweenVars = {}, trigger?: Element | null) => {
        const list = gsap.utils.toArray<Element>(targets);
        if (!list.length) return;
        gsap.from(list, {
          y: 28, autoAlpha: 0, duration: 0.7, ease: "power3.out",
          stagger: list.length > 1 ? 0.09 : 0,
          scrollTrigger: { trigger: trigger ?? list[0], start: "top 84%" },
          ...vars,
        });
      };
      /** 숫자 세기 */
      const countUp = (el: HTMLElement, to: number, suffix = "") => {
        const o = { v: 0 };
        gsap.to(o, {
          v: to, duration: 1.4, ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
          onUpdate: () => { el.textContent = won(Math.round(o.v)) + suffix; },
        });
      };

      /* ══ ① 히어로 — 줄 올라오기 → 밑칠 → 단어 → 버튼 → 체크 → 화면 (총 2.4s) ══ */
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(q(".lp7-eyebrow"), { scale: 0.6, autoAlpha: 0, duration: 0.45, ease: "back.out(1.8)" })
        .from(q(".lp7-h1-line > span"), { yPercent: 110, duration: 0.9, stagger: 0.12 }, "-=0.2")
        .from(q(".lp7-emph span"), { y: 16, autoAlpha: 0, duration: 0.55, stagger: 0.08 }, "-=0.35")
        .from(q(".lp7-hero .lp7-lead"), { y: 14, autoAlpha: 0, duration: 0.55 }, "-=0.3")
        .from(q(".lp7-hero-cta > a"), { scale: 0.7, autoAlpha: 0, duration: 0.45, stagger: 0.08, ease: "back.out(1.6)" }, "-=0.25")
        .from(q(".lp7-check"), { scale: 0.6, autoAlpha: 0, duration: 0.42, stagger: 0.045, ease: "back.out(2)" }, "-=0.2")
        .from(q(".lp7-check path"), { strokeDashoffset: 30, duration: 0.4, stagger: 0.045, ease: "power2.out" }, "-=0.5")
        .from(q(".lp7-player-wrap"), {
          rotateX: 14, y: 60, autoAlpha: 0, duration: 1.1,
          transformPerspective: 1400, transformOrigin: "50% 0%",
        }, "-=0.7");

      // 밑칠은 ::after 라 직접 못 잡는다 → CSS 변수를 0 → 1 로 올려 scaleX 를 그린다.
      const mark = q(".lp7-mark")[0] as HTMLElement | undefined;
      if (mark) {
        mark.style.setProperty("--lp7-draw", "0"); // JS 가 도는 순간 0 으로 — 칠해진 채 시작하지 않게
        const draw = { p: 0 };
        gsap.to(draw, {
          p: 1, duration: 0.75, ease: "power2.inOut", delay: 1.05,
          onUpdate: () => mark.style.setProperty("--lp7-draw", String(draw.p)),
        });
      }

      // 보조 층: 주 버튼 위를 스치는 빛 (2.6초마다 한 번)
      const sheen = q(".lp7-sheen");
      if (sheen.length) {
        gsap.fromTo(sheen, { xPercent: -130 }, {
          xPercent: 130, duration: 1.1, ease: "power2.inOut",
          repeat: -1, repeatDelay: 2.6, delay: 2.4,
        });
      }

      /* ══ ② 히어로 플레이어 — 장면 교차 + 커서 + 진행바 ══ */
      //  촬영 전이라 실제 화면 4장을 교차시킨다 (결정 192). 영상이 준비되면 <video> 로 바뀐다.
      const player = q(".lp7-player")[0] as HTMLElement | undefined;
      if (player && !HERO_VIDEO_SRC) {
        const scenesEl = q(".lp7-scene");
        const caps = q(".lp7-cap");
        const cursor = q(".lp7-cursor")[0];
        const rings = q(".lp7-clickring");
        const per = 5; // 장면 하나당 5초
        const px = (rx: number) => () => player.clientWidth * rx;
        const py = (ry: number) => () => player.clientHeight * ry;

        gsap.set(scenesEl, { autoAlpha: 0 });
        gsap.set(caps, { autoAlpha: 0, y: 8 });
        gsap.set(scenesEl[0], { autoAlpha: 1 });

        const pl = gsap.timeline({ repeat: -1, defaults: { ease: "power2.inOut" } });
        scenesEl.forEach((s, i) => {
          const at = i * per;
          if (i > 0) {
            pl.to(scenesEl[i - 1], { autoAlpha: 0, duration: 0.6 }, at);
            pl.to(s, { autoAlpha: 1, duration: 0.6 }, at);
          }
          pl.to(caps[i], { autoAlpha: 1, y: 0, duration: 0.4 }, at + 0.25);
          pl.to(caps[i], { autoAlpha: 0, y: 8, duration: 0.35 }, at + per - 0.7);
        });
        const total = scenesEl.length * per;
        pl.to(scenesEl[scenesEl.length - 1], { autoAlpha: 0, duration: 0.6 }, total - 0.6);
        pl.to(scenesEl[0], { autoAlpha: 1, duration: 0.6 }, total - 0.6);

        // 커서: 장면마다 한 곳을 눌러 본다 (x/y 변환 — 레이아웃을 건드리지 않는다)
        if (cursor) {
          const stops: Array<[number, number]> = [[0.52, 0.6], [0.18, 0.28], [0.84, 0.22], [0.4, 0.46], [0.3, 0.52]];
          gsap.set(cursor, { x: px(stops[0][0]), y: py(stops[0][1]) });
          stops.slice(1).forEach(([rx, ry], i) => {
            const at = i * per + 1.4;
            pl.to(cursor, { x: px(rx), y: py(ry), duration: 1.1, ease: "power2.inOut" }, at);
            pl.to(cursor, { scale: 0.82, duration: 0.09, yoyo: true, repeat: 1 }, at + 1.1);
            const ring = rings[i];
            if (ring) {
              gsap.set(ring, { x: px(rx), y: py(ry) });
              pl.fromTo(ring, { autoAlpha: 0.9, scale: 0.3 }, { autoAlpha: 0, scale: 1.7, duration: 0.7, ease: "power2.out" }, at + 1.1);
            }
          });
        }

        const bar = q(".lp7-prog i")[0];
        if (bar) pl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: total, ease: "none" }, 0);

        // 마우스를 올리면 멈춘다 (읽을 시간을 준다)
        const onEnter = () => pl.pause();
        const onLeave = () => pl.play();
        player.addEventListener("mouseenter", onEnter);
        player.addEventListener("mouseleave", onLeave);
        cleanups.push(() => {
          player.removeEventListener("mouseenter", onEnter);
          player.removeEventListener("mouseleave", onLeave);
        });
        loop(player, pl);
      }

      /* ══ 구간 머리 · 챕터 공통 등장 ══ */
      reveal(q(".lp7-sechead > *"), { stagger: 0.1 });
      q(".lp7-chapter").forEach((ch) => {
        reveal(ch.querySelectorAll(".lp7-copy > *"), { y: 22, duration: 0.6, stagger: 0.07 }, ch);
      });
      // 화면 캡처는 챕터마다 방향을 바꿔 들어온다 (좌 ↔ 우 교대라 지루하지 않다)
      q(".lp7-chapter").forEach((ch, i) => {
        const shot = ch.querySelector(".lp7-shot");
        if (!shot) return;
        const fromRight = ch.getAttribute("data-side") === "right";
        gsap.from(shot, {
          x: fromRight ? 44 : -44, rotate: i % 2 ? -1.4 : 1.4, autoAlpha: 0,
          duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: ch, start: "top 78%" },
        });
      });
      // 떠 있는 판은 화면보다 조금 늦게 (보조 층)
      q(".lp7-wg").forEach((w) => {
        gsap.from(w, {
          y: 24, scale: 0.96, autoAlpha: 0, duration: 0.7, delay: 0.15, ease: "power3.out",
          scrollTrigger: { trigger: w, start: "top 92%" },
        });
      });

      /* ══ ① KPI — 막대가 자라고 달성률 링이 감긴다 ══ */
      const kpi = q('[data-wg="kpi"]')[0];
      if (kpi) {
        gsap.from(kpi.querySelectorAll(".lp7-bars > div"), {
          scaleY: 0, transformOrigin: "50% 100%", duration: 0.85, stagger: 0.09, ease: "power3.out",
          scrollTrigger: { trigger: kpi, start: "top 88%" },
        });
        const ring = kpi.querySelector(".lp7-ring");
        if (ring) {
          gsap.to(ring, {
            strokeDashoffset: 251.2 * (1 - 0.78), duration: 1.4, ease: "power2.inOut", delay: 0.25,
            scrollTrigger: { trigger: kpi, start: "top 88%" },
          });
        }
        const num = kpi.querySelector<HTMLElement>("[data-count]");
        if (num) countUp(num, 78, "%");
      }

      /* ══ ② 판매채널 — 새 주문 알림이 번갈아 내려온다 + 채널 띠 흐름 ══ */
      const toasts = q(".lp7-toast");
      if (toasts.length) {
        gsap.set(toasts, { autoAlpha: 0, y: -16 });
        const tl = gsap.timeline({ repeat: -1 });
        toasts.forEach((t, i) => {
          tl.to(t, { autoAlpha: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" }, i * 3.6)
            .to(t, { autoAlpha: 0, y: -16, duration: 0.35, ease: "power2.in" }, i * 3.6 + 2.6);
        });
        loop(toasts[0].closest(".lp7-chapter"), tl);
      }
      const track = q(".lp7-marquee-track")[0];
      if (track) {
        const tl = gsap.timeline({ repeat: -1 });
        tl.fromTo(track, { xPercent: 0 }, { xPercent: -50, duration: 18, ease: "none" });
        loop(track, tl);
      }

      /* ══ ③ 프로젝트 — 카드가 7단계를 따라 옮겨 간다 ══ */
      const stages = q('[data-wg="project"]')[0];
      if (stages) {
        const card = stages.querySelector<HTMLElement>(".lp7-stage-card");
        const chips = stages.querySelectorAll<HTMLElement>(".lp7-stages > span");
        if (card && chips.length) {
          const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6 });
          chips.forEach((chip, i) => {
            const at = i * 1.5;
            if (i > 0) tl.to(card, { x: () => chip.offsetLeft - chips[0].offsetLeft, duration: 0.55, ease: "power2.inOut" }, at);
            tl.to(chip, { backgroundColor: "#4f46e5", color: "#ffffff", duration: 0.3 }, at + (i > 0 ? 0.35 : 0))
              .to(chip, { backgroundColor: "#f5f6fb", color: "#6b6b78", duration: 0.3 }, at + 1.2);
          });
          tl.to(card, { x: 0, duration: 0.01 });
          loop(stages, tl);
        }
      }

      /* ══ ④ 캘린더 — 알림 말풍선이 톡 튀어나온다 ══ */
      const rem = q(".lp7-rem")[0];
      if (rem) {
        gsap.set(rem, { autoAlpha: 0, scale: 0.7 });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2 });
        tl.to(rem, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "back.out(2.2)" })
          .to(rem, { autoAlpha: 0, scale: 0.85, duration: 0.35, ease: "power2.in" }, "+=2.6");
        loop(rem.closest(".lp7-chapter"), tl);
      }

      /* ══ ⑤ 파일 — 새 버전이 올라오고 옛 버전이 밀려 나간다 ══ */
      const files = q('[data-wg="files"]')[0];
      if (files) {
        const cards = files.querySelectorAll<HTMLElement>(".lp7-vstack > div");
        if (cards.length === 3) {
          gsap.set(cards[2], { autoAlpha: 0, y: 20 });
          const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4 });
          tl.to(cards, { y: -40, duration: 0.7, ease: "power3.out" }, 1.6)
            .to(cards[0], { autoAlpha: 0, duration: 0.5 }, "<")
            .to(cards[2], { autoAlpha: 1, duration: 0.5 }, "<")
            .set(cards, { y: 0 }, "+=2.2")
            .set(cards[0], { autoAlpha: 1 })
            .set(cards[2], { autoAlpha: 0, y: 20 });
          loop(files, tl);
        }
        const bar = files.querySelector(".lp7-sbar i");
        if (bar) gsap.to(bar, { scaleX: 0.62, duration: 1.2, ease: "power2.out", scrollTrigger: { trigger: files, start: "top 88%" } });
      }

      /* ══ ⑥ 인사 — 승인 도장이 찍힌다 ══ */
      const stamp = q(".lp7-stamp")[0];
      if (stamp) {
        gsap.set(stamp, { autoAlpha: 0, scale: 2, rotate: -18 });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4 });
        tl.to(stamp, { autoAlpha: 1, scale: 1, rotate: -12, duration: 0.5, ease: "back.out(1.4)" }, 1.4)
          .to(stamp, { autoAlpha: 0, duration: 0.4 }, "+=2.6");
        loop(stamp.closest(".lp7-chapter"), tl);
      }

      /* ══ ⑦ 회계 — 오늘 수집된 거래가 한 줄씩 적힌다 ══ */
      const ledger = q('[data-wg="accounting"]')[0];
      if (ledger) {
        const rows = ledger.querySelectorAll(".lp7-lg > div");
        gsap.set(rows, { autoAlpha: 0, x: -8 });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6 });
        tl.to(rows, { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.5, ease: "power2.out" })
          .to(rows, { autoAlpha: 0, duration: 0.4 }, "+=2.4");
        loop(ledger, tl);
      }

      /* ══ ⑧ 매뉴얼 — 카테고리가 돌고 검색어가 쳐진다 ══ */
      const board = q('[data-wg="board"]')[0];
      if (board) {
        const tabs = board.querySelectorAll<HTMLElement>(".lp7-tabs span");
        const typeEl = board.querySelector<HTMLElement>("[data-type]");
        const caret = board.querySelector(".lp7-caret");
        const tl = gsap.timeline({ repeat: -1 });
        tabs.forEach((t, i) => {
          tl.to(t, { backgroundColor: "#4f46e5", color: "#ffffff", duration: 0.3 }, i * 2)
            .to(t, { backgroundColor: "#f5f6fb", color: "#6b6b78", duration: 0.3 }, i * 2 + 1.6);
        });
        if (typeEl) {
          const full = typeEl.dataset.type ?? "";
          const o = { i: 0 };
          tl.to(o, {
            i: full.length, duration: 1.3, ease: "none",
            onUpdate: () => { typeEl.textContent = full.slice(0, Math.round(o.i)); },
          }, 2.2)
            .to(o, { i: 0, duration: 0.5, ease: "none", onUpdate: () => { typeEl.textContent = full.slice(0, Math.round(o.i)); } }, 6.6);
        }
        if (caret) gsap.to(caret, { autoAlpha: 0, duration: 0.01, repeat: -1, yoyo: true, repeatDelay: 0.5 });
        loop(board, tl);
      }

      /* ══ ⑨ 메신저 — 말풍선 → 읽음 → 파일 순서로 ══ */
      const chat = q('[data-wg="chat"]')[0];
      if (chat) {
        const bubs = chat.querySelectorAll(".lp7-bubs > *");
        gsap.set(bubs, { autoAlpha: 0, y: 8 });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6 });
        tl.to(bubs, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 1.1, ease: "power2.out" })
          .to(bubs, { autoAlpha: 0, duration: 0.4 }, "+=2.2");
        loop(chat, tl);
      }

      /* ══ 흐름도 — 자료가 왼쪽에서 들어와 오른쪽으로 나간다 ══ */
      const flow = q(".lp7-flow")[0];
      if (flow) {
        reveal(flow.querySelectorAll(".lp7-flow-kicker, .lp7-flow .lp7-h2, .lp7-flow .lp7-lead"), { stagger: 0.08 }, flow);
        gsap.from(flow.querySelectorAll(".lp7-flow-col:first-of-type .lp7-flow-card"), {
          x: -40, autoAlpha: 0, duration: 0.6, stagger: 0.1,
          scrollTrigger: { trigger: flow, start: "top 72%" },
        });
        gsap.from(flow.querySelectorAll(".lp7-flow-col:last-of-type .lp7-flow-card"), {
          x: 40, autoAlpha: 0, duration: 0.6, stagger: 0.1, delay: 0.25,
          scrollTrigger: { trigger: flow, start: "top 72%" },
        });
        const core = flow.querySelector(".lp7-flow-core");
        if (core) {
          gsap.from(core, { scale: 0.92, autoAlpha: 0, duration: 0.7, delay: 0.15, scrollTrigger: { trigger: flow, start: "top 72%" } });
          // 배경 층: 가운데 판이 천천히 숨 쉰다
          const breathe = gsap.timeline({ repeat: -1, yoyo: true });
          breathe.to(core, { scale: 1.015, duration: 1.6, ease: "sine.inOut" });
          loop(flow, breathe);
        }
        // 점이 화살표를 타고 흐른다
        const dots = flow.querySelectorAll(".lp7-arrow-dot");
        if (dots.length) {
          const tl = gsap.timeline({ repeat: -1 });
          dots.forEach((d, i) => {
            tl.fromTo(d, { x: 0, autoAlpha: 0 }, { x: 58, autoAlpha: 1, duration: 0.9, ease: "power1.inOut" }, i * 0.45)
              .to(d, { autoAlpha: 0, duration: 0.2 }, i * 0.45 + 0.9);
          });
          tl.to({}, { duration: 0.6 });
          loop(flow, tl);
        }
      }

      /* ══ AI 3단계 — 번호가 차례로 빛난다 ══ */
      const steps = q(".lp7-steps")[0];
      if (steps) {
        reveal(steps.querySelectorAll(".lp7-h2, .lp7-steps .lp7-lead"), { stagger: 0.08 }, steps);
        gsap.from(steps.querySelectorAll(".lp7-step"), {
          y: 32, autoAlpha: 0, duration: 0.7, stagger: 0.14,
          scrollTrigger: { trigger: steps, start: "top 76%" },
        });
        const nums = steps.querySelectorAll(".lp7-num");
        if (nums.length) {
          const tl = gsap.timeline({ repeat: -1 });
          nums.forEach((n, i) => {
            tl.to(n, { boxShadow: "0 0 0 12px rgba(165,180,252,0.18)", duration: 0.6, ease: "power2.out" }, i * 1.1)
              .to(n, { boxShadow: "0 0 0 0 rgba(165,180,252,0)", duration: 0.6, ease: "power2.in" }, i * 1.1 + 0.6);
          });
          loop(steps, tl);
        }
      }

      /* ══ 요금 — 숫자가 올라가고 테두리가 한 번 퍼진다 ══ */
      q("[data-amount]").forEach((el) => {
        const to = Number((el as HTMLElement).dataset.amount ?? 0);
        countUp(el as HTMLElement, to);
      });
      const hl = q(".lp7-plan.hl")[0];
      if (hl) {
        gsap.fromTo(hl,
          { boxShadow: "0 0 0 0 rgba(79,70,229,0.5)" },
          { boxShadow: "0 0 0 22px rgba(79,70,229,0)", duration: 1.6, ease: "power2.out", delay: 0.4, scrollTrigger: { trigger: hl, start: "top 84%" } });
      }
      reveal(q(".lp7-price-grid > *"), { stagger: 0.12 }, q(".lp7-price")[0]);

      /* ══ 무료 계산기 · 신뢰 ══ */
      reveal(q(".lp7-tools .lp7-h2, .lp7-tools .lp7-lead"), { stagger: 0.08 }, q(".lp7-tools")[0]);
      reveal(q(".lp7-tool"), { y: 24, duration: 0.55, stagger: 0.07 }, q(".lp7-tool-grid")[0]);
      const trust = q(".lp7-trust")[0];
      if (trust) {
        const cards = trust.querySelectorAll(".lp7-trust-card");
        gsap.from(cards[0], { x: -36, autoAlpha: 0, duration: 0.7, scrollTrigger: { trigger: trust, start: "top 82%" } });
        gsap.from(cards[1], { x: 36, autoAlpha: 0, duration: 0.7, delay: 0.1, scrollTrigger: { trigger: trust, start: "top 82%" } });
      }

      /* ══ 마지막 CTA — 빛이 떠다니고 버튼이 숨 쉰다 ══ */
      const cta = q(".lp7-cta")[0];
      if (cta) {
        reveal(cta.querySelectorAll(".lp7-h2, .lp7-cta .lp7-btn-lg, .lp7-cta p"), { stagger: 0.1 }, cta);
        const blobs = cta.querySelectorAll(".lp7-blob");
        blobs.forEach((b, i) => {
          const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
          tl.to(b, { x: i ? -40 : 60, y: i ? 30 : -40, scale: i ? 0.9 : 1.15, duration: 7 })
            .to(b, { x: i ? 30 : -30, y: i ? -20 : 25, scale: i ? 1.1 : 0.92, duration: 7 });
          loop(cta, tl);
        });
        const btn = cta.querySelector(".lp7-btn-lg");
        if (btn) {
          const tl = gsap.timeline({ repeat: -1, yoyo: true });
          tl.to(btn, { boxShadow: "0 8px 24px rgba(79,70,229,.28), 0 0 0 14px rgba(79,70,229,.10)", duration: 1.2, ease: "sine.inOut" });
          loop(cta, tl);
        }
      }

      // 캡처가 늦게 뜨면 트리거 위치가 어긋난다 — 다 뜨고 나서 한 번 다시 잰다.
      const onLoad = () => ScrollTrigger.refresh();
      window.addEventListener("load", onLoad);
      cleanups.push(() => window.removeEventListener("load", onLoad));

      return () => cleanups.forEach((fn) => fn());
    }, root);

    return () => mm.revert();
  }, { scope: root });

  const scenes = HERO_SCENES;

  return (
    <div className="lp7-root" ref={root}>
      {/* ── 상단바 ── */}
      <header className="lp7-nav">
        <Link href="/" className="lp7-brandmark"><i><Logo /></i>OwnerView</Link>
        <nav className="lp7-navlinks">
          {NAV.map((n) => (n.href.startsWith("#")
            ? <a key={n.href} href={n.href}>{n.label}</a>
            : <Link key={n.href} href={n.href}>{n.label}</Link>))}
        </nav>
        <div className="lp7-navcta">
          <Link href="/auth" className="lp7-login">로그인</Link>
          <Link href="/auth" className="lp7-pill">무료로 시작하기</Link>
        </div>
      </header>

      {/* ── 히어로 ── */}
      <section className="lp7-hero">
        <span className="lp7-eyebrow">{HERO.eyebrow}</span>
        <h1 className="lp7-h1">
          <span className="lp7-h1-line"><span>{HERO.titleLine1}</span></span>
          <span className="lp7-h1-line"><span>{HERO.titleLine2A}<span className="lp7-mark">{HERO.titleLine2B}</span></span></span>
        </h1>
        <p className="lp7-emph">
          {HERO.emphasis.map((w) => <span key={w} className="lp7-shimmer">{w}&nbsp;</span>)}
        </p>
        <p className="lp7-lead">{HERO.lead}</p>
        <div className="lp7-hero-cta">
          <Link href="/auth" className="lp7-btn-lg">{HERO.ctaPrimary} <Arrow /><i className="lp7-sheen" /></Link>
          <Link href="/tax-partners" className="lp7-btn-ghost">{HERO.ctaSecondary}</Link>
        </div>
        <div className="lp7-checks">
          {HERO.checks.map((c) => (
            <span key={c} className="lp7-check"><i><CheckPath /></i>{c}</span>
          ))}
        </div>

        {/* 시연 영상 — 촬영 전이라 실제 화면 4장을 교차시킨다 (결정 192) */}
        <div className="lp7-player-wrap">
          <div className="lp7-player-frame">
            <div className="lp7-chrome">
              <b /><b /><b />
              <span className="lp7-chrome-url">app.owner-view.com</span>
              <span className="lp7-live"><i />실제 화면 녹화</span>
            </div>
            <div className="lp7-player">
              {HERO_VIDEO_SRC ? (
                <video className="lp7-video" src={HERO_VIDEO_SRC} poster={scenes[0].src} autoPlay muted loop playsInline preload="metadata" />
              ) : (
                <>
                  {scenes.map((s, i) => (
                    <Image key={s.src} className="lp7-scene" src={s.src} alt={s.alt} fill sizes="(max-width: 1180px) 100vw, 1160px" priority={i === 0} />
                  ))}
                  {scenes.map((s, i) => (
                    <span key={`cap-${s.src}`} className="lp7-cap"><b>{i + 1}</b>{s.cap}</span>
                  ))}
                  {scenes.map((s) => <span key={`ring-${s.src}`} className="lp7-clickring" />)}
                  <svg className="lp7-cursor" viewBox="0 0 24 24" fill="#0b0b0f" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
                    <path d="M5 3l14 8.5-6.5 1.5-3.5 6z" />
                  </svg>
                </>
              )}
            </div>
          </div>
          <div className="lp7-playbar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#3a3a46" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
            <span className="lp7-prog"><i /></span>
            <span className="lp7-playnote">0:20 · 무음 · 자동 재생 · 마우스를 올리면 멈춥니다</span>
          </div>
        </div>
      </section>

      {/* ── 구간 머리 ── */}
      <section className="lp7-sechead">
        <h2 className="lp7-h2">{SECTION_HEAD.title}</h2>
        <p className="lp7-lead">{SECTION_HEAD.lead}</p>
      </section>

      {/* ── 9챕터 ── */}
      {SECTIONS.map((s) => (
        <section key={s.key} id={`sec-${s.key}`} className="lp7-chapter" data-side={s.side}>
          <div className="lp7-copy">
            <div className="lp7-kicker">{s.no} {s.eyebrow}</div>
            <h2 className={`lp7-h3${s.title.length > 34 ? " lp7-h3-sm" : ""}`}>{s.title}</h2>
            <p className="lp7-desc">{s.desc}</p>
            {s.bullets && (
              <div className="lp7-bullets">
                {s.bullets.map((b) => <span key={b}>· {b}</span>)}
              </div>
            )}
            {s.key === "channel" && (
              <div className="lp7-marquee">
                <div className="lp7-marquee-track">
                  {[0, 1].map((dup) => ["스마트스토어", "쿠팡", "CJ대한통운", "롯데택배", "로젠택배", "한진택배"].map((c) => (
                    <span key={`${dup}-${c}`} className="lp7-chip">{c}</span>
                  )))}
                </div>
              </div>
            )}
            <div className="lp7-loc"><b>위치</b> {s.loc}</div>
          </div>
          <div className="lp7-visual">
            <div className="lp7-stack">
              <Image className="lp7-shot" src={s.shot.src} alt={s.shot.alt} width={s.shot.w} height={s.shot.h} sizes="(max-width: 1180px) 100vw, 720px" />
              {s.key === "channel" && (
                <>
                  <div className="lp7-toast"><i />스마트스토어 새 주문 12건 · 출고 대기</div>
                  <div className="lp7-toast"><i />쿠팡 새 주문 7건 · 재고 반영됨</div>
                </>
              )}
              <ChapterWidget k={s.key} />
            </div>
          </div>
        </section>
      ))}

      {/* ── 자동 수집 → 세무 신고 한 흐름 ── */}
      <section className="lp7-flow">
        <p className="lp7-flow-kicker">{FLOW.kicker}</p>
        <h2 className="lp7-h2">{FLOW.title}</h2>
        <p className="lp7-lead">{FLOW.lead}</p>
        <div className="lp7-flow-grid">
          <div className="lp7-flow-col">
            {FLOW.inputs.map((i) => <div key={i.t} className="lp7-flow-card"><b>{i.t}</b><span>{i.d}</span></div>)}
          </div>
          <div className="lp7-arrow"><FlowArrow /><i className="lp7-arrow-dot" /><i className="lp7-arrow-dot" /></div>
          <div className="lp7-flow-core">
            <div className="lp7-wg-t">{FLOW.core.kicker}</div>
            <h3>{FLOW.core.title}</h3>
            <p>{FLOW.core.desc}</p>
          </div>
          <div className="lp7-arrow"><FlowArrow /><i className="lp7-arrow-dot" /><i className="lp7-arrow-dot" /></div>
          <div className="lp7-flow-col">
            {FLOW.outputs.map((o) => <div key={o.t} className="lp7-flow-card"><b>{o.t}</b><span>{o.d}</span></div>)}
          </div>
        </div>
      </section>

      {/* ── AI 자동입력 3단계 ── */}
      <section className="lp7-steps">
        <div className="lp7-grid-bg" aria-hidden />
        <div className="lp7-steps-in">
          <h2 className="lp7-h2">{STEPS.title}</h2>
          <p className="lp7-lead">{STEPS.lead}</p>
          <div className="lp7-step-grid">
            {STEPS.items.map((s) => (
              <div key={s.n} className="lp7-step">
                <div className="lp7-step-head"><span className="lp7-num">{s.n}</span><span className="lp7-step-label">{s.label}</span></div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 요금 ── */}
      <section id="pricing" className="lp7-price">
        <div className="lp7-price-grid">
          <div>
            <div className="lp7-kicker">{PRICING.eyebrow}</div>
            <h2 className="lp7-h3">{PRICING.title}</h2>
            <p className="lp7-desc">{PRICING.desc}</p>
          </div>
          <div className="lp7-plans">
            <div className="lp7-plan">
              <div className="lp7-plan-name">{PRICING.free.name}</div>
              <div className="lp7-plan-amt">{PRICING.free.price}</div>
              <div className="lp7-plan-note">{PRICING.free.note}</div>
              <ul>{PRICING.free.features.map((f) => <li key={f}>· {f}</li>)}</ul>
            </div>
            <div className="lp7-plan hl">
              <div className="lp7-plan-name">{PRICING.paid.name}</div>
              <div className="lp7-plan-amt"><span data-amount={PRICING.amount}>{won(PRICING.amount)}</span><em>{PRICING.paid.unit}</em></div>
              <div className="lp7-plan-note">{PRICING.paid.note}</div>
              <ul>{PRICING.paid.features.map((f) => <li key={f}>· {f}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 무료 계산기 ── */}
      <section className="lp7-tools">
        <h2 className="lp7-h2">{TOOLS.title}</h2>
        <p className="lp7-lead">{TOOLS.lead}</p>
        <div className="lp7-tool-grid">
          {TOOLS.items.map((t) => (
            <Link key={t.href} href={t.href} className="lp7-tool"><b>{t.name}</b><span>{t.desc}</span></Link>
          ))}
        </div>
      </section>

      {/* ── 세무사 제휴 · 데이터 소유 ── */}
      <section className="lp7-trust">
        {TRUST.map((t) => (
          <div key={t.title} className="lp7-trust-card">
            <h3>{t.title}</h3>
            <p>{t.desc}</p>
            <Link href={t.cta.href} className="lp7-ghost-sm">{t.cta.label}</Link>
          </div>
        ))}
      </section>

      {/* ── 마지막 CTA ── */}
      <section className="lp7-cta">
        <i className="lp7-blob lp7-blob-a" aria-hidden />
        <i className="lp7-blob lp7-blob-b" aria-hidden />
        <div className="lp7-cta-in">
          <h2 className="lp7-h2">{CTA.titleA}<br /><span className="lp7-shimmer">{CTA.titleB}</span></h2>
          <div className="lp7-cta-btn">
            <Link href="/auth" className="lp7-btn-lg">{CTA.button} <Arrow /><i className="lp7-sheen" /></Link>
          </div>
          <p className="lp7-cta-note">{CTA.note}</p>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className="lp7-footer">
        <div className="lp7-footer-row">
          <div>{FOOTER.company}<br />{FOOTER.reg}<br />{FOOTER.addr} · {FOOTER.email}</div>
          <div className="lp7-footer-links">
            {FOOTER.links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </div>
        </div>
        <div className="lp7-footer-kw">{FOOTER.keywords}</div>
      </footer>
    </div>
  );
}
