// 오너뷰 둘러보기 전용 페이지 (2026-07-27) — 메인 랜딩 스크롤이 너무 길어 메뉴 카탈로그를 여기로 뺐다.
//   상단 "오너뷰 둘러보기" 메가메뉴에서 ?g=<그룹키>&m=<메뉴index> 로 들어온다.
import type { Metadata } from "next";
import FeaturesView from "@/components/landing/features-view";

const SITE = "https://www.owner-view.com";
const TITLE = "기능 둘러보기 | 오너뷰";
const DESC = "거래처·세금·장부·프로젝트·결재·전자계약·인사·근태·통장·카드까지 메뉴 20개. 어느 메뉴에서 무엇을 할 수 있는지 실제 화면으로 보여드려요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}/features` },
  openGraph: { type: "website", url: `${SITE}/features`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  return <FeaturesView />;
}
