// 세무사 제휴 모집 랜딩 (2026-08-11) — 랜딩 네비 "세무사 제휴"에서 진입, CTA 는 /advisor 가입.
import type { Metadata } from "next";
import TaxPartnerView from "@/components/landing/tax-partner-view";

const SITE = "https://www.owner-view.com";
const TITLE = "세무사·회계사 제휴 | 오너뷰";
const DESC = "자료 요청 없이 기장이 끝나 있는 아침 — 고객사의 통장·세금계산서·인건비가 신고 기준으로 정리되어 세무사님 화면에 먼저 도착합니다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}/tax-partners` },
  openGraph: { type: "website", url: `${SITE}/tax-partners`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  return <TaxPartnerView />;
}
