"use client";

// 세무사 제휴 모집 랜딩 (2026-08-11 사장님) — lp4 세계관 + 이 페이지만의 장면.
//   히어로: "자료 요청 채팅"이 줄 그이며 사라지고 통장 카드가 떠오른다(자동 재생).
//   본문: 스크롤 리빌(IO) · 3단계 진행선 드로잉 · 숫자 카운트업. CTA → /advisor 가입.
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

export default function TaxPartnerView() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useReveal(rootRef);

  return (
    <div className="lp4-root" ref={rootRef}>
      <LandingNav solid />

      {/* ── 히어로: 자료 요청의 종말 ── */}
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
                <a href="#live" className="lp4-btn lp4-btn-line">어떤 화면인가요</a>
              </div>
            </div>

            {/* 장면: 요청 채팅 3개가 줄 그이며 사라지고 → 통장 카드가 떠오른다 */}
            <div className="tpx-scene" aria-hidden="true">
              <div className="tpx-chats">
                <div className="tpx-chat">사장님, 7월 통장 거래내역 좀 보내주세요</div>
                <div className="tpx-chat">세금계산서 파일도 부탁드립니다&#8230;</div>
                <div className="tpx-chat">급여대장은 엑셀로 정리해서 주시면&#8230;</div>
              </div>
              <div className="tpx-chat-done">이제 묻지 않아도 됩니다</div>
              <div className="tpx-book">
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

      {/* ── 3단계 ── */}
      <section className="lp4-section lp4-bg-canvas" id="how">
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

      {/* ── 지면 3종 (카운트업) ── */}
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

      {/* ── 신뢰 ── */}
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

      {/* ── CTA ── */}
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
