// 업종별 목록 (2026-09-16 2차) — 업종군 7 아래 세부 업종 23곳.
import type { Metadata } from "next";
import Link from "next/link";
import "@/app/landing-v8.css";
import "@/app/industries.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { SIGNUP_HREF, CONSULT_HREF } from "@/components/landing-v8/content";
import { BY_PARENT, INDUSTRIES, PARENTS } from "@/components/industries";

const SITE = "https://www.owner-view.com";
const DESC = `제조·유통·온라인 판매·용역·건설·물류·전문 서비스 ${INDUSTRIES.length}개 업종별로 오너뷰를 어떤 순서로, 어느 메뉴부터 쓰면 되는지 정리했습니다.`;

export const metadata: Metadata = {
  title: "업종별 활용법",
  description: DESC,
  alternates: { canonical: `${SITE}/industries` },
  openGraph: { type: "website", url: `${SITE}/industries`, siteName: "오너뷰", locale: "ko_KR", title: "업종별 활용법 | 오너뷰", description: DESC },
};

export default function Page() {
  return (
    <div className="ipg">
      <div className="lp8"><SiteHeader /></div>
      <section className="ipg-sec"><div className="ipg-wrap">
        <p className="ipg-eyebrow">업종별 활용법</p>
        <h2 className="ipg-h2">업종마다 일하는 순서가 다릅니다</h2>
        <p className="ipg-lead">쓰는 메뉴와 순서를 업종별로 정리했습니다. 우리 회사와 가까운 곳부터 보세요.</p>
        {PARENTS.map((p) => (
          <div className="ipg-group" key={p.key}>
            <h3><Link href={`/industries/${p.key}`}>{p.name}</Link><span>{p.lead}</span></h3>
            <div className="ipg-cards">
              {(BY_PARENT.get(p.key) ?? []).map((s) => (
                <Link key={s.slug} href={`/industries/${s.slug}`}>
                  <small>{s.name}</small>
                  <b>{s.title[0]} {s.title[1]}</b>
                  <p>{s.lead}</p>
                  <span className="go">활용법 보기 →</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div></section>
      <section className="ipg-fin"><div className="ipg-wrap">
        <h2>우리 업종에 맞게 시작하세요</h2>
        <p>업종을 골라 보고, 맞는 메뉴부터 켜면 됩니다.</p>
        <div className="ipg-btns">
          <Link className="ipg-btn w" href={SIGNUP_HREF} data-cta="signup:industries_index">무료로 시작하기 →</Link>
          <Link className="ipg-btn s" href={CONSULT_HREF} data-cta="consult:industries_index">도입 상담 신청</Link>
        </div>
      </div></section>
      <div className="lp8"><SiteFooter /></div>
    </div>
  );
}
