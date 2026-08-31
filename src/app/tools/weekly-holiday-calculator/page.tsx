// 무료 주휴수당 계산기 (2026-08-25) — 검색 유입용 공개 도구 5탄.
//   근로기준법 제55조 · 2026년 최저임금(10,320원) 기준. 계산 로직은 view.tsx.
import type { Metadata } from "next";
import WeeklyHolidayCalculatorView from "./view";
import { FAQS } from "./faqs";
import { toolJsonLd } from "../_seo";

const SITE = "https://www.owner-view.com";
// 루트 레이아웃 template("%s | 오너뷰")이 접미를 붙이므로 여기엔 브랜드를 안 쓴다
const TITLE = "주휴수당 계산기 (2026년) — 주 15시간 이상 알바·직원 주휴수당 자동 계산";
const DESC =
  "2026년 최저임금 10,320원 기준 주휴수당 계산기. 1일 근로시간·주 근무일수·시급만 넣으면 주휴시간과 주휴수당(주급·월 환산)을 근로기준법 제55조 기준으로 계산합니다. 무료.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["주휴수당 계산기", "주휴수당 계산", "알바 주휴수당", "주휴수당 조건", "주 15시간 주휴수당", "2026 주휴수당", "주휴수당 지급기준"],
  alternates: { canonical: `${SITE}/tools/weekly-holiday-calculator` },
  openGraph: { type: "website", url: `${SITE}/tools/weekly-holiday-calculator`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  const jsonLd = toolJsonLd({ slug: "weekly-holiday-calculator", name: "주휴수당 계산기", desc: DESC, faqs: FAQS });
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <WeeklyHolidayCalculatorView />
    </>
  );
}
