"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// 고객사 상세 — 운영 콕핏. 조회 + 실제 관리 액션:
//   멤버: 비밀번호/재설정링크/이메일/역할/잠금 (PlatformMemberActions 공용 패널)
//   구독: 플랜 변경 · 체험 연장 · 상태 변경 · 좌석 조정 (Stripe/Toss 연동 구독은 차단)

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { platformAdminAction, type AdminActionPayload } from "@/lib/platform-admin";
import { PlatformMemberActions, PLATFORM_ROLE_META } from "@/components/platform-member-actions";

const db = supabase;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

const SUB_STATUS_META: Record<string, string> = {
  active: "활성",
  trialing: "체험중",
  paused: "일시중지",
  canceled: "해지",
  past_due: "미납",
};

type PlanRow = { id: string; slug: string; name: string; base_price: number | null; per_seat_price: number | null };
type CompanyMember = { id: string; name: string | null; email: string; role: string | null; created_at: string | null };

export default function PlatformCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [subPending, setSubPending] = useState<string | null>(null);
  const [subError, setSubError] = useState("");
  const [seatsDraft, setSeatsDraft] = useState("");
  const [trialDays, setTrialDays] = useState("14");

  const { data, isLoading, error } = useQuery({
    queryKey: ["p-company-overview", id],
    queryFn: async () => {
      const { data, error } = await db.rpc("get_company_overview", { p_company_id: id });
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  // 회사 소속 멤버 — 계정 지원 액션 대상
  const { data: companyMembers = [] } = useQuery<CompanyMember[]>({
    queryKey: ["p-company-members", id],
    queryFn: async () => {
      const rows = logRead("platform/company:members", await db
        .from("users")
        .select("id, name, email, role, created_at")
        .eq("company_id", id)
        .order("created_at", { ascending: true }));
      return (rows || []) as CompanyMember[];
    },
    enabled: !!id,
  });

  const { data: plans = [] } = useQuery<PlanRow[]>({
    queryKey: ["p-plans"],
    queryFn: async () => {
      const rows = logRead("platform/company:plans", await db
        .from("subscription_plans")
        .select("id, slug, name, base_price, per_seat_price")
        .order("base_price", { ascending: true }));
      return (rows || []) as PlanRow[];
    },
  });

  // OP-F: 회사 드릴다운 진입 자동 기록 (감사 로그)
  useEffect(() => {
    if (!id) return;
    db.rpc("operator_log_action", {
      p_action: "view_company",
      p_target_type: "company",
      p_target_id: id,
      p_context: null,
    }).then(() => {});
  }, [id]);

  const runSub = async (payload: AdminActionPayload, confirmMsg: string) => {
    if (!(await appConfirm(confirmMsg))) return;
    setSubPending(payload.action);
    setSubError("");
    try {
      const res = await platformAdminAction({ ...payload, companyId: id });
      if (res.error) { setSubError(res.error); return; }
      qc.invalidateQueries({ queryKey: ["p-company-overview", id] });
    } finally {
      setSubPending(null);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl">
        <div className="text-sm text-[var(--text-dim)]">불러오는 중…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl">
        <div className="glass-card p-6">
          <h2 className="text-lg font-bold text-[var(--danger)] mb-2">조회 실패</h2>
          <p className="text-sm text-[var(--text-muted)]">{(error as any)?.message || "회사를 찾을 수 없습니다"}</p>
          <Link href="/platform/customers" className="inline-block mt-4 text-sm text-[var(--primary)] hover:underline">← 고객사 목록</Link>
        </div>
      </div>
    );
  }

  const c = data.company || {};
  const sub = data.subscription;
  const plan = sub?.plan;
  const hasBilling = !!(sub?.stripe_subscription_id || sub?.toss_billing_key);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/platform/customers" className="text-xs text-[var(--primary)] hover:underline">← 고객사 목록</Link>
      </div>

      {/* 헤더 */}
      <div className="platform-company-header">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">{c.name || "—"}</h1>
          <div className="mt-1 text-sm text-[var(--text-muted)] flex flex-wrap items-center gap-3">
            {c.business_number && <span>사업자 {c.business_number}</span>}
            {c.industry ? <span>업종: {c.industry}</span> : <span className="text-[var(--warning)]">업종 미분류</span>}
            <span>가입 {fmtDate(c.created_at)}</span>
          </div>
        </div>
        {plan && (
          <span className={`platform-company-plan-badge ${
            plan.slug === "business" || plan.slug === "pro"
              ? "bg-[var(--primary-light)] text-[var(--primary)]"
              : plan.slug === "starter"
              ? "bg-[var(--info-dim)] text-[var(--info)]"
              : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}>
            {plan.name || plan.slug || "Free"} · {SUB_STATUS_META[sub?.status] || sub?.status || "—"}
          </span>
        )}
      </div>

      {/* 핵심 지표 */}
      <div className="platform-company-kpi-grid">
        {[
          { label: "사용자", value: `${Number(data.user_count || 0)}명`, sub: `관리자 ${Number(data.admin_count || 0)} · 직원 ${Number(data.employee_count || 0)}` },
          { label: "딜", value: `${Number(data.deals_count || 0)}개`, sub: `진행중 ${Number(data.deals_active_count || 0)}` },
          { label: "통장 거래", value: `${Number(data.bank_tx_count || 0).toLocaleString()}건`, sub: `카드 ${Number(data.card_tx_count || 0).toLocaleString()}건` },
          { label: "누적 결제", value: fmtW(Number(data.paid_invoices_total || 0)), sub: `${Number(data.paid_invoices_count || 0)}건` },
        ].map((kpi) => (
          <div key={kpi.label} className="platform-company-kpi-card glass-card">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{kpi.label}</span>
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{kpi.value}</span>
            <div className="text-[11px] text-[var(--text-dim)]">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* 운영 지표 */}
      <div className="platform-company-ops-grid">
        <div className="platform-company-errors-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">24시간 에러</span>
          <div className={`text-[26px] leading-8 font-extrabold mono-number ${data.errors_24h > 50 ? "text-[var(--danger)]" : data.errors_24h > 10 ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
            {Number(data.errors_24h || 0)}건
          </div>
          <Link href="/platform/errors" className="text-[11px] text-[var(--primary)] hover:underline inline-block">
            전체 에러 해석 →
          </Link>
        </div>
        <div className="platform-company-last-login-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">마지막 로그인</span>
          <div className="text-xl leading-8 font-extrabold text-[var(--text)]">{data.last_login_at ? fmtDate(data.last_login_at) : "—"}</div>
          <div className="text-[11px] text-[var(--text-dim)]">회사 내 모든 사용자 중 최근값</div>
        </div>
      </div>

      {/* 구독 관리 */}
      <div className="platform-company-subscription-card glass-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title text-[var(--text)] !mb-0">구독 관리</h3>
          {hasBilling && (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--warning-dim)] text-[var(--warning)]">
              {sub?.stripe_subscription_id ? "Stripe" : "Toss"} 결제 연동 — 변경은 결제사 대시보드에서
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
          <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--text-dim)]">상태</div>
            <div className="text-[var(--text)] font-semibold mt-0.5">{SUB_STATUS_META[sub?.status] || sub?.status || "구독 없음"}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--text-dim)]">좌석 수</div>
            <div className="text-[var(--text)] font-semibold mt-0.5">{sub?.seat_count ?? 1}명</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--text-dim)]">체험 종료</div>
            <div className="text-[var(--text)] font-semibold mt-0.5">{c.trial_ends_at ? fmtDate(c.trial_ends_at) : "—"}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--text-dim)]">월 요금 (base+seat)</div>
            <div className="text-[var(--text)] font-semibold mt-0.5 mono-number">
              {plan ? fmtW((plan.base_price || 0) + (plan.per_seat_price || 0) * (sub?.seat_count || 1)) : "—"}
            </div>
          </div>
        </div>

        {!hasBilling && (
          <div className="platform-sub-admin-controls">
            {/* 플랜 변경 */}
            <div className="platform-admin-action-group">
              <div className="platform-admin-action-group-title">플랜 변경</div>
              <div className="flex flex-wrap gap-2">
                {plans.map((p) => (
                  <button
                    key={p.slug}
                    onClick={() => sub?.plan_slug !== p.slug && runSub({ action: "change-plan", planSlug: p.slug }, `${c.name} 의 플랜을 ${p.name}(으)로 변경할까요?`)}
                    disabled={subPending === "change-plan"}
                    className={`seg-item !rounded-lg border border-[var(--border)] ${sub?.plan_slug === p.slug ? "seg-item-active" : ""}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 체험 연장 */}
            <div className="platform-admin-action-group">
              <div className="platform-admin-action-group-title">체험 연장</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="field-input w-24"
                />
                <span className="text-xs text-[var(--text-muted)]">일</span>
                <button
                  onClick={() => runSub({ action: "extend-trial", days: Number(trialDays) }, `${c.name} 의 체험 기간을 ${trialDays}일 연장할까요?`)}
                  disabled={subPending === "extend-trial" || !Number(trialDays)}
                  className="btn-secondary text-xs"
                >
                  {subPending === "extend-trial" ? "연장 중…" : "연장"}
                </button>
              </div>
            </div>

            {/* 구독 상태 */}
            <div className="platform-admin-action-group">
              <div className="platform-admin-action-group-title">구독 상태</div>
              <div className="seg-bar">
                {(["active", "trialing", "paused", "canceled"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => sub?.status !== s && runSub({ action: "set-subscription-status", status: s }, `구독 상태를 ${SUB_STATUS_META[s]}(으)로 변경할까요?`)}
                    disabled={subPending === "set-subscription-status" || !sub}
                    className={`seg-item ${sub?.status === s ? "seg-item-active" : ""}`}
                  >
                    {SUB_STATUS_META[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* 좌석 조정 */}
            <div className="platform-admin-action-group">
              <div className="platform-admin-action-group-title">좌석 조정</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={seatsDraft}
                  onChange={(e) => setSeatsDraft(e.target.value)}
                  placeholder={String(sub?.seat_count ?? 1)}
                  className="field-input w-24"
                />
                <span className="text-xs text-[var(--text-muted)]">명</span>
                <button
                  onClick={() => runSub({ action: "set-seats", seats: Number(seatsDraft) }, `좌석을 ${seatsDraft}명으로 변경할까요?`)}
                  disabled={subPending === "set-seats" || !Number(seatsDraft) || !sub}
                  className="btn-secondary text-xs"
                >
                  {subPending === "set-seats" ? "변경 중…" : "변경"}
                </button>
              </div>
            </div>
          </div>
        )}

        {subError && <div className="text-xs text-[var(--danger)] font-medium mt-3">{subError}</div>}
      </div>

      {/* 멤버 관리 */}
      <div className="platform-company-members-card glass-card">
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text)]">멤버 관리</h3>
          <span className="text-xs text-[var(--text-dim)]">{companyMembers.length}명</span>
        </div>
        {companyMembers.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--text-dim)]">멤버가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {companyMembers.map((m) => {
              const role = PLATFORM_ROLE_META[m.role || ""] || PLATFORM_ROLE_META.employee;
              const open = expandedMember === m.id;
              return (
                <div key={m.id}>
                  <button
                    onClick={() => setExpandedMember(open ? null : m.id)}
                    className="platform-member-row"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {(m.name || m.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="font-semibold text-sm text-[var(--text)] truncate">{m.name || "(이름 없음)"}</div>
                        <div className="text-xs text-[var(--text-dim)] truncate">{m.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${role.cls}`}>{role.label}</span>
                      <svg className={`w-4 h-4 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </button>
                  {open && (
                    <PlatformMemberActions
                      member={m}
                      onChanged={() => {
                        qc.invalidateQueries({ queryKey: ["p-company-members", id] });
                        qc.invalidateQueries({ queryKey: ["p-company-overview", id] });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 운영자 안내 */}
      <div className="kpi-callout">
        <b>운영자 콕핏</b> · 계정 지원(비밀번호·이메일·잠금·역할)과 구독 관리(플랜·체험·상태·좌석)를 이 화면에서 직접 실행합니다.
        모든 조치는 감사로그에 기록됩니다. impersonate(다른 회사로 로그인)는 정책상 비활성.
      </div>
    </div>
  );
}
