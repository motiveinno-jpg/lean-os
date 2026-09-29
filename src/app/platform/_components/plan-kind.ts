// 회사의 이용 등급 판정 — 운영자 대시보드·고객사 관리의 카드 숫자·목록·필터·배지·분석 섹션이
// 전부 이 함수 하나만 쓴다 (2026-07-29 page.tsx 에서 추출).
//
// 2026-07-28 사고: 같은 판정을 세 곳이 각자 계산하다가 "체험 중 1개인데 눌러도
// 목록 0" 이 났다. 판정을 한 곳으로 모아 재발을 막는다.
// 기준은 차단 판정(get_company_entitlement)과 동일 — status 는 만료 후에도
// trialing 으로 남으므로 trial_ends_at 을 함께 본다.
//
// "유료"는 실제로 돈이 나가는 구독만이다 — 수익 화면의 MRR·결제 중 회사 수와 같은 기준
//   (isBilledSubscription: Stripe 구독 또는 토스 자동결제 키). 결제 수단 없이 활성인 구독
//   (자사·수동 부여)은 "무상 이용", 결제가 밀린 구독(past_due)은 "미납"으로 따로 센다.
//   해지(canceled)·일시중지만 남은 회사는 이용 중인 구독이 없으므로 "미구독"이다.

import { isBilledSubscription } from "@/lib/subscription-fee";

export type PlanKind = "free" | "trial" | "expired" | "paid" | "past_due" | "granted";

// 한 회사에 구독이 여럿이면 이용 중인 쪽을 고른다 — 활성 > 미납 > 체험, 같은 상태면 최근 것.
const LIVE_PRIORITY: Record<string, number> = { active: 3, past_due: 2, trialing: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function liveSub(c: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs = ((c?.subscriptions || []) as any[]).filter((s) => LIVE_PRIORITY[s?.status]);
  if (subs.length === 0) return undefined;
  return subs.sort((a, b) =>
    (LIVE_PRIORITY[b.status] - LIVE_PRIORITY[a.status]) ||
    String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function planOf(c: any, now: number = Date.now()): { kind: PlanKind; label: string; cls: string } {
  const sub = liveSub(c);
  if (!sub) return { kind: "free", label: "미구독", cls: "platform-badge-free" };
  if (sub.status === "trialing") {
    const left = sub.trial_ends_at ? Math.ceil((new Date(sub.trial_ends_at).getTime() - now) / 86400000) : null;
    if (left !== null && left < 0) return { kind: "expired", label: "체험 만료", cls: "platform-badge-expired" };
    return { kind: "trial", label: left === null ? "체험 중" : `체험 D-${left}`, cls: "platform-badge-trial" };
  }
  const slug = sub.subscription_plans?.slug;
  if (!slug || slug === "free") return { kind: "free", label: "미구독", cls: "platform-badge-free" };
  if (sub.status === "past_due") return { kind: "past_due", label: "미납", cls: "platform-badge-expired" };
  if (!isBilledSubscription(sub)) return { kind: "granted", label: "무상 이용", cls: "platform-badge-free" };
  return { kind: "paid", label: sub.subscription_plans?.name || "유료", cls: "platform-badge-paid" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function countPlanKinds(companies: any[], now: number = Date.now()): Record<PlanKind, number> {
  return (companies || []).reduce(
    (acc, c) => { acc[planOf(c, now).kind] += 1; return acc; },
    { free: 0, trial: 0, expired: 0, paid: 0, past_due: 0, granted: 0 } as Record<PlanKind, number>,
  );
}
