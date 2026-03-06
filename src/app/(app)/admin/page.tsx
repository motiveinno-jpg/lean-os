"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useRouter } from "next/navigation";

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase as any;

type Tab = "overview" | "customers" | "revenue" | "feedback" | "referral";

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  trialing: { bg: "bg-blue-100", text: "text-blue-700", label: "체험중" },
  active: { bg: "bg-green-100", text: "text-green-700", label: "활성" },
  past_due: { bg: "bg-yellow-100", text: "text-yellow-700", label: "미납" },
  canceled: { bg: "bg-red-100", text: "text-red-700", label: "해지" },
  paused: { bg: "bg-gray-100", text: "text-gray-700", label: "일시중지" },
};

const FB_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-yellow-100", text: "text-yellow-700", label: "접수" },
  reviewed: { bg: "bg-blue-100", text: "text-blue-700", label: "검토중" },
  planned: { bg: "bg-purple-100", text: "text-purple-700", label: "계획" },
  in_progress: { bg: "bg-indigo-100", text: "text-indigo-700", label: "진행중" },
  done: { bg: "bg-green-100", text: "text-green-700", label: "완료" },
  rejected: { bg: "bg-red-100", text: "text-red-700", label: "거절" },
};

const FB_CATEGORY: Record<string, string> = {
  feature_request: "기능 요청",
  bug_report: "버그 제보",
  ux_improvement: "UX 개선",
  general: "일반",
  billing: "결제",
};

export default function AdminPage() {
  const router = useRouter();
  const { role } = useUser();
  const [tab, setTab] = useState<Tab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const qc = useQueryClient();

  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const { user: ctxUser } = useUser();

  // 어드민 접근 제어: 모티브이노베이션 owner만 접근 가능
  const SUPER_ADMIN_COMPANY = "모티브이노베이션";
  const isSuperAdmin = role === "owner" && ctxUser?.companies?.name === SUPER_ADMIN_COMPANY;

  if (!isSuperAdmin) {
    return (
      <div className="p-8 text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-[var(--text)]">접근 권한이 없습니다</h2>
        <p className="text-sm text-[var(--text-muted)] mt-2">SaaS 관리자만 접근 가능합니다.</p>
      </div>
    );
  }

  // ── 데이터 쿼리 ──
  const { data: allCompanies } = useQuery({
    queryKey: ["admin-companies"],
    queryFn: async () => {
      const { data } = await db
        .from("companies")
        .select("*, users(count), subscriptions(*, subscription_plans(*))")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: allSubscriptions } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => {
      const { data } = await db
        .from("subscriptions")
        .select("*, subscription_plans(*), companies(name)")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: allInvoices } = useQuery({
    queryKey: ["admin-invoices"],
    queryFn: async () => {
      const { data } = await db
        .from("invoices")
        .select("*, companies(name)")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: allFeedback } = useQuery({
    queryKey: ["admin-feedback"],
    queryFn: async () => {
      const { data } = await db
        .from("feedback")
        .select("*, users(name, email), companies(name)")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: allReferrals } = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: async () => {
      const { data } = await db
        .from("referral_codes")
        .select("*, companies(name)")
        .order("referred_count", { ascending: false });
      return data || [];
    },
  });

  const { data: allUsers } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data } = await db.from("users").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  // 피드백 상태 변경
  const updateFbStatus = useMutation({
    mutationFn: async ({ id, status, adminNote }: { id: string; status: string; adminNote?: string }) => {
      const upd: any = { status, updated_at: new Date().toISOString() };
      if (adminNote !== undefined) upd.admin_note = adminNote;
      const { error } = await db.from("feedback").update(upd).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feedback"] }),
  });

  // ── 통계 계산 ──
  const totalCompanies = (allCompanies || []).length;
  const totalUsers = (allUsers || []).length;
  const activeSubscriptions = (allSubscriptions || []).filter((s: any) => s.status === "active" || s.status === "trialing").length;
  const paidSubscriptions = (allSubscriptions || []).filter((s: any) => s.status === "active" && s.subscription_plans?.slug !== "free").length;

  // MRR 계산
  const mrr = (allSubscriptions || [])
    .filter((s: any) => s.status === "active")
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans as any;
      if (!plan) return sum;
      return sum + plan.base_price + plan.per_seat_price * (s.seat_count || 1);
    }, 0);

  const paidInvoices = (allInvoices || []).filter((i: any) => i.status === "paid");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
  const conversionRate = totalCompanies > 0 ? ((paidSubscriptions / totalCompanies) * 100).toFixed(1) : "0";

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "overview", label: "개요", icon: "📊" },
    { key: "customers", label: "고객", icon: "🏢" },
    { key: "revenue", label: "매출", icon: "💰" },
    { key: "feedback", label: "피드백", icon: "💬" },
    { key: "referral", label: "추천", icon: "🎁" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">👑</span>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">SaaS 관리자</h1>
        </div>
        <p className="text-sm text-[var(--text-muted)]">REFLECT 서비스 전체 현황 관리</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition ${
              tab === t.key
                ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════ Overview ══════════════════════ */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "총 가입사", value: totalCompanies, icon: "🏢", color: "blue" },
              { label: "총 사용자", value: totalUsers, icon: "👥", color: "purple" },
              { label: "유료 구독", value: paidSubscriptions, icon: "💳", color: "green" },
              { label: "전환율", value: `${conversionRate}%`, icon: "📈", color: "amber" },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xl">{kpi.icon}</span>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">{kpi.label}</span>
                </div>
                <div className="text-3xl font-extrabold text-[var(--text)]">{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Revenue KPI */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-6 text-white">
              <div className="text-xs font-semibold opacity-80 mb-1">MRR (월간 반복 매출)</div>
              <div className="text-3xl font-extrabold">₩{fmtW(mrr)}</div>
              <div className="text-xs opacity-70 mt-1">ARR: ₩{fmtW(mrr * 12)}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-2xl p-6 text-white">
              <div className="text-xs font-semibold opacity-80 mb-1">총 매출 누적</div>
              <div className="text-3xl font-extrabold">₩{fmtW(totalRevenue)}</div>
              <div className="text-xs opacity-70 mt-1">{paidInvoices.length}건 결제 완료</div>
            </div>
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-2xl p-6 text-white">
              <div className="text-xs font-semibold opacity-80 mb-1">활성 구독</div>
              <div className="text-3xl font-extrabold">{activeSubscriptions}</div>
              <div className="text-xs opacity-70 mt-1">체험+유료 포함</div>
            </div>
          </div>

          {/* Recent activity */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h3 className="font-bold text-[var(--text)] mb-4">최근 가입</h3>
            <div className="space-y-3">
              {(allCompanies || []).slice(0, 5).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-surface)]">
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">{c.name}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {new Date(c.created_at).toLocaleDateString("ko-KR")} · {c.current_plan || "free"}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    c.current_plan === "business" ? "bg-purple-100 text-purple-700" :
                    c.current_plan === "starter" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {c.current_plan || "Free"}
                  </span>
                </div>
              ))}
              {(allCompanies || []).length === 0 && (
                <div className="text-center py-6 text-sm text-[var(--text-muted)]">아직 가입 고객이 없습니다</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ Customers ══════════════════════ */}
      {tab === "customers" && (
        <div>
          <div className="mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="회사명 또는 이메일 검색..."
              className="w-full max-w-md px-4 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">회사</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">플랜</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">상태</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">좌석</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">가입일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(allCompanies || [])
                    .filter((c: any) => !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((c: any) => {
                      const sub = c.subscriptions?.[0];
                      const plan = sub?.subscription_plans;
                      const st = STATUS_COLORS[sub?.status || "trialing"] || STATUS_COLORS.trialing;
                      return (
                        <tr key={c.id} className="hover:bg-[var(--bg-surface)] transition">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[var(--text)]">{c.name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold">{plan?.name || c.current_plan || "Free"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">{sub?.seat_count || 1}명</td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">
                            {new Date(c.created_at).toLocaleDateString("ko-KR")}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ Revenue ══════════════════════ */}
      {tab === "revenue" && (
        <div className="space-y-6">
          {/* Revenue summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="text-xs text-[var(--text-muted)] mb-1">이번 달 매출</div>
              <div className="text-2xl font-extrabold text-[var(--text)]">₩{fmtW(mrr)}</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="text-xs text-[var(--text-muted)] mb-1">결제 성공</div>
              <div className="text-2xl font-extrabold text-green-600">{paidInvoices.length}건</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="text-xs text-[var(--text-muted)] mb-1">미수금</div>
              <div className="text-2xl font-extrabold text-amber-600">
                ₩{fmtW((allInvoices || []).filter((i: any) => i.status === "pending").reduce((s: number, i: any) => s + (i.total_amount || 0), 0))}
              </div>
            </div>
          </div>

          {/* Invoice list */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text)]">전체 결제 내역</h3>
            </div>
            {(allInvoices || []).length === 0 ? (
              <div className="text-center py-12 text-sm text-[var(--text-muted)]">결제 내역이 없습니다</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {(allInvoices || []).map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-[var(--bg-surface)] transition">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        inv.status === "paid" ? "bg-green-500" : inv.status === "failed" ? "bg-red-500" : "bg-yellow-500"
                      }`} />
                      <div>
                        <div className="font-semibold text-sm text-[var(--text)]">{inv.companies?.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">{inv.invoice_number} · {inv.description || "구독 결제"}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm text-[var(--text)]">₩{(inv.total_amount || 0).toLocaleString()}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {new Date(inv.created_at).toLocaleDateString("ko-KR")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ Feedback ══════════════════════ */}
      {tab === "feedback" && (
        <div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
              <h3 className="font-bold text-[var(--text)]">고객 피드백 ({(allFeedback || []).length})</h3>
              <div className="flex gap-2 text-xs">
                {Object.entries(FB_STATUS).map(([key, val]) => {
                  const count = (allFeedback || []).filter((f: any) => f.status === key).length;
                  return count > 0 ? (
                    <span key={key} className={`px-2 py-0.5 rounded ${val.bg} ${val.text} font-semibold`}>
                      {val.label} {count}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
            {(allFeedback || []).length === 0 ? (
              <div className="text-center py-12 text-sm text-[var(--text-muted)]">피드백이 없습니다</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {(allFeedback || []).map((fb: any) => {
                  const st = FB_STATUS[fb.status] || FB_STATUS.pending;
                  return (
                    <div key={fb.id} className="p-4 hover:bg-[var(--bg-surface)] transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] font-medium">
                              {FB_CATEGORY[fb.category] || fb.category}
                            </span>
                          </div>
                          <div className="font-semibold text-sm text-[var(--text)]">{fb.title}</div>
                          {fb.description && <div className="text-xs text-[var(--text-muted)] mt-1">{fb.description}</div>}
                          <div className="text-xs text-[var(--text-dim)] mt-2">
                            {fb.companies?.name} · {fb.users?.name || fb.users?.email} · {new Date(fb.created_at).toLocaleDateString("ko-KR")}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {["reviewed", "planned", "done", "rejected"].map((s) => (
                            <button
                              key={s}
                              onClick={() => updateFbStatus.mutate({ id: fb.id, status: s })}
                              className={`px-2 py-1 rounded text-xs font-semibold transition ${
                                fb.status === s
                                  ? `${FB_STATUS[s]?.bg} ${FB_STATUS[s]?.text}`
                                  : "bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text)]"
                              }`}
                            >
                              {FB_STATUS[s]?.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ Referral ══════════════════════ */}
      {tab === "referral" && (
        <div className="space-y-6">
          {/* Referral summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="text-xs text-[var(--text-muted)] mb-1">총 추천 코드</div>
              <div className="text-2xl font-extrabold text-[var(--text)]">{(allReferrals || []).length}개</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="text-xs text-[var(--text-muted)] mb-1">총 추천 가입</div>
              <div className="text-2xl font-extrabold text-blue-600">
                {(allReferrals || []).reduce((s: number, r: any) => s + (r.referred_count || 0), 0)}명
              </div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="text-xs text-[var(--text-muted)] mb-1">총 지급 크레딧</div>
              <div className="text-2xl font-extrabold text-purple-600">
                ₩{fmtW((allReferrals || []).reduce((s: number, r: any) => s + (r.credit_earned || 0), 0))}
              </div>
            </div>
          </div>

          {/* Referral leaderboard */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text)]">추천인 랭킹 TOP 20</h3>
            </div>
            {(allReferrals || []).length === 0 ? (
              <div className="text-center py-12 text-sm text-[var(--text-muted)]">추천 코드가 없습니다</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {(allReferrals || []).slice(0, 20).map((r: any, i: number) => (
                  <div key={r.id} className="flex items-center justify-between p-4 hover:bg-[var(--bg-surface)] transition">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        i === 0 ? "bg-yellow-100 text-yellow-700" :
                        i === 1 ? "bg-gray-100 text-gray-600" :
                        i === 2 ? "bg-amber-100 text-amber-700" :
                        "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                      }`}>
                        {i + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-[var(--text)]">{r.companies?.name || "알 수 없음"}</div>
                        <div className="text-xs font-mono text-[var(--text-muted)]">{r.code}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm text-[var(--text)]">{r.referred_count || 0}명</div>
                      <div className="text-xs text-[var(--text-muted)]">₩{((r.credit_earned || 0)).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
