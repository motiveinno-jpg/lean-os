"use client";

// 2026-08-04 사장님 지시: 운영자 도구는 앱 셸이 아니라 운영자 페이지(/platform) 안에 있어야 한다.
//   회원 조회·계정 수정 → /platform/members (사용자 관리)가 전부 대체.
//   CODEF 사용량 탭 → /platform/codef-usage 로 이동.
//   기존 URL 로 들어오는 북마크를 위해 리다이렉트만 남긴다 (admin → platform 과 동일 패턴).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OperatorUsersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/platform/codef-usage");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
