"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

const db = supabase;

type UsageStats = {
  as_of: string;
  accounts: { total: number; dau: number; wau: number; mau: number; never_signed_in: number };
  companies: { total: number; new_this_month: number };
  plans: { free: number; trialing: number; paid: number };
  activity_14d: { date: string; count: number }[];
};
type TrafficStats = {
  as_of: string; days: number;
  totals: { views_today: number; visitors_today: number; views: number; visitors: number; guest_visitors: number };
  daily: { date: string; views: number; visitors: number }[];
  top_paths: { path: string; views: number; visitors: number }[];
  top_referrers: { host: string; visitors: number }[];
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

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">플랫폼 개요</h1>
      </div>

      {/* KPI Row 1 */}
      <div className="platform-kpi-grid">
        {[
          { label: "총 가입사", value: totalCompanies, sub: `이번 달 +${thisMonth}` },
          { label: "총 사용자", value: totalUsers, sub: `회사당 ${totalCompanies ? (totalUsers / totalCompanies).toFixed(1) : 0}명` },
          { label: "유료 구독", value: paidSubs, sub: `전환율 ${conversionRate}%` },
          { label: "활성 구독", value: activeSubs, sub: "체험+유료 포함" },
        ].map((kpi) => (
          <div key={kpi.label} className="platform-kpi-card glass-card">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{kpi.label}</span>
            <div className="flex items-end gap-2">
              <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{kpi.value}</span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* 트래픽·이용 현황 (2026-07-28) */}
      <TrafficSection usage={usage ?? null} traffic={traffic ?? null} />

      {/* Revenue Row */}
      <div className="platform-revenue-row">
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">MRR (월간 반복 매출)</span>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmtW(mrr)}</span>
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">ARR: {fmtW(mrr * 12)}</div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 누적 매출</span>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--success)]">{fmtW(totalRevenue)}</span>
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">{paidInvoices.length}건 결제</div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">미처리 피드백</span>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--warning)]">{pendingFeedback}</span>
          </div>
          <div className="text-[11px]">
            <Link href="/platform/feedback" className="text-[var(--primary)] hover:underline">바로가기</Link>
          </div>
        </div>
      </div>

      {/* OP-A: 운영 신호 (24h 에러 + 사고) */}
      <div className="platform-ops-signal-row">
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">최근 24시간 에러</span>
            <span className="badge badge-primary uppercase tracking-wider">운영</span>
          </div>
          <div className={`text-[26px] leading-8 font-extrabold mono-number ${recentErrors.length > 50 ? "text-[var(--danger)]" : recentErrors.length > 10 ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
            {recentErrors.length}
          </div>
          <div className="text-[11px]">
            <Link href="/platform/errors" className="text-[var(--primary)] hover:underline">상세 해석 보기 →</Link>
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">미해결 사고</span>
            <span className="badge badge-primary uppercase tracking-wider">운영</span>
          </div>
          <div className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text-dim)]">—</div>
          <div className="text-[11px]">
            <Link href="/platform/incidents" className="text-[var(--primary)] hover:underline">사고 기록 →</Link>
          </div>
        </div>
      </div>

      {/* Recent signups */}
      <div className="platform-recent-signups-card glass-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[var(--text)]">최근 가입</h3>
          <Link href="/platform/customers" className="text-xs text-[var(--primary)] hover:underline">전체 보기</Link>
        </div>
        <div className="space-y-2">
          {companies.slice(0, 8).map((c: any) => {
            const subs = Array.isArray(c.subscriptions) ? c.subscriptions : [];
            const sub = subs.length
              ? [...subs].sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())[0]
              : undefined;
            const plan = sub?.subscription_plans;
            return (
              <div key={c.id} className="platform-signup-row">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[var(--text)] truncate">{c.name}</div>
                  <div className="text-xs text-[var(--text-dim)]">
                    {kstDateStr(new Date(c.created_at))}
                  </div>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  plan?.slug === "business" || plan?.slug === "pro" ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                  plan?.slug === "starter" ? "bg-[var(--info-dim)] text-[var(--info)]" :
                  "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                }`}>
                  {plan?.name || c.current_plan || "Free"}
                </span>
              </div>
            );
          })}
          {companies.length === 0 && (
            <div className="text-center py-8 text-sm text-[var(--text-dim)]">아직 가입 고객이 없습니다</div>
          )}
        </div>
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
              { label: "무료", n: plans?.free ?? 0, cls: "platform-plan-free" },
              { label: "체험 중", n: plans?.trialing ?? 0, cls: "platform-plan-trial" },
              { label: "유료", n: plans?.paid ?? 0, cls: "platform-plan-paid" },
            ].map((r) => {
              const total = Math.max(1, (plans?.free ?? 0) + (plans?.trialing ?? 0) + (plans?.paid ?? 0));
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
