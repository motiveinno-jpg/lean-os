"use client";
// ══════════════════════════════════════════════════════════════
//  /pricing — 요금제 (랜딩 v8 이관 2단계, 2026-09-14)
//
//  ▸ 옛 화면(components/landing/pricing-view.tsx, lp4-)의 구성을 그대로 옮겼다:
//    요금 카드 2장 → 플랜별 기능 표 → 따로 구독할 때와 비교 → 상담·시작.
//  ▸ 숫자는 전부 props.plans(DB subscription_plans)에서 만든다. 여기 숫자를 직접 적지 않는다.
//    예외 = 추가 구매 단가(billing/page.tsx 의 묶음 표와 같은 값)·개별 도구 참고가(COMPETITORS) — 표 옆 주석 참조.
//  ▸ 옛 화면에서 대표 걷어낸 「요금 FAQ」는 다시 넣지 않는다(가격은 상담으로 잇는다, 2026-07-27).
//  ▸ 스타일은 landing-v8.css `.lp8 .pr8-*`.
// ══════════════════════════════════════════════════════════════
import { useState } from "react";
import Link from "next/link";
import "@/app/landing-v8.css";
import { SiteFooter, SiteHeader } from "./site-shell";
import { COMPETITORS, CONSULT_HREF, SIGNUP_HREF } from "./content";
import { bytes, discountPct, perMonth, tokens, won, type PlanRow } from "./pricing-data";

const Check = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

type Row = { name: string; free: string; paid: string };

/* 플랜별 기능 표 — 숫자 칸은 DB, 나머지는 기능 유무( 표 그대로).
   ⚠️ 유무 칸을 바꾸려면 실제 기능 게이트(entitlement·sync-cooldown 등)를 먼저 확인할 것. */
function matrix(free: PlanRow, paid: PlanRow): { group: string; rows: Row[] }[] {
  const seats = (p: PlanRow) =>
    p.per_seat_price > 0 ? `기본 ${p.included_seats}명 + 추가 1명 ${won(p.per_seat_price)}/월` : `${p.max_seats ?? p.included_seats}명`;
  const storage = (p: PlanRow) =>
    p.per_seat_price > 0 ? `${bytes(p.included_storage_bytes)} + 추가 1명당 ${bytes(p.storage_per_unit_bytes)}` : bytes(p.included_storage_bytes);
  const d = discountPct(paid);
  return [
    {
      group: "기본",
      rows: [
        { name: "사용 인원", free: seats(free), paid: seats(paid) },
        { name: "저장공간", free: storage(free), paid: storage(paid) },
        { name: "은행·카드 실계좌 연동", free: "하루 2회 자동", paid: "계좌 수 제한 없이 하루 2회 자동" },
        { name: "통장·카드 연결", free: "3개까지", paid: "무제한" },
        { name: "즉시 동기화", free: "—", paid: "필요할 때 (종류별 30분 간격)" },
        { name: "경영 대시보드 · 리포트", free: "✓", paid: "✓" },
        ...(d > 0 ? [{ name: "연간 결제", free: "—", paid: `${d}% 할인` }] : []),
      ],
    },
    {
      group: "프로젝트 · 문서",
      rows: [
        { name: "프로젝트", free: "무제한", paid: "무제한" },
        { name: "전자결재", free: "무제한", paid: "무제한" },
        { name: "전자계약(서명)", free: perMonth(free.monthly_contract_limit, "건"), paid: perMonth(paid.monthly_contract_limit, "건") },
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
        { name: "세금계산서 발행", free: perMonth(free.monthly_tax_invoice_limit, "건"), paid: perMonth(paid.monthly_tax_invoice_limit, "건") },
        { name: "현금영수증 발행", free: perMonth(free.monthly_cashbill_limit, "건"), paid: perMonth(paid.monthly_cashbill_limit, "건") },
        { name: "홈택스 자동 수집", free: "—", paid: "✓" },
        // 추가 구매 단가 = billing/page.tsx 묶음 표(10건 3,000원 · 50만 토큰 10,000원). 무료는 구매 불가(api/stripe/credits).
        { name: "월 제공량을 다 썼을 때", free: "다음 달까지 대기", paid: "추가 구매 가능 (발행 10건 3,000원 · 토큰 50만 개 10,000원)" },
      ],
    },
    {
      group: "AI",
      rows: [
        { name: "AI 대표 참모(질문·업무 지시)", free: tokens(free.monthly_ai_token_limit), paid: tokens(paid.monthly_ai_token_limit) },
        { name: "AI 브리핑", free: "기본형(요약 규칙)", paid: "매일 자동 분석" },
      ],
    },
  ];
}

export default function PricingView({ plans, source }: { plans: PlanRow[]; source: "db" | "fallback" }) {
  const free = plans.find((p) => p.base_price === 0)!;
  const paid = plans.find((p) => p.base_price > 0)!;
  const [team, setTeam] = useState(8);

  const extra = Math.max(0, team - paid.included_seats);
  const owvTotal = paid.base_price + extra * paid.per_seat_price;
  const compTotal = COMPETITORS.reduce((s, c) => s + (c.perSeat ? c.price * team : c.price), 0);
  const save = compTotal - owvTotal;
  const d = discountPct(paid);

  const cards = [
    { p: free, desc: "메뉴는 같고, 사용 한도만 다릅니다", period: "카드 등록 없이 계속 무료", cta: "무료로 시작하기", hl: false },
    {
      p: paid,
      desc: "회사 운영 전체를 맡기는 요금제",
      period: `VAT 별도 · 기본 ${paid.included_seats}명 포함 · 추가 1명 ${won(paid.per_seat_price)}/월`,
      cta: `${paid.name} 시작하기`,
      hl: true,
    },
  ];

  return (
    <div className="lp8" data-plans={source}>
      <SiteHeader />

      <main>
        {/* ── 머리 + 요금 카드 ── */}
        <section className="pr8-hero">
          <div className="container">
            <div className="pr8-head">
              <div className="tl8-eyebrow">요금</div>
              <h1>무료로 시작하세요</h1>
              <p className="lead24">
                카드 등록 없이 계속 무료로 사용하고,<br className="brk" />
                필요할 때 월 {paid.base_price.toLocaleString("ko-KR")}원(VAT 별도) 하나만 결제하세요.
              </p>
            </div>

            <div className="pr8-cards">
              {cards.map(({ p, desc, period, cta, hl }) => (
                <div key={p.slug} className={`pr8-card${hl ? " pr8-card-hl" : ""}`}>
                  <div className="pr8-card-top">
                    <b className="pr8-name">{p.name}</b>
                    {hl && <span className="pr8-badge">추천</span>}
                  </div>
                  <p className="pr8-desc">{desc}</p>
                  <div className="pr8-amt">
                    {won(p.base_price)}<span>{p.base_price > 0 ? " /월" : ""}</span>
                  </div>
                  <p className="pr8-period">{period}</p>
                  {hl && d > 0 && (
                    <p className="pr8-annual">
                      연간 결제 시 {d}% 할인 · 월 {won(p.base_price * (1 - d / 100))} 상당
                    </p>
                  )}
                  <Link className={`btn ${hl ? "btn-fill" : "btn-soft"} pr8-cta`} href={SIGNUP_HREF} data-cta={`signup:pricing_${p.slug}`}>{cta}</Link>
                  <ul className="pr8-feats">
                    {p.features.map((f) => <li key={f}><Check />{f}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 플랜별 기능 ── */}
        <section id="matrix" className="sec-100 pt96 pb96">
          <div className="container">
            <div className="pr8-head">
              <h2>플랜별 기능</h2>
              <p className="p20 pr8-head-sub">어떤 기능을 어디까지 쓰는지 한 표에 정리했습니다.</p>
            </div>
            <div className="pr8-mx" role="table" aria-label="플랜별 기능 비교">
              <div className="pr8-mx-head" role="row">
                <span role="columnheader">기능</span>
                <span role="columnheader">{free.name}</span>
                <span role="columnheader" className="pr8-mx-us">{paid.name}</span>
              </div>
              {matrix(free, paid).map((g) => (
                <div key={g.group} role="rowgroup">
                  <div className="pr8-mx-group" role="row"><span role="cell">{g.group}</span></div>
                  {g.rows.map((r) => (
                    <div key={r.name} className="pr8-mx-row" role="row">
                      <span role="rowheader" className="pr8-mx-name">{r.name}</span>
                      <span role="cell" className="pr8-mx-v" data-plan={free.name}>{r.free}</span>
                      <span role="cell" className="pr8-mx-v pr8-mx-us" data-plan={paid.name}>{r.paid}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="pr8-note">
              메뉴는 두 요금제가 같습니다. 어느 메뉴에서 무엇을 하는지는 <Link href="/features">기능 둘러보기</Link>에서 확인하세요.
            </p>
          </div>
        </section>

        {/* ── 따로 구독할 때와 비교 ── */}
        <section id="compare" className="pt96 pb96">
          <div className="container">
            <div className="pr8-head">
              <h2>도구를 따로 쓰면 <em className="hl">인원만큼 늘어납니다</em></h2>
              <p className="p20 pr8-head-sub">분야별 도구 7개를 따로 구독할 때와 오너뷰 요금을 같은 인원으로 비교했습니다.</p>
            </div>

            <div className="pr8-team">
              <label htmlFor="pr8-team">팀 인원</label>
              <input id="pr8-team" type="range" min={1} max={50} value={team} onChange={(e) => setTeam(Number(e.target.value))} />
              <b>{team}명</b>
            </div>

            <div className="pr8-cmp">
              <div className="pr8-cmp-col">
                <b className="pr8-cmp-title">분야별 도구를 따로 쓸 때</b>
                <p className="pr8-cmp-note">분야별 공개 요금을 기준으로 잡은 참고 금액입니다.</p>
                {COMPETITORS.map((c) => (
                  <div key={c.cat} className="pr8-cmp-row">
                    <span>{c.cat}{c.perSeat ? " (인원당)" : ""}</span>
                    <span className="num">{won(c.perSeat ? c.price * team : c.price)}</span>
                  </div>
                ))}
                <div className="pr8-cmp-total"><span>{team}명 기준 월</span><b className="num">{won(compTotal)}</b></div>
              </div>
              <div className="pr8-cmp-col pr8-cmp-us">
                <b className="pr8-cmp-title">오너뷰 하나로</b>
                <p className="pr8-cmp-note">전 기능 포함 · VAT 별도</p>
                <div className="pr8-cmp-row">
                  <span>{paid.name} (기본 {paid.included_seats}명 포함)</span><span className="num">{won(paid.base_price)}</span>
                </div>
                <div className="pr8-cmp-row">
                  <span>추가 {extra}명 × {won(paid.per_seat_price)}</span><span className="num">{won(extra * paid.per_seat_price)}</span>
                </div>
                <div className="pr8-cmp-row">
                  <span>저장공간 {bytes(paid.included_storage_bytes + extra * paid.storage_per_unit_bytes)}</span><span>포함</span>
                </div>
                <div className="pr8-cmp-total"><span>{team}명 기준 월</span><b className="num">{won(owvTotal)}</b></div>
                {save > 0 && (
                  <p className="pr8-save">매월 약 {won(save)} 절감 ({Math.round((save / compTotal) * 100)}%)</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── 상담·시작 ── */}
        <section className="finale">
          <div className="container">
            <h3 className="cta-h">요금이 궁금하시면<br />먼저 물어보세요!</h3>
            <p className="pr8-finale-sub">회사 상황에 맞는 메뉴 구성과 요금을 함께 정리해 드립니다. 무료 플랜으로 먼저 사용해 보셔도 됩니다.</p>
            <div className="lp8-finale-cta">
              <Link className="btn btn-fill" href={CONSULT_HREF} data-cta="consult:pricing_finale">도입 상담 신청</Link>
              <Link className="btn btn-soft" href={SIGNUP_HREF} data-cta="signup:pricing_finale">무료로 시작하기</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
