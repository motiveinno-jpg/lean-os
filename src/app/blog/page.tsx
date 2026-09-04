// 블로그 목록 — 검색으로 들어온 사장님이 질문의 답과 실제 화면을 보고 가입까지 오는 길.
//   글은 content/blog/*.md (docs/BLOG_PLAYBOOK.md). 빌드 때 정적으로 굳는다.
import type { Metadata } from "next";
import Link from "next/link";
import "@/app/landing.css";
import { LandingNav } from "@/components/landing/landing-nav";
import { FOOTER } from "@/components/landing/content";
import { getAllPosts } from "@/lib/blog";

const SITE = "https://www.owner-view.com";
const TITLE = "오너뷰 블로그 — 사장님의 돈·세금·사람 질문에 답합니다";
const DESC = "법인카드 부가세, 미수금, 근태·연차, 홈택스 등록처럼 회사 운영에서 매달 부딪히는 질문을 실제 화면과 함께 풀어드려요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}/blog` },
  openGraph: { type: "website", url: `${SITE}/blog`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  return (
    <div className="lp4-root">
      <LandingNav solid />
      <section className="lp4-section lp4-bg-canvas">
        <div className="lp4-narrow">
          <div className="lp4-sec-head lp4-sec-head-c">
            <div className="lp4-eyebrow">블로그</div>
            <h1 className="lp4-h2">사장님이 매달 부딪히는 질문에 답해요</h1>
            <p className="lp4-sub">법인카드 부가세, 미수금, 근태·연차, 홈택스 등록. 답과 함께 오너뷰 실제 화면을 보여드려요.</p>
          </div>
          {posts.length === 0 ? (
            <p className="blog-empty">첫 글을 준비하고 있어요.</p>
          ) : (
            <ul className="blog-list">
              {posts.map((p) => (
                <li key={p.slug} className="blog-card">
                  <Link href={`/blog/${p.slug}`} className="blog-card-link">
                    {p.cover && <img className="blog-card-cover" src={p.cover} alt="" loading="lazy" />}
                    <div className="blog-card-body">
                      <div className="blog-card-meta">{p.date} · {p.readMinutes}분</div>
                      <h2 className="blog-card-title">{p.title}</h2>
                      <p className="blog-card-desc">{p.description}</p>
                      {p.tags.length > 0 && <div className="blog-tags">{p.tags.map((t) => <span key={t} className="blog-tag">{t}</span>)}</div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
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
