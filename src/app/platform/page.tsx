"use client";
import { kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";
import { planOf, countPlanKinds, type PlanKind as PK } from "./_components/plan-kind";
import { AnalyticsSection } from "./_components/analytics-section";

import { useEffect, useState } from "react";
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
// 회사별 활동 (platform_company_activity RPC — 로그인·업무행위·방문의 합집합)
type CompanyActivity = {
  company_id: string;
  company: string;
  last_login: string | null;
  last_activity: string | null;
  last_inquiry: string | null;
};
// "활동중" 판정 — 마지막 활동이 10분 이내면 접속중으로 본다
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// CODEF 사용량 요약 (operator-user-admin EF mode=codef-usage — 운영자 게이트 내장)
type CodefUsageSummary = {
  month: string;
  total: { units: number; calls: number; rows: number };
  byCategory: Record<string, { units: number; calls: number }>;
  companies: { companyId: string; name: string; units: number; calls: number }[];
};
const CODEF_CATEGORY_ORDER = ["통장", "카드", "현금영수증", "세금계산서", "이체", "관리(무과금)", "기타"];

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

// 이용 등급 판정은 _components/plan-kind.ts 로 추출(2026-07-29 분석 섹션과 공유).
//   같은 판정이 두 벌 생기면 "카드 1개인데 목록 0" 사고가 재발한다 — 반드시 이것만 쓸 것.
export type { PlanKind } from "./_components/plan-kind";

export default function PlatformOverview() {
  // 현황판 모드 — 큰 화면에 상시로 띄워두므로 모든 데이터를 1분 주기로 자동 갱신한다.
  const { data: companies = [] } = useQuery({
    queryKey: ["p-companies"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("companies").select("*, users(count), subscriptions(*, subscription_plans(*))").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const { data: subscriptions = [] } = useQuery({
    queryKey: ["p-subs"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("subscriptions").select("*, subscription_plans(*), companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["p-invoices"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("invoices").select("*, companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-users"],
    queryFn: async () => {
      const data = logRead('platform/page:data', await db.from("users").select("id").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  // 회사별 마지막 로그인·활동 — 가입사 목록 "활동" 컬럼 + "지금 활동중" 카드
  const { data: companyActivity = [] } = useQuery<CompanyActivity[]>({
    queryKey: ["p-company-activity"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_company_activity");
      if (error) return [];
      return (data as CompanyActivity[]) || [];
    },
    refetchInterval: 60_000,
  });

  // CODEF 사용량 (이번 달) — 원장(codef_usage)은 RLS 가 자기 회사로 묶여 있어
  //   클라 직조회가 안 된다. 운영자 검증이 내장된 EF 집계를 그대로 쓴다.
  const { data: codefUsage } = useQuery<CodefUsageSummary | null>({
    queryKey: ["p-codef-usage"],
    queryFn: async () => {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return null;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/operator-user-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ mode: "codef-usage" }),
      });
      if (!res.ok) return null;
      return (await res.json()) as CodefUsageSummary;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  // 라이브 시계 — 현황판에서 "지금 몇 시 기준 화면인지" 보이게 (30초 틱)
  //   SSR 시각과 클라 시각이 달라 hydration mismatch 가 나므로 마운트 후에만 채운다.
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // OP-A: 24h 에러 수 (error_logs 테이블 — 운영 신호)
  const { data: recentErrors = [] } = useQuery({
    queryKey: ["p-errors-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      // 처리(resolved)된 오류는 제외 — 시스템상태 신호등과 같은 기준(2026-07-29 사장님)
      const data = logRead('platform/page:data', await db.from("error_logs").select("id").eq("resolved", false).gte("created_at", since));
      return data || [];
    },
    refetchInterval: 60_000,
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
  const { data: opsRisk, isError: opsRiskErr } = useQuery<OpsRisk | null>({
    queryKey: ["p-ops-risk"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_ops_risk");
      if (error) throw error;
      return data as OpsRisk;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  // 트래픽·사용 지표 (2026-07-28) — auth.users 는 클라에서 못 읽어 운영자 전용 RPC 로 감쌌다.
  //   두 RPC 모두 함수 안에서 is_platform_operator() 를 확인하므로 비운영자는 예외를 받는다.
  const { data: usage, isError: usageErr } = useQuery<UsageStats | null>({
    queryKey: ["p-usage-stats"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_usage_stats");
      if (error) throw error;
      return data as UsageStats;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  const { data: traffic, isError: trafficErr } = useQuery<TrafficStats | null>({
    queryKey: ["p-traffic-stats"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_traffic_stats", { p_days: 14 });
      if (error) throw error;
      return data as TrafficStats;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  // 가입 퍼널 — companies 기준 통계로는 "계정만 만들고 회사 등록 전 이탈" 이 안 잡힌다.
  const { data: funnel, isError: funnelErr } = useQuery<FunnelStats | null>({
    queryKey: ["p-signup-funnel"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_signup_funnel", { p_days: 7 });
      if (error) throw error;
      return data as FunnelStats;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  // KPI 카드 클릭 → 아래 "가입사" 목록을 해당 그룹으로 필터 (2026-07-28 사장님 요청).
  //   숫자만 보고 "그게 어떤 회사인지" 알 방법이 없던 문제.
  const [kpiFilter, setKpiFilter] = useState<"all" | "paid" | "trial" | "free" | "new" | "expired">("all");

  const totalCompanies = companies.length;
  const totalUsers = users.length;
  // ⚠️ subscriptions 배열이 아니라 companies 기준 planOf 로 센다 — 목록 필터와 같은 함수라
  //    "카드 숫자 1인데 눌러도 목록 0" 같은 어긋남이 원천적으로 안 생긴다.
  const kindCounts = countPlanKinds(companies as any[]);
  const paidSubs = kindCounts.paid;
  const activeSubs = kindCounts.paid + kindCounts.trial;
  // 실결제 구독만 — stripe 미연동(내부 부여) 구독이 MRR 을 부풀리던 것 제외 (2026-07-29)
  const mrr = subscriptions
    .filter((s: any) => s.status === "active" && s.stripe_subscription_id)
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
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
      // "접속"이 아니라 로그인·업무행위·방문을 합친 마지막 활동 시각이다.
      //   last_sign_in_at 만 보던 시절, 오늘 도입문의를 넣은 회사가 "마지막 접속 3월"로
      //   표시돼 사실과 어긋나 보였다(2026-07-28 이음네트웍스).
      detail: `마지막 활동 ${fmtD(d.last_seen)}`,
    })),
  ];

  // 지금 활동중 — 마지막 활동 10분 이내 회사 (현황판의 "라이브" 신호)
  const activityById = new Map(companyActivity.map((a) => [a.company_id, a]));
  const activeNow = companyActivity
    .filter((a) => a.last_activity && nowMs - new Date(a.last_activity).getTime() < ACTIVE_WINDOW_MS)
    .sort((a, b) => String(b.last_activity).localeCompare(String(a.last_activity)));

  // 운영 인박스 — 0건이면 초록, 있으면 주의 색으로
  const inboxItems = [
    { label: "신규 도입문의", n: (newInquiries as any[]).length, href: "/platform/partnership", icon: "📥" },
    { label: "미답변 고객센터", n: (openTickets as any[]).length, href: "/platform/support", icon: "🎧" },
    { label: "24시간 에러", n: recentErrors.length, href: "/platform/health", icon: "🚨", danger: recentErrors.length > 50 },
  ];
  const todoTotal = inboxItems.reduce((s, i) => s + i.n, 0);

  return (
    <div className="max-w-[1400px] space-y-6">
      {/* 히어로 밴드 — 인사·날짜 + 핵심 지표 4개 (2026-07-28 전면 재배치) */}
      <div className="platform-hero chrome-glass">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-[var(--text-dim)]">
            {clock ? (
              <>{kstDateStr(clock)} <span className="mono-number text-[var(--text-muted)]">{clock.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}</span> · 1분마다 갱신</>
            ) : "1분마다 갱신"}
          </div>
          <h1 className="text-xl md:text-2xl font-extrabold text-[var(--text)] mt-0.5">플랫폼 개요</h1>
          <span className={`platform-header-live mt-2 inline-block ${todoTotal > 0 ? "platform-header-live-warn" : ""}`}>
            {todoTotal > 0 ? `처리 대기 ${todoTotal}건` : "모두 처리됨 ✓"}
          </span>
          {(usageErr || trafficErr || funnelErr || opsRiskErr) && (
            <span className="platform-header-live platform-header-live-warn mt-2 ml-2 inline-block" title="일부 지표 RPC 호출이 실패했습니다 — 표시된 0은 실제 0이 아닐 수 있습니다">
              <Ico e="⚠" /> 일부 데이터 로드 실패
            </span>
          )}
        </div>
        <div className="platform-hero-metrics">
          {[
            { label: "MRR", value: fmtW(mrr), accent: true },
            { label: "총 가입사", value: `${totalCompanies}곳` },
            { label: "유료 전환율", value: `${conversionRate}%` },
            { label: "오늘 활동", value: `${usage?.accounts?.dau ?? 0}명` },
            { label: "지금 접속", value: `${activeNow.length}곳`, live: activeNow.length > 0 },
          ].map((m: any) => (
            // ⚠️ stat-fit(container-type) 금지 — flex 아이템이라 폭이 0으로 붕괴해 라벨이 세로로 깨졌다
            //   (2026-08-04 렌더 확인으로 발견). 값은 fmtW 로 짧게 축약되므로 고정 크기로 충분.
            <div key={m.label} className="platform-hero-metric">
              <span className={`text-xl md:text-2xl leading-tight font-extrabold mono-number whitespace-nowrap ${m.accent ? "text-[var(--primary)]" : m.live ? "text-[var(--success)]" : "text-[var(--text)]"}`}>
                {m.live && <span className="platform-active-dot mr-1.5" />}{m.value}
              </span>
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
                { label: "유료 구독", value: kindCounts.paid, sub: `전환율 ${conversionRate}%`, f: "paid" as const },
                { label: "체험 중", value: kindCounts.trial, sub: "카드 등록 · 전환 대기", f: "trial" as const },
                { label: "체험 만료", value: kindCounts.expired, sub: "차단 중 · 연락 대상", f: "expired" as const },
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
          <RecentCompanies companies={companies as any[]} filter={kpiFilter} onFilter={setKpiFilter} activityById={activityById} nowMs={nowMs} />

          {/* 가입 퍼널 */}
          <SignupFunnelSection funnel={funnel ?? null} />

          {/* 트래픽·이용 현황 */}
          <AnalyticsSection usage={usage ?? null} traffic={traffic ?? null} companies={companies as any[]} />
        </div>

        {/* ▶ 작업 레일 */}
        <aside className="space-y-4 min-w-0">
          {/* 지금 활동중 — 마지막 활동 10분 이내 회사 (현황판 라이브 신호) */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title"><span className={`platform-active-dot mr-1.5 ${activeNow.length === 0 ? "platform-active-dot-off" : ""}`} />지금 활동중</span>
              <span className="platform-rail-count">{activeNow.length}</span>
            </div>
            {activeNow.length === 0 ? (
              <div className="px-4 py-5 text-[12px] text-[var(--text-dim)]">최근 10분 내 접속한 회사가 없습니다.</div>
            ) : (
              <div className="platform-rail-rows">
                {activeNow.slice(0, 8).map((a) => {
                  const mins = Math.max(0, Math.floor((nowMs - new Date(a.last_activity!).getTime()) / 60_000));
                  return (
                    <Link key={a.company_id} href={`/platform/companies/${a.company_id}`} className="platform-rail-row">
                      <span className="platform-active-dot shrink-0" />
                      <span className="flex-1 text-[12px] font-semibold text-[var(--text)] truncate">{a.company || "이름 없음"}</span>
                      <span className="text-[11px] mono-number text-[var(--text-dim)]">{mins === 0 ? "방금" : `${mins}분 전`}</span>
                    </Link>
                  );
                })}
                {activeNow.length > 8 && (
                  <div className="px-4 py-2 text-[11px] text-[var(--text-dim)]">외 {activeNow.length - 8}곳</div>
                )}
              </div>
            )}
          </div>

          {/* 오늘 봐야 할 것 */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">오늘 봐야 할 것</span>
              <span className={`platform-rail-count ${todoTotal > 0 ? "platform-rail-count-warn" : ""}`}>{todoTotal}</span>
            </div>
            <div className="platform-rail-rows">
              {inboxItems.map((it) => (
                <Link key={it.label} href={it.href} className="platform-rail-row">
                  <span className="text-sm shrink-0"><Ico e={it.icon} /></span>
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

          {/* CODEF 사용량 (이번 달) — 원가 신호. 상세는 운영자 회원관리의 CODEF 탭 */}
          <div className="glass-card p-0 overflow-hidden">
            <div className="platform-card-head">
              <span className="platform-card-title">CODEF 사용량 <span className="text-[10px] font-normal text-[var(--text-dim)]">이번 달</span></span>
              <Link href="/platform/codef-usage" className="text-[11px] text-[var(--primary)] hover:underline">상세 →</Link>
            </div>
            <div className="platform-rail-stats">
              <div><span className="mono-number font-extrabold text-[var(--primary)]">{(codefUsage?.total?.units ?? 0).toLocaleString()}</span><span>과금 추정</span></div>
              <div><span className="mono-number font-extrabold text-[var(--text)]">{(codefUsage?.total?.calls ?? 0).toLocaleString()}</span><span>전체 호출</span></div>
              <div><span className="mono-number font-extrabold text-[var(--text)]">{codefUsage?.companies?.length ?? 0}</span><span>사용 회사</span></div>
            </div>
            {codefUsage && Object.keys(codefUsage.byCategory).length > 0 && (
              <div className="platform-codef-tags">
                {CODEF_CATEGORY_ORDER.filter((c) => codefUsage.byCategory[c]?.units).map((c) => (
                  <span key={c} className="codef-usage-cat-tag">
                    {c} <b>{codefUsage.byCategory[c].units.toLocaleString()}</b>
                  </span>
                ))}
              </div>
            )}
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
function RecentCompanies({ companies, filter, onFilter, activityById, nowMs }: {
  companies: any[];
  filter: "all" | "paid" | "trial" | "free" | "new" | "expired";
  onFilter: (f: "all" | "paid" | "trial" | "free" | "new" | "expired") => void;
  activityById: Map<string, CompanyActivity>;
  nowMs: number;
}) {
  // 행 어디를 눌러도 상세로 — 기존엔 회사명 글자만 링크라 "눌러도 아무것도 안 나온다"는 제보 (2026-07-28)
  const router = useRouter();
  // 명칭 정리(2026-07-28 사장님): "무료 vs 체험" 구분이 안 됨 → 미구독(카드 미등록) /
  //   체험 D-n(카드 등록, 남은 일수) / 플랜명. kind 는 필터 매칭용(라벨 문자열 비교 제거).
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
        <table className="w-full min-w-[680px] text-xs">
          <thead>
            <tr className="table-head-row">
              <th className="th-cell text-left">회사</th>
              <th className="th-cell text-left">사업자번호</th>
              <th className="th-cell text-center">인원</th>
              <th className="th-cell text-center">이용</th>
              <th className="th-cell text-left">활동</th>
              <th className="th-cell text-left">가입</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--text-dim)]">해당하는 가입사가 없습니다</td></tr>
            ) : rows.map((c) => {
              const p = planOf(c);
              // 활동 표시 — 10분 내 활동이면 "활동중", 아니면 마지막 로그인(없으면 마지막 활동) 시각
              const act = activityById.get(c.id);
              const isActive = !!act?.last_activity && nowMs - new Date(act.last_activity).getTime() < ACTIVE_WINDOW_MS;
              const lastSeen = act?.last_login || act?.last_activity;
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
                  <td className="px-3 py-2">
                    {isActive ? (
                      <span className="platform-active-badge" title={`마지막 활동 ${fmtKst(act!.last_activity!)}`}>
                        <span className="platform-active-dot" />활동중
                      </span>
                    ) : lastSeen ? (
                      <span className="text-[var(--text-muted)] mono-number" title={act?.last_login ? "마지막 로그인" : "마지막 활동"}>{fmtKst(lastSeen)}</span>
                    ) : (
                      <span className="text-[var(--text-dim)]">기록 없음</span>
                    )}
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
