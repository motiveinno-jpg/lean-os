"use client";

// /matching 라우트 폐지 → /partners/reconciliation(매칭허브) 통일 (2026-06-25).
//   입금 자동매칭·3-Way 매칭 기능은 매칭허브로 이전 완료. 옛 북마크·딥링크 안전망용 리다이렉트.
// QA 2026-07-10: 서버 컴포넌트 redirect() 버전은 prod(Vercel)에서 클라이언트 크래시(React #310)
//   유발 (로컬 빌드는 재현 안 됨 — Sentry 계측 유무 차이로 추정). /projects 와 동일한 클라이언트
//   리다이렉트 패턴(이미 prod 검증됨)으로 교체.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MatchingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/partners/reconciliation");
  }, [router]);
  return <div className="p-12 text-center text-sm text-[var(--text-muted)]">이동 중…</div>;
}
