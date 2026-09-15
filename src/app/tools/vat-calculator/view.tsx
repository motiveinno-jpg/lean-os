"use client";

// 부가세 계산기 화면 (2026-08-25) — 무료 도구 6탄. tl8-(랜딩 v8) 스타일(salary-calculator 와 동일 구조).
//   부가가치세 10%. 두 방향을 지원한다:
//     · 공급가액 기준: 부가세 = 공급가액 × 10%, 합계 = 공급가액 × 1.1
//     · 합계금액 기준(역산): 공급가액 = 합계 ÷ 1.1, 부가세 = 합계 − 공급가액
//   원 단위 반올림 — 합계 = 공급가액 + 부가세가 항상 맞도록 부가세는 (합계 − 공급가액)으로 맞춘다.

import "@/app/landing-v8.css";
import Link from "next/link";
import { ResultCta } from "../_result-cta";
import { menuHref } from "@/components/landing-v8/catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
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
    
    // 합계금액 기준 · 역산
    const supply = Math.round(n / 1.1);
    return  { supply, vat: n - supply, total: n };
  }, [amount, basis]);

  // 계측 — 이 세션에서 처음 결과를 봤을 때 1회
  const tracked = useRef(false);
  useEffect(() => {
    if (r && !tracked.current) { tracked.current = true; track("tool_calculate", { tool: "vat" }); }
  }, [r]);

  return (
    <div className="lp8">
      <SiteHeader />

      <section className="tl8-section tl8-bg-canvas">
        <div className="tl8-narrow">
          <div className="tl8-sec-head tl8-sec-head-c">
            <div className="tl8-eyebrow">무료 도구</div>
            <h1 className="tl8-h2">부가세 계산기</h1>
            <p className="tl8-sub">금액만 넣으면 부가가치세(10%)를 바로 계산합니다. 공급가액에 부가세를 더하거나, 부가세 포함 합계금액에서 공급가액과 세액을 역산합니다. 회원가입 없이 무료입니다.</p>
          </div>

          <div className="tl8-card">
            <div className="tl8-fields">
              <label className="tl8-field">
                <span className="tl8-label">기준 금액</span>
                <input type="text" inputMode="numeric" placeholder="1,000,000" className="tl8-input" value={comma(amount)} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <label className="tl8-field">
                <span className="tl8-label">입력한 금액이 무엇인가요?</span>
                <select className="tl8-input" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
                  <option value="supply">공급가액 (부가세 별도). 부가세를 더한다</option>
                  <option value="total">합계금액 (부가세 포함). 부가세를 빼낸다</option>
                </select>
              </label>
            </div>

            {r ? (
              <div className="tl8-result" aria-live="polite">
                <div className="tl8-result-main">
                  <span className="tl8-result-num">{won(r.vat)}원</span>
                  <span className="tl8-result-cap">부가가치세 (10%) — 합계금액 {won(r.total)}원</span>
                </div>
                <table className="tl8-table tl8-table-tight">
                  <thead>
                    <tr><th>항목</th><th>금액</th><th>계산</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>공급가액</td><td>{won(r.supply)}원</td><td className="tl8-dim">{basis === "supply" ? "입력값" : `합계 ${won(r.total)} ÷ 1.1`}</td></tr>
                    <tr><td>부가가치세</td><td>{won(r.vat)}원</td><td className="tl8-dim">{basis === "supply" ? `공급가액 × 10%` : `합계 − 공급가액`}</td></tr>
                    <tr><td><b>합계금액</b></td><td><b>{won(r.total)}원</b></td><td className="tl8-dim">공급가액 + 부가세</td></tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="tl8-empty">금액을 넣으면 바로 계산됩니다</div>
            )}
            {(r) && (
              <ResultCta tool="vat" menuHref={menuHref("finance", "tax-filing")} menuLabel="세무 신고 기능 보기">
                부가세는 매출·매입 세금계산서가 모두 모여야 계산됩니다. <b>오너뷰는 확정 전표와 세금계산서로 부가세 신고 자료를 정리</b>합니다.
              </ResultCta>
            )}
          </div>

          <p className="tl8-note">
            * 일반과세 기준 부가가치세율 10%입니다. 간이과세자는 업종별 부가가치율이 적용돼 실제 납부세액이 다르며, 면세 품목에는 부가세가 붙지 않습니다. 원 단위 반올림으로 표시되어 실제 세금계산서와 1원 내외 차이가 날 수 있습니다.
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
            다른 무료 도구: <Link href="/tools/salary-calculator" className="tl8-crosslink">실수령액 계산기</Link> · <Link href="/tools/weekly-holiday-calculator" className="tl8-crosslink">주휴수당 계산기</Link> · <Link href="/tools/insurance-calculator" className="tl8-crosslink">4대보험 계산기</Link> · <Link href="/tools/severance-calculator" className="tl8-crosslink">퇴직금 계산기</Link> · <Link href="/tools/leave-calculator" className="tl8-crosslink">연차 계산기</Link>
          </p>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="tl8-section tl8-bg-tint">
        <div className="tl8-narrow tl8-sec-head-c">
          <h2 className="tl8-h2">세금계산서·부가세, 오너뷰가 자동으로 정리합니다</h2>
          <p className="tl8-sub">오너뷰는 홈택스 세금계산서와 카드·현금 매입매출을 자동으로 모아 부가세 신고 자료를 정리해 드립니다. 매번 계산기 두드리지 않아도 됩니다. 카드 등록 없이 무료로 시작하세요.</p>
          <div className="tl8-feat-cta">
            <Link href="/auth?mode=signup" className="btn btn-fill" data-cta="signup:tool_vat">무료로 시작하기</Link>
            <Link href="/features" className="btn btn-soft">기능 둘러보기</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
