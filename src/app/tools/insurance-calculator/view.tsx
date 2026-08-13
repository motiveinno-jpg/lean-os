"use client";

// 4대보험 계산기 화면 (2026-08-13) — 무료 도구 3탄. lp4-freetool 스타일.
//   2026년 요율 (출처: 보건복지부 고시·국민연금공단·건강보험공단, 2026-08 확인):
//     · 국민연금 9.5% (근로자 4.75 / 회사 4.75) — 연금개혁으로 2026년 9%→9.5% 인상.
//       기준소득월액 상한 659만·하한 41만 (2026.7~2027.6 고시)
//     · 건강보험 7.19% (3.595 / 3.595) · 장기요양 0.9448% (0.4724 / 0.4724, 보수월액 기준)
//     · 고용보험 실업급여 1.8% (0.9 / 0.9) + 회사만 고용안정·직능개발 0.25% (150인 미만)
//     · 산재보험 — 업종별 상이(회사 전액), 선택 입력
//   ⚠️ 요율 개정 시 이 파일 상수만 고치면 된다 (RATES 블록).

import "@/app/landing.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import { FAQS } from "./faqs";
import { track } from "@/lib/analytics";

// ── 2026년 요율 상수 — 개정 시 여기만 수정 ──
const RATES = {
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
      pay, pensionEach, healthEach, careEach, empEach, empBiz, accident,
      workerTotal, bizTotal,
      afterDeduct: pay - workerTotal,
      totalCost: pay + bizTotal,
      capped: pay > RATES.pensionCapHigh,
    };
  }, [salary, accidentRate]);

  const rows = r ? [
    { name: "국민연금 (각 4.75%)", worker: r.pensionEach, biz: r.pensionEach },
    { name: "건강보험 (각 3.595%)", worker: r.healthEach, biz: r.healthEach },
    { name: "장기요양 (각 0.4724%)", worker: r.careEach, biz: r.careEach },
    { name: "고용보험 (각 0.9%)", worker: r.empEach, biz: r.empEach },
    { name: "고용안정·직능개발 (0.25%)", worker: null, biz: r.empBiz },
    ...(r.accident > 0 ? [{ name: `산재보험 (${accidentRate}%)`, worker: null, biz: r.accident }] : []),
  ] : [];


  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회 (2026-08-13)
  const tracked = useRef(false);
  useEffect(() => {
    if (r && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "insurance" }); }
  }, [r]);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">무료 도구</div>
            <h1 className="lp4-h2">4대보험 계산기 <span className="lp4-freetool-yearchip">{RATES.yearLabel} 요율</span></h1>
            <p className="lp4-sub">월급에서 얼마가 공제되고, 회사는 얼마를 더 부담하는지 — 직원과 사장님 양쪽의 몫을 한 번에 계산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="lp4-freetool-card">
            <div className="lp4-freetool-fields">
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">월급 (세전, 보수월액)</span>
                <input type="text" inputMode="numeric" placeholder="3,000,000" className="lp4-input" value={comma(salary)} onChange={(e) => setSalary(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">산재보험 요율 % (선택 — 업종별 상이)</span>
                <input type="text" inputMode="decimal" placeholder="예: 0.7" className="lp4-input" value={accidentRate} onChange={(e) => setAccidentRate(digits(e.target.value))} />
              </label>
            </div>

            {r ? (
              <div className="lp4-freetool-result" aria-live="polite">
                <div className="lp4-freetool-duo">
                  <div className="lp4-freetool-duo-col">
                    <div className="lp4-freetool-duo-cap">직원 공제 후 월급 (소득세 제외)</div>
                    <div className="lp4-freetool-result-num">{won(r.afterDeduct)}원</div>
                    <div className="lp4-freetool-duo-sub">공제 합계 −{won(r.workerTotal)}원</div>
                  </div>
                  <div className="lp4-freetool-duo-col">
                    <div className="lp4-freetool-duo-cap">회사 실제 부담 총액</div>
                    <div className="lp4-freetool-result-num">{won(r.totalCost)}원</div>
                    <div className="lp4-freetool-duo-sub">월급 + 회사 보험료 {won(r.bizTotal)}원</div>
                  </div>
                </div>
                <table className="lp4-freetool-table lp4-freetool-table-tight">
                  <thead>
                    <tr><th>항목</th><th>직원 부담</th><th>회사 부담</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.worker === null ? "—" : `${won(row.worker)}원`}</td>
                        <td>{won(row.biz)}원</td>
                      </tr>
                    ))}
                    <tr>
                      <td><b>합계</b></td>
                      <td><b>{won(r.workerTotal)}원</b></td>
                      <td><b>{won(r.bizTotal)}원</b></td>
                    </tr>
                  </tbody>
                </table>
                {r.capped && (
                  <div className="lp4-freetool-result-rows">
                    <div className="lp4-freetool-result-row">국민연금은 기준소득월액 상한({won(RATES.pensionCapHigh)}원)까지만 부과됩니다</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="lp4-freetool-empty">월급을 넣으면 바로 계산됩니다</div>
            )}
          </div>

          <p className="lp4-freetool-note">
            * {RATES.yearLabel} 요율 기준(국민연금 9.5%·건강 7.19%·장기요양 0.9448%·고용 1.8%, 국민연금 상·하한은 2026.7~2027.6 고시). 고용안정·직능개발 0.25%는 150인 미만 사업장 기준이며, 근로소득세·지방소득세는 별도입니다.
          </p>

          {/* 요율표 — 검색 스니펫·본문 텍스트 겸용 */}
          <div className="lp4-freetool-tablewrap">
            <h2 className="lp4-freetool-h3">{RATES.yearLabel} 4대보험 요율표</h2>
            <table className="lp4-freetool-table">
              <thead>
                <tr><th>보험</th><th>총 요율</th><th>직원</th><th>회사</th></tr>
              </thead>
              <tbody>
                <tr><td>국민연금</td><td>9.5% <span className="lp4-freetool-dim">(2026년 9%→9.5% 인상)</span></td><td>4.75%</td><td>4.75%</td></tr>
                <tr><td>건강보험</td><td>7.19%</td><td>3.595%</td><td>3.595%</td></tr>
                <tr><td>장기요양보험</td><td>0.9448%</td><td>0.4724%</td><td>0.4724%</td></tr>
                <tr><td>고용보험 (실업급여)</td><td>1.8%</td><td>0.9%</td><td>0.9%</td></tr>
                <tr><td>고용안정·직능개발</td><td>0.25%~0.85%</td><td>—</td><td>전액 (150인 미만 0.25%)</td></tr>
                <tr><td>산재보험</td><td>업종별 상이</td><td>—</td><td>전액</td></tr>
              </tbody>
            </table>
          </div>

          {/* FAQ */}
          <div className="lp4-freetool-faqwrap">
            <h2 className="lp4-freetool-h3">자주 묻는 질문</h2>
            {FAQS.map((f, i) => (
              <div key={i} className={`lp4-faq ${openFaq === i ? "lp4-faq-open" : ""}`}>
                <button type="button" className="lp4-faq-btn" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{f.q}</span>
                  <svg className="lp4-faq-chev" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
                </button>
                <div className="lp4-faq-panel"><p className="lp4-faq-a">{f.a}</p></div>
              </div>
            ))}
          </div>

          <p className="lp4-freetool-note">
            다른 무료 도구: <Link href="/tools/leave-calculator" className="lp4-freetool-crosslink">연차 계산기</Link> · <Link href="/tools/severance-calculator" className="lp4-freetool-crosslink">퇴직금 계산기</Link> · <Link href="/tools/salary-calculator" className="lp4-freetool-crosslink">실수령액 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">직원 뽑을 때마다 이 계산, 자동으로 하면 어떨까요?</h2>
          <p className="lp4-sub">오너뷰는 급여명세서의 4대보험·세금 공제를 자동 계산하고, 근태·연차·계약서까지 사장님의 인사 업무를 한 곳에서 끝냅니다. 카드 등록 없이 무료로 시작하세요.</p>
          <div className="lp4-feat-cta">
            <Link href="/auth" className="lp4-btn lp4-btn-brand">무료로 시작하기</Link>
            <Link href="/features" className="lp4-btn lp4-btn-line">기능 둘러보기</Link>
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
