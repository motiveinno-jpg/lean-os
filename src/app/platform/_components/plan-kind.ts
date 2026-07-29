// 회사의 이용 등급 판정 — 운영자 대시보드의 카드 숫자·목록·배지·분석 섹션이
// 전부 이 함수 하나만 쓴다 (2026-07-29 page.tsx 에서 추출).
//
// 2026-07-28 사고: 같은 판정을 세 곳이 각자 계산하다가 "체험 중 1개인데 눌러도
// 목록 0" 이 났다. 판정을 한 곳으로 모아 재발을 막는다.
// 기준은 차단 판정(get_company_entitlement)과 동일 — status 는 만료 후에도
// trialing 으로 남으므로 trial_ends_at 을 함께 본다.

export type PlanKind = "free" | "trial" | "expired" | "paid";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function planOf(c: any): { kind: PlanKind; label: string; cls: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = (c.subscriptions || []).find((s: any) => s.status === "active" || s.status === "trialing");
  if (!sub) return { kind: "free", label: "미구독", cls: "platform-badge-free" };
  if (sub.status === "trialing") {
    const left = sub.trial_ends_at ? Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000) : null;
    if (left !== null && left < 0) return { kind: "expired", label: "체험 만료", cls: "platform-badge-expired" };
    return { kind: "trial", label: left === null ? "체험 중" : `체험 D-${left}`, cls: "platform-badge-trial" };
  }
  const slug = sub.subscription_plans?.slug;
  return slug && slug !== "free"
    ? { kind: "paid", label: sub.subscription_plans?.name || "유료", cls: "platform-badge-paid" }
    : { kind: "free", label: "미구독", cls: "platform-badge-free" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function countPlanKinds(companies: any[]): Record<PlanKind, number> {
  return (companies || []).reduce(
    (acc, c) => { acc[planOf(c).kind] += 1; return acc; },
    { free: 0, trial: 0, expired: 0, paid: 0 } as Record<PlanKind, number>,
  );
}
