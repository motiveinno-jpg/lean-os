// /contact 도입 상담 신청 — 서버 래퍼 (2026-09-14)
//   랜딩 v8 의 「전문 상담 예약」이 mailto 였던 것을 전용 화면으로 옮겼다. 화면은 ContactView 가 그린다.
import type { Metadata } from "next";
import ContactView from "@/components/landing-v8/contact-view";

const URL = "https://www.owner-view.com/contact";
const TITLE = "도입 상담 신청"; // 뒤의 " | 오너뷰" 는 layout 의 title.template 이 붙인다
const DESC = "회사 업무 순서를 알려 주시면 사용할 메뉴, 이전할 자료, 요금을 정리해 영업일 기준 1일 이내에 연락드립니다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: URL },
  openGraph: { type: "website", url: URL, siteName: "오너뷰", locale: "ko_KR", title: `${TITLE} | 오너뷰`, description: DESC, images: ["/og-image.png"] },
};

export default function Page() {
  return <ContactView />;
}
