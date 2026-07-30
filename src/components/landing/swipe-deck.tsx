"use client";

// ══ 모바일 스와이프 덱 (2026-07-30) ══
//   사장님: "모바일은 스와이프가 편하니까 거기에 맞춰 편의성을 꼭 고려해서 수정해 줘.
//   특히 '오너뷰로 달라지는 하루', '자리에 없어도 결정은 멈추지 않아요' 는
//   사용자가 화면 보면서 기능을 확인하기 너무 어렵게 되어 있다."
//
//   ▸ 무엇이 문제였나(390px 실측)
//     · 하루 구간: 제목·시간·비포/애프터가 한 화면을 다 먹고 폰 화면은 접힌 아래에 있었다.
//       게다가 스크롤이 시간대를 넘기는 핀 고정 장면이라, 화면을 보려고 내리면 다음 시간대로 갔다.
//     · 자리에 없어도: 폰 목업 한 대와 설명 네 줄이 따로 놀아서, 지금 보이는 화면이
//       어느 설명인지 손가락으로 짚어가며 맞춰야 했다.
//   ▸ 해결: 카드 한 장 = 설명 + 그 화면. 한 장이 화면을 꽉 채우고 옆으로 넘긴다.
//     AI 구간에서 승인된 방식과 같게 맞춘다 — 도트로 위치를 보여주고, 자동으로 넘어가지만
//     손을 대면 그때부터 사용자가 넘긴다.
//   ⚠️ 화면에 보일 때만 돈다. 안 보이는 덱이 타이머를 돌리면 배터리만 먹는다.
//   ⚠️ 스크롤 진행률에 묶지 않는다 — 중간에서 손을 떼면 반쯤 넘어간 채 얼어붙는다(v5 교훈).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function SwipeDeck({ slides, label, ms = 5200, tone = "light" }: {
  slides: ReactNode[]; label: string; ms?: number; tone?: "light" | "dark";
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const prog = useRef(false);          // 프로그램이 굴린 스크롤 — 사용자 조작으로 오해하지 않게
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  const n = slides.length;

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const io = new IntersectionObserver((es) => setInView(es[0].isIntersecting), { threshold: 0.3 });
    io.observe(rail);
    return () => io.disconnect();
  }, []);

  const scrollTo = useCallback((i: number) => {
    const rail = railRef.current;
    const slide = rail?.children[i] as HTMLElement | undefined;
    if (!rail || !slide) return;
    prog.current = true;
    rail.scrollTo({
      left: (slide.offsetLeft - rail.offsetLeft) - (rail.clientWidth - slide.clientWidth) / 2,
      behavior: "smooth",
    });
    window.setTimeout(() => { prog.current = false; }, 1200);   // 스크롤 이벤트가 안 오는 경우 대비
  }, []);

  /* 손으로 넘기면 그 뒤로는 사용자가 넘긴다 */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let t = 0;
    const onScroll = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (prog.current) { prog.current = false; return; }
        const mid = rail.scrollLeft + rail.clientWidth / 2;
        let best = 0, bestD = Infinity;
        Array.from(rail.children).forEach((el, i) => {
          const s = el as HTMLElement;
          const d = Math.abs((s.offsetLeft - rail.offsetLeft) + s.clientWidth / 2 - mid);
          if (d < bestD) { bestD = d; best = i; }
        });
        setAuto(false);
        setIndex(best);
      }, 130);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => { rail.removeEventListener("scroll", onScroll); clearTimeout(t); };
  }, []);

  /* 자동 넘김 — 보일 때만, 켜져 있을 때만 */
  useEffect(() => {
    if (!inView || !auto || reduced || n < 2) return;
    const t = window.setTimeout(() => {
      const next = (index + 1) % n;
      setIndex(next);
      scrollTo(next);
    }, ms);
    return () => clearTimeout(t);
  }, [index, inView, auto, reduced, n, ms, scrollTo]);

  const jump = (i: number) => { setAuto(false); setIndex(i); scrollTo(i); };

  return (
    <div className={tone === "dark" ? "lp5-deck lp5-deck-dark" : "lp5-deck"}>
      <div className="lp5-deck-rail" ref={railRef} aria-label={label}>
        {slides.map((s, i) => (
          <div key={i} className={i === index ? "lp5-deck-slide lp5-deck-slide-on" : "lp5-deck-slide"}>{s}</div>
        ))}
      </div>
      <div className="lp5-deck-ctrl">
        <div className="lp5-deck-dots">
          {slides.map((s, i) => (
            <button
              key={i} type="button"
              className={i === index ? "lp5-deck-dot lp5-deck-dot-on" : "lp5-deck-dot"}
              aria-label={`${label} ${i + 1}번째`} aria-current={i === index}
              onClick={() => jump(i)}
            />
          ))}
        </div>
        {!reduced && n > 1 && (
          <button
            type="button" className="lp5-deck-play" aria-pressed={auto}
            aria-label={auto ? "자동 넘김 멈추기" : "자동 넘김 시작"}
            onClick={() => setAuto((v) => !v)}
          >
            {auto
              ? <svg viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="1" width="3.4" height="12" rx="1" /><rect x="7.6" y="1" width="3.4" height="12" rx="1" /></svg>
              : <svg viewBox="0 0 12 14" aria-hidden="true"><path d="M2 1.2 L11 7 L2 12.8 Z" /></svg>}
          </button>
        )}
        <span className="lp5-deck-count">{index + 1} / {n}</span>
      </div>
    </div>
  );
}
