"use client";

// ══ AI 미니 데모 레일 (2026-07-30) ══
//   사장님: "애플 인텔리전스 페이지처럼 1열로 화면 꽉 차게, 옆으로 계속 넘어가게."
//
//   ▸ 왜 영상(mp4)이 아닌가 — 6개면 합쳐 10MB 안팎이라 폰에서 LCP·데이터를 먹고,
//     문구 하나 고치려면 재촬영해야 하고, 확대하면 흐리다. 코드로 그린 화면은
//     용량이 사실상 0이고 문구·숫자는 content.ts 에서 바로 고친다.
//   ▸ 재생은 "지금 보고 있는 한 장"만. 여섯 개를 동시에 무한 반복하면 읽는 동안
//     시야가 계속 흔들리고 저사양 폰에서 프레임이 떨어진다(사장님 지시).
//     구간이 화면에서 벗어나면 전부 멈춘다.
//   ▸ 자동 넘김은 기본 켜짐. 사용자가 도트를 누르거나 손으로 넘기는 순간 끄고
//     그 뒤로는 사용자가 넘긴다(다시 켜려면 재생 버튼).
//   ▸ 숫자는 데모용 예시값이다 — 실제 고객 데이터가 아니다. 화면 아래 한 줄로 밝힌다.
//   스타일은 landing-v6.css 의 lp5-aid-* (연출 타이밍도 CSS 에 있다 — 한곳에서 조율).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AI_DEMOS, AI_DEMO_TAG } from "@/components/landing/content";

const HOLD = 2000;      // 연출이 끝난 뒤 마지막 화면에 머무는 시간

/* ══════════ 화면 6종 — 실제 앱 화면과 같은 구조로 그린다 ══════════ */

function ScreenCopilot() {
  return (
    <div className="lp5-aid-screen lp5-aid-cop" data-demo="copilot" data-len={4100}>
      <div className="lp5-aid-top"><span className="lp5-aid-tab">AI 참모</span><span className="lp5-aid-meta">회사 데이터 기준</span></div>
      <div className="lp5-aid-ask"><span className="lp5-aid-type" data-type="이번 주에 제일 급한 게 뭐야?" data-delay={150} /></div>
      <div className="lp5-aid-think"><i /><i /><i /></div>
      <p className="lp5-aid-head lp5-aid-anim">미수금 회수가 가장 급합니다.</p>
      <div className="lp5-aid-acts">
        <div className="lp5-aid-act lp5-aid-anim">
          <span className="lp5-aid-chip lp5-aid-chip-watch">먼저</span>
          <p><b>디자인랩 1,650만원</b> <span>— 입금 예정일 12일 지남</span></p>
        </div>
        <div className="lp5-aid-act lp5-aid-anim">
          <span className="lp5-aid-chip lp5-aid-chip-plain">다음</span>
          <p><b>세금계산서 3건 미발행</b> <span>— 이번 달 마감 전</span></p>
        </div>
        <div className="lp5-aid-act lp5-aid-anim">
          <span className="lp5-aid-chip lp5-aid-chip-plain">다음</span>
          <p><b>용역계약 2건 만료 임박</b> <span>— 8월 중 갱신 여부 확인</span></p>
        </div>
      </div>
      <div className="lp5-aid-evi">
        <span className="lp5-aid-chip lp5-aid-chip-plain lp5-aid-anim">근거 · 미수금 3,240만원</span>
        <span className="lp5-aid-chip lp5-aid-chip-plain lp5-aid-anim">근거 · 이번 달 매출 8,700만원</span>
        <span className="lp5-aid-chip lp5-aid-chip-plain lp5-aid-anim">근거 · 현금 잔액 4,820만원</span>
      </div>
    </div>
  );
}

const TX_ROWS = [
  { d: "07·28", n: "(주)디자인랩", a: "매출 · 과세", v: "+8,800,000", out: false },
  { d: "07·28", n: "아마존웹서비스", a: "지급수수료 · 불공제", v: "−412,300", out: true },
  { d: "07·27", n: "스타벅스 역삼점", a: "복리후생비 · 과세", v: "−38,000", out: true },
  { d: "07·27", n: "한국전력공사", a: "수도광열비 · 과세", v: "−286,410", out: true },
  { d: "07·26", n: "(주)위드파트너스", a: "매출 · 과세", v: "+3,300,000", out: false },
];

function ScreenTx() {
  return (
    <div className="lp5-aid-screen lp5-aid-tx" data-demo="tx" data-len={3700}>
      <div className="lp5-aid-top"><span className="lp5-aid-tab">거래 장부</span><span className="lp5-aid-meta">신규 6건</span></div>
      <div className="lp5-aid-txbody">
        {TX_ROWS.map((r) => (
          <div key={r.n} className="lp5-aid-txrow">
            <span className="lp5-aid-txdate lp5-aid-fig">{r.d}</span>
            <span className="lp5-aid-txname">{r.n}<em className="lp5-aid-anim">{r.a}</em></span>
            <span className={r.out ? "lp5-aid-txamt lp5-aid-txamt-out lp5-aid-fig" : "lp5-aid-txamt lp5-aid-fig"}>{r.v}</span>
          </div>
        ))}
        <div className="lp5-aid-txrow">
          <span className="lp5-aid-txdate lp5-aid-fig">07·26</span>
          <span className="lp5-aid-txname">김○○ 이체
            <em className="lp5-aid-anim"><span className="lp5-aid-chip lp5-aid-chip-watch">확인 필요 · 입금자명 불명확</span></em>
          </span>
          <span className="lp5-aid-txamt lp5-aid-fig">+1,200,000</span>
        </div>
      </div>
      <div className="lp5-aid-txfoot lp5-aid-anim">
        <b>5건 분류 완료.</b><span className="lp5-aid-type" data-type="1건은 대표님 확인 후 확정" data-delay={3000} />
      </div>
    </div>
  );
}

const WAY_ROWS = [
  { k: "계약", sub: "용역계약 · 07/02 체결" },
  { k: "세금계산서", sub: "#0142 · 07/25 발행" },
  { k: "입금", sub: "기업은행 · 모티브리뉴얼" },
];

function ScreenWay() {
  return (
    <div className="lp5-aid-screen lp5-aid-way" data-demo="way" data-len={4000}>
      <div className="lp5-aid-top"><span className="lp5-aid-tab">모티브 리뉴얼</span><span className="lp5-aid-meta">미정산 대조</span></div>
      <div className="lp5-aid-waybody">
        {WAY_ROWS.map((r) => (
          <div key={r.k} className="lp5-aid-wayitem" data-way="">
            <span className="lp5-aid-waymark">✓</span>
            <span className="lp5-aid-waylbl"><b>{r.k}</b>{r.sub}</span>
            <span className="lp5-aid-wayamt lp5-aid-fig">3,300,000</span>
          </div>
        ))}
      </div>
      <div className="lp5-aid-waysum">
        <span className="lp5-aid-type" data-type="세 금액 일치 · 전표 초안 만들었어요" data-delay={2100} />
        <span className="lp5-aid-chip lp5-aid-chip-done lp5-aid-pop">확정 대기</span>
      </div>
    </div>
  );
}

function ScreenRadar() {
  return (
    <div className="lp5-aid-screen lp5-aid-rad" data-demo="radar" data-len={3100}>
      <div className="lp5-aid-top"><span className="lp5-aid-tab">경영 흐름</span><span className="lp5-aid-meta">자동 동기화 · 하루 2회</span></div>
      <div className="lp5-aid-radaccs">
        <div className="lp5-aid-radacc lp5-aid-anim"><span>기업은행 ···1234</span><b className="lp5-aid-fig">2,140만원</b></div>
        <div className="lp5-aid-radacc lp5-aid-anim"><span>국민은행 ···8802</span><b className="lp5-aid-fig">1,860만원</b></div>
        <div className="lp5-aid-radacc lp5-aid-anim"><span>법인카드 (신한)</span><b className="lp5-aid-fig">820만원</b></div>
      </div>
      <div className="lp5-aid-radsum lp5-aid-anim">
        <span className="lp5-aid-radsum-l">합계 잔고</span>
        <span className="lp5-aid-radsum-v lp5-aid-fig" data-count={4820} data-delay={760}>0</span>
        <span className="lp5-aid-radsum-u">만원</span>
        <span className="lp5-aid-chip lp5-aid-chip-plain lp5-aid-anim">월 고정비 1,340만원</span>
      </div>
      {/* 예측 곡선 — 고정 높이로 늘리면 대각선 굵기가 구간마다 달라져 viewBox 비율을 따른다 */}
      <div className="lp5-aid-radgraph">
        <svg viewBox="0 0 268 58" role="img" aria-label="향후 90일 잔고 예측 — 11월 셋째 주 바닥">
          <defs>
            <linearGradient id="lp5AidRadFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F46E5" stopOpacity=".18" />
              <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="lp5-aid-radfill" d="M4,11 L48,17 L92,14 L136,26 L180,33 L224,44 L260,53 L260,58 L4,58 Z" />
          <path className="lp5-aid-radline" d="M4,11 L48,17 L92,14 L136,26 L180,33 L224,44 L260,53" />
          <line className="lp5-aid-radmark" x1="224" y1="0" x2="224" y2="58" />
          <circle className="lp5-aid-radend" cx="260" cy="53" r="3.4" />
        </svg>
      </div>
      <div className="lp5-aid-radverdict">
        <span className="lp5-aid-chip lp5-aid-chip-risk lp5-aid-pop">주의</span>
        <span className="lp5-aid-type" data-type="생존 3.6개월 · 11월 셋째 주" data-delay={2450} />
      </div>
    </div>
  );
}

const PIPE_STEPS = [["견적", "승인"], ["계약서", "초안"], ["서명", "요청"], ["서명", "완료"]];

function ScreenPipe() {
  return (
    <div className="lp5-aid-screen lp5-aid-pipe" data-demo="pipe" data-len={3700}>
      <div className="lp5-aid-top"><span className="lp5-aid-tab">모티브 리뉴얼 · 3,300,000원</span><span className="lp5-aid-meta">진행</span></div>
      <div className="lp5-aid-steps">
        {PIPE_STEPS.map(([a, b], i) => (
          <span key={a + b} className="lp5-aid-stepwrap">
            {i > 0 && <span className="lp5-aid-link" data-link=""><i /></span>}
            {/* ⚠️ 이 동그라미를 lp5-aid-dot 으로 뒀더니 하단 캐러셀 도트(같은 이름)와 서로
                덮어써서 7px 점으로 쪼그라들었다(실측). 이름을 분리해 둔다. */}
            <span className="lp5-aid-step" data-step="">
              <span className="lp5-aid-stepdot">✓</span>
              <span className="lp5-aid-lbl">{a}<br />{b}</span>
            </span>
          </span>
        ))}
      </div>
      <div className="lp5-aid-doc lp5-aid-anim">
        <div className="lp5-aid-dochead">
          <span>용역계약서 초안</span>
          <span className="lp5-aid-chip lp5-aid-chip-plain lp5-aid-pop">회사 서식</span>
        </div>
        <div className="lp5-aid-docrows">
          <div className="lp5-aid-docrow lp5-aid-anim"><span>계약금액</span><b className="lp5-aid-fig">3,300,000원 (부가세 포함)</b></div>
          <div className="lp5-aid-docrow lp5-aid-anim"><span>계약기간</span><b className="lp5-aid-fig">2026·08·01 ~ 10·31</b></div>
          <div className="lp5-aid-docrow lp5-aid-anim"><span>대금지급</span><b>납품 확인 후 7일 이내</b></div>
        </div>
        <div className="lp5-aid-doclines"><i /><i /><i /></div>
      </div>
      <div className="lp5-aid-sign">
        <span className="lp5-aid-signwho"><b>(주)디자인랩 김대표</b>07/26 14:20 서명</span>
        <span className="lp5-aid-chip lp5-aid-chip-done lp5-aid-pop">완료 · 잠금</span>
      </div>
    </div>
  );
}

const DOC_FIELDS = [
  ["상호", "한우리 식당", false],
  ["날짜", "2026·07·26", true],
  ["금액", "143,000원", true],
  ["부가세", "13,000원", true],
  ["사업자", "214-81-····", true],
] as const;

function ScreenDoc() {
  return (
    <div className="lp5-aid-screen lp5-aid-doc2" data-demo="doc" data-len={3300}>
      <div className="lp5-aid-top"><span className="lp5-aid-tab">경비 영수증</span><span className="lp5-aid-meta">사진 1장</span></div>
      <div className="lp5-aid-scan">
        <div className="lp5-aid-paper">
          <i /><i /><i /><i /><i />
          <span className="lp5-aid-sweep" />
        </div>
        <div className="lp5-aid-fields">
          {DOC_FIELDS.map(([k, v, fig]) => (
            <div key={k} className="lp5-aid-field lp5-aid-anim">
              <span>{k}</span><b className={fig ? "lp5-aid-fig" : undefined}>{v}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="lp5-aid-docfoot lp5-aid-anim">
        <span className="lp5-aid-chip lp5-aid-chip-plain">접대비 · 과세</span>
        <span className="lp5-aid-type" data-type="경비 정산으로 넘겼어요" data-delay={2750} />
      </div>
    </div>
  );
}

const SCREENS: Record<string, () => ReactNode> = {
  copilot: ScreenCopilot, tx: ScreenTx, way: ScreenWay,
  radar: ScreenRadar, pipe: ScreenPipe, doc: ScreenDoc,
};

/* ══════════ 레일 ══════════ */

export function AiDemoRail() {
  const railRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const progRef = useRef(false);          // 프로그램이 굴린 스크롤 — 사용자 조작으로 오해하지 않게
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);  // 같은 장을 다시 재생할 때만 올린다
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  /* 구간이 화면에 있을 때만 돈다 */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const io = new IntersectionObserver((es) => setInView(es[0].isIntersecting), { threshold: 0.3 });
    io.observe(rail);
    return () => io.disconnect();
  }, []);

  const scrollTo = useCallback((i: number, smooth: boolean) => {
    const rail = railRef.current;
    const slide = rail?.children[i] as HTMLElement | undefined;
    if (!rail || !slide) return;
    progRef.current = true;
    // 카드 폭이 장마다 달라 그 장의 폭으로 중앙을 잡는다.
    // ⚠️ offsetLeft 는 offsetParent 기준이라 레일 위치를 빼야 스크롤 좌표가 된다.
    rail.scrollTo({
      left: (slide.offsetLeft - rail.offsetLeft) - (rail.clientWidth - slide.clientWidth) / 2,
      behavior: smooth ? "smooth" : "auto",
    });
    // 스크롤 이벤트가 아예 안 오는 경우(이미 그 자리)를 대비한 안전장치 — 자동 넘김은 건드리지 않는다.
    window.setTimeout(() => { progRef.current = false; }, 1200);
  }, []);

  /* 사용자가 손으로 넘기면 그 뒤로는 사용자가 넘긴다 */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let t = 0;
    const onScroll = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (progRef.current) { progRef.current = false; return; }  // 자동 넘김이 굴린 스크롤
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

  /* 재생 — 보고 있는 한 장만. 옆 장은 "끝난 화면"으로 세워둔다(반쯤 빈 화면은 고장처럼 읽힌다). */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const screens = Array.from(rail.querySelectorAll<HTMLElement>(".lp5-aid-screen"));
    clearTimers();

    const settle = (el: HTMLElement) => {
      el.classList.remove("lp5-aid-play");
      el.classList.add("lp5-aid-done");
      el.querySelectorAll<HTMLElement>("[data-type]").forEach((t) => { t.textContent = t.dataset.type ?? ""; });
      el.querySelectorAll<HTMLElement>("[data-count]").forEach((c) => {
        c.textContent = Number(c.dataset.count).toLocaleString("ko-KR");
      });
      el.querySelectorAll<HTMLElement>("[data-step]").forEach((s) => s.classList.add("lp5-aid-step-on"));
      el.querySelectorAll<HTMLElement>("[data-link]").forEach((s) => s.classList.add("lp5-aid-link-on"));
      el.querySelectorAll<HTMLElement>("[data-way]").forEach((s) => s.classList.add("lp5-aid-way-on"));
    };

    screens.forEach((el, i) => { if (i !== index) settle(el); });
    const cur = screens[index];
    if (!cur) return;
    if (!inView) return;                       // 화면 밖 — 타이머를 하나도 남기지 않는다
    if (reduced) { settle(cur); return; }       // 모션 최소화 — 결과 화면만

    cur.classList.remove("lp5-aid-done", "lp5-aid-play");
    void cur.offsetWidth;                      // 리플로우 강제 — 없으면 같은 장을 다시 재생할 수 없다
    cur.classList.add("lp5-aid-play");

    cur.querySelectorAll<HTMLElement>("[data-type]").forEach((el) => {
      const text = el.dataset.type ?? "";
      el.textContent = "";
      el.classList.remove("lp5-aid-caret");
      later(() => {
        el.classList.add("lp5-aid-caret");
        let n = 0;
        const step = () => {
          el.textContent = text.slice(0, ++n);
          if (n < text.length) later(step, 42);
          else later(() => el.classList.remove("lp5-aid-caret"), 1200);
        };
        step();
      }, Number(el.dataset.delay ?? 0));
    });

    cur.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
      const target = Number(el.dataset.count);
      el.textContent = "0";
      later(() => {
        const t0 = performance.now();
        const frame = (now: number) => {
          const p = Math.min(1, (now - t0) / 900);
          el.textContent = Math.round(target * (1 - (1 - p) ** 3)).toLocaleString("ko-KR");
          if (p < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, Number(el.dataset.delay ?? 0));
    });

    // 단계가 차례로 켜지는 두 화면은 transition 이라 시점을 JS 가 준다.
    const steps = (sel: string, on: string, at: number[]) => {
      const items = Array.from(cur.querySelectorAll<HTMLElement>(sel));
      items.forEach((el) => el.classList.remove(on));
      items.forEach((el, i) => later(() => el.classList.add(on), at[i] ?? 0));
    };
    if (cur.dataset.demo === "pipe") {
      steps("[data-step]", "lp5-aid-step-on", [0, 650, 1850, 2350]);
      steps("[data-link]", "lp5-aid-link-on", [200, 850, 2050]);
    }
    if (cur.dataset.demo === "way") steps("[data-way]", "lp5-aid-way-on", [600, 1150, 1700]);

    const len = Number(cur.dataset.len ?? 3400);
    later(() => {
      if (auto) {
        const next = (index + 1) % screens.length;
        scrollTo(next, true);
        setIndex(next);
      } else {
        setCycle((c) => c + 1);                // 자동 넘김을 끈 상태 — 제자리에서 다시
      }
    }, len + HOLD);

    return clearTimers;
  }, [index, cycle, auto, inView, reduced, clearTimers, later, scrollTo]);

  const jump = (i: number) => { setAuto(false); setIndex(i); scrollTo(i, true); };

  return (
    <div className="lp5-aid">
      <div
        className="lp5-aid-rail"
        ref={railRef}
        tabIndex={0}
        aria-label="AI 기능 데모"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); jump(Math.min(index + 1, AI_DEMOS.length - 1)); }
          if (e.key === "ArrowLeft") { e.preventDefault(); jump(Math.max(index - 1, 0)); }
        }}
      >
        {AI_DEMOS.map((d, i) => {
          const Screen = SCREENS[d.key];
          const size = d.size === "lg" ? "lp5-aid-lg" : d.size === "md" ? "lp5-aid-md" : "lp5-aid-sm";
          const stack = "stack" in d && d.stack ? " lp5-aid-stack" : "";
          return (
            <article key={d.key} className={`lp5-aid-slide ${size}${stack}${i === index ? " lp5-aid-slide-on" : ""}`}>
              <div className="lp5-aid-copy">
                <div className="lp5-aid-kick">
                  <span className="lp5-aid-kicknum">{d.num} · {d.eng}</span>
                  <span className={d.kind === "ai" ? "lp5-aid-tag lp5-aid-tag-ai" : "lp5-aid-tag lp5-aid-tag-auto"}>
                    {AI_DEMO_TAG[d.kind]}
                  </span>
                </div>
                <h3 className="lp5-aid-name">{d.name}</h3>
                <p className="lp5-aid-desc">{d.desc}</p>
                <p className="lp5-aid-beat">{d.beat}</p>
                <p className="lp5-aid-where">{d.where}</p>
              </div>
              <Screen />
            </article>
          );
        })}
      </div>

      <div className="lp5-aid-ctrl">
        <div className="lp5-aid-dots">
          {AI_DEMOS.map((d, i) => (
            <button
              key={d.key} type="button"
              className={i === index ? "lp5-aid-dot lp5-aid-dot-on" : "lp5-aid-dot"}
              aria-label={`${d.name} 보기`} aria-current={i === index}
              onClick={() => jump(i)}
            />
          ))}
        </div>
        {!reduced && (
          <button
            type="button" className="lp5-aid-play-btn" aria-pressed={auto}
            aria-label={auto ? "자동 넘김 멈추기" : "자동 넘김 시작"}
            onClick={() => setAuto((v) => !v)}
          >
            {auto
              ? <svg viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="1" width="3.4" height="12" rx="1" /><rect x="7.6" y="1" width="3.4" height="12" rx="1" /></svg>
              : <svg viewBox="0 0 12 14" aria-hidden="true"><path d="M2 1.2 L11 7 L2 12.8 Z" /></svg>}
          </button>
        )}
        <span className="lp5-aid-note">화면 속 숫자는 예시예요</span>
      </div>
    </div>
  );
}
