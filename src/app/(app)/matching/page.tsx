"use client";

// /matching 라우트 폐지 — 통장 입출금 처리는 수집·전표 › 통장 탭(/collect?tab=bank)에서 한다.
//   옛 북마크·딥링크 안전망용 리다이렉트. 탭은 도착 화면이 주소를 따라 연다(useUrlTabSync).
// 서버 컴포넌트 redirect 버전은 prod(Vercel)에서 클라이언트 크래시(React #310)
//   유발 (로컬 빌드는 재현 안 됨 — Sentry 계측 유무 차이로 추정). /projects 와 동일한 클라이언트
//   리다이렉트 패턴(이미 prod 검증됨)으로 교체.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MatchingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/collect?tab=bank");
  }, [router]);
  return <div className="p-12 text-center text-sm text-[var(--text-muted)]">이동 중…</div>;
}
