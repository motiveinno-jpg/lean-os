// 요금제 전용 페이지 (2026-07-27) — 랜딩 스크롤에서는 가격을 빼고, 상단 "가격"을 눌러 들어온다.
import type { Metadata } from "next";
import PricingView from "@/components/landing/pricing-view";

const SITE = "https://www.owner-view.com";
const TITLE = "요금제 | 오너뷰";
const DESC = "14일 무료로 써보고 결정하세요. 기본 5명 포함, 추가 1명당 ₩10,000/월. 플랜별 기능을 한 장에 정리했어요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}/pricing` },
  openGraph: { type: "website", url: `${SITE}/pricing`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  return <PricingView />;
}
