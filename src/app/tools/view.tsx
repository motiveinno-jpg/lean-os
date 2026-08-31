"use client";

// 무료 계산기 허브 (2026-08-31) — /tools 인덱스. 6개 계산기를 한 곳에 모아
//   "무료 계산기 모음" 류 검색어를 받고, 내부 링크로 각 도구에 링크주스를 나눠 준다.
//   스타일은 각 계산기 화면(lp4-freetool)과 동일 세트.

import "@/app/landing.css";
import Link from "next/link";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import { TOOLS } from "./_seo";

export default function ToolsHubView() {
  return (
    <div className="lp4-root">
      <LandingNav solid />

      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">무료 계산기</div>
            <h1 className="lp4-h2">사장님·인사담당자를 위한 무료 계산기 모음</h1>
            <p className="lp4-sub">
              회원가입 없이 바로 쓰는 노무·세무 계산기입니다. 연차부터 퇴직금·4대보험·월급 실수령액·
              주휴수당·부가세까지, 실무에서 자주 찾는 계산을 한 곳에서 해결하세요. 모두 무료입니다.
            </p>
          </div>

          <div className="lp4-freetool-hub">
            {TOOLS.map((t) => (
              <Link key={t.slug} href={`/tools/${t.slug}`} className="lp4-freetool-card lp4-freetool-hubcard">
                <span className="lp4-freetool-result-num">{t.name}</span>
                <span className="lp4-freetool-result-cap">{t.desc}</span>
                <span className="lp4-freetool-crosslink">계산하러 가기 →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="lp4-section lp4-bg-tint">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <h2 className="lp4-h2">계산은 무료, 관리는 오너뷰에서</h2>
            <p className="lp4-sub">연차·급여·4대보험·세무를 매번 계산기로 두드리지 말고, 회사 상황판 하나로 자동 관리하세요.</p>
          </div>
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
