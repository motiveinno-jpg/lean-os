"use client";

// /deals 라우트 폐지 → /projects 통일 (2026-05-26, 사장님 요청 "그냥 없애").
//   옛 북마크·알림·딥링크 안전망: 클라이언트 리다이렉트. ?id= / ?detail= → /projects/<id>.
//   프로그램 뷰(ProgramDashboard)는 진입로 폐지 — programs 테이블·deals.program_id 데이터는 보존(유실 0).
//   칸반/상세/캘린더 기능은 /projects(칸반) + /projects/[id](상세)가 대체.
// QA 2026-07-10: 서버 컴포넌트 redirect() 버전은 prod(Vercel)에서만 500(React #310)로 크래시
//   (로컬 빌드는 재현 안 됨 — Sentry 계측 유무 차이로 추정). /projects 와 동일한 클라이언트
//   리다이렉트 패턴(이미 prod 검증됨)으로 교체.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function DealsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const target = searchParams.get("id") || searchParams.get("detail");
    router.replace(target ? `/projects/${target}` : "/projects");
  }, [router, searchParams]);
  return <div className="p-12 text-center text-sm text-[var(--text-muted)]">이동 중…</div>;
}
