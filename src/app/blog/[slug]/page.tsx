// 블로그 본문 — posts.ts 레지스트리 기반 정적 생성 (2026-09-08)
//   2026-09-14 공개 페이지 공용 머리·바닥(v8)으로(목록 page.tsx 머리주석). 글 끝 안내에 가입 버튼(signup:blog_post) 추가.
import type { Metadata } from "next";
import Link from "next/link";
import "@/app/landing-v8.css";
import { SiteFooter, SiteHeader } from "@/components/landing-v8/site-shell";
import { SIGNUP_HREF } from "@/components/landing-v8/content";
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
    // absolute — layout 의 " | 오너뷰" 가 또 붙어 「… · 오너뷰 블로그 | 오너뷰」가 됐다 (2026-09-14)
    title: { absolute: `${post.title} · 오너뷰 블로그` },
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
    <div className="lp8">
      {jsonLd.map((d, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d) }} />
      ))}
      <SiteHeader />

      <main className="bl8-main">
        <article className="bl8-wrap bl8-article">
          <Link href="/blog" className="bl8-back">블로그 목록</Link>
          <h1>{post.title}</h1>
          <p className="bl8-meta">{post.date} · 오너뷰 팀</p>

          {post.sections.map((s, i) => (
            <section key={i} className="bl8-sec">
              {s.h && <h2>{s.h}</h2>}
              {s.p?.map((t, j) => <p key={j}>{t}</p>)}
              {s.list && (
                <ul>
                  {s.list.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              )}
              {s.link && (
                <Link href={s.link.href} className="bl8-sec-link">
                  <b>{s.link.label}</b>
                  {s.link.note && <span>{s.link.note}</span>}
                </Link>
              )}
              {s.table && (
                <div className="bl8-table">
                  <table>
                    <thead>
                      <tr>{s.table.head.map((h, j) => <th key={j}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {s.table.rows.map((row, j) => (
                        <tr key={j}>{row.map((c, k) => <td key={k}>{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          {post.faq && post.faq.length > 0 && (
            <section className="bl8-sec bl8-faq">
              <h2>자주 묻는 질문</h2>
              {post.faq.map((f, i) => (
                <div key={i} className="bl8-faq-item">
                  <b>Q. {f.q}</b>
                  <p>{f.a}</p>
                </div>
              ))}
            </section>
          )}

          <aside className="bl8-cta">
            <b>회사 운영을 한 곳에서 관리하세요</b>
            <p>오너뷰는 매출·회계·급여·프로젝트를 한 화면에서 관리하는 올인원 AI ERP입니다. 무료 플랜은 카드 등록 없이 계속 사용할 수 있습니다.</p>
            <div className="bl8-cta-btns">
              <Link className="btn btn-sm btn-fill" href={SIGNUP_HREF} data-cta="signup:blog_post">무료로 시작하기</Link>
              <Link className="btn btn-sm btn-soft" href="/demo">가입 없이 데모 보기</Link>
              <Link className="btn btn-sm btn-soft" href="/tools">무료 계산기 6종</Link>
            </div>
          </aside>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
