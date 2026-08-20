// 오너뷰 둘러보기 전용 페이지 (2026-07-27) — 메인 랜딩 스크롤이 너무 길어 메뉴 카탈로그를 여기로 뺐다.
//   상단 "오너뷰 둘러보기" 메가메뉴에서 ?g=<그룹키>&m=<메뉴index> 로 들어온다.
import type { Metadata } from "next";
import { Suspense } from "react";
import FeaturesView from "@/components/landing/features-view";

const SITE = "https://www.owner-view.com";
const TITLE = "기능 둘러보기 | 오너뷰";
// ⚠️ 메뉴 개수는 CATALOG(=사이드바 NAV_GROUPS) 와 같아야 한다. 2026-08-20 전수 대조로
//    7그룹 34메뉴(마스터 전용 제외)에 맞췄다. 사이드바가 바뀌면 이 숫자도 같이 고칠 것.
const DESC = "통장·카드·거래처·수집전표·세금증빙·프로젝트·결재·전자계약·인사·근태까지 7개 영역 메뉴 34개. 어느 메뉴에서 무엇을 할 수 있는지 실제 화면으로 보여드려요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}/features` },
  openGraph: { type: "website", url: `${SITE}/features`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  // useSearchParams(메가메뉴 세부탭 이동 반영)를 쓰는 클라이언트 뷰 — 정적 프리렌더에 Suspense 경계 필수
  return (
    <Suspense fallback={null}>
      <FeaturesView />
    </Suspense>
  );
}
