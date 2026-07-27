"use client";

// 랜딩 라이브 패널 (2026-07-27) — 정지 캡처 대신 "일이 돌아가는" 모습을 보여준다.
//   사장님: "그래프도 변하고, 채팅창에서는 채팅이 실시간 작성되는 것처럼, 업무에 생동감이 있게".
//   화면에 들어올 때만 재생하고, 모션 최소화 설정이면 최종 상태를 즉시 보여준다(깜빡임 없음).
//   ⚠️ 실제 제품 화면(캡처)을 대체하는 게 아니라, 그 옆에서 움직임을 담당하는 보조 연출이다.

import { useEffect, useRef, useState } from "react";

const won = (n: number) => "₩" + n.toLocaleString("ko-KR");

/** 화면에 들어왔는지 + 모션 허용 여부 */
function usePlay<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [play, setPlay] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const el = ref.current; if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setPlay(true); return; }
    const io = new IntersectionObserver((es) => setPlay(es[0].isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, play, reduced };
}

/** 0 → to 로 차오르는 숫자 */
function useCountUp(to: number, play: boolean, reduced: boolean, dur = 1100) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) { setN(to); return; }
    if (!play) { setN(0); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, play, reduced, dur]);
  return n;
}

/** 한 항목씩 늘어나는 스텝 */
function useSteps(count: number, play: boolean, reduced: boolean, gap = 620) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) { setI(count); return; }
    if (!play) { setI(0); return; }
    let step = 0;
    setI(0);
    const t = setInterval(() => {
      step += 1;
      setI(step);
      if (step >= count) clearInterval(t);
    }, gap);
    return () => clearInterval(t);
  }, [count, play, reduced, gap]);
  return i;
}

// ── AI 브리핑 — 문장이 한 줄씩 도착하고 잔고가 차오른다
export function LiveBrief() {
  const { ref, play, reduced } = usePlay<HTMLDivElement>();
  const bal = useCountUp(166_335_596, play, reduced);
  const lines = [
    "오늘 아침 통장에는 1억 6,633만원이 있어요.",
    "30일 뒤에는 1,500만원 정도 줄어들 것으로 보여요.",
    "승인 대기 11건, 주의가 필요한 프로젝트가 3건 있어요.",
  ];
  const shown = useSteps(lines.length, play, reduced, 760);

  return (
    <div className="lv" ref={ref}>
      <div className="lv-head"><span className="lv-dot lv-dot-ok" />MORNING BRIEF</div>
      <div className="lv-bal">{won(bal)}</div>
      <div className="lv-cap">오늘 아침 통장 잔고</div>
      <div className="lv-lines">
        {lines.map((t, i) => (
          <div key={t} className={`lv-line ${i < shown ? "lv-in" : ""}`}>{t}</div>
        ))}
      </div>
    </div>
  );
}

// ── 견적 — 품목이 한 줄씩 추가되며 합계가 올라간다
export function LiveQuote() {
  const { ref, play, reduced } = usePlay<HTMLDivElement>();
  const items = [
    { n: "UX 리서치 · 정보구조 설계", v: 6_000_000 },
    { n: "UI 디자인 (12개 화면)", v: 9_600_000 },
    { n: "디자인 시스템 구축", v: 4_000_000 },
    { n: "퍼블리싱 · QA", v: 3_400_000 },
  ];
  const shown = useSteps(items.length, play, reduced, 540);
  const supply = items.slice(0, shown).reduce((s, i) => s + i.v, 0);
  const total = Math.round(supply * 1.1);

  return (
    <div className="lv" ref={ref}>
      <div className="lv-head"><span className="lv-dot" />견적서 작성</div>
      <div className="lv-rows">
        {items.map((it, i) => (
          <div key={it.n} className={`lv-row ${i < shown ? "lv-in" : ""}`}>
            <span>{it.n}</span><b>{won(it.v)}</b>
          </div>
        ))}
      </div>
      <div className="lv-total"><span>합계 (VAT 포함)</span><b>{won(total)}</b></div>
      <div className="lv-pay">
        <span className="lv-seg lv-seg-a" style={{ width: "30%" }}>선금 30%</span>
        <span className="lv-seg lv-seg-b" style={{ width: "40%" }}>중도금 40%</span>
        <span className="lv-seg lv-seg-c" style={{ width: "30%" }}>잔금 30%</span>
      </div>
    </div>
  );
}

// ── 근태 — 막대가 차오르고 출근율이 올라간다
export function LiveAttend() {
  const { ref, play, reduced } = usePlay<HTMLDivElement>();
  const rate = useCountUp(964, play, reduced, 1000);
  const bars = [72, 88, 64, 95, 81, 90, 76];

  return (
    <div className="lv" ref={ref}>
      <div className="lv-head"><span className="lv-dot" />이번 달 근태</div>
      <div className="lv-bal">{(rate / 10).toFixed(1)}%</div>
      <div className="lv-cap">정상 출근율</div>
      <div className="lv-bars">
        {bars.map((h, i) => (
          <span key={i} className="lv-bar" style={{ height: play || reduced ? `${h}%` : "6%", transitionDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <div className="lv-chips">
        <span className="lv-chip">지각 3건</span>
        <span className="lv-chip">연차 18일</span>
        <span className="lv-chip">연장 42h</span>
      </div>
    </div>
  );
}

// ── 3-Way 매칭 — 카드가 순서대로 확인되며 매칭 완료
export function LiveMatch() {
  const { ref, play, reduced } = usePlay<HTMLDivElement>();
  const cards = [
    { cap: "계약", sub: "B사 UI/UX 리뉴얼" },
    { cap: "세금계산서", sub: "국세청 승인" },
    { cap: "입금", sub: "기업은행" },
  ];
  const shown = useSteps(cards.length + 1, play, reduced, 620);

  return (
    <div className="lv" ref={ref}>
      <div className="lv-head"><span className="lv-dot" />정산 확인 · 3-Way 매칭</div>
      <div className="lv-match">
        {cards.map((c, i) => (
          <div key={c.cap} className={`lv-mcard ${i < shown ? "lv-in" : ""}`}>
            <div className="lv-mcap">{c.cap}</div>
            <div className="lv-mval">₩25,300,000</div>
            <div className="lv-msub">{c.sub}</div>
            <span className={`lv-mcheck ${i < shown ? "lv-in" : ""}`}>✓</span>
          </div>
        ))}
      </div>
      <div className={`lv-note ${shown > cards.length ? "lv-in" : ""}`}>세 금액이 일치해요 · 전표를 자동으로 만들었어요</div>
    </div>
  );
}

// ── 현금 예측 — 막대가 자라고 위험 구간이 색으로 바뀐다
export function LiveForecast() {
  const { ref, play, reduced } = usePlay<HTMLDivElement>();
  const pts = [
    { l: "현재", v: 100, warn: false },
    { l: "D+30", v: 86, warn: false },
    { l: "D+60", v: 71, warn: true },
    { l: "D+90", v: 61, warn: true },
  ];
  return (
    <div className="lv" ref={ref}>
      <div className="lv-head"><span className="lv-dot" />90일 현금 예측</div>
      <div className="lv-fc">
        {pts.map((p, i) => (
          <div key={p.l} className="lv-fcol">
            <div className="lv-fbar-wrap">
              <span
                className={`lv-fbar ${p.warn ? "lv-fbar-warn" : ""}`}
                style={{ height: play || reduced ? `${p.v}%` : "4%", transitionDelay: `${i * 130}ms` }}
              />
            </div>
            <div className="lv-flabel">{p.l}</div>
          </div>
        ))}
      </div>
      <div className="lv-note lv-in">D+60 부터 위험 구간이에요 · 미수금을 회수하면 해소돼요</div>
    </div>
  );
}

// ── 메신저 — 메시지가 타이핑되며 도착한다
export function LiveChat() {
  const { ref, play, reduced } = usePlay<HTMLDivElement>();
  const msgs = [
    { me: false, who: "박서연", t: "B사 디자인 시안 올렸어요!" },
    { me: true, who: "나", t: "확인했어요. 계약서 초안도 보낼게요" },
    { me: false, who: "이준호", t: "견적 승인 떨어졌습니다 🎉" },
  ];
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduced) { setShown(msgs.length); return; }
    if (!play) { setShown(0); setTyping(false); return; }
    let i = 0;
    setShown(0);
    let t1: ReturnType<typeof setTimeout>;
    const step = () => {
      setTyping(true);
      t1 = setTimeout(() => {
        setTyping(false);
        i += 1;
        setShown(i);
        if (i < msgs.length) t1 = setTimeout(step, 520);
      }, 780);
    };
    t1 = setTimeout(step, 320);
    return () => clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, reduced]);

  return (
    <div className="lv" ref={ref}>
      <div className="lv-head"><span className="lv-dot lv-dot-ok" />프로젝트 채널 · B사 리뉴얼</div>
      <div className="lv-chat">
        {msgs.slice(0, shown).map((m) => (
          <div key={m.t} className={`lv-msg ${m.me ? "lv-msg-me" : ""} lv-in`}>
            {!m.me && <span className="lv-who">{m.who}</span>}
            <span className="lv-bubble">{m.t}</span>
          </div>
        ))}
        {typing && (
          <div className="lv-msg">
            <span className="lv-bubble lv-typing"><i /><i /><i /></span>
          </div>
        )}
      </div>
    </div>
  );
}

export const LIVE: Record<string, () => React.JSX.Element> = {
  brief: LiveBrief,
  quote: LiveQuote,
  attend: LiveAttend,
  match: LiveMatch,
  forecast: LiveForecast,
  chat: LiveChat,
};
