"use client";

// 월급 실수령액 계산기 화면 (2026-08-13) — 무료 도구 4탄. tl8-(랜딩 v8) 스타일.
//   소득세는 근사식이 아니라 **국세청 근로소득 간이세액표 원본**(소득세법 시행령 별표2,
//   2026-02-27 개정, 법제처 PDF에서 추출)을 그대로 조회한다 — ganyi-2026.json (646구간 × 가족수 11).
//     · 월급여 정확히 1,000만원: anchor10000 · 1,000만원 초과: 별표 주7 산식(high 밴드)
//     · 가족수 11명 초과: 주4 산식 t11 − (t10−t11)×초과수 · 8~20세 자녀: 주3 월정액 공제
//   4대보험 요율은 insurance-calculator 의 RATES 와 같은 값 (2026년 — 개정 시 두 곳 함께 수정).

import "@/app/landing-v8.css";
import Link from "next/link";
import { ResultCta } from "../_result-cta";
import { menuHref } from "@/components/landing-v8/catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { FAQS } from "./faqs";
import { track }  from "@/lib/analytics";
import { simplifiedIncomeTax } from "@/lib/income-tax";

// ── 2026년 4대보험 요율 (원본: tools/insurance-calculator RATES · 개정 시 함께 수정) ──
const RATES =  {
  pensionRate: 0.095, pensionCapHigh: 6_590_000, pensionCapLow: 410_000,
  healthRate: 0.0719, careRate: 0.009448, empRate: 0.018,
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
/** 요율을 화면 글자로 — 0.0475 → "4.75%". 손으로 또 적으면 RATES 만 고쳤을 때 어긋난다. */
const pct = (f: number) => `${+(f * 100).toFixed(4)}%`;
const comma = (s: string) => (s ? Number(s.replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : "");

export default function SalaryCalculatorView() {
  const [salary, setSalary] = useState("");
  const [taxFree, setTaxFree] = useState("200000"); // 비과세 (기본: 식대 20만)
  const [family, setFamily] = useState(1);
  const [children, setChildren] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const r = useMemo(() => {
    const gross = Number(salary.replace(/[^0-9]/g, ""));
    if (!gross) return null;
    const free = Math.min(gross, Number(taxFree.replace(/[^0-9]/g, "")) || 0);
    const base = gross - free; // 과세대상 = 보험료 산정 보수월액

    const pensionBase = Math.min(RATES.pensionCapHigh, Math.max(RATES.pensionCapLow, base));
    const pension = (pensionBase * RATES.pensionRate) / 2;
    const health = (base * RATES.healthRate) / 2;
    const care = (base * RATES.careRate) / 2;
    const emp = (base * RATES.empRate) / 2;
    const tax = simplifiedIncomeTax(base, family, children);
    const localTax = Math.floor(tax * 0.1);
    const total = pension + health + care + emp + tax + localTax;
    return {
      gross, free, base, pension, health, care, emp, tax, localTax, total, net: gross - total,
      //   국민연금이 붙는 기준(기준소득월액)과 그게 잘렸는지 — 화면에 그대로 적기 위한 값
      pensionBase,
      capped: base > RATES.pensionCapHigh,
      floored: base < RATES.pensionCapLow,
    };
  }, [salary, taxFree, family, children]);


  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회 (2026-08-13)
  const tracked = useRef(false);
  useEffect(() => {
    if (r && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "salary" }); }
  }, [r]);

  return (
    <div className="lp8">
      <SiteHeader />

      <section className="tl8-section tl8-bg-canvas">
        <div className="tl8-narrow">
          <div className="tl8-sec-head tl8-sec-head-c">
            <div className="tl8-eyebrow">무료 도구</div>
            <h1 className="tl8-h2">월급 실수령액 계산기 <span className="tl8-yearchip">2026년 기준</span></h1>
            <p className="tl8-sub">세전 월급에서 4대보험과 소득세를 빼면 통장에 얼마가 들어올까요? 국세청 간이세액표(2026.2.27 개정) 원본 기준으로 계산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="tl8-card">
            <div className="tl8-fields">
              <label className="tl8-field">
                <span className="tl8-label">세전 월급</span>
                <input type="text" inputMode="numeric" placeholder="3,000,000" className="tl8-input" value={comma(salary)} onChange={(e) => setSalary(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="tl8-field">
                <span className="tl8-label">비과세액 (기본: 식대 20만원)</span>
                <input type="text" inputMode="numeric" className="tl8-input" value={comma(taxFree)} onChange={(e) => setTaxFree(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="tl8-field">
                <span className="tl8-label">부양가족 수 (본인 포함)</span>
                <select className="tl8-input" value={family} onChange={(e) => { const v = Number(e.target.value); setFamily(v); if (children > v - 1) setChildren(Math.max(0, v - 1)); }}>
                  {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}명</option>)}
                </select>
              </label>
              <label className="tl8-field">
                <span className="tl8-label">그중 8세~20세 자녀 수</span>
                <select className="tl8-input" value={children} onChange={(e) => setChildren(Number(e.target.value))}>
                  {Array.from({ length: Math.max(1, family) }, (_, i) => i).map((n) => <option key={n} value={n}>{n}명</option>)}
                </select>
              </label>
            </div>

            {r ? (
              <div className="tl8-result" aria-live="polite">
                <div className="tl8-result-main">
                  <span className="tl8-result-num">{won(r.net)}원</span>
                  <span className="tl8-result-cap">예상 월 실수령액 — 공제 합계 −{won(r.total)}원</span>
                </div>
                {/*   세전 → 과세대상 → 공제 → 실수령액까지 **한 사다리**로.
                      금액만 있으면 무엇에 요율을 곱했는지 알 수 없고, 표 어디에도 실수령액이 안 나와
                      위 큰 숫자와 이어지지 않았다. 마지막 줄에서 고리를 닫는다.
                      ⚠️ 국민연금 비고는 월급과 무관하게 늘 "(상한 적용)"이라고 적혀 있었다 —
                         300만 원에도 상한이 걸린 것처럼 읽힌다. 실제로 잘렸을 때만 적는다. */}
                <table className="tl8-table tl8-table-tight">
                  <thead>
                    <tr><th>항목</th><th>금액</th><th>계산</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>과세대상</td><td>{won(r.base)}원</td><td className="tl8-dim">세전 {won(r.gross)} − 비과세 {won(r.free)}</td></tr>
                    <tr><td>국민연금</td><td>−{won(r.pension)}원</td><td className="tl8-dim">{won(r.pensionBase)}{r.capped ? " (상한)" : r.floored ? " (하한)" : ""} × {pct(RATES.pensionRate / 2)}</td></tr>
                    <tr><td>건강보험</td><td>−{won(r.health)}원</td><td className="tl8-dim">{won(r.base)} × {pct(RATES.healthRate / 2)}</td></tr>
                    <tr><td>장기요양보험</td><td>−{won(r.care)}원</td><td className="tl8-dim">{won(r.base)} × {pct(RATES.careRate / 2)}</td></tr>
                    <tr><td>고용보험</td><td>−{won(r.emp)}원</td><td className="tl8-dim">{won(r.base)} × {pct(RATES.empRate / 2)}</td></tr>
                    <tr><td>근로소득세</td><td>−{won(r.tax)}원</td><td className="tl8-dim">간이세액표 · 가족 {family}명{children > 0 ? ` · 자녀 ${children}명` : ""}</td></tr>
                    <tr><td>지방소득세</td><td>−{won(r.localTax)}원</td><td className="tl8-dim">소득세 {won(r.tax)} × 10%</td></tr>
                    <tr><td><b>공제 합계</b></td><td><b>−{won(r.total)}원</b></td><td className="tl8-dim">4대보험 + 소득세</td></tr>
                    <tr><td><b>실수령액</b></td><td><b>{won(r.net)}원</b></td><td className="tl8-dim">세전 {won(r.gross)} − 공제 {won(r.total)}</td></tr>
                  </tbody>
                </table>
                {(r.capped || r.floored) && (
                  <div className="tl8-result-rows">
                    <div className="tl8-result-row">
                      {r.capped
                        ? <>국민연금은 기준소득월액 <b>상한({won(RATES.pensionCapHigh)}원)</b>까지만 부과됩니다. 월급이 더 많아도 연금 공제액은 그대로입니다</>
                        : <>국민연금은 기준소득월액 <b>하한({won(RATES.pensionCapLow)}원)</b>부터 부과됩니다. 과세대상이 더 적어도 하한 기준으로 붙습니다</>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="tl8-empty">세전 월급을 넣으면 바로 계산됩니다</div>
            )}
            {(r) && (
              <ResultCta tool="salary" menuHref={menuHref("hr", "employees")} menuLabel="구성원 기능 보기">
                직원마다 실수령액을 매달 따로 계산하고 계신가요? <b>오너뷰는 급여 한 번 계산으로 전 직원의 공제·실지급액과 명세서까지</b> 만듭니다.
              </ResultCta>
            )}
          </div>

          <p className="tl8-note">
            * 근로소득세는 국세청 근로소득 간이세액표(소득세법 시행령 별표2, 2026.2.27 개정) 원본 데이터 기준이며 원천징수 100% 선택을 가정합니다. 매달 떼는 어림값이라 연말정산에서 실제 공제(카드·의료비 등)에 따라 환급 또는 추가 납부로 정산됩니다.
          </p>

          {/* FAQ */}
          <div className="tl8-faqwrap">
            <h2 className="tl8-h3">자주 묻는 질문</h2>
            {FAQS.map((f, i) => (
              <div key={i} className={`tl8-faq ${openFaq === i ? "tl8-faq-open" : ""}`}>
                <button type="button" className="tl8-faq-btn" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{f.q}</span>
                  <svg className="tl8-faq-chev" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
                </button>
                <div className="tl8-faq-panel"><p className="tl8-faq-a">{f.a}</p></div>
              </div>
            ))}
          </div>

          <p className="tl8-note">
            다른 무료 도구: <Link href="/tools/leave-calculator" className="tl8-crosslink">연차 계산기</Link> · <Link href="/tools/severance-calculator" className="tl8-crosslink">퇴직금 계산기</Link> · <Link href="/tools/insurance-calculator" className="tl8-crosslink">4대보험 계산기</Link> · <Link href="/tools/weekly-holiday-calculator" className="tl8-crosslink">주휴수당 계산기</Link> · <Link href="/tools/vat-calculator" className="tl8-crosslink">부가세 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="tl8-section tl8-bg-tint">
        <div className="tl8-narrow tl8-sec-head-c">
          <h2 className="tl8-h2">급여명세서, 매달 이 계산 자동으로 해드립니다</h2>
          <p className="tl8-sub">오너뷰는 직원별 4대보험·소득세 공제를 자동 계산해 급여명세서를 만들어 발송하고, 근태·연차까지 한 곳에서 끝냅니다. 카드 등록 없이 무료로 시작하세요.</p>
          <div className="tl8-feat-cta">
            <Link href="/auth?mode=signup" className="btn btn-fill" data-cta="signup:tool_salary">무료로 시작하기</Link>
            <Link href="/features" className="btn btn-soft">기능 둘러보기</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
