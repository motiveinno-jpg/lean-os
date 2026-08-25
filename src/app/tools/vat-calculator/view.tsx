"use client";

// 부가세 계산기 화면 (2026-08-25) — 무료 도구 6탄. lp4-freetool 스타일(salary-calculator 와 동일 구조).
//   부가가치세 10%. 두 방향을 지원한다:
//     · 공급가액 기준: 부가세 = 공급가액 × 10%, 합계 = 공급가액 × 1.1
//     · 합계금액 기준(역산): 공급가액 = 합계 ÷ 1.1, 부가세 = 합계 − 공급가액
//   원 단위 반올림 — 합계 = 공급가액 + 부가세가 항상 맞도록 부가세는 (합계 − 공급가액)으로 맞춘다.

import "@/app/landing.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import { FAQS } from "./faqs";
import { track } from "@/lib/analytics";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const comma = (s: string) => (s ? Number(s.replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : "");

type Basis = "supply" | "total"; // 공급가액 기준 / 합계금액 기준

export default function VatCalculatorView() {
  const [amount, setAmount] = useState("");
  const [basis, setBasis] = useState<Basis>("supply");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const r = useMemo(() => {
    const n = Number(amount.replace(/[^0-9]/g, ""));
    if (!n) return null;
    if (basis === "supply") {
      const supply = n;
      const vat = Math.round(supply * 0.1);
      return { supply, vat, total: supply + vat };
    }
    // 합계금액 기준 — 역산
    const supply = Math.round(n / 1.1);
    return { supply, vat: n - supply, total: n };
  }, [amount, basis]);

  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회
  const tracked = useRef(false);
  useEffect(() => {
    if (r && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "vat" }); }
  }, [r]);

  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">무료 도구</div>
            <h1 className="lp4-h2">부가세 계산기</h1>
            <p className="lp4-sub">금액만 넣으면 부가가치세(10%)를 바로 계산합니다. 공급가액에 부가세를 더하거나, 부가세 포함 합계금액에서 공급가액과 세액을 역산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="lp4-freetool-card">
            <div className="lp4-freetool-fields">
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">기준 금액</span>
                <input type="text" inputMode="numeric" placeholder="1,000,000" className="lp4-input" value={comma(amount)} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="lp4-freetool-field">
                <span className="lp4-freetool-label">입력한 금액이 무엇인가요?</span>
                <select className="lp4-input" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
                  <option value="supply">공급가액 (부가세 별도) — 부가세를 더한다</option>
                  <option value="total">합계금액 (부가세 포함) — 부가세를 빼낸다</option>
                </select>
              </label>
            </div>

            {r ? (
              <div className="lp4-freetool-result" aria-live="polite">
                <div className="lp4-freetool-result-main">
                  <span className="lp4-freetool-result-num">{won(r.vat)}원</span>
                  <span className="lp4-freetool-result-cap">부가가치세 (10%) — 합계금액 {won(r.total)}원</span>
                </div>
                <table className="lp4-freetool-table lp4-freetool-table-tight">
                  <thead>
                    <tr><th>항목</th><th>금액</th><th>계산</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>공급가액</td><td>{won(r.supply)}원</td><td className="lp4-freetool-dim">{basis === "supply" ? "입력값" : `합계 ${won(r.total)} ÷ 1.1`}</td></tr>
                    <tr><td>부가가치세</td><td>{won(r.vat)}원</td><td className="lp4-freetool-dim">{basis === "supply" ? `공급가액 × 10%` : `합계 − 공급가액`}</td></tr>
                    <tr><td><b>합계금액</b></td><td><b>{won(r.total)}원</b></td><td className="lp4-freetool-dim">공급가액 + 부가세</td></tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="lp4-freetool-empty">금액을 넣으면 바로 계산됩니다</div>
            )}
          </div>

          <p className="lp4-freetool-note">
            * 일반과세 기준 부가가치세율 10%입니다. 간이과세자는 업종별 부가가치율이 적용돼 실제 납부세액이 다르며, 면세 품목에는 부가세가 붙지 않습니다. 원 단위 반올림으로 표시되어 실제 세금계산서와 1원 내외 차이가 날 수 있습니다.
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
            다른 무료 도구: <Link href="/tools/salary-calculator" className="lp4-freetool-crosslink">실수령액 계산기</Link> · <Link href="/tools/weekly-holiday-calculator" className="lp4-freetool-crosslink">주휴수당 계산기</Link> · <Link href="/tools/insurance-calculator" className="lp4-freetool-crosslink">4대보험 계산기</Link> · <Link href="/tools/severance-calculator" className="lp4-freetool-crosslink">퇴직금 계산기</Link> · <Link href="/tools/leave-calculator" className="lp4-freetool-crosslink">연차 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow lp4-sec-head-c">
          <h2 className="lp4-h2">세금계산서·부가세, 오너뷰가 자동으로 정리합니다</h2>
          <p className="lp4-sub">오너뷰는 홈택스 세금계산서와 카드·현금 매입매출을 자동으로 모아 부가세 신고 자료를 정리해 드립니다. 매번 계산기 두드리지 않아도 됩니다. 카드 등록 없이 무료로 시작하세요.</p>
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
