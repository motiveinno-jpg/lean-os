// AI 자동화 전용 페이지 (2026-07-27) — "AI 엔진"과 겹쳐 헷갈린다는 지적에 따라 한곳으로 합쳤다.
import type { Metadata } from "next";
import AiView from "@/components/landing/ai-view";

const SITE = "https://www.owner-view.com";
const TITLE = "AI 자동화 | 오너뷰";
const DESC = "AI 참모·거래 자동분류·아침 브리핑·3-Way 매칭·영수증 OCR·현금 소진 예측·휴면 감지·계약 갱신 알림. 사람이 매번 하던 일 8가지를 오너뷰가 대신 처리해요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}/ai` },
  openGraph: { type: "website", url: `${SITE}/ai`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  return <AiView />;
}
