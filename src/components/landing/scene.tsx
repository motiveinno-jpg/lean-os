"use client";

// 랜딩 v5 — 장면(Scene) 엔진 (2026-07-28)
//   기존 랜딩은 섹션을 위에서 아래로 쌓는 "문서" 구조였다. v5 는 다르다:
//   화면 하나가 무대이고, 스크롤은 그 무대 위에서 일어나는 연출의 재생 헤드다.
//
//   ⚠️ 진행률을 React state 로 들고 있으면 스크롤 프레임마다 리렌더가 돌아
//      큰 화면 이미지가 있는 장면에서 즉시 끊긴다. 진행률은 무대 엘리먼트의
//      CSS 변수(--p)로만 흘려보내고, 움직임은 전부 CSS 가 계산한다. 리렌더 0.
//      내용 자체가 바뀌어야 하는 구간(beat)만 state 로 올린다 — 장면당 3~5회.

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 트랙(높이 = len × 100vh)이 뷰포트를 지나는 동안 무대는 sticky 로 붙어 있는다.
 * @param beats 1보다 크면 진행률을 등분한 구간 인덱스를 함께 돌려준다(내용 교체용).
 */
export function useScene(beats = 1) {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const track = trackRef.current, stage = stageRef.current;
    if (!track || !stage) return;

    // 모션을 줄이고 싶은 사용자에겐 연출을 재생하지 않고 "다 끝난 상태"를 바로 보여준다.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stage.style.setProperty("--p", "1");
      // ⚠️ 여기서 beat 를 0 으로 두면 "다 끝난 상태"가 아니라 "시작 상태"가 된다 —
      //    커버리지처럼 쌓이는 장면은 메뉴 18개 중 1개만 켜진 채로 멈춘다. 마지막 구간으로 둔다.
      if (beats > 1) setBeat(beats - 1);
      return;
    }

    let raf = 0, lastBeat = -1;
    const tick = () => {
      raf = 0;
      const r = track.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = total <= 0 ? 1 : Math.min(1, Math.max(0, -r.top / total));
      stage.style.setProperty("--p", p.toFixed(4));
      if (beats > 1) {
        const b = Math.min(beats - 1, Math.floor(p * beats));
        if (b !== lastBeat) { lastBeat = b; setBeat(b); }
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [beats]);

  return { trackRef, stageRef, beat };
}

/** 무대 하나 = 트랙 + sticky 무대. len 이 곧 그 장면의 재생 시간이다. */
export function Scene({ id, len = 1.6, beats = 1, tone, className = "", children }: {
  id?: string;
  len?: number;
  beats?: number;
  tone?: "dark";
  className?: string;
  children: (beat: number) => ReactNode;
}) {
  const { trackRef, stageRef, beat } = useScene(beats);
  return (
    <section
      id={id}
      ref={trackRef}
      className={`lp5-scene ${tone === "dark" ? "lp5-scene-dark" : ""}`}
      style={{ ["--len" as string]: len }}
    >
      <div ref={stageRef} className={`lp5-stage ${className}`}>{children(beat)}</div>
    </section>
  );
}

// ── 등장 관찰자 ──
//   인스턴스마다 IntersectionObserver 를 만들면 한 페이지에 수십 개가 생긴다. 하나만 공유한다.
let revealIO: IntersectionObserver | null = null;
const revealCbs = new WeakMap<Element, () => void>();

function observeReveal(el: Element, cb: () => void) {
  if (typeof IntersectionObserver === "undefined") { cb(); return () => {}; }
  if (!revealIO) {
    revealIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        revealCbs.get(e.target)?.();
        revealIO!.unobserve(e.target);
        revealCbs.delete(e.target);
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
  }
  revealCbs.set(el, cb);
  revealIO.observe(el);
  return () => { revealIO?.unobserve(el); revealCbs.delete(el); };
}

/**
 * 좁은 화면 판정.
 *   ⚠️ 폰에서 데스크톱 화면 캡처를 그대로 축소하면 글자가 안 읽혀 "무슨 화면인지" 전달이 0이 된다.
 *      좁을 때는 같은 기능의 모바일 화면으로 바꿔 끼운다.
 *   SSR 은 항상 false(데스크톱)로 그리고 마운트 후 판정한다 — 하이드레이션 불일치를 피한다.
 */
export function useNarrow(max = 700) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${max}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [max]);
  return narrow;
}

/** 뷰포트에 들어오면 스르륵 떠오른다. delay 는 같은 줄에 여러 개일 때 계단식으로. */
export function Rise({ children, delay = 0, as = "div", className = "" }: {
  children: ReactNode; delay?: number; as?: "div" | "h2" | "p" | "li"; className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOn(true); return; }
    return observeReveal(el, () => setOn(true));
  }, []);
  const Tag = as as "div";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`lp5-rise ${on ? "lp5-rise-on" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
