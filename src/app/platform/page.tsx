"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

const db = supabase;

type UsageStats = {
  as_of: string;
  accounts: { total: number; dau: number; wau: number; mau: number; never_signed_in: number };
  companies: { total: number; new_this_month: number };
  plans: { free: number; trialing: number; trial_expired: number; paid: number };
  activity_14d: { date: string; count: number }[];
};
type FunnelStats = {
  as_of: string; days: number;
  today: { accounts: number; signed_in: number; companies: number; trials: number };
  today_detail?: {
    accounts: { email: string; provider: string; created_at: string; signed_in: boolean; company: string | null }[];
    companies: { id: string; name: string; created_at: string }[];
    trials: { company_id: string; company: string; status: string; created_at: string }[];
  };
  period: { accounts: number; signed_in: number; companies: number; trials: number };
  pending: { email: string; created_at: string; last_sign_in: string | null; provider: string; confirmed: boolean }[];
};
type TrafficStats = {
  as_of: string; days: number;
  totals: { views_today: number; visitors_today: number; views: number; visitors: number; guest_visitors: number };
  daily: { date: string; views: number; visitors: number }[];
  top_paths: { path: string; views: number; visitors: number }[];
  top_referrers: { host: string; visitors: number }[];
};
type OpsRisk = {
  as_of: string;
  stale_join_requests: { company: string; email: string; days: number; created_at: string }[];
  dormant_companies: { name: string; plan: string; last_seen: string | null }[];
  email_failures: { join_requests: number; billing: number };
  sales_codes: { code: string; owner: string | null; bonus_days: number; active: boolean; redemptions: number; conversions: number }[];
  deletions: { d7: number; d30: number };
};

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

export default function PlatformOverview() {
  const { data: companies = [] } = useQuery({
    queryKey: ["p-companies"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("companies").select("*, users(count), subscriptions(*, subscription_plans(*))").order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: subscriptions = [] } = useQuery({
    queryKey: ["p-subs"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("subscriptions").select("*, subscription_plans(*), companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["p-invoices"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("invoices").select("*, companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-users"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("users").select("id").order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: feedback = [] } = useQuery({
    queryKey: ["p-feedback"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("feedback").select("id, status, category, created_at").order("created_at", { ascending: false }));
      return data || [];
    },
  });

  // OP-A: 24h 에러 수 (error_logs 테이블 — 운영 신호)
  const { data: recentErrors = [] } = useQuery({
    queryKey: ["p-errors-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const data = logRead('platform/page:data', await db.from("error_logs").select("id").gte("created_at", since));
      return data || [];
    },
  });

  // 운영 인박스 신호 (2026-07-28) — 아침에 봐야 할 "할 일" 카운트
  const { data: newInquiries = [] } = useQuery({
    queryKey: ["p-inbox-partnership"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("operator_list_partnership_inquiries", { p_status: "new", p_limit: 100 });
      if (error) return [];
      return data || [];
    },
    refetchInterval: 60_000,
  });
  const { data: openTickets = [] } = useQuery({
    queryKey: ["p-inbox-support"],
    queryFn: async () => {
      const data = logRead('platform/page:tickets', await db.from("support_tickets").select("id").eq("status", "open"));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  // 위험·성장 신호 (2026-07-28) — 합류요청 방치·휴면 고객·메일 실패·영업코드 실적·탈퇴 추이
  const { data: opsRisk } = useQuery<OpsRisk | null>({
    queryKey: ["p-ops-risk"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_ops_risk");
      if (error) return null;
      return data as OpsRisk;
    },
    refetchInterval: 60_000,
  });

  // 트래픽·사용 지표 (2026-07-28) — auth.users 는 클라에서 못 읽어 운영자 전용 RPC 로 감쌌다.
  //   두 RPC 모두 함수 안에서 is_platform_operator() 를 확인하므로 비운영자는 예외를 받는다.
  const { data: usage } = useQuery<UsageStats | null>({
    queryKey: ["p-usage-stats"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_usage_stats");
      if (error) return null;
      return data as UsageStats;
    },
    refetchInterval: 60_000,
  });

  const { data: traffic } = useQuery<TrafficStats | null>({
    queryKey: ["p-traffic-stats"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_traffic_stats", { p_days: 14 });
      if (error) return null;
      return data as TrafficStats;
    },
    refetchInterval: 60_000,
  });

  // 가입 퍼널 — companies 기준 통계로는 "계정만 만들고 회사 등록 전 이탈" 이 안 잡힌다.
  const { data: funnel } = useQuery<FunnelStats | null>({
    queryKey: ["p-signup-funnel"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_signup_funnel", { p_days: 7 });
      if (error) return null;
      return data as FunnelStats;
    },
    refetchInterval: 60_000,
  });

  // KPI 카드 클릭 → 아래 "가입사" 목록을 해당 그룹으로 필터 (2026-07-28 사장님 요청).
  //   숫자만 보고 "그게 어떤 회사인지" 알 방법이 없던 문제.
  const [kpiFilter, setKpiFilter] = useState<"all" | "paid" | "trial" | "free" | "new" | "expired">("all");

  const totalCompanies = companies.length;
  const totalUsers = users.length;
  const activeSubs = subscriptions.filter((s: any) => s.status === "active" || s.status === "trialing").length;
  const paidSubs = subscriptions.filter((s: any) => s.status === "active" && s.subscription_plans?.slug !== "free").length;
  const mrr = subscriptions
    .filter((s: any) => s.status === "active")
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
  const pendingFeedback = feedback.filter((f: any) => f.status === "pending").length;
  const conversionRate = totalCompanies > 0 ? ((paidSubs / totalCompanies) * 100).toFixed(1) : "0";

  // 이번 달 가입
  const now = new Date();
  const thisMonth = companies.filter((c: any) => {
    const d = new Date(c.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // 위험 신호 계산 — 체험 만료 임박(D-3)·해지 예약·결제 실패는 subscriptions 로 직접
  const nowMs = Date.now();
  const trialEndingSoon = subscriptions.filter((s: any) => {
    if (s.status !== "trialing" || !s.trial_ends_at) return false;
    const left = new Date(s.trial_ends_at).getTime() - nowMs;
    return left > 0 && left < 3 * 24 * 3600 * 1000;
  });
  const cancelScheduled = subscriptions.filter((s: any) =>
    s.cancel_at_period_end && (s.status === "active" || s.status === "trialing"));
  const pastDue = subscriptions.filter((s: any) => s.status === "past_due");
  const staleJoinReqs = (opsRisk?.stale_join_requests ?? []).filter((r) => r.days >= 3);
  const dormant = opsRisk?.dormant_companies ?? [];
  const emailFails = (opsRisk?.email_failures?.join_requests ?? 0) + (opsRisk?.email_failures?.billing ?? 0);
  // 좌석 임박 — 유료/체험 회사 중 인원이 기본좌석-1 이상 (추가좌석 매출 리드)
  const seatPressure = (companies as any[]).filter((c: any) => {
    const sub = (c.subscriptions || []).find((s: any) => s.status === "active" || s.status === "trialing");
    if (!sub) return false;
    const included = sub.subscription_plans?.included_seats || 5;
    return (c.users?.[0]?.count ?? 0) >= included - 1;
  });

  // 위험 신호 통합 리스트 (유형 배지 + 대상 + 시점)
  const fmtD = (iso?: string | null) => (iso ? kstDateStr(new Date(iso)) : "기록 없음");
  const riskRows: { type: string; cls: string; who: string; detail: string }[] = [
    ...trialEndingSoon.map((s: any) => ({
      type: "체험 만료 임박", cls: "platform-risk-trial",
      who: s.companies?.name || "-",
      detail: `${fmtD(s.trial_ends_at)} 종료`,
    })),
    ...cancelScheduled.map((s: any) => ({
      type: "해지 예약", cls: "platform-risk-cancel",
      who: s.companies?.name || "-",
      detail: s.current_period_end ? `${fmtD(s.current_period_end)}까지 이용` : "기간 종료 시 해지",
    })),
    ...pastDue.map((s: any) => ({
      type: "결제 실패", cls: "platform-risk-pastdue",
      who: s.companies?.name || "-",
      detail: "카드 확인 필요",
    })),
    ...staleJoinReqs.map((r) => ({
      type: "합류요청 방치", cls: "platform-risk-join",
      who: `${r.company} ← ${r.email}`,
      detail: `${r.days}일째 대기`,
    })),
    ...dormant.map((d) => ({
      type: "휴면 위험", cls: "platform-risk-dormant",
      who: `${d.name} (${d.plan})`,
      detail: `마지막 접속 ${fmtD(d.last_seen)}`,
    })),
  ];

  // 운영 인박스 — 0건이면 초록, 있으면 주의 색으로
  const inboxItems = [
    { label: "신규 도입문의", n: (newInquiries as any[]).length, href: "/platform/partnership", icon: "📥" },
    { label: "미답변 고객센터", n: (openTickets as any[]).length, href: "/platform/support", icon: "🎧" },
    { label: "미처리 피드백", n: pendingFeedback, href: "/platform/feedback", icon: "💬" },
    { label: "24시간 에러", n: recentErrors.length, href: "/platform/health", icon: "🚨", danger: recentErrors.length > 50 },
  ];
  const todoTotal = inboxItems.reduce((s, i) => s + i.n, 0);

  return (
    <div className="max-w-[1400px] space-y-6">
      {/* 히어로 밴드 — 인사·날짜 + 핵심 지표 4개 (2026-07-28 전면 재배치) */}
      <div className="platform-hero chrome-glass">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-[var(--text-dim)]">{kstDateStr(new Date())} · 1분마다 갱신</div>
          <h1 className="text-xl md:text-2xl font-extrabold text-[var(--text)] mt-0.5">플랫폼 개요</h1>
          <span className={`platform-header-live mt-2 inline-block ${todoTotal > 0 ? "platform-header-live-warn" : ""}`}>
            {todoTotal > 0 ? `처리 대기 ${todoTotal}건` : "모두 처리됨 ✓"}
          </span>
        </div>
        <div className="platform-hero-metrics">
          {[
            { label: "MRR", value: fmtW(mrr), accent: true },
            { label: "총 가입사", value: `${totalCompanies}곳` },
            { label: "유료 전환율", value: `${conversionRate}%` },
            { label: "오늘 활동", value: `${usage?.accounts?.dau ?? 0}명` },
          ].map((m) => (
            <div key={m.label} className="platform-hero-metric">
              <span className={`text-[22px] md:text-[26px] leading-8 font-extrabold mono-number ${m.accent ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{m.value}</span>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 본문 그리드 — 좌: 고객 데이터 / 우: 작업 레일 */}
      <div className="platform-grid">
        {/* ◀ 메인 컬럼 */}
        <div className="space-y-6 min-w-0">
          {/* 고객 현황 — 지표 스트립(클릭=아래 가입사 필터) */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">고객 현황</span>
              <span className="text-[11px] text-[var(--text-dim)]">지표를 누르면 아래 목록이 필터링됩니다</span>
            </div>
            <div className="platform-stat-strip">
              {[
                { label: "총 가입사", value: totalCompanies, sub: `이번 달 +${thisMonth}`, f: "all" as const },
                { label: "이번 달 신규", value: thisMonth, sub: "신규 가입", f: "new" as const },
                { label: "유료 구독", value: paidSubs, sub: `전환율 ${conversionRate}%`, f: "paid" as const },
                { label: "체험 중", value: activeSubs - paidSubs, sub: "카드 등록 · 전환 대기", f: "trial" as const },
              ].map((kpi) => (
                <button
                  key={kpi.label}
                  type="button"
                  onClick={() => setKpiFilter(kpi.f)}
                  className={`platform-stat-cell ${kpiFilter === kpi.f ? "platform-stat-cell-active" : ""}`}
                >
                  <span className="text-[22px] leading-7 font-extrabold mono-number text-[var(--text)]">{kpi.value}</span>
                  <span className="text-[12px] font-semibold text-[var(--text-muted)]">{kpi.label}</span>
                  <span className="text-[10px] text-[var(--text-dim)]">{kpi.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 가입사 목록 */}
          <RecentCompanies companies={companies as any[]} filter={kpiFilter} onFilter={setKpiFilter} />

          {/* 가입 퍼널 */}
          <SignupFunnelSection funnel={funnel ?? null} />

          {/* 트래픽·이용 현황 */}
          <TrafficSection usage={usage ?? null} traffic={traffic ?? null} />
        </div>

        {/* ▶ 작업 레일 */}
        <aside className="space-y-4 min-w-0">
          {/* 오늘 봐야 할 것 */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">오늘 봐야 할 것</span>
              <span className={`platform-rail-count ${todoTotal > 0 ? "platform-rail-count-warn" : ""}`}>{todoTotal}</span>
            </div>
            <div className="platform-rail-rows">
              {inboxItems.map((it) => (
                <Link key={it.label} href={it.href} className="platform-rail-row">
                  <span className="text-sm shrink-0">{it.icon}</span>
                  <span className="flex-1 text-[12px] font-semibold text-[var(--text-muted)] truncate">{it.label}</span>
                  <span className={`platform-rail-badge ${it.n === 0 ? "" : it.danger ? "platform-rail-badge-danger" : "platform-rail-badge-warn"}`}>{it.n}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* 위험 신호 */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">위험 신호</span>
              <span className={`platform-rail-count ${riskRows.length > 0 ? "platform-rail-count-warn" : ""}`}>{riskRows.length}</span>
            </div>
            {riskRows.length === 0 ? (
              <div className="px-4 py-5 text-[12px] text-[var(--text-dim)]">위험 신호가 없습니다 — 안정적입니다.</div>
            ) : (
              <div className="platform-rail-rows">
                {riskRows.slice(0, 8).map((r, i) => (
                  <div key={i} className="platform-rail-row cursor-default">
                    <span className={`platform-badge shrink-0 ${r.cls}`}>{r.type}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-[var(--text)] truncate">{r.who}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">{r.detail}</div>
                    </div>
                  </div>
                ))}
                {riskRows.length > 8 && (
                  <div className="px-4 py-2 text-[11px] text-[var(--text-dim)]">외 {riskRows.length - 8}건</div>
                )}
              </div>
            )}
          </div>

          {/* 수익 */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">수익</span>
              <Link href="/platform/revenue" className="text-[11px] text-[var(--primary)] hover:underline">상세 →</Link>
            </div>
            <div className="platform-rail-stats">
              <div><span className="mono-number font-extrabold text-[var(--text)]">{fmtW(mrr)}</span><span>MRR</span></div>
              <div><span className="mono-number font-extrabold text-[var(--success)]">{fmtW(totalRevenue)}</span><span>누적 매출</span></div>
              <div><span className="mono-number font-extrabold text-[var(--primary)]">{fmtW(mrr * 12)}</span><span>ARR</span></div>
            </div>
          </div>

          {/* 성장 신호 */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">성장 신호</span>
              <Link href="/platform/sales-codes" className="text-[11px] text-[var(--primary)] hover:underline">영업코드 →</Link>
            </div>
            <div className="platform-rail-rows">
              {(opsRisk?.sales_codes ?? []).slice(0, 4).map((sc) => (
                <div key={sc.code} className="platform-rail-row cursor-default">
                  <span className="mono-number text-[12px] font-bold text-[var(--text)] shrink-0">{sc.code}</span>
                  <span className="flex-1 text-[11px] text-[var(--text-dim)] truncate">{sc.owner || "—"}</span>
                  <span className="text-[11px] mono-number text-[var(--text-muted)]">사용 {sc.redemptions} · 전환 <b className="text-[var(--success)]">{sc.conversions}</b></span>
                </div>
              ))}
              {(opsRisk?.sales_codes?.length ?? 0) === 0 && (
                <div className="px-4 py-3 text-[12px] text-[var(--text-dim)]">발급된 영업코드가 없습니다.</div>
              )}
              {seatPressure.length > 0 && (
                <div className="platform-rail-row cursor-default">
                  <span className="text-sm shrink-0">💺</span>
                  <span className="flex-1 text-[12px] font-semibold text-[var(--text-muted)]">좌석 초과 임박</span>
                  <span className="platform-rail-badge platform-rail-badge-warn">{seatPressure.length}</span>
                </div>
              )}
              <div className="platform-rail-row cursor-default">
                <span className="text-sm shrink-0">👋</span>
                <span className="flex-1 text-[12px] font-semibold text-[var(--text-muted)]">탈퇴 (7일/30일)</span>
                <span className="text-[12px] mono-number text-[var(--text-muted)]">{opsRisk?.deletions?.d7 ?? 0} / {opsRisk?.deletions?.d30 ?? 0}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── 트래픽·이용 현황 ─────────────────────────────────────────────────────────
//   방문자·페이지뷰는 2026-07-28 부터 수집 시작 — 그 이전 기간은 데이터가 없다.
function TrafficSection({ usage, traffic }: { usage: UsageStats | null; traffic: TrafficStats | null }) {
  const acc = usage?.accounts;
  const plans = usage?.plans;
  const t = traffic?.totals;

  const daily = traffic?.daily ?? [];
  const maxViews = Math.max(1, ...daily.map((d) => d.views));
  const noTraffic = !t || t.views === 0;

  return (
    <section className="platform-traffic">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-[var(--text)]">트래픽 · 이용 현황</h2>
        <span className="text-[11px] text-[var(--text-dim)]">로그인 지표는 실시간 · 방문자는 2026-07-28부터 수집</span>
      </div>

      <div className="platform-kpi-grid">
        {[
          { label: "오늘 방문자", value: t?.visitors_today ?? 0, sub: `페이지뷰 ${(t?.views_today ?? 0).toLocaleString()}` },
          { label: "14일 방문자", value: t?.visitors ?? 0, sub: `비로그인 ${(t?.guest_visitors ?? 0).toLocaleString()}` },
          { label: "오늘 활동 사용자", value: acc?.dau ?? 0, sub: `주간 ${acc?.wau ?? 0} · 월간 ${acc?.mau ?? 0}` },
          { label: "미로그인 계정", value: acc?.never_signed_in ?? 0, sub: `전체 계정 ${acc?.total ?? 0}` },
        ].map((k) => (
          <div key={k.label} className="platform-kpi-card glass-card">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{k.label}</span>
            <div className="flex items-end gap-2">
              <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{k.value.toLocaleString()}</span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="platform-traffic-grid">
        {/* 요금제 분포 */}
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold text-[var(--text-muted)] mb-3">이용 형태</div>
          <div className="platform-plan-rows">
            {[
              { label: "미구독 (카드 미등록)", n: plans?.free ?? 0, cls: "platform-plan-free" },
              { label: "체험 중 (카드 등록)", n: plans?.trialing ?? 0, cls: "platform-plan-trial" },
              // status 는 trialing 인데 기간이 지난 회사 — 실제로는 페이월에 막혀 있다.
              //   status 만 세면 "체험 중" 으로 잡혀 실사용 회사 수가 부풀었다(2026-07-28).
              { label: "체험 만료", n: plans?.trial_expired ?? 0, cls: "platform-plan-expired" },
              { label: "유료", n: plans?.paid ?? 0, cls: "platform-plan-paid" },
            ].map((r) => {
              const total = Math.max(1, (plans?.free ?? 0) + (plans?.trialing ?? 0) + (plans?.trial_expired ?? 0) + (plans?.paid ?? 0));
              return (
                <div key={r.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-muted)]">{r.label}</span>
                    <span className="mono-number font-bold text-[var(--text)]">{r.n}곳</span>
                  </div>
                  <div className="platform-plan-bar">
                    <div className={`platform-plan-fill ${r.cls}`} style={{ width: `${(r.n / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 일별 방문 추이 */}
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold text-[var(--text-muted)] mb-3">일별 방문 (14일)</div>
          {noTraffic ? (
            <div className="platform-traffic-empty">
              아직 수집된 방문 기록이 없습니다.<br />
              <span className="text-[11px]">배포 후 방문이 발생하면 이 자리에 그래프가 나타납니다.</span>
            </div>
          ) : (
            <div className="platform-traffic-bars">
              {daily.map((d) => (
                <div key={d.date} className="platform-traffic-bar-col" title={`${d.date} · 방문자 ${d.visitors} · 페이지뷰 ${d.views}`}>
                  <div className="platform-traffic-bar" style={{ height: `${Math.max(4, (d.views / maxViews) * 100)}%` }} />
                  <span className="platform-traffic-bar-label mono-number">{d.date.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 인기 페이지 · 유입 */}
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold text-[var(--text-muted)] mb-3">많이 본 페이지</div>
          {(traffic?.top_paths?.length ?? 0) === 0 ? (
            <div className="platform-traffic-empty">수집 대기 중</div>
          ) : (
            <ul className="platform-traffic-list">
              {traffic!.top_paths.slice(0, 6).map((p) => (
                <li key={p.path}>
                  <span className="truncate">{p.path}</span>
                  <span className="mono-number">{p.views.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[13px] font-semibold text-[var(--text-muted)] mt-4 mb-2">유입 경로</div>
          {(traffic?.top_referrers?.length ?? 0) === 0 ? (
            <div className="platform-traffic-empty">수집 대기 중</div>
          ) : (
            <ul className="platform-traffic-list">
              {traffic!.top_referrers.slice(0, 5).map((r) => (
                <li key={r.host}>
                  <span className="truncate">{r.host}</span>
                  <span className="mono-number">{r.visitors.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 가입 퍼널 ────────────────────────────────────────────────────────────────
//   "총 가입사" 는 companies 기준이라 계정만 만들고 회사 등록 전에 떠난 사람이
//   통계에서 통째로 빠진다. 그 구간을 드러내는 게 이 섹션의 목적.
function SignupFunnelSection({ funnel }: { funnel: FunnelStats | null }) {
  const t = funnel?.today;
  const pending = funnel?.pending ?? [];
  const detail = funnel?.today_detail;
  // 단계 클릭 → 그 단계에 해당하는 오늘의 명단 (2026-07-28 사장님 요청)
  const [openStep, setOpenStep] = useState<number | null>(null);

  const steps = [
    { label: "계정 생성", n: t?.accounts ?? 0 },
    { label: "로그인", n: t?.signed_in ?? 0 },
    { label: "회사 등록", n: t?.companies ?? 0 },
    { label: "체험 시작", n: t?.trials ?? 0 },
  ];
  // 가장 크게 빠지는 구간 — 여기가 오늘의 병목
  let worstIdx = -1, worstDrop = 0;
  for (let i = 1; i < steps.length; i++) {
    const drop = steps[i - 1].n - steps[i].n;
    if (drop > worstDrop) { worstDrop = drop; worstIdx = i; }
  }

  const fmtKst = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  // 단계별 명단 행 구성 — 계정 단계는 상태(로그인·회사연결)까지 병기
  const stepRows: { key: string; who: React.ReactNode; sub: string }[] = (() => {
    if (openStep === null || !detail) return [];
    if (openStep === 0 || openStep === 1) {
      const list = openStep === 0 ? detail.accounts : detail.accounts.filter((a) => a.signed_in);
      return list.map((a) => ({
        key: a.email,
        who: <span className="font-semibold text-[var(--text)]">{a.email}</span>,
        sub: `${a.provider} · ${fmtKst(a.created_at)} · ${a.company ? `회사: ${a.company}` : a.signed_in ? "회사 미등록" : "미로그인"}`,
      }));
    }
    if (openStep === 2) {
      return detail.companies.map((c) => ({
        key: c.id,
        who: <Link href={`/platform/companies/${c.id}`} className="font-semibold text-[var(--primary)] hover:underline">{c.name}</Link>,
        sub: fmtKst(c.created_at),
      }));
    }
    return detail.trials.map((tr) => ({
      key: tr.company_id,
      who: <Link href={`/platform/companies/${tr.company_id}`} className="font-semibold text-[var(--primary)] hover:underline">{tr.company}</Link>,
      sub: `${tr.status === "trialing" ? "체험" : "유료"} 시작 · ${fmtKst(tr.created_at)}`,
    }));
  })();

  return (
    <section className="platform-funnel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-[var(--text)]">오늘 가입 퍼널</h2>
        <span className="text-[11px] text-[var(--text-dim)]">최근 7일: 계정 {funnel?.period.accounts ?? 0} · 회사 {funnel?.period.companies ?? 0} · 카드를 누르면 명단이 보입니다</span>
      </div>

      <div className="platform-funnel-steps glass-card">
        {steps.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setOpenStep(openStep === i ? null : i)}
            className={`platform-funnel-step platform-funnel-step-btn ${openStep === i ? "platform-funnel-step-active" : ""}`}
          >
            <span className="text-[11px] text-[var(--text-muted)]">{s.label}</span>
            <span className={`text-[24px] leading-7 font-extrabold mono-number ${i === worstIdx && worstDrop > 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
              {s.n}
            </span>
            {i === worstIdx && worstDrop > 0 && (
              <span className="text-[10px] font-semibold text-[var(--danger)]">-{worstDrop} 이탈</span>
            )}
          </button>
        ))}
      </div>

      {openStep !== null && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">오늘 · {steps[openStep].label} {stepRows.length}명</span>
            <button onClick={() => setOpenStep(null)} className="platform-filter-clear">닫기</button>
          </div>
          {stepRows.length === 0 ? (
            <div className="platform-traffic-empty">오늘 해당 단계에 도달한 사람이 없습니다.</div>
          ) : (
            <ul className="platform-funnel-people">
              {stepRows.map((r) => (
                <li key={r.key}>
                  {r.who}
                  <span className="text-[11px] text-[var(--text-dim)]">{r.sub}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="glass-card p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">회사 등록을 안 끝낸 가입자</span>
          <span className="text-[11px] text-[var(--text-dim)]">최근 30일 · {pending.length}명</span>
        </div>
        {pending.length === 0 ? (
          <div className="platform-traffic-empty">전원 회사 등록을 마쳤습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="table-head-row">
                  <th className="th-cell text-left">이메일</th>
                  <th className="th-cell text-left">가입</th>
                  <th className="th-cell text-center">경로</th>
                  <th className="th-cell text-center">로그인</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.email} className="border-b border-[var(--border)]/50">
                    <td className="px-3 py-2 text-[var(--text)]">{p.email}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] mono-number">{fmtKst(p.created_at)}</td>
                    <td className="px-3 py-2 text-center text-[var(--text-muted)]">{p.provider}</td>
                    <td className="px-3 py-2 text-center">
                      {p.last_sign_in
                        ? <span className="text-[var(--success)]">완료</span>
                        : <span className="text-[var(--text-dim)]">{p.confirmed ? "미접속" : "인증 전"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ── 최근 가입사 ──────────────────────────────────────────────────────────────
//   2026-07-28: companies SELECT 정책에 운영자 예외가 없어 이 화면이 자기 회사
//   1건만 보고 있었다("총 가입사 1"). 정책 추가 후 전체가 보이므로 목록을 붙인다.
function RecentCompanies({ companies, filter, onFilter }: {
  companies: any[];
  filter: "all" | "paid" | "trial" | "free" | "new" | "expired";
  onFilter: (f: "all" | "paid" | "trial" | "free" | "new" | "expired") => void;
}) {
  // 행 어디를 눌러도 상세로 — 기존엔 회사명 글자만 링크라 "눌러도 아무것도 안 나온다"는 제보 (2026-07-28)
  const router = useRouter();
  // 명칭 정리(2026-07-28 사장님): "무료 vs 체험" 구분이 안 됨 → 미구독(카드 미등록) /
  //   체험 D-n(카드 등록, 남은 일수) / 플랜명. kind 는 필터 매칭용(라벨 문자열 비교 제거).
  const planOf = (c: any): { kind: "free" | "trial" | "expired" | "paid"; label: string; cls: string } => {
    const sub = (c.subscriptions || []).find((s: any) => s.status === "active" || s.status === "trialing");
    if (!sub) return { kind: "free", label: "미구독", cls: "platform-badge-free" };
    if (sub.status === "trialing") {
      // status 는 만료 후에도 trialing 으로 남는다(이음네트웍스: 67일 경과).
      //   차단 판정(get_company_entitlement)은 trial_ends_at 기준이라 집계도 분리한다.
      const left = sub.trial_ends_at ? Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000) : null;
      if (left !== null && left < 0) {
        return { kind: "expired", label: "체험 만료", cls: "platform-badge-expired" };
      }
      return {
        kind: "trial",
        label: left === null ? "체험 중" : `체험 D-${left}`,
        cls: "platform-badge-trial",
      };
    }
    const slug = sub.subscription_plans?.slug;
    return slug && slug !== "free"
      ? { kind: "paid", label: sub.subscription_plans?.name || "유료", cls: "platform-badge-paid" }
      : { kind: "free", label: "미구독", cls: "platform-badge-free" };
  };

  const fmtKst = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  const now = new Date();
  const isThisMonth = (c: any) => {
    const d = new Date(c.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  };
  const matches = (c: any) => {
    const k = planOf(c).kind;
    if (filter === "paid") return k === "paid";
    if (filter === "trial") return k === "trial";
    if (filter === "expired") return k === "expired";
    if (filter === "free") return k === "free";
    if (filter === "new") return isThisMonth(c);
    return true;
  };

  const rows = [...(companies || [])]
    .filter(matches)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const FILTER_LABEL: Record<string, string> = {
    all: "전체", new: "이번 달 신규", paid: "유료", trial: "체험 중", free: "미구독", expired: "체험 만료",
  };

  return (
    <section className="platform-funnel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-[var(--text)]">
          가입사 <span className="text-[var(--primary)]">{FILTER_LABEL[filter]}</span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-dim)]">{rows.length}곳 / 전체 {companies?.length ?? 0}곳</span>
          {filter !== "all" && (
            <button onClick={() => onFilter("all")} className="platform-filter-clear">전체 보기</button>
          )}
        </div>
      </div>
      <div className="glass-card p-0 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="table-head-row">
              <th className="th-cell text-left">회사</th>
              <th className="th-cell text-left">사업자번호</th>
              <th className="th-cell text-center">인원</th>
              <th className="th-cell text-center">이용</th>
              <th className="th-cell text-left">가입</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-dim)]">해당하는 가입사가 없습니다</td></tr>
            ) : rows.map((c) => {
              const p = planOf(c);
              return (
                <tr key={c.id} onClick={() => router.push(`/platform/companies/${c.id}`)} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] cursor-pointer">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-[var(--primary)] hover:underline">
                      {c.name || "이름 없음"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)] mono-number">{c.business_number || "—"}</td>
                  <td className="px-3 py-2 text-center mono-number text-[var(--text-muted)]">{c.users?.[0]?.count ?? 0}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`platform-badge ${p.cls}`}>{p.label}</span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)] mono-number">{fmtKst(c.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
