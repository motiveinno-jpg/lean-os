// 업종 페이지 (2026-09-16 2차) — /industries/<세부 업종> 23곳 + /industries/<업종군> 7곳(안내).
//   ▸ 업종마다 제목·설명·canonical 을 따로 줘 검색에서 각자 색인되는 문서가 된다.
//   ▸ 정적으로 미리 만든다 — 스크롤 연출이 없어 서버 HTML 그대로가 화면이다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndustryPage from "@/components/industries/industry-page";
import HubPage from "@/components/industries/hub-page";
import { BY_PARENT, BY_SLUG, INDUSTRIES, PARENTS, PARENT_BY_KEY } from "@/components/industries";

const SITE = "https://www.owner-view.com";
type P = Promise<{ slug: string }>;

export function generateStaticParams() {
  return [...INDUSTRIES.map((i) => ({ slug: i.slug })), ...PARENTS.map((p) => ({ slug: p.key }))];
}

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { slug } = await params;
  const d = BY_SLUG.get(slug);
  const p = PARENT_BY_KEY.get(slug);
  if (!d && !p) return {};
  const url = `${SITE}/industries/${slug}`;
  const title = d ? `${d.name} 업종 활용법` : `${p!.name} 업종 활용법`;
  const desc = d ? d.seo
    : `${p!.lead} ${(BY_PARENT.get(p!.key) ?? []).map((s) => s.name).join(" · ")} 업종별 사용법을 정리했습니다.`;
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "오너뷰", locale: "ko_KR", title: `${title} | 오너뷰`, description: desc },
  };
}

export default async function Page({ params }: { params: P }) {
  const { slug } = await params;
  const d = BY_SLUG.get(slug);
  if (d) return <IndustryPage data={d} />;
  const p = PARENT_BY_KEY.get(slug);
  if (p) return <HubPage parent={p} />;
  notFound();
}
