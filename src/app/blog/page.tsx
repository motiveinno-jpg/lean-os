// 블로그 목록 — GEO/자연유입용 콘텐츠 허브 (2026-09-08)
//   2026-09-14 공개 페이지 공용 머리·바닥(v8)으로 — 전에는 약관 페이지(legal-page)의 어두운 머리 「OwnerView 오너뷰」를 빌려 써
//   메인·계산기·요금과 전혀 다른 사이트처럼 보였다. 스타일은 landing-v8.css `.lp8 .bl8-*`. 구조화 데이터·주소는 그대로.
import Link from "next/link";
import "@/app/landing-v8.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { POSTS } from "./posts";

const BASE = "https://www.owner-view.com";

export default function BlogIndexPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "오너뷰 사장님 경영 가이드",
    url: `${BASE}/blog`,
    publisher: { "@type": "Organization", name: "모티브이노베이션", url: BASE },
    blogPost: POSTS.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${BASE}/blog/${p.slug}`,
      datePublished: p.date,
    })),
  };

  return (
    <div className="lp8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />

      <main className="bl8-main">
        <div className="bl8-wrap">
          <div className="bl8-head">
            <div className="tl8-eyebrow">블로그</div>
            <h1>사장님 경영 가이드</h1>
            <p className="bl8-lead">ERP 선택, 미수금 관리, 회계·급여 자동화까지. 회사 운영의 실전 방법을 사실대로 정리합니다.</p>
          </div>

          <ul className="bl8-list">
            {POSTS.map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}`} className="bl8-item">
                  <b>{p.title}</b>
                  <span className="bl8-desc">{p.description}</span>
                  <span className="bl8-date">{p.date}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
