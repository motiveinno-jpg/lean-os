"use client";

// 옛 프로젝트 목록/칸반 화면 제거 (2026-07-01) — 신규 /projecthub 로 리다이렉트(쿼리 유지).
//   ?deal= 등 딥링크도 projecthub 로 이동.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyProjectsRedirect() {
  const router = useRouter();
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    router.replace(`/projecthub${qs}`);
  }, [router]);
  return <div className="p-12 text-center text-sm text-[var(--text-muted)]">이동 중…</div>;
}
