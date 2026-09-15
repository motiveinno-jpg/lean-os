"use client";

// 주휴수당 계산기 화면 (2026-08-25) — 무료 도구 5탄. tl8-(랜딩 v8) 스타일(salary-calculator 와 동일 구조).
//   근로기준법 제55조: 1주 소정근로시간 15시간 이상 + 개근이면 유급 주휴일 발생.
//     · 주휴시간 = min(1주 소정근로시간, 40) ÷ 40 × 8   (연장근로 제외, 최대 8시간)
//     · 주휴수당 = 주휴시간 × 시급
//     · 월 환산 = 1주 주휴수당 × 4.345주 (365÷7÷12)
//   최저임금은 lib/support-programs 의 MIN_WAGE_HOURLY_2026 과 같은 값(2026년 — 개정 시 함께 수정).

import "@/app/landing-v8.css";
import Link from "next/link";
import { ResultCta } from "../_result-cta";
import { menuHref } from "@/components/landing-v8/catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
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
    <div className="lp8">
      <SiteHeader />

      <section className="tl8-section tl8-bg-canvas">
        <div className="tl8-narrow">
          <div className="tl8-sec-head tl8-sec-head-c">
            <div className="tl8-eyebrow">무료 도구</div>
            <h1 className="tl8-h2">주휴수당 계산기 <span className="tl8-yearchip">2026년 기준</span></h1>
            <p className="tl8-sub">1주 15시간 이상 일한 직원·아르바이트는 주휴수당을 받습니다. 시급과 근무시간만 넣으면 주휴시간과 주휴수당을 근로기준법 제55조 기준으로 계산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="tl8-card">
            <div className="tl8-fields">
              <label className="tl8-field">
                <span className="tl8-label">시급 (기본: 2026 최저임금)</span>
                <input type="text" inputMode="numeric" placeholder="10,320" className="tl8-input" value={comma(hourly)} onChange={(e) => setHourly(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="tl8-field">
                <span className="tl8-label">1일 근로시간</span>
                <input type="text" inputMode="decimal" placeholder="8" className="tl8-input" value={dayHours} onChange={(e) => setDayHours(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
              <label className="tl8-field">
                <span className="tl8-label">주 근무일수</span>
                <select className="tl8-input" value={daysPerWeek} onChange={(e) => setDaysPerWeek(Number(e.target.value))}>
                  {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}일</option>)}
                </select>
              </label>
            </div>

            {r ? (
              r.eligible ? (
                <div className="tl8-result" aria-live="polite">
                  <div className="tl8-result-main">
                    <span className="tl8-result-num">{won(r.juhyuWeek)}원</span>
                    <span className="tl8-result-cap">1주 주휴수당 — 월 환산 약 {won(r.juhyuMonth)}원</span>
                  </div>
                  <table className="tl8-table tl8-table-tight">
                    <thead>
                      <tr><th>항목</th><th>값</th><th>계산</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>1주 소정근로시간</td><td>{r.weeklyHours}시간</td><td className="tl8-dim">1일 {dayHours}시간 × 주 {daysPerWeek}일</td></tr>
                      <tr><td>주휴시간</td><td>{+r.juhyuHours.toFixed(2)}시간</td><td className="tl8-dim">min({r.weeklyHours}, 40) ÷ 40 × 8</td></tr>
                      <tr><td><b>1주 주휴수당</b></td><td><b>{won(r.juhyuWeek)}원</b></td><td className="tl8-dim">주휴시간 × 시급 {won(r.wage)}</td></tr>
                      <tr><td>월 환산 주휴수당</td><td>{won(r.juhyuMonth)}원</td><td className="tl8-dim">1주 주휴수당 × 4.345주</td></tr>
                      <tr><td>참고 · 1주 임금 합계</td><td>{won(r.totalWeek)}원</td><td className="tl8-dim">근로 {won(r.workWeek)} + 주휴 {won(r.juhyuWeek)}</td></tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="tl8-result" aria-live="polite">
                  <div className="tl8-result-main">
                    <span className="tl8-result-num">해당 없음</span>
                    <span className="tl8-result-cap">1주 소정근로시간이 {r.weeklyHours}시간 · 15시간 미만이면 주휴수당이 발생하지 않습니다</span>
                  </div>
                </div>
              )
            ) : (
              <div className="tl8-empty">시급과 근무시간을 넣으면 바로 계산됩니다</div>
            )}
            {(r) && (
              <ResultCta tool="weekly-holiday" menuHref={menuHref("hr", "attendance")} menuLabel="근태 관리 기능 보기">
                주휴수당은 주별 근무시간에 따라 달라집니다. <b>오너뷰는 출퇴근 기록으로 구성원별 근무시간을 자동으로 모아</b> 주 단위로 확인할 수 있습니다.
              </ResultCta>
            )}
          </div>

          <p className="tl8-note">
            * 주휴수당은 1주 소정근로시간 15시간 이상이면서 그 주 정해진 근무일을 개근한 경우 발생합니다(근로기준법 제55조). 결근이 있으면 그 주 주휴수당은 발생하지 않습니다. 소정근로시간이 40시간을 넘어도 주휴시간은 8시간까지만 인정됩니다.
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
            다른 무료 도구: <Link href="/tools/salary-calculator" className="tl8-crosslink">실수령액 계산기</Link> · <Link href="/tools/insurance-calculator" className="tl8-crosslink">4대보험 계산기</Link> · <Link href="/tools/severance-calculator" className="tl8-crosslink">퇴직금 계산기</Link> · <Link href="/tools/leave-calculator" className="tl8-crosslink">연차 계산기</Link> · <Link href="/tools/vat-calculator" className="tl8-crosslink">부가세 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="tl8-section tl8-bg-tint">
        <div className="tl8-narrow tl8-sec-head-c">
          <h2 className="tl8-h2">주휴수당까지 반영한 급여, 매달 자동으로</h2>
          <p className="tl8-sub">오너뷰는 근태 기록을 바탕으로 주휴수당·4대보험·소득세를 자동 계산해 급여명세서를 만들어 발송합니다. 알바·직원 근무시간만 넣으면 매달 손 안 대도 됩니다. 카드 등록 없이 무료로 시작하세요.</p>
          <div className="tl8-feat-cta">
            <Link href="/auth?mode=signup" className="btn btn-fill" data-cta="signup:tool_weekly-holiday">무료로 시작하기</Link>
            <Link href="/features" className="btn btn-soft">기능 둘러보기</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
