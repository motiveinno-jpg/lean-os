"use client";

// 4대보험 계산기 화면 (2026-08-13) — 무료 도구 3탄. tl8-(랜딩 v8) 스타일.
//   2026년 요율 (출처: 보건복지부 고시·국민연금공단·건강보험공단, 2026-08 확인):
//     · 국민연금 9.5% (근로자 4.75 / 회사 4.75) — 연금개혁으로 2026년 9%→9.5% 인상.
//       기준소득월액 상한 659만·하한 41만 (2026.7~2027.6 고시)
//     · 건강보험 7.19% (3.595 / 3.595) · 장기요양 0.9448% (0.4724 / 0.4724, 보수월액 기준)
//     · 고용보험 실업급여 1.8% (0.9 / 0.9) + 회사만 고용안정·직능개발 0.25% (150인 미만)
//     · 산재보험 — 업종별 상이(회사 전액), 선택 입력
//   ⚠️ 요율 개정 시 이 파일 상수만 고치면 된다 (RATES 블록).

import "@/app/landing-v8.css";
import Link from "next/link";
import { ResultCta } from "../_result-cta";
import { menuHref } from "@/components/landing-v8/catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { FAQS } from "./faqs";
import { track }  from "@/lib/analytics";

// ── 2026년 요율 상수 · 개정 시 여기만 수정 ──
const RATES =  {
  yearLabel: "2026년",
  pensionRate: 0.095,          // 국민연금 총 9.5%
  pensionCapHigh: 6_590_000,   // 기준소득월액 상한 (2026.7~2027.6)
  pensionCapLow: 410_000,      // 하한
  healthRate: 0.0719,          // 건강보험 총 7.19%
  careRate: 0.009448,          // 장기요양 총 0.9448% (보수월액 기준)
  empRate: 0.018,              // 고용보험 실업급여 총 1.8%
  empBizExtra: 0.0025,         // 고용안정·직능개발 (150인 미만, 회사 전액)
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
/** 요율을 화면 글자로 — 0.0475 → "4.75%". 요율을 글자로 또 적어 두면 RATES 만 고쳤을 때 어긋난다. */
const pct = (f: number) => `${+(f * 100).toFixed(4)}%`;
const digits = (s: string) => s.replace(/[^0-9.]/g, "");
const comma = (s: string) => (s ? Number(s.replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : "");

export default function InsuranceCalculatorView() {
  const [salary, setSalary] = useState("");
  const [accidentRate, setAccidentRate] = useState(""); // 산재 요율 % (선택)
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const r = useMemo(() => {
    const pay = Number(salary.replace(/[^0-9]/g, ""));
    if (!pay) return null;
    // 국민연금 — 기준소득월액 상·하한 클램프
    const pensionBase = Math.min(RATES.pensionCapHigh, Math.max(RATES.pensionCapLow, pay));
    const pensionEach = (pensionBase * RATES.pensionRate) / 2;
    const healthEach = (pay * RATES.healthRate) / 2;
    const careEach = (pay * RATES.careRate) / 2;
    const empEach = (pay * RATES.empRate) / 2;
    const empBiz = pay * RATES.empBizExtra;
    const accident = accidentRate ? (pay * Number(accidentRate)) / 100 : 0;

    const workerTotal = pensionEach + healthEach + careEach + empEach;
    const bizTotal = pensionEach + healthEach + careEach + empEach + empBiz + accident;
    return {
      pay, pensionBase, pensionEach, healthEach, careEach, empEach, empBiz, accident,
      workerTotal, bizTotal,
      afterDeduct: pay - workerTotal,
      totalCost: pay + bizTotal,
      capped: pay > RATES.pensionCapHigh,
      //   하한도 알려 준다 — 월급이 41만 원보다 적어도 보험료는 41만 원 기준으로 붙는다.
      //   "왜 월급보다 보험료 비율이 높지?" 의 답이 여기 있다.
      floored: pay < RATES.pensionCapLow,
    };
  }, [salary, accidentRate]);

  //   ★ '계산' 칸을 함께 적는다 — 금액만 있으면 **무엇에 요율을 곱했는지**
  //     알 수 없다. 특히 국민연금은 월급이 아니라 기준소득월액(상·하한으로 자른 값)에 붙는다.
  //     요율 글자는 RATES 에서 뽑는다 — 손으로 또 적으면 요율 개정 때 한쪽만 고쳐진다.
  const rows = r ? [
    { name: "국민연금",
      calc: `${won(r.pensionBase)}${r.capped ? " (상한)" : r.floored ? " (하한)" : ""} × ${pct(RATES.pensionRate / 2)}`,
      worker: r.pensionEach, biz: r.pensionEach },
    { name: "건강보험", calc: `${won(r.pay)} × ${pct(RATES.healthRate / 2)}`, worker: r.healthEach, biz: r.healthEach },
    { name: "장기요양", calc: `${won(r.pay)} × ${pct(RATES.careRate / 2)}`, worker: r.careEach, biz: r.careEach },
    { name: "고용보험", calc: `${won(r.pay)} × ${pct(RATES.empRate / 2)}`, worker: r.empEach, biz: r.empEach },
    { name: "고용안정·직능개발", calc: `${won(r.pay)} × ${pct(RATES.empBizExtra)} · 회사만`, worker: null, biz: r.empBiz },
    ...(r.accident > 0 ? [{ name: "산재보험", calc: `${won(r.pay)} × ${accidentRate}% · 회사만`, worker: null, biz: r.accident }] : []),
  ] : [];


  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회 (2026-08-13)
  const tracked = useRef(false);
  useEffect(() => {
    if (r && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "insurance" }); }
  }, [r]);

  return (
    <div className="lp8">
      <SiteHeader />

      <section className="tl8-section tl8-bg-canvas">
        <div className="tl8-narrow">
          <div className="tl8-sec-head tl8-sec-head-c">
            <div className="tl8-eyebrow">무료 도구</div>
            <h1 className="tl8-h2">4대보험 계산기 <span className="tl8-yearchip">{RATES.yearLabel} 요율</span></h1>
            <p className="tl8-sub">월급에서 얼마가 공제되고, 회사는 얼마를 더 부담하는지 · 직원과 사장님 양쪽의 몫을 한 번에 계산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="tl8-card">
            <div className="tl8-fields">
              <label className="tl8-field">
                <span className="tl8-label">월급 (세전, 보수월액)</span>
                <input type="text" inputMode="numeric" placeholder="3,000,000" className="tl8-input" value={comma(salary)} onChange={(e) => setSalary(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="tl8-field">
                <span className="tl8-label">산재보험 요율 % (선택 · 업종별 상이)</span>
                <input type="text" inputMode="decimal" placeholder="예: 0.7" className="tl8-input" value={accidentRate} onChange={(e) => setAccidentRate(digits(e.target.value))} />
              </label>
            </div>

            {r ? (
              <div className="tl8-result" aria-live="polite">
                <div className="tl8-duo">
                  <div className="tl8-duo-col">
                    <div className="tl8-duo-cap">직원 공제 후 월급 (소득세 제외)</div>
                    <div className="tl8-result-num">{won(r.afterDeduct)}원</div>
                    <div className="tl8-duo-sub">공제 합계 −{won(r.workerTotal)}원</div>
                  </div>
                  <div className="tl8-duo-col">
                    <div className="tl8-duo-cap">회사 실제 부담 총액</div>
                    <div className="tl8-result-num">{won(r.totalCost)}원</div>
                    <div className="tl8-duo-sub">월급 + 회사 보험료 {won(r.bizTotal)}원</div>
                  </div>
                </div>
                <table className="tl8-table tl8-table-tight">
                  <thead>
                    <tr><th>항목</th><th>계산</th><th>직원 부담</th><th>회사 부담</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td className="tl8-dim">{row.calc}</td>
                        <td>{row.worker === null ? "—" : `${won(row.worker)}원`}</td>
                        <td>{won(row.biz)}원</td>
                      </tr>
                    ))}
                    <tr>
                      <td><b>합계</b></td>
                      <td className="tl8-dim">월급 {won(r.pay)}원 기준</td>
                      <td><b>{won(r.workerTotal)}원</b></td>
                      <td><b>{won(r.bizTotal)}원</b></td>
                    </tr>
                  </tbody>
                </table>
                {(r.capped || r.floored) && (
                  <div className="tl8-result-rows">
                    <div className="tl8-result-row">
                      {r.capped
                        ? <>국민연금은 기준소득월액 <b>상한({won(RATES.pensionCapHigh)}원)</b>까지만 부과됩니다. 월급이 더 많아도 연금 보험료는 그대로입니다</>
                        : <>국민연금은 기준소득월액 <b>하한({won(RATES.pensionCapLow)}원)</b>부터 부과됩니다. 월급이 더 적어도 하한 기준으로 붙습니다</>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="tl8-empty">월급을 넣으면 바로 계산됩니다</div>
            )}
            {(r) && (
              <ResultCta tool="insurance" menuHref={menuHref("hr", "employees")} menuLabel="구성원 기능 보기">
                4대보험 요율은 해마다 바뀝니다. <b>오너뷰는 올해 요율표로 구성원별 공제액을 계산해 급여에 반영</b>합니다.
              </ResultCta>
            )}
          </div>

          <p className="tl8-note">
            * {RATES.yearLabel} 요율 기준(국민연금 9.5%·건강 7.19%·장기요양 0.9448%·고용 1.8%, 국민연금 상·하한은 2026.7~2027.6 고시). 고용안정·직능개발 0.25%는 150인 미만 사업장 기준이며, 근로소득세·지방소득세는 별도입니다.
          </p>

          {/* 요율표 — 검색 스니펫·본문 텍스트 겸용 */}
          <div className="tl8-tablewrap">
            <h2 className="tl8-h3">{RATES.yearLabel} 4대보험 요율표</h2>
            <table className="tl8-table">
              <thead>
                <tr><th>보험</th><th>총 요율</th><th>직원</th><th>회사</th></tr>
              </thead>
              <tbody>
                <tr><td>국민연금</td><td>9.5% <span className="tl8-dim">(2026년 9%→9.5% 인상)</span></td><td>4.75%</td><td>4.75%</td></tr>
                <tr><td>건강보험</td><td>7.19%</td><td>3.595%</td><td>3.595%</td></tr>
                <tr><td>장기요양보험</td><td>0.9448%</td><td>0.4724%</td><td>0.4724%</td></tr>
                <tr><td>고용보험 (실업급여)</td><td>1.8%</td><td>0.9%</td><td>0.9%</td></tr>
                <tr><td>고용안정·직능개발</td><td>0.25%~0.85%</td><td>—</td><td>전액 (150인 미만 0.25%)</td></tr>
                <tr><td>산재보험</td><td>업종별 상이</td><td>—</td><td>전액</td></tr>
              </tbody>
            </table>
          </div>

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
            다른 무료 도구: <Link href="/tools/leave-calculator" className="tl8-crosslink">연차 계산기</Link> · <Link href="/tools/severance-calculator" className="tl8-crosslink">퇴직금 계산기</Link> · <Link href="/tools/salary-calculator" className="tl8-crosslink">실수령액 계산기</Link> · <Link href="/tools/weekly-holiday-calculator" className="tl8-crosslink">주휴수당 계산기</Link> · <Link href="/tools/vat-calculator" className="tl8-crosslink">부가세 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="tl8-section tl8-bg-tint">
        <div className="tl8-narrow tl8-sec-head-c">
          <h2 className="tl8-h2">직원을 뽑을 때마다 하는 이 계산, 오너뷰가 자동으로 처리합니다</h2>
          <p className="tl8-sub">오너뷰는 급여명세서의 4대보험·세금 공제를 자동 계산하고, 근태·연차·계약서까지 사장님의 인사 업무를 한 곳에서 끝냅니다. 카드 등록 없이 무료로 시작하세요.</p>
          <div className="tl8-feat-cta">
            <Link href="/auth?mode=signup" className="btn btn-fill" data-cta="signup:tool_insurance">무료로 시작하기</Link>
            <Link href="/features" className="btn btn-soft">기능 둘러보기</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
