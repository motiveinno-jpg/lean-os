// 오너뷰 기능 둘러보기 (2026-07-27 신설) — 그룹·메뉴는 ?g=<그룹키>&m=<메뉴key> 로 연다.
//   2026-09-14 검색엔진이 받는 HTML 에 메뉴가 **하나도 없었다**(12KB, useSearchParams 가 정적 프리렌더를
//   클라이언트 렌더로 떨어뜨림). searchParams 를 읽어 요청마다 서버에서 그리고, 그룹마다 제목·설명·canonical 을
//   따로 준다 → ?g=finance 같은 그룹 주소가 각자 색인되는 문서가 된다(메뉴 m 은 고른 화면만 바뀌어 canonical 에서 뺀다).
//   2026-09-14 랜딩 v8 이관 3단계: 화면은 landing-v8/features-view, 목록은 landing-v8/catalog(앱 사이드바 기준).
import type { Metadata } from "next";
import { Suspense } from "react";
import FeaturesView from "@/components/landing-v8/features-view";
import { CATALOG, MENU_COUNT, pickMenu } from "@/components/landing-v8/catalog";

const SITE = "https://www.owner-view.com";
const TITLE = "기능 둘러보기"; // 뒤의 " | 오너뷰" 는 layout 의 title.template 이 붙인다
// 숫자는 catalog 에서 센다 — 손으로 적으면 사이드바가 바뀔 때 거짓이 된다(전에는 「7개 영역 34개」가 남아 있었다)
const DESC = `재고·재무·업무·인사·분석까지 ${CATALOG.length}개 영역 메뉴 ${MENU_COUNT}개. 어느 메뉴에서 무엇을 할 수 있는지 실제 화면으로 보여 드립니다.`;

type SP = Promise<{ [k: string]: string | string[] | undefined }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  // 화면과 같은 해석(pickMenu) — 옛 주소가 다른 그룹으로 옮겨 가면(예: 인사 m=3 → 업무 구성원 디렉토리) 제목·canonical 도 따라간다.
  // 첫 그룹(홈)·모르는 그룹은 /features 와 같은 화면이라 따로 문서를 만들지 않는다.
  const [gi] = pickMenu(one(sp.g), one(sp.m));
  const grp = gi > 0 ? CATALOG[gi] : undefined;
  const title = grp ? `${grp.name} 기능` : TITLE;
  const desc = grp ? `${grp.lead} ${grp.menus.map((m) => m.name).join(" · ")} 메뉴를 실제 화면으로 보여 드립니다.` : DESC;
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
