"use client";

// 휴가는 근태관리(/attendance?section=leave)로 통합(2026-06-26). 기존 /leave 진입은 리다이렉트.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LeaveRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/attendance?section=leave");
  }, [router]);
  return <div className="p-8 text-center text-sm text-[var(--text-muted)]">근태 관리 · 휴가로 이동 중…</div>;
}
