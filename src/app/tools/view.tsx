"use client";

// 무료 계산기 허브 (2026-08-31) — /tools 인덱스. 6개 계산기를 한 곳에 모아
//   "무료 계산기 모음" 류 검색어를 받고, 내부 링크로 각 도구에 링크주스를 나눠 준다.
//   스타일은 각 계산기 화면(tl8-)과 동일 세트.

import "@/app/landing-v8.css";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { TOOLS } from "./_seo";

export default function ToolsHubView() {
  return (
    <div className="lp8">
      <SiteHeader />

      <section className="tl8-section tl8-bg-canvas">
        <div className="tl8-narrow">
          <div className="tl8-sec-head tl8-sec-head-c">
            <div className="tl8-eyebrow">무료 계산기</div>
            <h1 className="tl8-h2">사장님·인사담당자를 위한 무료 계산기 모음</h1>
            <p className="tl8-sub">
              회원가입 없이 바로 쓰는 노무·세무 계산기입니다. 연차부터 퇴직금·4대보험·월급 실수령액·
              주휴수당·부가세까지, 실무에서 자주 찾는 계산을 한 곳에서 해결하세요. 모두 무료입니다.
            </p>
          </div>

          <div className="tl8-hub">
            {TOOLS.map((t) => (
              <Link key={t.slug} href={`/tools/${t.slug}`} className="tl8-card tl8-hubcard">
                <span className="tl8-result-num">{t.name}</span>
                <span className="tl8-result-cap">{t.desc}</span>
                <span className="tl8-crosslink">계산하러 가기 →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — 도구에서 제품으로 */}
      <section className="tl8-section tl8-bg-tint">
        <div className="tl8-narrow">
          <div className="tl8-sec-head tl8-sec-head-c">
            <h2 className="tl8-h2">계산은 무료, 관리는 오너뷰에서</h2>
            <p className="tl8-sub">연차·급여·4대보험·세무를 매번 계산기로 두드리지 말고, 회사 상황판 하나로 자동 관리하세요.</p>
          </div>
          <div className="tl8-feat-cta">
            <Link href="/auth" className="btn btn-fill">무료로 시작하기</Link>
            <Link href="/features" className="btn btn-soft">기능 둘러보기</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
