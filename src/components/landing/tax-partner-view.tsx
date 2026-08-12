"use client";

// 세무사 제휴 모집 랜딩 (2026-08-11, 08-12 확장 — 사장님: "더 길게, 애니메이션 더") —
//   lp4 세계관 + 이 페이지만의 장면들. 전부 자체 구현(IO·rAF·CSS), 라이브러리 0, reduced-motion 존중.
//   ① 히어로: 자료 요청 채팅이 줄 그이며 사라지고 통장 카드가 떠올라 둥실거린다
//   ② 비포/애프터: 기존 기장 하루의 할 일이 하나씩 그어진다
//   ③ 3단계 진행선 드로잉
//   ④ 스크롤 고정 스토리: 카드가 화면에 붙고, 스크롤에 따라 세금계산서→통장→인건비로 전환
//   ⑤ 지면 3종 카운트업 ⑥ 부가세 시즌 타임라인 점등 ⑦ 숫자 밴드 ⑧ 신뢰 ⑨ FAQ ⑩ CTA
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import "@/app/landing.css";
import "@/app/tax-partners.css";

/** 화면에 들어오면 .tpx-in — 요소별 지연은 style={{ "--d": ".1s" }} 로 준다 */
function useReveal(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-tpx]"));
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("tpx-in"); io.unobserve(e.target); } }),
      { threshold: 0.22, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rootRef]);
}

/** 화면에 들어오면 0 → to 카운트업 (탭ular, 감속 이징) */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVal(to); return; }
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const dur = 1100;
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{val.toLocaleString("ko-KR")}{suffix}</span>;
}

const Check = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
);

/* ── ② 비포/애프터: 기존 하루의 할 일이 하나씩 그어진다 ── */
const OLD_DAY = [
  "고객사마다 전화·카톡으로 자료 요청",
  "통장 내역 엑셀 올 때까지 대기",
  "세금계산서 파일 수합·정리",
  "급여대장 따로 요청해서 대조",
  "받은 파일을 세무 프로그램에 수기 입력",
];
function BeforeAfter() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) { setOn(true); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section className="lp4-section lp4-bg-canvas" id="before-after">
      <div className="lp4-container">
        <div className="lp4-sec-head lp4-sec-head-c" data-tpx>
          <div className="lp4-eyebrow">기장 하루의 변화</div>
          <h2 className="lp4-h2">수합하는 날이, 검토하는 날로</h2>
          <p className="lp4-sub">자료를 모으는 시간이 사라지면, 그 시간은 검토와 상담으로 돌아갑니다.</p>
        </div>
        <div className="tpx-ba-grid" ref={ref}>
          <div className="tpx-ba-col tpx-ba-old" data-tpx>
            <div className="tpx-ba-title">지금까지의 아침</div>
            {OLD_DAY.map((t, i) => (
              <div key={t} className={`tpx-ba-item ${on ? "tpx-ba-strike" : ""}`} style={{ "--sd": `${0.5 + i * 0.45}s` } as React.CSSProperties}>
                <span className="tpx-ba-line" />{t}
              </div>
            ))}
          </div>
          <div className="tpx-ba-arrow" data-tpx style={{ "--d": ".3s" } as React.CSSProperties} aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" /></svg>
          </div>
          <div className="tpx-ba-col tpx-ba-new" data-tpx style={{ "--d": ".2s" } as React.CSSProperties}>
            <div className="tpx-ba-title">오너뷰 파트너의 아침</div>
            <div className="tpx-ba-done">
              <Check />
              <div>
                <b>이미 정리되어 있습니다</b>
                <p>통장·세금계산서·인건비가 신고 기준으로 도착해 있어, 바로 검토를 시작합니다.</p>
              </div>
            </div>
            <div className="tpx-ba-clock">
              <span className="tpx-ba-clock-n"><CountUp to={0} suffix="시간" /></span>
              <span className="tpx-ba-clock-l">오늘 자료 수합에 쓴 시간</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── ④ 스크롤 고정 스토리 — 카드가 붙고, 스크롤이 지면을 넘긴다 ── */
const STORY = [
  {
    k: "세금계산서", t: "발행되는 순간, 세무사님 지면에도",
    d: "고객사가 발행·수취하는 계산서가 매출/매입으로 나뉘어 쌓이고 분기 부가세 추정까지 계산됩니다.",
    rows: [
      ["08-10", "매출 · QA시드상사 디자인 용역", "+11,000,000", "in"],
      ["08-08", "매입 · 서버클라우드 인프라", "−1,320,000", "out"],
      ["08-06", "매입 · 오피스월드 사무용품", "−880,000", "out"],
    ],
    foot: ["분기 부가세 추정", "1,300,000원"],
  },
  {
    k: "통장 · 카드", t: "입출금이 잉크색 그대로",
    d: "전 계좌 잔고와 거래, 법인카드 사용까지 — 증빙 대조에 필요한 원장이 한 지면에 인쇄됩니다.",
    rows: [
      ["08-10", "거래처 용역대금 입금", "+11,000,000", "in"],
      ["08-09", "사무용품 결제", "−880,000", "out"],
      ["08-07", "7월 급여 이체", "−3,200,000", "out"],
    ],
    foot: ["통장 잔고 합계", "42,370,000원"],
  },
  {
    k: "인건비", t: "원천세 신고 자료가 따로 없게",
    d: "월별 급여·4대보험·소득세가 직원 단위로 정리됩니다. 급여대장을 요청할 일이 없습니다.",
    rows: [
      ["7월", "김직원 · 실지급", "2,840,000", "in"],
      ["7월", "이직원 · 실지급", "2,510,000", "in"],
      ["7월", "소득세+지방소득세 합계", "312,400", "out"],
    ],
    foot: ["7월 인건비 합계", "5,350,000원"],
  },
];
function StickyStory() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        if (total <= 0) return;
        const p = Math.min(1, Math.max(0, -r.top / total));
        setActive(p < 1 / 3 ? 0 : p < 2 / 3 ? 1 : 2);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  const s = STORY[active];
  return (
    <section className="tpx-story" ref={wrapRef} id="story">
      <div className="tpx-story-sticky">
        <div className="lp4-container">
          <div className="tpx-story-grid">
            <div>
              <div className="lp4-eyebrow">스크롤로 지면 넘기기</div>
              <h2 className="lp4-h2" style={{ maxWidth: 420 }}>한 권의 장부처럼,<br />넘기면 다음 지면</h2>
              <div className="tpx-story-steps">
                {STORY.map((st, i) => (
                  <div key={st.k} className={`tpx-story-step ${active === i ? "tpx-story-step-on" : ""}`}>
                    <span className="tpx-story-step-no">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <div className="tpx-story-step-k">{st.k}</div>
                      <div className="tpx-story-step-t">{st.t}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="tpx-story-book" key={active}>
              <div className="tpx-book tpx-book-static">
                <div className="tpx-book-cover">
                  <span className="tpx-book-name">{s.k}</span>
                  <span className="tpx-book-tag">OWNERVIEW PARTNERS</span>
                </div>
                <div className="tpx-book-rows">
                  {s.rows.map(([d, t, amt, dir], i) => (
                    <div key={i} className="tpx-book-row tpx-story-row" style={{ "--d": `${i * 0.09}s` } as React.CSSProperties}>
                      <span>{d}</span><b>{t}</b>
                      <span className={dir === "in" ? "tpx-amt-in" : "tpx-amt-out"}>{amt}</span>
                    </div>
                  ))}
                </div>
                <div className="tpx-book-foot">
                  <span className="tpx-book-foot-l">{s.foot[0]}</span>
                  <span className="tpx-book-foot-v">{s.foot[1]}</span>
                </div>
              </div>
              <p className="tpx-story-desc">{s.d}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── ⑥ 부가세 시즌 타임라인 — 신고 달이 순차 점등 ── */
const VAT_MONTHS = [
  ["1월", "2기 확정"], ["4월", "1기 예정"], ["7월", "1기 확정"], ["10월", "2기 예정"],
];
function VatSeason() {
  return (
    <section className="lp4-section lp4-bg-canvas" id="vat">
      <div className="lp4-container">
        <div className="lp4-sec-head lp4-sec-head-c" data-tpx>
          <div className="lp4-eyebrow">신고 시즌</div>
          <h2 className="lp4-h2">부가세 주간에도, 수합 0시간</h2>
          <p className="lp4-sub">신고 달마다 반복되던 자료 독촉이 사라집니다. 분기 매출·매입세액이 이미 나뉘어 있으니까요.</p>
        </div>
        <div className="tpx-vat" data-tpx>
          <div className="tpx-vat-line"><span className="tpx-vat-line-fill" /></div>
          <div className="tpx-vat-marks">
            {VAT_MONTHS.map(([m, label], i) => (
              <div key={m} className="tpx-vat-mark" style={{ "--vd": `${0.35 + i * 0.3}s` } as React.CSSProperties}>
                <span className="tpx-vat-dot" />
                <span className="tpx-vat-m">{m}</span>
                <span className="tpx-vat-l">{label}</span>
              </div>
            ))}
          </div>
          <div className="tpx-vat-note" data-tpx style={{ "--d": "1.4s" } as React.CSSProperties}>
            매 분기, 매출세액 − 매입세액 추정치가 지면 상단에 계산되어 있습니다
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── ⑦ 숫자 밴드 ── */
function NumberBand() {
  return (
    <section className="tpx-band" data-tpx>
      <div className="lp4-container">
        <div className="tpx-band-grid">
          <div className="tpx-band-item">
            <div className="tpx-band-n"><CountUp to={3} suffix="분" /></div>
            <div className="tpx-band-l">가입부터 첫 열람까지</div>
          </div>
          <div className="tpx-band-item">
            <div className="tpx-band-n"><CountUp to={0} suffix="회" /></div>
            <div className="tpx-band-l">고객사에 보내는 자료 요청</div>
          </div>
          <div className="tpx-band-item">
            <div className="tpx-band-n"><CountUp to={0} suffix="원" /></div>
            <div className="tpx-band-l">세무사님과 고객사의 추가 비용</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── ⑨ FAQ 아코디언 ── */
const FAQS = [
  ["비용이 정말 없나요?", "네. 세무사님 가입·이용 모두 무료이고, 고객사 좌석 요금에도 포함되지 않습니다. 오너뷰를 쓰는 고객사가 있다면 연결만 하면 됩니다."],
  ["고객사 자료를 실수로 바꾸게 되진 않나요?", "세무사 계정은 데이터베이스 차원에서 모든 쓰기가 차단되는 읽기 전용입니다. 화면의 버튼이 아니라 서버가 막기 때문에 실수로도 바뀌지 않습니다."],
  ["어떤 자료까지 볼 수 있나요?", "고객사가 권한을 부여한 메뉴만 보입니다. 기본으로 통장·카드·세금계산서·전표·인건비 등 세무 업무 지면이 열리고, 회사가 메뉴 단위로 조절합니다."],
  ["쓰던 세무 프로그램과 병행할 수 있나요?", "네. 각 지면을 엑셀(CSV)로 내려받아 쓰시던 프로그램에 그대로 반입하면 됩니다. 오너뷰는 자료가 모이는 쪽을 맡습니다."],
  ["담당 고객사가 여러 곳이면요?", "포털에 담당 고객사가 카드로 나란히 꽂히고, 열람 중에도 상단에서 회사를 바로 전환합니다. 연결 수 제한은 없습니다."],
];
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="lp4-section" id="faq-tpx" style={{ background: "var(--canvas2)" }}>
      <div className="lp4-narrow">
        <div className="lp4-sec-head lp4-sec-head-c" data-tpx>
          <div className="lp4-eyebrow">자주 묻는 질문</div>
          <h2 className="lp4-h2">세무사님들이 먼저 물어본 것들</h2>
        </div>
        <div className="tpx-faq" data-tpx style={{ "--d": ".12s" } as React.CSSProperties}>
          {FAQS.map(([q, a], i) => (
            <div key={q} className={`tpx-faq-item ${open === i ? "tpx-faq-open" : ""}`}>
              <button className="tpx-faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                {q}
                <svg className="tpx-faq-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
              </button>
              <div className="tpx-faq-a"><p>{a}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function TaxPartnerView() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useReveal(rootRef);

  return (
    <div className="lp4-root" ref={rootRef}>
      <LandingNav solid />

      {/* ── ① 히어로: 자료 요청의 종말 ── */}
      <section className="tpx-hero lp4-bg-canvas">
        <div className="lp4-container">
          <div className="tpx-hero-grid">
            <div>
              <div className="lp4-eyebrow" data-tpx>OwnerView Partners · 세무사&#183;회계사 제휴</div>
              <h1 className="tpx-h1" data-tpx style={{ "--d": ".08s" } as React.CSSProperties}>
                자료 요청 없이,<br /><em>기장이 끝나 있는</em> 아침
              </h1>
              <p className="tpx-hero-sub" data-tpx style={{ "--d": ".16s" } as React.CSSProperties}>
                오너뷰를 쓰는 고객사의 통장·세금계산서·인건비가
                신고 업무 기준으로 정리되어 세무사님 화면에 먼저 도착합니다.
                파일을 기다리는 시간이 사라집니다.
              </p>
              <div className="tpx-hero-ctas" data-tpx style={{ "--d": ".24s" } as React.CSSProperties}>
                <Link href="/advisor" className="lp4-btn lp4-btn-onink">파트너 가입하기</Link>
                <a href="#story" className="lp4-btn lp4-btn-line">어떤 화면인가요</a>
              </div>
            </div>

            {/* 장면: 요청 채팅 3개가 줄 그이며 사라지고 → 통장 카드가 떠올라 둥실거린다 */}
            <div className="tpx-scene" aria-hidden="true">
              <div className="tpx-chats">
                <div className="tpx-chat">사장님, 7월 통장 거래내역 좀 보내주세요</div>
                <div className="tpx-chat">세금계산서 파일도 부탁드립니다&#8230;</div>
                <div className="tpx-chat">급여대장은 엑셀로 정리해서 주시면&#8230;</div>
              </div>
              <div className="tpx-chat-done">이제 묻지 않아도 됩니다</div>
              <div className="tpx-book tpx-book-float">
                <div className="tpx-book-cover">
                  <span className="tpx-book-name">모던웍스 주식회사</span>
                  <span className="tpx-book-tag">OWNERVIEW PARTNERS</span>
                </div>
                <div className="tpx-book-rows">
                  <div className="tpx-book-row"><span>08-10</span><b>거래처 용역대금</b><span className="tpx-amt-in">+11,000,000</span></div>
                  <div className="tpx-book-row"><span>08-09</span><b>사무용품 결제</b><span className="tpx-amt-out">&#8722;880,000</span></div>
                  <div className="tpx-book-row"><span>08-07</span><b>7월 급여 이체</b><span className="tpx-amt-out">&#8722;3,200,000</span></div>
                </div>
                <div className="tpx-book-foot">
                  <span className="tpx-book-foot-l">이번 달 매출 (세금계산서 기준)</span>
                  <span className="tpx-book-foot-v"><CountUp to={16500000} suffix="원" /></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ② 비포/애프터 ── */}
      <BeforeAfter />

      {/* ── ③ 3단계 ── */}
      <section className="lp4-section" id="how" style={{ background: "var(--canvas2)" }}>
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c" data-tpx>
            <div className="lp4-eyebrow">시작하기</div>
            <h2 className="lp4-h2">연결은 회사가, 열람은 즉시</h2>
            <p className="lp4-sub">설치도, 계정 세팅 대행도 없습니다. 가입 한 번이면 고객사가 세무사님을 선택해 연결합니다.</p>
          </div>
          <div className="tpx-steps" data-tpx>
            <div className="tpx-steps-line" />
            <div className="tpx-step">
              <div className="tpx-step-no">1</div>
              <div className="tpx-step-t">파트너 가입</div>
              <div className="tpx-step-d">이메일로 가입하고 사무소 정보를 등록하면 오너뷰가 제휴를 확인해 드립니다.</div>
            </div>
            <div className="tpx-step">
              <div className="tpx-step-no">2</div>
              <div className="tpx-step-t">고객사가 연결</div>
              <div className="tpx-step-d">고객사가 회사 설정에서 세무사님을 선택합니다. 어떤 메뉴를 보여줄지도 회사가 정합니다.</div>
            </div>
            <div className="tpx-step">
              <div className="tpx-step-no">3</div>
              <div className="tpx-step-t">펼치면 끝</div>
              <div className="tpx-step-d">파트너 포털에서 고객사를 누르면 그 회사의 오너뷰 화면 그대로 열람합니다.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ④ 스크롤 고정 스토리 ── */}
      <StickyStory />

      {/* ── ⑤ 지면 3종 (카운트업) ── */}
      <section className="lp4-section" id="live" style={{ background: "var(--canvas2)" }}>
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c" data-tpx>
            <div className="lp4-eyebrow">파트너 포털</div>
            <h2 className="lp4-h2">매일 아침, 이미 정리되어 있는 것들</h2>
            <p className="lp4-sub">고객사가 오너뷰에 쌓는 순간 세무사님 화면에도 같은 숫자가 정리됩니다.</p>
          </div>
          <div className="tpx-live-grid">
            <div className="tpx-live" data-tpx>
              <div className="tpx-live-k">세금계산서</div>
              <div className="tpx-live-t">매출·매입·부가세 흐름</div>
              <div className="tpx-live-num"><CountUp to={2443} suffix="건" /></div>
              <div className="tpx-live-d">발행·수취 계산서가 매출/매입으로 나뉘어 쌓이고, 분기 부가세 추정까지 계산되어 있습니다.</div>
              <div className="tpx-live-badge"><Check /> 엑셀(CSV)로 바로 내려받기</div>
            </div>
            <div className="tpx-live" data-tpx style={{ "--d": ".12s" } as React.CSSProperties}>
              <div className="tpx-live-k">통장 · 카드</div>
              <div className="tpx-live-t">입출금이 잉크색 그대로</div>
              <div className="tpx-live-num"><CountUp to={42370000} suffix="원" /></div>
              <div className="tpx-live-d">전 계좌 잔고와 거래내역, 법인카드 사용까지 — 증빙 대조에 필요한 원장이 그대로 보입니다.</div>
              <div className="tpx-live-badge"><Check /> 엑셀(CSV)로 바로 내려받기</div>
            </div>
            <div className="tpx-live" data-tpx style={{ "--d": ".24s" } as React.CSSProperties}>
              <div className="tpx-live-k">인건비</div>
              <div className="tpx-live-t">원천세 신고 자료</div>
              <div className="tpx-live-num"><CountUp to={12} suffix="명분" /></div>
              <div className="tpx-live-d">월별 급여·4대보험·소득세가 직원 단위로 정리되어, 원천세 신고 자료가 따로 필요 없습니다.</div>
              <div className="tpx-live-badge"><Check /> 엑셀(CSV)로 바로 내려받기</div>
            </div>
          </div>
          <p className="tpx-ex-note" data-tpx>화면 속 숫자는 예시입니다. 실제 수치는 연결된 고객사의 데이터로 채워집니다.</p>
        </div>
      </section>

      {/* ── ⑥ 부가세 시즌 ── */}
      <VatSeason />

      {/* ── ⑦ 숫자 밴드 ── */}
      <NumberBand />

      {/* ── ⑧ 신뢰 ── */}
      <section className="lp4-section lp4-bg-canvas" id="trust">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c" data-tpx>
            <div className="lp4-eyebrow">신뢰 설계</div>
            <h2 className="lp4-h2">고객사가 안심하고 여는 이유</h2>
          </div>
          <div className="tpx-trust-grid">
            {[
              ["읽기 전용", "세무사 계정은 화면이 아니라 데이터베이스 차원에서 모든 수정이 차단됩니다. 실수로도 고객사 자료가 바뀌지 않습니다."],
              ["열람 기록", "언제 어느 회사를 열람했는지 기록이 남고, 고객사가 직접 확인할 수 있습니다."],
              ["즉시 차단", "고객사가 연결을 해제하는 순간 열람이 바로 끊깁니다. 권한도 회사가 메뉴 단위로 정합니다."],
              ["추가 비용 0원", "세무사 연결은 고객사 좌석 요금에 포함되지 않습니다. 세무사님도 무료입니다."],
            ].map(([t, d], i) => (
              <div key={t} className="tpx-trust" data-tpx style={{ "--d": `${i * 0.09}s` } as React.CSSProperties}>
                <div className="tpx-trust-t"><Check /> {t}</div>
                <div className="tpx-trust-d">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ⑨ FAQ ── */}
      <Faq />

      {/* ── ⑩ CTA ── */}
      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-container">
          <div className="tpx-cta" data-tpx>
            <div className="tpx-cta-eyebrow">OWNERVIEW PARTNERS</div>
            <h2 className="tpx-cta-h">고객사 장부를,<br />펼쳐 두세요</h2>
            <p className="tpx-cta-sub">가입 후 오너뷰가 제휴를 확인해 드립니다. 승인되면 고객사 연결과 동시에 열람이 시작됩니다.</p>
            <Link href="/advisor" className="tpx-cta-btn">파트너 가입하기 →</Link>
            <span className="tpx-cta-mail">제휴 문의 · {FOOTER.email}</span>
          </div>
        </div>
      </section>

      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks">
              <Link href="/">홈</Link><Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보처리방침</Link><Link href="/refund">환불규정</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
