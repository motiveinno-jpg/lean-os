// 무료 연차 계산기 (2026-08-13) — 검색 유입용 공개 도구 1호 (사장님: "검색으로 유입시키게").
//   "연차 계산기" 류 실무 검색어로 들어온 사장님·직원에게 즉답을 주고 오너뷰로 잇는다.
//   로그인 불필요(PUBLIC_ROUTES)·사이트맵 등재·FAQ 구조화데이터(JSON-LD)까지 세트.
import type { Metadata } from "next";
import LeaveCalculatorView from "./view";
import { FAQS } from "./faqs";
import { toolJsonLd } from "../_seo";

const SITE = "https://www.owner-view.com";
// 루트 레이아웃 template("%s | 오너뷰")이 접미를 붙이므로 여기엔 브랜드를 안 쓴다
const TITLE = "연차 계산기 — 입사일만 넣으면 내 연차 자동 계산 (무료)";
const DESC =
  "입사일 기준 연차휴가 계산기. 근로기준법 제60조 기준으로 1년 미만 월 1일(최대 11일), 1년 이상 15일부터 2년마다 가산해 최대 25일까지 자동 계산합니다. 회원가입 없이 무료.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["연차 계산기", "연차휴가 계산", "연차 발생 기준", "입사일 기준 연차", "근로기준법 연차", "연차 개수", "1년미만 연차"],
  alternates: { canonical: `${SITE}/tools/leave-calculator` },
  openGraph: { type: "website", url: `${SITE}/tools/leave-calculator`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  // 구조화 데이터 — 웹앱(무료 계산기) + 빵부스러기 + FAQ 를 한 번에 (검색 리치 결과용)
  const jsonLd = toolJsonLd({ slug: "leave-calculator", name: "연차 계산기", desc: DESC, faqs: FAQS });
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <LeaveCalculatorView />
    </>
  );
}
