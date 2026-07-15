"use client";

// 휴가 신청은 전자결재로 일원화(2026-07-15). 기존 /leave 진입은 전자결재 새 휴가요청으로 리다이렉트.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LeaveRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/approvals?new=leave");
  }, [router]);
  return <div className="p-8 text-center text-sm text-[var(--text-muted)]">전자결재 · 휴가 신청으로 이동 중…</div>;
}
