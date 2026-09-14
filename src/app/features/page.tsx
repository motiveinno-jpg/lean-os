// 오너뷰 둘러보기 전용 페이지 (2026-07-27) — 메인 랜딩 스크롤이 너무 길어 메뉴 카탈로그를 여기로 뺐다.
//   상단 "오너뷰 둘러보기" 메가메뉴에서 ?g=<그룹키>&m=<메뉴index> 로 들어온다.
//   2026-09-14 검색엔진이 받는 HTML 에 메뉴가 **하나도 없었다**(12KB, useSearchParams 가 정적 프리렌더를
//   클라이언트 렌더로 떨어뜨림). searchParams 를 읽어 요청마다 서버에서 그리고, 그룹마다 제목·설명·canonical 을
//   따로 준다 → ?g=finance 같은 그룹 주소가 각자 색인되는 문서가 된다(메뉴 m 은 고른 화면만 바뀌어 canonical 에서 뺀다).
import type { Metadata } from "next";
import { Suspense } from "react";
import FeaturesView from "@/components/landing/features-view";
import { CATALOG } from "@/components/landing/content";

const SITE = "https://www.owner-view.com";
const TITLE = "기능 둘러보기"; // 뒤의 " | 오너뷰" 는 layout 의 title.template 이 붙인다 (전에는 두 번 붙었다)
// ⚠️ 메뉴 개수는 CATALOG(=사이드바 NAV_GROUPS) 와 같아야 한다. 2026-08-20 전수 대조로
//    7그룹 34메뉴(마스터 전용 제외)에 맞췄다. 사이드바가 바뀌면 이 숫자도 같이 고칠 것.
const DESC = "통장·카드·거래처·수집전표·세금증빙·프로젝트·결재·전자계약·인사·근태까지 7개 영역 메뉴 34개. 어느 메뉴에서 무엇을 할 수 있는지 실제 화면으로 보여드려요.";

type SP = Promise<{ [k: string]: string | string[] | undefined }>;
const groupOf = (g: string | string[] | undefined) =>
  CATALOG.find((c) => c.key === (Array.isArray(g) ? g[0] : g));

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const grp = groupOf((await searchParams).g);
  const title = grp ? `${grp.group} 기능` : TITLE;
  const desc = grp ? `${grp.lead} ${grp.menus.map((m) => m.name).join(" · ")} 메뉴를 실제 화면으로 보여드립니다.` : DESC;
  // 쿼리가 붙으면 Next 가 끝 `/` 를 안 붙여 준다(trailingSlash) → 308 을 거치지 않게 직접 적는다
  const url = grp ? `${SITE}/features/?g=${grp.key}` : `${SITE}/features`;
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "오너뷰", locale: "ko_KR", title: `${title} | 오너뷰`, description: desc },
  };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  // searchParams 를 읽으면 이 경로는 요청마다 서버에서 그린다 → FeaturesView 의 useSearchParams 가
  // 서버 렌더에서도 값을 받아 고른 그룹의 메뉴가 HTML 에 들어간다. Suspense 는 그대로 둔다.
  await searchParams;
  return (
    <Suspense fallback={null}>
      <FeaturesView />
    </Suspense>
  );
}
