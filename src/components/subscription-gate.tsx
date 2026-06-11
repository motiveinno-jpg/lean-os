"use client";

// 유료 출시 게이트 (2026-06-11) — 구독 상태에 따른 배너/페이월.
//   감사 결과: 결제가 기능을 전혀 게이트하지 않아 "돈 낼 이유"가 없었음 → 최소 게이트 도입.
//   · trialing(D-14 이하): 상단 배너로 결제 유도
//   · past_due: 결제 실패 경고 배너 (Stripe dunning 진행 중 — 즉시 차단 X)
//   · trial 만료 / 해지 후 기간 종료: 하드 페이월 (children 대체)
//   안전망: 구독 행이 없는 레거시 회사는 차단하지 않음. 플랫폼 운영자(@mo-tive.com) 우회.
//   허용 라우트(/billing 등)는 차단 중에도 접근 가능 — 결제·계정 관리 동선 보장.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { getSubscriptionGate } from "@/lib/billing";

const ALLOW_WHEN_BLOCKED = ["/billing", "/mypage", "/guide", "/notifications", "/settings"];

export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { user, role } = useUser();
  const pathname = usePathname();
  const companyId = user?.company_id ?? null;
  const isOperator = /@mo-tive\.com$/i.test(user?.email || "");

  const { data: gate } = useQuery({
    queryKey: ["subscription-gate", companyId],
    queryFn: () => getSubscriptionGate(companyId!),
    enabled: !!companyId && !isOperator,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // 운영자 / 로딩 중 / 정보 없음 → 게이트 없이 통과
  if (isOperator || !gate) return <>{children}</>;

  const isManager = role === "owner" || role === "admin";
  const onAllowedRoute = ALLOW_WHEN_BLOCKED.some((r) => pathname === r || pathname.startsWith(r + "/"));

  // ── 하드 페이월: trial 만료 · 해지 후 기간 종료 ──
  if (gate.blocked && !onAllowedRoute) {
    return (
      <div className="glass-card" style={{ maxWidth: 560, margin: "64px auto", padding: "40px 32px", textAlign: "center" }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 16, margin: "0 auto 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "color-mix(in srgb, var(--primary) 12%, transparent)", color: "var(--primary)",
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>
          {gate.state === "trial_expired" ? "무료 체험이 끝났습니다" : "구독이 종료되었습니다"}
        </h2>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7, margin: "0 0 24px" }}>
          데이터는 안전하게 보관되어 있습니다.
          {isManager
            ? " 요금제를 선택하시면 모든 기능과 데이터를 바로 다시 사용할 수 있습니다."
            : " 회사 관리자(대표님)에게 구독 갱신을 요청해 주세요."}
        </p>
        {isManager ? (
          <Link
            href="/billing"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px",
              borderRadius: 12, background: "var(--primary)", color: "#fff",
              fontSize: 14, fontWeight: 700, textDecoration: "none",
            }}
          >
            요금제 보기 →
          </Link>
        ) : (
          <Link
            href="/mypage"
            style={{ fontSize: 13, color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}
          >
            내 계정으로 이동 →
          </Link>
        )}
      </div>
    );
  }

  // ── 소프트 배너 ──
  const showTrialBanner = gate.state === "trialing" && gate.daysLeft !== null && gate.daysLeft <= 14;
  const showPastDueBanner = gate.state === "past_due";
  const showBlockedAllowedBanner = gate.blocked && onAllowedRoute;

  return (
    <>
      {showTrialBanner && isManager && (
        <Link
          href="/billing"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "10px 16px", borderRadius: 12, marginBottom: 16, textDecoration: "none",
            background: "color-mix(in srgb, var(--primary) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
          }}
        >
          <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>
            ⏳ 무료 체험이 <strong style={{ color: "var(--primary)" }}>{gate.daysLeft}일</strong> 남았습니다
            {gate.planName ? ` (${gate.planName} 체험 중)` : ""}
          </span>
          <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, whiteSpace: "nowrap" }}>요금제 선택 →</span>
        </Link>
      )}
      {showPastDueBanner && isManager && (
        <Link
          href="/billing"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "10px 16px", borderRadius: 12, marginBottom: 16, textDecoration: "none",
            background: "color-mix(in srgb, #ef4444 8%, transparent)",
            border: "1px solid color-mix(in srgb, #ef4444 30%, transparent)",
          }}
        >
          <span style={{ fontSize: 12.5, color: "#ef4444", fontWeight: 600 }}>
            ⚠️ 결제에 실패했습니다 — 결제 수단을 확인해 주세요. 미해결 시 서비스가 제한될 수 있습니다.
          </span>
          <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 700, whiteSpace: "nowrap" }}>결제 관리 →</span>
        </Link>
      )}
      {showBlockedAllowedBanner && (
        <div
          style={{
            padding: "10px 16px", borderRadius: 12, marginBottom: 16,
            background: "color-mix(in srgb, #f59e0b 8%, transparent)",
            border: "1px solid color-mix(in srgb, #f59e0b 30%, transparent)",
            fontSize: 12.5, color: "#d97706", fontWeight: 600,
          }}
        >
          🔒 구독이 만료되어 다른 화면은 잠겨 있습니다. {isManager ? "요금제를 선택하면 즉시 복구됩니다." : "관리자에게 문의해 주세요."}
        </div>
      )}
      {children}
    </>
  );
}
