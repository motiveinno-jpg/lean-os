"use client";

// /pricing — 요금제 전용 화면 (2026-07-27).
//   사장님: "스크롤에서는 가격을 안 보이고, 먼데이처럼 '가격'을 눌렀을 때 요금제를 보여주자.
//   밑에 기능 목록으로 표시해줘."
//   랜딩 본문에서 가격·비교 섹션을 떼어내 이 페이지로 옮겼다. 스타일은 랜딩과 같은 lp4- 네임스페이스.

import "@/app/landing.css";
import Link from "next/link";
import { useState } from "react";
import { PLANS, COMPETITORS, FEATURES, FAQS, NAV_LINKS, FOOTER } from "@/components/landing/content";

function Logo({ size = 25 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="#5b54e8" />
      <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none" />
      <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <polyline points="12,20 15,18 18,19 22,14" stroke="#fdba74" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
const Check = () => (<svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);

// 플랜별 포함 여부 — 하단 기능 목록(먼데이식 비교표)
const MATRIX: { group: string; rows: { name: string; free: string; basic: string; ultra: string }[] }[] = [
  {
    group: "기본",
    rows: [
      { name: "사용 인원", free: "체험 5명", basic: "기본 5명 + 추가 ₩10,000/월", ultra: "기본 5명 + 추가 ₩10,000/월" },
      { name: "은행·카드 실계좌 연동", free: "✓", basic: "✓", ultra: "✓" },
      { name: "경영 대시보드 · 리포트", free: "✓", basic: "무제한", ultra: "무제한" },
    ],
  },
  {
    group: "프로젝트 · 문서",
    rows: [
      { name: "프로젝트", free: "체험", basic: "무제한", ultra: "무제한" },
      { name: "전자결재", free: "체험", basic: "무제한", ultra: "무제한" },
      { name: "전자계약(서명)", free: "체험", basic: "월 20건", ultra: "월 20건" },
      { name: "거래처 · 파트너", free: "체험", basic: "무제한", ultra: "무제한" },
    ],
  },
  {
    group: "회계 · 세무",
    rows: [
      { name: "AI 거래 분류", free: "체험", basic: "무제한", ultra: "무제한" },
      { name: "세금계산서 국세청 발행", free: "—", basic: "월 10건", ultra: "무제한" },
      { name: "현금영수증 발행(베타)", free: "—", basic: "✓", ultra: "✓" },
    ],
  },
  {
    group: "AI · 지원",
    rows: [
      { name: "AI 브리핑", free: "—", basic: "—", ultra: "매일 우선순위 액션" },
      { name: "신기능 얼리 액세스", free: "—", basic: "—", ultra: "✓" },
      { name: "우선 지원", free: "—", basic: "—", ultra: "✓" },
    ],
  },
];

export default function PricingView() {
  const [team, setTeam] = useState(8);
  const won = (n: number) => "₩" + n.toLocaleString("ko-KR");
  const compTotal = COMPETITORS.reduce((s, c) => s + (c.perSeat ? c.price * team : c.price), 0);
  const owvTotal = 79500 + Math.max(0, team - 5) * 10000;
  const savePct = Math.round(((compTotal - owvTotal) / compTotal) * 100);

  return (
    <div className="lp4-root">
      <nav className="lp4-nav lp4-nav-on">
        <div className="lp4-nav-inner">
          <Link href="/" className="lp4-logo"><Logo /> OwnerView</Link>
          <div className="lp4-menu">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href.startsWith("#") ? `/${l.href}` : l.href}>{l.label}</Link>
            ))}
          </div>
          <div className="lp4-nav-right">
            <Link href="/auth" className="lp4-login">로그인</Link>
            <Link href="/auth" className="lp4-pill">무료로 시작하기</Link>
          </div>
        </div>
      </nav>

      <section className="lp4-section lp4-bg-canvas" id="pricing">
        <div className="lp4-container">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">Pricing</div>
            <h1 className="lp4-h2">14일 써보고 결정하세요</h1>
            <p className="lp4-sub">가입할 때 카드만 등록해요. 14일 안에 해지하면 첫 결제는 없어요.</p>
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
                  href={p.name === "엔터프라이즈" ? "/#partner" : p.slug ? `/auth?plan=${p.slug}` : "/auth"}
                  className={`lp4-price-cta ${p.hl ? "lp4-price-cta-brand" : "lp4-price-cta-line"}`}
                >
                  {p.name === "엔터프라이즈" ? "도입 문의하기" : "14일 무료로 시작하기"}
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
              <span>기능</span><span>무료체험</span><span>프로</span><span>울트라</span>
            </div>
            {MATRIX.map((g) => (
              <div key={g.group} className="lp4-mx-group">
                <div className="lp4-mx-gname">{g.group}</div>
                {g.rows.map((r) => (
                  <div key={r.name} className="lp4-mx-row">
                    <span className="lp4-mx-name">{r.name}</span>
                    <span className="lp4-mx-v">{r.free}</span>
                    <span className="lp4-mx-v lp4-mx-hl">{r.basic}</span>
                    <span className="lp4-mx-v">{r.ultra}</span>
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
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">프로 (기본 5명 포함)</span><span className="lp4-cmp-price">₩79,500</span></div>
                <div className="lp4-cmp-row"><span className="lp4-cmp-name">추가 {Math.max(0, team - 5)}명 × ₩10,000</span><span className="lp4-cmp-price">{won(Math.max(0, team - 5) * 10000)}</span></div>
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

      <section className="lp4-section lp4-bg-canvas" id="faq">
        <div className="lp4-narrow">
          <div className="lp4-sec-head"><h2 className="lp4-h2">요금 관련해서 자주 묻는 질문이에요</h2></div>
          <div>
            {FAQS.slice(0, 4).map((f, i) => (
              <div key={i} className="lp4-faq lp4-faq-open">
                <div className="lp4-faq-btn">{f.q}</div>
                <div className="lp4-faq-panel"><div className="lp4-faq-a">{f.a}</div></div>
              </div>
            ))}
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
