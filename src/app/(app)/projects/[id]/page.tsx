"use client";

// 옛 프로젝트 상세 화면 제거 (2026-07-01) — 신규 /projecthub/[id] 로 리다이렉트(쿼리 유지).
//   기존 코드가 있던 자리. 대시보드·알림·리포트의 /projects/[id] 링크가 자동으로 projecthub 로 이동.

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function LegacyProjectDetailRedirect() {
  const params = useParams();
  const router = useRouter();
  useEffect(() => {
    const id = String((params as { id?: string })?.id || "");
    const qs = typeof window !== "undefined" ? window.location.search : "";
    router.replace(id ? `/projecthub/${id}${qs}` : "/projecthub");
  }, [params, router]);
  return <div className="p-12 text-center text-sm text-[var(--text-muted)]">이동 중…</div>;
}
