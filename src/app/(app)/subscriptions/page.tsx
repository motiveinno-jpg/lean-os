"use client";

// 2026-07-08 "정기 지출" 흡수 — 구독 관리는 정기 지출 > 구독 탭으로 이동.
//   옛 /subscriptions 북마크·링크 호환을 위해 리다이렉트로 유지.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SubscriptionsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/payments?tab=subscriptions"); }, [router]);
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
