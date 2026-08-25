"use client";

// 연차 계산기 화면 (2026-08-13) — 랜딩 패밀리(lp4- 네임스페이스) 스타일을 그대로 따른다.
//   계산 규칙(근로기준법 제60조, 입사일 기준):
//     · 1년 미만: 1개월 개근 시 1일 (최대 11일)
//     · 1년 이상: 15일 + (근속연수-1)/2 내림 가산, 최대 25일
//     · 2020-03-31 개정 반영: 1년 미만 기간의 연차는 1년차 15일에서 차감하지 않는다(별도 발생·별도 소멸)
//   회계연도 기준 부여는 회사마다 규칙이 달라 계산기에선 다루지 않고 안내만 한다(오너뷰가 자동 처리 — CTA).

import "@/app/landing.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { DateField } from "@/components/date-field";
import { FOOTER } from "@/components/landing/content";
import { FAQS } from "./faqs";
import { track } from "@/lib/analytics";

// 만 개월 수 — from 에서 to 까지 "같은 날짜"가 돌아온 횟수 (예: 3/15 입사, 8/13 기준 → 4개월)
function fullMonthsBetween(from: Date, to: Date): number {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m -= 1;
  return Math.max(0, m);
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

/** 근속연수(만)별 연차 — 1년:15 … 21년 이상:25 */
function annualDays(years: number): number {
  if (years < 1) return 0;
  return Math.min(25, 15 + Math.floor((years - 1) / 2));
}

/**
 * 입사일부터 기준일까지 **법으로 생긴** 연차를 시점별로 모은다 (2026-08-14 사장님: "누적도 확인").
 *
 *   ★ 여기서 세는 것은 **생긴 연차(발생)** 다. 쓴 날·소멸분·수당으로 정산한 분은 빼지 않는다 —
 *     그건 회사의 사용 기록이 있어야 알 수 있고, 계산기는 그 기록을 모른다.
 *     합계만 크게 띄우면 "지금 쓸 수 있는 날"로 읽히므로 화면에 반드시 그 구분을 적는다.
 *   ★ 1년 미만의 월 1일(최대 11일)은 1년차 15일에서 **차감하지 않는다** (2020-03-31 개정) —
 *     그래서 만 1년이면 11 + 15 = 26일이 된다.
 *   ★ 같은 일수가 이어지는 해는 한 줄로 묶는다. 안 묶으면 20년 근속이 20줄이 되어 못 읽는다.
 */
function accrualRows(months: number, years: number): { label: string; detail: string; days: number }[] {
  const rows: { label: string; detail: string; days: number }[] = [];
  const firstYear = years >= 1 ? 11 : Math.min(11, months);
  if (firstYear > 0) rows.push({ label: "1년 미만", detail: `${firstYear}개월 개근 × 1일`, days: firstYear });
  let y = 1;
  while (y <= years) {
    const d = annualDays(y);
    let end = y;
    while (end + 1 <= years && annualDays(end + 1) === d) end += 1;
    const times = end - y + 1;
    rows.push({
      label: y === end ? `만 ${y}년` : `만 ${y}~${end}년`,
      detail: `${d}일 × ${times}회`,
      days: d * times,
    });
    y = end + 1;
  }
  return rows;
}

const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export default function LeaveCalculatorView() {
  const [hire, setHire] = useState("");
  const [base, setBase] = useState(todayStr());
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const result = useMemo(() => {
    if (!hire || !base) return null;
    const h = new Date(hire + "T00:00:00");
    const b = new Date(base + "T00:00:00");
    if (isNaN(h.getTime()) || isNaN(b.getTime()) || b < h) return null;

    const months = fullMonthsBetween(h, b);
    const years = Math.floor(months / 12);
    //   지금까지 생긴 연차(누적) — 시점별 내역과 합계. 두 갈래가 같이 쓴다.
    const acc = accrualRows(months, years);
    const accTotal = acc.reduce((n, r) => n + r.days, 0);

    if (years < 1) {
      // 1년 미만 — 개근 가정 월 1일, 최대 11일
      const days = Math.min(11, months);
      const next = new Date(h);
      next.setMonth(next.getMonth() + months + 1);
      return {
        kind: "under1" as const,
        years, months,
        days,
        acc, accTotal,
        nextDate: months < 11 ? next : addYears(h, 1),
        nextDays: months < 11 ? days + 1 : 15,
        nextLabel: months < 11 ? "다음 1일 추가" : "15일 발생(1년 차)",
      };
    }
    const days = annualDays(years);
    // 다음 증가 시점 — 연차 일수가 지금보다 커지는 첫 입사기념일
    //   ★ 25일은 법정 상한이라 **더 늘지 않는다.** 그런데도 다음 기념일을 찾아 "25일로 증가"라고
    //     적고 있었다(2026-08-14 25년 근속으로 확인 — 2029년에 25일로 증가한다고 나왔다).
    //     늘지 않는데 늘어난다고 적으면 그 줄 전체를 못 믿게 된다. 상한이면 상한이라고 말한다.
    const capped = days >= 25;
    let ny = years + 1;
    while (annualDays(ny) === days && ny - years < 3) ny++;
    return {
      kind: "over1" as const,
      years, months: months % 12,
      days, capped,
      acc, accTotal,
      nextDate: addYears(h, ny),
      nextDays: annualDays(ny),
      nextLabel: `${annualDays(ny)}일로 증가`,
    };
  }, [hire, base]);


  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회 (2026-08-13)
  const tracked = useRef(false);
  useEffect(() => {
    if (result && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "leave" }); }
  }, [result]);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">무료 도구</div>
            <h1 className="lp4-h2">연차 계산기</h1>
            <p className="lp4-sub">입사일만 넣으면 근로기준법 제60조 기준으로 지금 발생한 연차를 계산해 드려요. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="lp4-freetool-card">
            <div className="lp4-freetool-fields">
              {/*   달력은 오너뷰 안에서 쓰는 것과 같은 부품(DateField) — 브라우저·OS 마다 다르게
                    생기는 <input type="date"> 대신, 열리는 달력까지 우리 디자인으로 통일한다
                    (2026-08-14 사장님). onChange 가 input 호환이라 계산 로직은 그대로다. */}
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">입사일</span>
                <DateField className="lp4-input" value={hire} max={base} onChange={(e) => setHire(e.target.value)} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">기준일 (오늘)</span>
                <DateField className="lp4-input" value={base} onChange={(e) => setBase(e.target.value)} />
              </label>
            </div>

            {result ? (
              <div className="lp4-freetool-result" aria-live="polite">
                <div className="lp4-freetool-result-main">
                  <span className="lp4-freetool-result-num">{result.days}일</span>
                  {/*   큰 숫자가 무엇인지 분명히 적는다 — 그냥 '현재 발생 연차'라고만 하면
                        "지금까지 쌓인 전부"로 읽힌다(2026-08-14 사장님이 실제로 그렇게 읽으셨다).
                        연차는 1년 단위로 부여되므로 이 숫자는 **이번 1년치**다. */}
                  <span className="lp4-freetool-result-cap">
                    근속 {result.years >= 1 ? `만 ${result.years}년 ${result.months}개월` : `${result.months}개월`}
                    {result.kind === "over1" ? " — 이번 1년치 연차" : " — 지금까지 생긴 연차"}
                  </span>
                </div>
                <div className="lp4-freetool-result-rows">
                  {result.kind === "under1" && (
                    <div className="lp4-freetool-result-row">1년 미만은 <b>1개월 개근마다 1일</b> (최대 11일) — 개근을 가정한 값입니다</div>
                  )}
                  {result.kind === "over1" && (
                    <div className="lp4-freetool-result-row">1년 이상은 <b>15일 + 2년마다 1일 가산</b> (최대 25일), 전년 출근율 80% 이상 기준</div>
                  )}
                  <div className="lp4-freetool-result-row">
                    {result.kind === "over1" && result.capped
                      ? <>연차는 <b>25일이 최대</b>라 근속이 더 늘어도 이 일수는 그대로입니다</>
                      : <>{fmtDate(result.nextDate)}에 <b>{result.nextLabel}</b></>}
                  </div>

                  {/*   누적 — 입사일부터 지금까지 **생긴** 연차의 합계와 그 내역 (2026-08-14 사장님).
                        합계만 두면 "지금 쓸 수 있는 날"로 읽히므로, 내역을 같이 펼쳐 어떻게 그
                        숫자가 되는지 보이게 하고 · 쓴 날은 빼지 않았다는 걸 바로 아래 적는다.
                        1년 미만은 위 큰 숫자가 이미 누적과 같은 값이라 이 칸을 만들지 않는다. */}
                  {result.kind === "over1" && (
                    <div className="lp4-freetool-duo-col">
                      <div className="lp4-freetool-duo-cap">
                        지금까지 생긴 연차 — 모두 <b>{result.accTotal}일</b>
                      </div>
                      <table className="lp4-freetool-table lp4-freetool-table-tight">
                        <thead>
                          <tr><th>생긴 때</th><th>계산</th><th>일수</th></tr>
                        </thead>
                        <tbody>
                          {result.acc.map((r) => (
                            <tr key={r.label}>
                              <td>{r.label}</td>
                              <td className="lp4-freetool-dim">{r.detail}</td>
                              <td>{r.days}일</td>
                            </tr>
                          ))}
                          <tr><td><b>합계</b></td><td className="lp4-freetool-dim">근속 {result.years}년 {result.months}개월</td><td><b>{result.accTotal}일</b></td></tr>
                        </tbody>
                      </table>
                      <div className="lp4-freetool-duo-sub">
                        <b>쓴 날·소멸분·수당으로 정산한 분은 빼지 않은</b> 발생 기준입니다 — 지금 쓸 수 있는 잔여 연차와는 다릅니다.
                        연차는 생긴 날부터 1년 안에 쓰는 것이 원칙이라, 안 쓴 날은 수당으로 정산되거나 촉진제도에 따라 소멸합니다.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              //   달력에 '지우기'가 생겨 기준일도 비울 수 있게 됐다 — 무엇이 비었는지 그대로 적는다
              //   ("입사일을 선택하세요"만 띄우면 입사일을 넣은 사람은 왜 안 되는지 모른다)
              <div className="lp4-freetool-empty">
                {!hire && !base ? "입사일과 기준일을 선택하면 바로 계산됩니다"
                  : !hire ? "입사일을 선택하면 바로 계산됩니다"
                  : !base ? "기준일을 선택하면 바로 계산됩니다"
                  : "기준일은 입사일보다 뒤여야 합니다"}
              </div>
            )}
          </div>

          <p className="lp4-freetool-note">
            * 입사일 기준·개근(출근율 80% 이상) 가정의 법정 최소치입니다. 회계연도 기준 부여, 육아휴직·휴직 기간 처리, 촉진제도 적용 여부에 따라 실제 부여 일수는 달라질 수 있습니다.
          </p>

          {/* 근속연수별 표 — 검색 스니펫·본문 텍스트 겸용 */}
          <div className="lp4-freetool-tablewrap">
            <h2 className="lp4-freetool-h3">근속연수별 연차 발생 일수 (근로기준법 제60조)</h2>
            <table className="lp4-freetool-table">
              <thead>
                <tr><th>근속연수</th><th>연차 일수</th><th>근속연수</th><th>연차 일수</th></tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((row) => {
                  const y1 = row, y2 = row + 6;
                  return (
                    <tr key={row}>
                      <td>{y1}년</td><td>{annualDays(y1)}일</td>
                      <td>{y2}년</td><td>{annualDays(y2)}일</td>
                    </tr>
                  );
                })}
                <tr><td>21년 이상</td><td>25일 (최대)</td><td>1년 미만</td><td>월 1일, 최대 11일</td></tr>
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
            다른 무료 도구: <Link href="/tools/severance-calculator" className="lp4-freetool-crosslink">퇴직금 계산기</Link> · <Link href="/tools/insurance-calculator" className="lp4-freetool-crosslink">4대보험 계산기</Link> · <Link href="/tools/salary-calculator" className="lp4-freetool-crosslink">실수령액 계산기</Link> · <Link href="/tools/weekly-holiday-calculator" className="lp4-freetool-crosslink">주휴수당 계산기</Link> · <Link href="/tools/vat-calculator" className="lp4-freetool-crosslink">부가세 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">직원별 연차, 아직 엑셀로 세고 계세요?</h2>
          <p className="lp4-sub">오너뷰는 입사일 기준·회계연도 기준 모두 매월 자동으로 부여하고, 신청·승인·잔여 관리까지 한 곳에서 끝냅니다. 카드 등록 없이 무료로 시작하세요.</p>
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
