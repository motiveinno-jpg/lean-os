"use client";

// /pricing — 요금제 전용 화면 (2026-07-27).
//   사장님: "스크롤에서는 가격을 안 보이고, 보드형 툴처럼 '가격'을 눌렀을 때 요금제를 보여주자.
//   밑에 기능 목록으로 표시해줘."
//   랜딩 본문에서 가격·비교 섹션을 떼어내 이 페이지로 옮겼다. 스타일은 랜딩과 같은 lp4- 네임스페이스.

import "@/app/landing.css";
import Link from "next/link";
import { useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { PLANS, COMPETITORS, FEATURES, FOOTER } from "@/components/landing/content";

const Check = () => (<svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);

// 플랜별 포함 여부 — 하단 기능 목록(보드형 비교표)
// 플랜별 기능 비교 — 현행 요금제(무료 + 오너뷰 39,000원·VAT 별도, 2026-08-11) 기준.
//   ⚠️ 숫자는 subscription_plans 의 실제 한도와 맞춰야 한다. 여기만 고치면 거짓 안내가 된다.
//   free: 발행 각 월 5건 / AI 10만 토큰,  standard: 발행 각 월 100건(세금계산서·현금영수증 각각) / AI 50만 토큰
//   ⚠️ 토큰 제공량은 월 AI 비용 상한($6)에 맞춰 산정한 값이다 — 실측 원가가 바뀌면 다시 계산할 것.
const MATRIX = [
  {
    group: "기본",
    rows: [
      { name: "사용 인원", free: "5명", paid: "기본 5명 + 추가 1명 ₩5,000/월" },
      { name: "은행·카드 실계좌 연동", free: "하루 2회 자동", paid: "계좌 수 제한 없이 하루 2회 자동" },
      { name: "즉시 동기화 버튼", free: "횟수 제한 없음(30분 간격)", paid: "횟수 제한 없음(30분 간격)" },
      { name: "경영 대시보드 · 리포트", free: "✓", paid: "✓" },
    ],
  },
  {
    group: "프로젝트 · 문서",
    rows: [
      { name: "프로젝트", free: "무제한", paid: "무제한" },
      { name: "전자결재", free: "무제한", paid: "무제한" },
      { name: "전자계약(서명)", free: "월 5건", paid: "무제한" },
      { name: "거래처 · 파트너", free: "무제한", paid: "무제한" },
    ],
  },
  {
    group: "인사 · 급여",
    rows: [
      { name: "근태 · 연차 관리", free: "✓", paid: "✓" },
      { name: "급여 · 4대보험 자동 계산 · 명세서 발송", free: "✓", paid: "✓" },
      { name: "근로계약서 전자서명 · 증명서 발급", free: "✓", paid: "✓" },
    ],
  },
  {
    group: "회계 · 세무",
    rows: [
      { name: "AI 거래 분류", free: "✓", paid: "✓" },
      { name: "세금계산서 발행", free: "월 5건", paid: "월 100건" },
      { name: "현금영수증 발행", free: "월 5건", paid: "월 100건" },
      { name: "홈택스 자동 수집", free: "—", paid: "✓" },
      { name: "월 제공량을 다 썼을 때", free: "다음 달까지 대기", paid: "추가 구매 가능 (발행 300원/건 · 토큰 50만개 10,000원)" },
    ],
  },
  {
    group: "AI",
    rows: [
      { name: "AI 대표 참모(질문·업무 지시)", free: "월 10만 토큰", paid: "월 50만 토큰" },
      { name: "AI 브리핑", free: "기본형(요약 규칙)", paid: "매일 자동 분석" },
    ],
  },
];

export default function PricingView() {
  const [team, setTeam] = useState(8);
  const won = (n: number) => "₩" + n.toLocaleString("ko-KR");
  const compTotal = COMPETITORS.reduce((s, c) => s + (c.perSeat ? c.price * team : c.price), 0);
  const owvTotal = 39000 + Math.max(0, team - 5) * 5000;
  const savePct = Math.round(((compTotal - owvTotal) / compTotal) * 100);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas" id="pricing">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Pricing</div>
            <h1 className="lp4-h2">무료로 시작하세요</h1>
            <p className="lp4-sub">카드 등록 없이 계속 무료로 쓰고, 필요해지면 월 39,000원(VAT 별도) 하나만 결제하세요.</p>
          </div>

          <div className="lp4-price-grid">
            {PLANS.map((p) => (
              <div key={p.name} className={`lp4-price ${p.hl ? "lp4-price-hl" : ""}`}>
                {p.hl && <span className="lp4-price-best">BEST</span>}
                <div className="lp4-price-name">{p.name}</div>
                <div className="lp4-price-desc">{p.desc}</div>
                {p.regularPrice
                  ? <div className="lp4-price-reg">₩{p.regularPrice}{p.discount && <span className="lp4-price-off">{p.discount} 할인</span>}</div>
                  : <div className="lp4-price-reg-empty" />}
                <div className={`lp4-price-amt ${p.price === "별도 협의" ? "lp4-price-amt-text" : ""}`}>
                  {p.price === "별도 협의" ? "별도 협의" : `₩${p.price}`}
                  <span className="lp4-price-unit">{p.unit && ` ${p.unit}`}</span>
                </div>
                <div className="lp4-price-period">{p.period}</div>
                <ul className="lp4-price-feats">
                  {p.features.map((ft, i) => <li key={i} className="lp4-price-feat"><Check />{ft}</li>)}
                </ul>
                <Link
                  href={p.slug ? `/auth?plan=${p.slug}` : "/auth"}
                  className={`lp4-price-cta ${p.hl ? "lp4-price-cta-brand" : "lp4-price-cta-line"}`}
                >
                  14일 무료로 시작하기
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 기능 목록 — 플랜별 포함 여부 */}
      <section className="lp4-section lp4-bg-canvas" id="matrix">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <h2 className="lp4-h2">플랜별 기능</h2>
            <p className="lp4-sub">무엇이 어디까지 되는지 한 장에 정리했어요.</p>
          </div>

          <div className="lp4-matrix">
            <div className="lp4-mx-head">
              <span>기능</span><span>무료</span><span>오너뷰</span>
            </div>
            {MATRIX.map((g) => (
              <div key={g.group} className="lp4-mx-group">
                <div className="lp4-mx-gname">{g.group}</div>
                {g.rows.map((r) => (
                  <div key={r.name} className="lp4-mx-row">
                    <span className="lp4-mx-name">{r.name}</span>
                    <span className="lp4-mx-v">{r.free}</span>
                    <span className="lp4-mx-v lp4-mx-hl">{r.paid}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="lp4-mx-tools">
            <div className="lp4-mx-tools-t">모든 플랜에 이 도구들이 들어 있어요</div>
            <div className="lp4-mx-tools-list">
              {FEATURES.map((f) => <span key={f.tab} className="lp4-pillar-menu">{f.tab}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* 개별 구독 대비 비교 계산기 */}
      <section className="lp4-section lp4-bg-tint" id="compare">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <h2 className="lp4-h2">따로 쓰면 인원마다 늘어나요</h2>
            <p className="lp4-sub">7개 도구를 따로 구독할 때와 오너뷰 정액제를 같은 조건으로 비교해봤어요.</p>
          </div>
          <div className="lp4-cmp-grid">
            <div className="lp4-cmp lp4-card">
              <div className="lp4-cmp-title">개별 도구를 따로 쓰는 방식</div>
              <div className="lp4-cmp-note">각 분야 도구를 하나씩 구독했을 때의 참고 금액이에요.</div>
              <div className="lp4-cmp-rows">
                {COMPETITORS.map((c) => (
                  <div key={c.cat} className="lp4-cmp-row">
                    <span className="lp4-cmp-name">{c.cat}{c.perSeat ? " (인원당)" : ""}</span>
                    <span className="lp4-cmp-price">{won(c.perSeat ? c.price * team : c.price)}</span>
                  </div>
                ))}
              </div>
              <div className="lp4-cmp-total">
                <span className="lp4-cmp-total-cap">{team}명 기준 월</span>
                <span className="lp4-cmp-total-val lp4-cmp-total-warn">{won(compTotal)}</span>
              </div>
            </div>
            <div className="lp4-cmp lp4-card lp4-cmp-hl">
              <div className="lp4-cmp-title">오너뷰 하나로</div>
              <div className="lp4-cmp-rows">
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">오너뷰 (기본 5명 포함)</span><span className="lp4-cmp-price">₩39,000</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">추가 {Math.max(0, team - 5)}명 × ₩5,000</span><span className="lp4-cmp-price">{won(Math.max(0, team - 5) * 5000)}</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">전 기능 포함 · VAT 별도</span><span className="lp4-cmp-price lp4-cmp-inc">포함</span></div>
              </div>
              <div className="lp4-cmp-total">
                <span className="lp4-cmp-total-cap">{team}명 기준 월</span>
                <span className="lp4-cmp-total-val">{won(owvTotal)}</span>
              </div>
              <div className="lp4-cmp-save">매월 약 {won(compTotal - owvTotal)} 절감 ({savePct}%)</div>
            </div>
          </div>
          <div className="lp4-calc lp4-card">
            <div className="lp4-calc-head"><span>팀 인원</span><b>{team}명</b></div>
            <input type="range" min={1} max={50} value={team} onChange={(e) => setTeam(Number(e.target.value))} className="lp4-slider" aria-label="팀 인원" />
          </div>
        </div>
      </section>

      {/* ⚠️ 여기 "요금 관련 자주 묻는 질문" 4개가 있었다. 사장님: 가격과 상관없는 내용이고,
          가격은 글로 읽히기보다 설명으로 듣는 게 낫다(읽다가 이탈한다) → 걷어내고 상담·시작으로 잇는다.
          FAQ 자체는 메인 랜딩(#faq)에 그대로 있다. */}
      <section className="lp4-section lp4-bg-tint" id="ask">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">가격이 궁금하면 물어보세요</h2>
          <p className="lp4-sub">회사 상황에 따라 무엇이 필요한지 같이 정리해 드려요. 먼저 14일 써보셔도 돼요.</p>
          <div className="lp4-feat-cta">
            <Link href="/#partner" className="lp4-btn lp4-btn-brand">도입 상담하기</Link>
            <Link href="/auth" className="lp4-btn lp4-btn-line">무료로 시작하기</Link>
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
