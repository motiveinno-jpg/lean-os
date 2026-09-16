// 업종별 페이지 (2026-09-16) — /industries/<업종>. 내용은 components/industries/data.ts.
//   ▸ 업종마다 제목·설명·canonical 을 따로 줘 검색에서 각자 색인되는 문서가 된다.
//   ▸ 정적으로 미리 만든다(generateStaticParams) — 스크롤 연출이 없어 서버 HTML 그대로가 화면이다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndustryPage from "@/components/industries/industry-page";
import { BY_SLUG, INDUSTRIES } from "@/components/industries/data";

const SITE = "https://www.owner-view.com";
type P = Promise<{ slug: string }>;

export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  const d = BY_SLUG.get(slug);
  if (!d) return {};
  const title = `${d.name} 업종 활용법`;
  const url = `${SITE}/industries/${d.slug}`;
  return {
    title,
    description: d.seo,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "오너뷰", locale: "ko_KR", title: `${title} | 오너뷰`, description: d.seo },
  };
}

export default async function Page({ params }: { params: P }) {
  const { slug } = await params;
  const d = BY_SLUG.get(slug);
  if (!d) notFound();
  return <IndustryPage data={d} />;
}
