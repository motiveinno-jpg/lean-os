// /unsubscribe 광고 메일 수신거부 — 서버 래퍼 (2026-09-16)
//   정보통신망법 제50조 대응. 소개 메일 푸터의 수신거부 링크가 가리키는 주소다.
//   검색에 잡힐 이유가 없는 화면이라 noindex — 색인되면 관계없는 유입이 목록을 채운다.
import type { Metadata } from "next";
import UnsubscribeView from "@/components/landing-v8/unsubscribe-view";

export const metadata: Metadata = {
  title: "광고 메일 수신거부",
  description: "오너뷰가 보내는 광고·소개 메일 수신을 거부합니다.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <UnsubscribeView />;
}
