import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "사장님 경영 가이드 · 오너뷰 블로그",
  description:
    "중소기업 ERP 선택, 미수금 관리, 회계·급여 자동화 — 회사 운영의 실전 노하우를 오너뷰 팀이 사실 그대로 정리합니다.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
