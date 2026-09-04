// 블로그 글 — 마크다운 본문 + 실제 화면 캡처 + 가입 유도. 글 끝의 CTA 하나가 이 페이지의 목적이다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/app/landing.css";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import { getAllPosts, getPost } from "@/lib/blog";

const SITE = "https://www.owner-view.com";

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "글을 찾을 수 없어요 | 오너뷰 블로그" };
  const url = `${SITE}/blog/${post.slug}`;
  const image = post.cover ? `${SITE}${post.cover}` : `${SITE}/og-image.png`;
  return {
    title: `${post.title} | 오너뷰 블로그`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, siteName: "오너뷰", locale: "ko_KR", title: post.title, description: post.description, publishedTime: post.date, images: [{ url: image }] },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [image] },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    image: post.cover ? `${SITE}${post.cover}` : `${SITE}/og-image.png`,
    author: { "@type": "Organization", name: "오너뷰" },
    publisher: { "@type": "Organization", name: "모티브이노베이션", logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` } },
    mainEntityOfPage: `${SITE}/blog/${post.slug}`,
  };
  const others = getAllPosts().filter((p) => p.slug !== post.slug).slice(0, 3);
  return (
    <div className="lp4-root">
      <LandingNav solid />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="lp4-section lp4-bg-canvas">
        <article className="blog-article">
          <div className="blog-article-meta"><Link href="/blog">블로그</Link> · {post.date} · {post.readMinutes}분</div>
          <h1 className="blog-article-title">{post.title}</h1>
          <p className="blog-article-desc">{post.description}</p>
          {post.tags.length > 0 && <div className="blog-tags">{post.tags.map((t) => <span key={t} className="blog-tag">{t}</span>)}</div>}
          <div className="blog-body" dangerouslySetInnerHTML={{ __html: post.html }} />
          <div className="blog-cta">
            <div className="blog-cta-text">
              <b>이 화면, 우리 회사 자료로 바로 볼 수 있어요.</b>
              <span>통장 하나만 연결하면 다음 날부터 채워져요. 기본 기능은 계속 무료예요.</span>
            </div>
            <Link href="/auth" className="lp4-pill">무료로 시작하기</Link>
          </div>
          {others.length > 0 && (
            <div className="blog-more">
              <div className="blog-more-title">함께 읽기</div>
              <ul>{others.map((p) => <li key={p.slug}><Link href={`/blog/${p.slug}`}>{p.title}</Link></li>)}</ul>
            </div>
          )}
        </article>
      </section>
      <footer className="lp4-footer">
        <div className="lp4-container">
          <div className="lp4-footer-bottom">
            <div className="lp4-finfo"><div>{FOOTER.company}</div><div>{FOOTER.reg}</div><div>{FOOTER.addr}</div></div>
            <div className="lp4-flinks"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/security">보안</Link><Link href="/refund">환불규정</Link><a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
