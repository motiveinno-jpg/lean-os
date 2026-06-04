"use client";

// 2026-05-22 프로젝트 상세 — 슬라이드 패널 → 독립 전체화면 페이지로 분리.
//   /projects/<dealId>. ProjectSlideOver variant='page' 로 헤더바+넓은 본문 렌더.
//   탭(개요/돈/활동/일정관리) 컨텐츠·데이터 로직은 슬라이드와 100% 동일 재사용.
//   직원(role='employee')은 돈 탭 숨김·재무 가림 유지. partner 는 접근 차단.

import { useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ProjectSlideOver } from "@/components/project-slide-over";

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const dealId = String(params?.id || "");
  const { role, loading } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  // ?action=<key> 딥링크(알림 CTA) — 해당 탭/섹션 점프 1회
  const [pendingAction, setPendingAction] = useState<string | null>(searchParams?.get("action") || null);

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); });
  }, []);

  if (loading) {
    return <div className="mx-auto px-6 py-20 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }
  if (role === "partner") {
    return <AccessDenied detail="프로젝트 상세는 내부 구성원 전용입니다." />;
  }
  if (!companyId) {
    return <div className="mx-auto px-6 py-20 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <ProjectSlideOver
      dealId={dealId}
      companyId={companyId}
      variant="page"
      isEmployeeLimited={role === "employee"}
      pendingAction={pendingAction}
      onActionConsumed={() => setPendingAction(null)}
      onClose={() => {
        // 직전 화면(필터·스크롤 유지된 목록 등)으로 복귀. 편집 모달은 같은 페이지 state 라
        //   히스토리에 안 쌓여 back() 이 정확히 직전 목록으로 감.
        //   외부 직접진입(알림·북마크 — 히스토리 없음)이면 목록으로 fallback.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push("/projects");
        }
      }}
    />
  );
}
