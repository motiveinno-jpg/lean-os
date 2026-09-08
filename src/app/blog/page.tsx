// 블로그 목록 — GEO/자연유입용 콘텐츠 허브 (2026-09-08)
import Link from "next/link";
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
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="legal-site-nav">
        <div className="site-nav-inner">
          <Link href="/" className="brand-logo-link">
            <span className="text-lg font-bold text-white">OwnerView 오너뷰</span>
          </Link>
          <Link href="/" className="px-4 py-2 text-sm text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition">
            홈으로
          </Link>
        </div>
      </nav>

      <main className="legal-content">
        <div className="legal-header">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">사장님 경영 가이드</h1>
          <p className="text-slate-400 text-sm">
            ERP 선택, 미수금 관리, 회계·급여 자동화 — 회사 운영의 실전 노하우를 사실 그대로 정리합니다.
          </p>
        </div>

        <div className="legal-sections">
          {POSTS.map((p) => (
            <section key={p.slug} className="legal-section">
              <h2 className="text-lg font-semibold text-white mb-2">
                <Link href={`/blog/${p.slug}`} className="hover:underline">
                  {p.title}
                </Link>
              </h2>
              <p className="text-slate-300 text-sm leading-7 mb-2">{p.description}</p>
              <p className="text-slate-500 text-xs">{p.date}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
