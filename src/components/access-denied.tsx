"use client";

// P0-A: 권한거부 화면 막다른길 통일.
//   기존 곳곳의 "접근 권한이 없습니다 / 관리자에게 문의하세요" 텍스트만 있어
//   복귀 링크 0이던 패턴을 일괄 교체. 메시지 + 홈복귀 + 역할별 추천 메뉴.
import Link from "next/link";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ico } from "@/components/ui-icon";
import { useUser, type UserRole } from "@/components/user-context";

type RecMenu = { href: string; label: string; emoji: string };

const RECOMMEND_BY_ROLE: Record<UserRole, RecMenu[]> = {
  owner: [
    { href: "/dashboard", label: "대시보드", emoji: "🏠" },
    { href: "/approvals", label: "결재함", emoji: "📋" },
    { href: "/transactions", label: "통장", emoji: "💳" },
  ],
  admin: [
    { href: "/dashboard", label: "대시보드", emoji: "🏠" },
    { href: "/approvals", label: "결재함", emoji: "📋" },
    { href: "/employees", label: "인사관리", emoji: "👤" },
  ],
  employee: [
    { href: "/dashboard", label: "홈", emoji: "🏠" },
    { href: "/attendance", label: "근태/출퇴근", emoji: "⏰" },
    { href: "/leave", label: "휴가 신청", emoji: "🏖️" },
  ],
  partner: [
    { href: "/dashboard", label: "홈", emoji: "🏠" },
    { href: "/projects", label: "프로젝트", emoji: "📋" },
    { href: "/documents", label: "문서/계약", emoji: "📄" },
  ],
};

const ROLE_LABEL: Record<UserRole, string> = {
  owner: "대표",
  admin: "관리자",
  employee: "직원",
  partner: "파트너",
};

export function AccessDenied({
  title = "이 페이지에 접근 권한이 없습니다",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  const { role, user } = useUser();
  const qc = useQueryClient();
  const recs = RECOMMEND_BY_ROLE[role] || RECOMMEND_BY_ROLE.employee;
  const roleLabel = (user as any)?.is_master ? "마스터" : ROLE_LABEL[role] || "사용자";
  // 이 화면이 떠 있는 동안 10초마다 권한 재확인 — 마스터가 방금 부여하면 자동으로 풀린다
  //   (2026-07-31: 템플릿 부여 직후 캐시로 '권한 없음'이 유지되던 문제)
  useEffect(() => {
    const iv = setInterval(() => qc.invalidateQueries({ queryKey: ["my-permissions"] }), 10_000);
    return () => clearInterval(iv);
  }, [qc]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="access-denied-panel glass-card">
        <div className="text-4xl mb-3"><Ico e="🔒" /></div>
        <h1 className="text-2xl font-extrabold text-[var(--text)] mb-2">{title}</h1>
        <p className="text-sm text-[var(--text-muted)] mb-1">
          현재 <strong>{roleLabel}</strong> 권한으로는 이 화면을 열 수 없습니다.
        </p>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["my-permissions"] })}
          className="mt-1 mb-2 text-xs text-[var(--primary)] underline underline-offset-2"
        >
          방금 권한을 받았다면 여기를 눌러 다시 확인
        </button>
        {detail && <p className="text-xs text-[var(--text-dim)] mb-2">{detail}</p>}
        <p className="text-xs text-[var(--text-dim)] mb-5">
          권한이 필요하면 대표/관리자에게 요청하세요.
        </p>

        <Link
          href="/dashboard"
          className="access-denied-home-link"
        >
          ← 홈으로 돌아가기
        </Link>

        <div className="access-denied-recommend">
          <p className="access-denied-recommend-label">바로 갈 수 있는 곳</p>
          <div className="access-denied-recommend-list">
            {recs.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="access-denied-recommend-link"
              >
                <span><Ico e={m.emoji} /></span>
                {m.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccessDenied;
