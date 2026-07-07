"use client";

// 분석 진입점(/reports) — 2026-07-08 IA 개선: 카드 허브(추가 클릭) 대신 기본 분석 화면으로 바로 이동.
//   사장님 결정 — 진입 시 "경영 흐름"을 기본으로, 상단 공통 서브탭(ReportsTabs)으로 4종 자유 전환.
//   옛 /reports 북마크·링크 호환을 위해 리다이렉트로 유지.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

export default function ReportsHubRedirect() {
  const { role } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (role === "partner") return;
    router.replace("/reports/flow");
  }, [role, router]);

  if (role === "partner") {
    return <AccessDenied detail="회계 분석은 대표·관리자 전용입니다." />;
  }

  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
