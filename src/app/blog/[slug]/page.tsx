// 블로그 본문 — posts.ts 레지스트리 기반 정적 생성 (2026-09-08)
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS, getPost } from "../posts";

const BASE = "https://www.owner-view.com";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} · 오너뷰 블로그`,
    description: post.description,
    alternates: { canonical: `${BASE}/blog/${post.slug}` },
    openGraph: { title: post.title, description: post.description, url: `${BASE}/blog/${post.slug}`, type: "article" },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      inLanguage: "ko",
      mainEntityOfPage: `${BASE}/blog/${post.slug}`,
      author: { "@type": "Organization", name: "오너뷰 (모티브이노베이션)", url: BASE },
      publisher: { "@type": "Organization", name: "모티브이노베이션", url: BASE, logo: { "@type": "ImageObject", url: `${BASE}/icon-512.png` } },
    },
  ];
  if (post.faq && post.faq.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: post.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return (
    <div className="legal-page">
      {jsonLd.map((d, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d) }} />
      ))}
      <nav className="legal-site-nav">
        <div className="site-nav-inner">
          <Link href="/" className="brand-logo-link">
            <span className="text-lg font-bold text-white">OwnerView 오너뷰</span>
          </Link>
          <Link href="/blog" className="px-4 py-2 text-sm text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition">
            가이드 목록
          </Link>
        </div>
      </nav>

      <main className="legal-content">
        <div className="legal-header">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{post.title}</h1>
          <p className="text-slate-400 text-sm">{post.date} · 오너뷰 팀</p>
        </div>

        <div className="legal-sections">
          {post.sections.map((s, i) => (
            <section key={i} className="legal-section">
              {s.h && <h2 className="text-lg font-semibold text-white mb-3">{s.h}</h2>}
              {s.p?.map((t, j) => (
                <p key={j} className="text-slate-300 text-sm leading-7 mb-3">{t}</p>
              ))}
              {s.list && (
                <ul className="list-disc pl-5 space-y-2">
                  {s.list.map((t, j) => (
                    <li key={j} className="text-slate-300 text-sm leading-7">{t}</li>
                  ))}
                </ul>
              )}
              {s.table && (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-sm text-left border border-white/10">
                    <thead>
                      <tr>
                        {s.table.head.map((h, j) => (
                          <th key={j} className="px-3 py-2 border border-white/10 text-white bg-white/5 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.table.rows.map((row, j) => (
                        <tr key={j}>
                          {row.map((c, k) => (
                            <td key={k} className="px-3 py-2 border border-white/10 text-slate-300">{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          {post.faq && post.faq.length > 0 && (
            <section className="legal-section">
              <h2 className="text-lg font-semibold text-white mb-3">자주 묻는 질문</h2>
              {post.faq.map((f, i) => (
                <div key={i} className="mb-4">
                  <p className="text-white text-sm font-semibold mb-1">Q. {f.q}</p>
                  <p className="text-slate-300 text-sm leading-7">{f.a}</p>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="legal-intro-box">
          <p>
            오너뷰는 매출·회계·급여·프로젝트를 한 화면에서 관리하는 올인원 AI ERP입니다. 기본 기능은 계속 무료입니다.{" "}
            <Link href="/demo" className="underline">가입 없이 데모 보기</Link> ·{" "}
            <Link href="/tools" className="underline">무료 계산기 6종</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
