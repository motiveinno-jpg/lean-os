"use client";

// 주휴수당 계산기 화면 (2026-08-25) — 무료 도구 5탄. lp4-freetool 스타일(salary-calculator 와 동일 구조).
//   근로기준법 제55조: 1주 소정근로시간 15시간 이상 + 개근이면 유급 주휴일 발생.
//     · 주휴시간 = min(1주 소정근로시간, 40) ÷ 40 × 8   (연장근로 제외, 최대 8시간)
//     · 주휴수당 = 주휴시간 × 시급
//     · 월 환산 = 1주 주휴수당 × 4.345주 (365÷7÷12)
//   최저임금은 lib/support-programs 의 MIN_WAGE_HOURLY_2026 과 같은 값(2026년 — 개정 시 함께 수정).

import "@/app/landing.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import { FAQS } from "./faqs";
import { track } from "@/lib/analytics";

const MIN_WAGE_HOURLY_2026 = 10320; // lib/support-programs.MIN_WAGE_HOURLY_2026 과 동일
const WEEKS_PER_MONTH = 4.345; // 365 ÷ 7 ÷ 12

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const comma = (s: string) => (s ? Number(s.replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : "");

export default function WeeklyHolidayCalculatorView() {
  const [hourly, setHourly] = useState(String(MIN_WAGE_HOURLY_2026));
  const [dayHours, setDayHours] = useState("8"); // 1일 근로시간
  const [daysPerWeek, setDaysPerWeek] = useState(5); // 주 근무일수
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const r = useMemo(() => {
    const wage = Number(hourly.replace(/[^0-9]/g, ""));
    const perDay = Number(dayHours.replace(/[^0-9.]/g, ""));
    if (!wage || !perDay || !daysPerWeek) return null;
    const weeklyHours = perDay * daysPerWeek;
    const eligible = weeklyHours >= 15;
    const juhyuHours = eligible ? (Math.min(weeklyHours, 40) / 40) * 8 : 0;
    const juhyuWeek = juhyuHours * wage;
    const juhyuMonth = juhyuWeek * WEEKS_PER_MONTH;
    const workWeek = weeklyHours * wage;
    return {
      wage, weeklyHours, eligible, juhyuHours,
      juhyuWeek, juhyuMonth, workWeek, totalWeek: workWeek + juhyuWeek,
    };
  }, [hourly, dayHours, daysPerWeek]);

  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회
  const tracked = useRef(false);
  useEffect(() => {
    if (r && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "weekly-holiday" }); }
  }, [r]);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">무료 도구</div>
            <h1 className="lp4-h2">주휴수당 계산기 <span className="lp4-freetool-yearchip">2026년 기준</span></h1>
            <p className="lp4-sub">1주 15시간 이상 일한 직원·아르바이트는 주휴수당을 받습니다. 시급과 근무시간만 넣으면 주휴시간과 주휴수당을 근로기준법 제55조 기준으로 계산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="lp4-freetool-card">
            <div className="lp4-freetool-fields">
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">시급 (기본: 2026 최저임금)</span>
                <input type="text" inputMode="numeric" placeholder="10,320" className="lp4-input" value={comma(hourly)} onChange={(e) => setHourly(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">1일 근로시간</span>
                <input type="text" inputMode="decimal" placeholder="8" className="lp4-input" value={dayHours} onChange={(e) => setDayHours(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">주 근무일수</span>
                <select className="lp4-input" value={daysPerWeek} onChange={(e) => setDaysPerWeek(Number(e.target.value))}>
                  {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}일</option>)}
                </select>
              </label>
            </div>

            {r ? (
              r.eligible ? (
                <div className="lp4-freetool-result" aria-live="polite">
                  <div className="lp4-freetool-result-main">
                    <span className="lp4-freetool-result-num">{won(r.juhyuWeek)}원</span>
                    <span className="lp4-freetool-result-cap">1주 주휴수당 — 월 환산 약 {won(r.juhyuMonth)}원</span>
                  </div>
                  <table className="lp4-freetool-table lp4-freetool-table-tight">
                    <thead>
                      <tr><th>항목</th><th>값</th><th>계산</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>1주 소정근로시간</td><td>{r.weeklyHours}시간</td><td className="lp4-freetool-dim">1일 {dayHours}시간 × 주 {daysPerWeek}일</td></tr>
                      <tr><td>주휴시간</td><td>{+r.juhyuHours.toFixed(2)}시간</td><td className="lp4-freetool-dim">min({r.weeklyHours}, 40) ÷ 40 × 8</td></tr>
                      <tr><td><b>1주 주휴수당</b></td><td><b>{won(r.juhyuWeek)}원</b></td><td className="lp4-freetool-dim">주휴시간 × 시급 {won(r.wage)}</td></tr>
                      <tr><td>월 환산 주휴수당</td><td>{won(r.juhyuMonth)}원</td><td className="lp4-freetool-dim">1주 주휴수당 × 4.345주</td></tr>
                      <tr><td>참고 · 1주 임금 합계</td><td>{won(r.totalWeek)}원</td><td className="lp4-freetool-dim">근로 {won(r.workWeek)} + 주휴 {won(r.juhyuWeek)}</td></tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="lp4-freetool-result" aria-live="polite">
                  <div className="lp4-freetool-result-main">
                    <span className="lp4-freetool-result-num">해당 없음</span>
                    <span className="lp4-freetool-result-cap">1주 소정근로시간이 {r.weeklyHours}시간 — 15시간 미만이면 주휴수당이 발생하지 않습니다</span>
                  </div>
                </div>
              )
            ) : (
              <div className="lp4-freetool-empty">시급과 근무시간을 넣으면 바로 계산됩니다</div>
            )}
          </div>

          <p className="lp4-freetool-note">
            * 주휴수당은 1주 소정근로시간 15시간 이상이면서 그 주 정해진 근무일을 개근한 경우 발생합니다(근로기준법 제55조). 결근이 있으면 그 주 주휴수당은 발생하지 않습니다. 소정근로시간이 40시간을 넘어도 주휴시간은 8시간까지만 인정됩니다.
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
            다른 무료 도구: <Link href="/tools/salary-calculator" className="lp4-freetool-crosslink">실수령액 계산기</Link> · <Link href="/tools/insurance-calculator" className="lp4-freetool-crosslink">4대보험 계산기</Link> · <Link href="/tools/severance-calculator" className="lp4-freetool-crosslink">퇴직금 계산기</Link> · <Link href="/tools/leave-calculator" className="lp4-freetool-crosslink">연차 계산기</Link> · <Link href="/tools/vat-calculator" className="lp4-freetool-crosslink">부가세 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">주휴수당까지 반영한 급여, 매달 자동으로</h2>
          <p className="lp4-sub">오너뷰는 근태 기록을 바탕으로 주휴수당·4대보험·소득세를 자동 계산해 급여명세서를 만들어 발송합니다. 알바·직원 근무시간만 넣으면 매달 손 안 대도 됩니다. 카드 등록 없이 무료로 시작하세요.</p>
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
