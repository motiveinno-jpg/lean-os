"use client";

// 퇴직금 계산기 화면 (2026-08-13) — 연차 계산기(1탄)와 같은 lp4-freetool 스타일.
//   계산 규칙(근로자퇴직급여 보장법 제8조, 고용노동부 계산기와 동일 방식):
//     · 퇴직금 = 1일 평균임금 × 30일 × (재직일수 / 365)
//     · 1일 평균임금 = 퇴직일 이전 3개월 임금총액 ÷ 그 3개월의 실제 일수(89~92일)
//     · 3개월 임금총액 = 월급×3 + 연간 상여 × 3/12 + 연차수당 × 3/12
//     · 계속근로 1년 미만은 지급 대상 아님. 통상임금이 더 크면 통상임금 기준(안내만).

import "@/app/landing.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { DateField } from "@/components/date-field";
import { FOOTER } from "@/components/landing/content";
import { FAQS } from "./faqs";
import { track } from "@/lib/analytics";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
// 콤마 입력 필드 — 숫자만 남기고 천단위 콤마로 표시
const digits = (s: string) => s.replace(/[^0-9]/g, "");
const comma = (s: string) => (s ? Number(s).toLocaleString("ko-KR") : "");

function fmtDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export default function SeveranceCalculatorView() {
  const [hire, setHire] = useState("");
  const [leave, setLeave] = useState("");
  const [salary, setSalary] = useState("");   // 월급(세전)
  const [bonus, setBonus] = useState("");     // 연간 상여금 총액 (선택)
  const [leavePay, setLeavePay] = useState(""); // 연차수당 (선택)
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const result = useMemo(() => {
    const pay = Number(digits(salary));
    if (!hire || !leave || !pay) return null;
    const h = new Date(hire + "T00:00:00");
    const l = new Date(leave + "T00:00:00");
    if (isNaN(h.getTime()) || isNaN(l.getTime()) || l <= h) return null;

    // 재직일수 — 입사일부터 마지막 근무일까지 (양 끝 포함)
    const serviceDays = Math.floor((l.getTime() - h.getTime()) / 86400000) + 1;
    if (serviceDays < 365) return { under1: true as const, serviceDays };

    // 퇴직일 이전 3개월의 실제 일수 — (퇴직일-3개월+1일) ~ 퇴직일
    const from = new Date(l);
    from.setMonth(from.getMonth() - 3);
    from.setDate(from.getDate() + 1);
    const periodDays = Math.round((l.getTime() - from.getTime()) / 86400000) + 1;

    const yearBonus = Number(digits(bonus));
    const yearLeavePay = Number(digits(leavePay));
    const threeMonthTotal = pay * 3 + (yearBonus * 3) / 12 + (yearLeavePay * 3) / 12;
    const avgDaily = threeMonthTotal / periodDays;
    const severance = avgDaily * 30 * (serviceDays / 365);

    const years = Math.floor(serviceDays / 365);
    return {
      under1: false as const,
      serviceDays, years,
      months: Math.floor((serviceDays % 365) / 30),
      hireDate: h,
      periodFrom: from, periodTo: l, periodDays,
      //   계산 내역용 조각 — 합계만 보여 주면 "왜 이 금액인지" 확인할 방법이 없다 (2026-08-14 사장님)
      pay, yearBonus, yearLeavePay,
      payX3: pay * 3,
      bonusPart: (yearBonus * 3) / 12,
      leavePart: (yearLeavePay * 3) / 12,
      threeMonthTotal, avgDaily, severance,
    };
  }, [hire, leave, salary, bonus, leavePay]);


  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회 (2026-08-13)
  const tracked = useRef(false);
  useEffect(() => {
    if (result && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "severance" }); }
  }, [result]);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">무료 도구</div>
            <h1 className="lp4-h2">퇴직금 계산기</h1>
            <p className="lp4-sub">입사일·퇴직일·월급만 넣으면 고용노동부 방식(평균임금 × 30일 × 재직일수/365)으로 예상 퇴직금을 계산해 드려요. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="lp4-freetool-card">
            <div className="lp4-freetool-fields">
              {/*   달력은 오너뷰 안에서 쓰는 것과 같은 부품(DateField) — 연차 계산기와 같은 이유
                    (2026-08-14 사장님). onChange 가 input 호환이라 계산 로직은 그대로다. */}
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">입사일</span>
                <DateField className="lp4-input" value={hire} max={leave || undefined} onChange={(e) => setHire(e.target.value)} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">퇴직일 (마지막 근무일)</span>
                <DateField className="lp4-input" value={leave} min={hire || undefined} onChange={(e) => setLeave(e.target.value)} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">월급 (세전 기본급+고정수당)</span>
                <input type="text" inputMode="numeric" placeholder="3,000,000" className="lp4-input" value={comma(digits(salary))} onChange={(e) => setSalary(digits(e.target.value))} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">연간 상여금 총액 (선택)</span>
                <input type="text" inputMode="numeric" placeholder="0" className="lp4-input" value={comma(digits(bonus))} onChange={(e) => setBonus(digits(e.target.value))} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">연차휴가 미사용수당 (선택)</span>
                <input type="text" inputMode="numeric" placeholder="0" className="lp4-input" value={comma(digits(leavePay))} onChange={(e) => setLeavePay(digits(e.target.value))} />
              </label>
            </div>

            {result ? (
              result.under1 ? (
                <div className="lp4-freetool-empty">
                  재직 {result.serviceDays}일 — 계속근로 <b>1년 미만</b>은 법정 퇴직금 지급 대상이 아닙니다
                </div>
              ) : (
                <div className="lp4-freetool-result" aria-live="polite">
                  <div className="lp4-freetool-result-main">
                    <span className="lp4-freetool-result-num">약 {won(result.severance)}원</span>
                    <span className="lp4-freetool-result-cap">근속 {result.years}년 {result.months}개월 — 예상 퇴직금 (세전)</span>
                  </div>
                  <div className="lp4-freetool-result-rows">
                    {/*   이 금액이 어떻게 나왔는지 — 단계별로 적는다 (2026-08-14 사장님, 연차 계산기와 같은 방식).
                          예전에는 같은 내용을 두 줄의 글로 적어 뒀는데, 글로 이어 붙이면 어느 숫자가
                          어디서 왔는지 눈으로 따라가기 어렵고 검산이 안 된다. 표로 세워 한 줄씩 짚는다.
                          (그래서 그 두 줄은 이 표로 흡수했다 — 같은 말을 두 곳에 두지 않는다) */}
                    <div className="lp4-freetool-duo-col">
                      <div className="lp4-freetool-duo-cap">이 금액이 나온 계산</div>
                      <table className="lp4-freetool-table lp4-freetool-table-tight">
                        <thead>
                          <tr><th>단계</th><th>계산</th><th>결과</th></tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>재직일수</td>
                            <td className="lp4-freetool-dim">{fmtDate(result.hireDate)} ~ {fmtDate(result.periodTo)} (양 끝 포함)</td>
                            <td>{won(result.serviceDays)}일</td>
                          </tr>
                          <tr>
                            <td>월급 × 3개월</td>
                            <td className="lp4-freetool-dim">{won(result.pay)} × 3</td>
                            <td>{won(result.payX3)}원</td>
                          </tr>
                          {/*   안 넣은 항목은 줄을 만들지 않는다 — 0원짜리 줄이 늘어서면 표가 시끄럽다 */}
                          {result.yearBonus > 0 && (
                            <tr>
                              <td>연간 상여금</td>
                              <td className="lp4-freetool-dim">{won(result.yearBonus)} × 3/12</td>
                              <td>{won(result.bonusPart)}원</td>
                            </tr>
                          )}
                          {result.yearLeavePay > 0 && (
                            <tr>
                              <td>연차휴가 미사용수당</td>
                              <td className="lp4-freetool-dim">{won(result.yearLeavePay)} × 3/12</td>
                              <td>{won(result.leavePart)}원</td>
                            </tr>
                          )}
                          <tr>
                            <td>3개월 임금총액</td>
                            <td className="lp4-freetool-dim">{fmtDate(result.periodFrom)} ~ {fmtDate(result.periodTo)} · {result.periodDays}일</td>
                            <td>{won(result.threeMonthTotal)}원</td>
                          </tr>
                          <tr>
                            <td>1일 평균임금</td>
                            <td className="lp4-freetool-dim">{won(result.threeMonthTotal)} ÷ {result.periodDays}일</td>
                            <td>{won(result.avgDaily)}원</td>
                          </tr>
                          <tr>
                            <td><b>퇴직금</b></td>
                            <td className="lp4-freetool-dim">{won(result.avgDaily)} × 30일 × ({won(result.serviceDays)} ÷ 365)</td>
                            <td><b>약 {won(result.severance)}원</b></td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="lp4-freetool-duo-sub">
                        표시 금액은 원 단위로 반올림한 것이라, 위 숫자를 그대로 곱하면 끝자리가 조금 다를 수 있습니다(계산은 반올림 전 값으로 합니다).
                      </div>
                    </div>
                    <div className="lp4-freetool-result-row">
                      평균임금이 통상임금보다 적으면 <b>통상임금 기준</b>으로 계산해야 합니다 · 퇴직소득세는 별도 원천징수
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="lp4-freetool-empty">입사일 · 퇴직일 · 월급을 넣으면 바로 계산됩니다</div>
            )}
          </div>

          <p className="lp4-freetool-note">
            * 최근 3개월 월급이 같다고 가정한 예상치입니다. 실제 지급액은 3개월간 실수령 임금 내역, 통상임금 비교, 퇴직연금(DC형) 가입 여부, 휴직·결근 기간 처리에 따라 달라질 수 있습니다.
          </p>

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
            다른 무료 도구: <Link href="/tools/leave-calculator" className="lp4-freetool-crosslink">연차 계산기</Link> · <Link href="/tools/insurance-calculator" className="lp4-freetool-crosslink">4대보험 계산기</Link> · <Link href="/tools/salary-calculator" className="lp4-freetool-crosslink">실수령액 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">직원 급여·퇴직금 관리, 아직 엑셀로 하세요?</h2>
          <p className="lp4-sub">오너뷰는 급여명세서 발송부터 연차·근태·4대보험까지 사장님이 챙길 인사 업무를 한 곳에서 끝냅니다. 카드 등록 없이 무료로 시작하세요.</p>
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
