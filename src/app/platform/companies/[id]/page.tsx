"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// 고객사 상세 — 운영 콕핏. 조회 + 실제 관리 액션:
//   멤버: 비밀번호/재설정링크/이메일/역할/잠금 (PlatformMemberActions 공용 패널)
//   구독: 플랜 변경 · 체험 연장 · 상태 변경 · 좌석 조정 (Stripe/Toss 연동 구독은 차단)
// 운영자 페이지 v2 (2026-09-03): 고객 프로필 카드 + KPI 타일 + 활동 링 차트. 조회·액션은 종전 그대로.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { platformAdminAction, type AdminActionPayload } from "@/lib/platform-admin";
import { PlatformMemberActions, PLATFORM_ROLE_META } from "@/components/platform-member-actions";
import { PfPage, PfCard, PfCardHead, PfCardBody, PfKpi, PfKpiKrw, PfBadge, PfSkeleton, PfEmpty, PfIn } from "@/app/platform/_components/pf/ui";
import { PfRings, PfGauge } from "@/app/platform/_components/pf/charts";

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

/** "3일 전" 같은 상대 시각 — 비전공자용 */
function fmtAgo(s: string | null | undefined): string {
  if (!s) return "기록 없음";
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return `${Math.floor(d / 30)}개월 전`;
}

const SUB_STATUS_META: Record<string, string> = {
  active: "활성",
  trialing: "체험중",
  paused: "일시중지",
  canceled: "해지",
  past_due: "미납",
};
const SUB_STATUS_TONE: Record<string, "ok" | "info" | "muted" | "danger" | "warn"> = {
  active: "ok", trialing: "info", paused: "muted", canceled: "danger", past_due: "warn",
};
const ROLE_TONE: Record<string, "info" | "ok" | "muted" | "warn"> = { owner: "info", admin: "ok", employee: "muted", partner: "warn" };

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
      <PfPage>
        <PfCard hover={false} pad><PfSkeleton rows={3} h={22} /></PfCard>
        <div className="pf-kpi-grid">
          {[1, 2, 3, 4].map((k) => <div key={k} className="pf-kpi-tile"><PfSkeleton rows={2} h={20} /></div>)}
        </div>
        <PfCard hover={false} pad><PfSkeleton rows={5} h={16} /></PfCard>
      </PfPage>
    );
  }

  if (error || !data) {
    return (
      <PfPage>
        <PfCard hover={false} pad i={0}>
          <h2 className="text-lg font-bold text-[var(--danger)] mb-2">회사를 불러오지 못했습니다</h2>
          <p className="text-sm text-[var(--text-muted)]">{(error as any)?.message || "회사를 찾을 수 없습니다"}</p>
          <Link href="/platform/customers" className="pf-btn pf-btn-sm mt-4 inline-flex">← 고객사 목록</Link>
        </PfCard>
      </PfPage>
    );
  }

  const c = data.company || {};
  const sub = data.subscription;
  const plan = sub?.plan;
  const hasBilling = !!(sub?.stripe_subscription_id || sub?.toss_billing_key);
  const seatCount = Number(sub?.seat_count ?? 1);
  const userCount = Number(data.user_count || 0);
  const seatPct = seatCount > 0 ? Math.round((userCount / seatCount) * 100) : 0;
  const errors24h = Number(data.errors_24h || 0);
  const monthlyFee = plan ? (plan.base_price || 0) + (plan.per_seat_price || 0) * seatCount : 0;
  const lastActivity = data.last_login_at as string | null;
  const activeRecently = !!lastActivity && Date.now() - new Date(lastActivity).getTime() < 24 * 3600 * 1000;

  return (
    <PfPage>
      <PfIn i={0}>
        <Link href="/platform/customers" className="pf-btn pf-btn-ghost pf-btn-sm">← 고객사 목록</Link>
      </PfIn>

      {/* 고객 프로필 */}
      <PfCard i={1} dark hover={false}>
        <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black text-white shrink-0" style={{ background: "linear-gradient(135deg, var(--primary), #7C3AED)", boxShadow: "0 12px 30px -12px var(--primary)" }}>
              {(c.name || "?").charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-black tracking-tight truncate">{c.name || "—"}</h1>
                {plan ? (
                  <PfBadge tone={SUB_STATUS_TONE[sub?.status] || "muted"}>{plan.name || plan.slug || "무료"} · {SUB_STATUS_META[sub?.status] || sub?.status || "—"}</PfBadge>
                ) : (
                  <PfBadge tone="muted">구독 없음</PfBadge>
                )}
              </div>
              <div className="mt-1.5 text-[12px] text-slate-300/80 flex flex-wrap items-center gap-x-3 gap-y-1">
                {c.business_number && <span>사업자번호 {c.business_number}</span>}
                {c.industry ? <span>업종 {c.industry}</span> : <span className="text-amber-300">업종 미분류</span>}
                <span>가입 {fmtDate(c.created_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6 shrink-0">
            <div className="flex flex-col">
              <span className="text-[11px] text-slate-300/70 font-semibold"><span className={`pf-live mr-1.5 align-middle ${activeRecently ? "" : "pf-live-off"}`} />마지막 활동</span>
              <span className="text-lg font-extrabold">{fmtAgo(lastActivity)}</span>
              <span className="text-[10.5px] text-slate-300/60">{lastActivity ? fmtDate(lastActivity) : "회사 내 사용자 로그인 기록 없음"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] text-slate-300/70 font-semibold">월 요금</span>
              <span className="text-lg font-extrabold mono-number">{plan ? fmtW(monthlyFee) : "—"}</span>
              <span className="text-[10.5px] text-slate-300/60">기본 + 좌석 {seatCount}명</span>
            </div>
          </div>
        </div>
      </PfCard>

      {/* 핵심 지표 */}
      <div className="pf-kpi-grid">
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 2 }}>
          <PfKpi label="사용자" value={userCount} unit="명" accent />
          <div className="text-[11px] text-[var(--text-dim)]">관리자 {Number(data.admin_count || 0)} · 직원 {Number(data.employee_count || 0)}</div>
        </div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 3 }}>
          <PfKpi label="프로젝트(딜)" value={Number(data.deals_count || 0)} unit="개" />
          <div className="text-[11px] text-[var(--text-dim)]">진행 중 {Number(data.deals_active_count || 0)}개</div>
        </div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 4 }}>
          <PfKpi label="통장 거래" value={Number(data.bank_tx_count || 0)} unit="건" />
          <div className="text-[11px] text-[var(--text-dim)]">카드 {Number(data.card_tx_count || 0).toLocaleString()}건</div>
        </div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 5 }}>
          <PfKpiKrw label="누적 결제" value={Number(data.paid_invoices_total || 0)} />
          <div className="text-[11px] text-[var(--text-dim)]">{Number(data.paid_invoices_count || 0)}건</div>
        </div>
      </div>

      {/* 활동·상태 시각화 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PfCard i={6} className="lg:col-span-2">
          <PfCardHead title="이 회사의 활동" sub="사용자·프로젝트·거래가 얼마나 쌓였는지 — 바깥 링부터 사용자, 프로젝트, 통장 거래, 카드 거래" />
          <PfCardBody>
            <PfRings
              items={[
                { label: "사용자 (좌석 대비)", value: userCount, max: Math.max(seatCount, userCount, 1) },
                { label: "진행 중 프로젝트 (전체 대비)", value: Number(data.deals_active_count || 0), max: Math.max(Number(data.deals_count || 0), 1) },
                { label: "통장 거래", value: Number(data.bank_tx_count || 0), max: Math.max(Number(data.bank_tx_count || 0) + Number(data.card_tx_count || 0), 1) },
                { label: "카드 거래", value: Number(data.card_tx_count || 0), max: Math.max(Number(data.bank_tx_count || 0) + Number(data.card_tx_count || 0), 1) },
              ]}
              size={190}
              centerLabel="거래 합계"
              formatCenter={() => (Number(data.bank_tx_count || 0) + Number(data.card_tx_count || 0)).toLocaleString("ko-KR")}
            />
          </PfCardBody>
        </PfCard>
        <PfCard i={7}>
          <PfCardHead title="건강 상태" sub="좌석 사용률과 최근 24시간 오류" href="/platform/errors" action="오류 보기 →" />
          <PfCardBody>
            <div className="flex flex-col items-center gap-4">
              <PfGauge pct={Math.min(100, seatPct)} label="좌석 사용률" width={170} tone={seatPct > 100 ? "danger" : seatPct >= 90 ? "warn" : "ok"} />
              <div className="w-full flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "var(--bg-surface)" }}>
                <span className="text-[12px] font-semibold text-[var(--text-muted)]">24시간 오류</span>
                <span className="flex items-center gap-2">
                  <span className={`text-lg font-extrabold mono-number ${errors24h > 50 ? "text-[var(--danger)]" : errors24h > 10 ? "text-[#b45309]" : "text-[var(--success)]"}`}>{errors24h}건</span>
                  <PfBadge tone={errors24h > 50 ? "danger" : errors24h > 10 ? "warn" : "ok"}>{errors24h > 50 ? "심각" : errors24h > 10 ? "주의" : "정상"}</PfBadge>
                </span>
              </div>
              {seatPct > 100 && <div className="text-[11px] text-[var(--danger)] font-semibold">좌석보다 사용자가 많습니다 — 좌석 조정이 필요해요</div>}
            </div>
          </PfCardBody>
        </PfCard>
      </div>

      {/* 구독 관리 */}
      <PfCard i={8} hover={false}>
        <PfCardHead
          title="구독 관리"
          sub="요금제·체험 기간·상태·좌석을 여기서 바로 바꿉니다"
          right={hasBilling ? <PfBadge tone="warn">{sub?.stripe_subscription_id ? "Stripe" : "Toss"} 결제 연동 — 변경은 결제사 화면에서</PfBadge> : undefined}
        />
        <PfCardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
            {[
              { l: "상태", v: SUB_STATUS_META[sub?.status] || sub?.status || "구독 없음" },
              { l: "좌석 수", v: `${seatCount}명` },
              { l: "체험 종료", v: c.trial_ends_at ? fmtDate(c.trial_ends_at) : "—" },
              { l: "월 요금 (기본 + 좌석)", v: plan ? fmtW(monthlyFee) : "—" },
            ].map((x) => (
              <div key={x.l} className="rounded-xl px-3 py-2.5" style={{ background: "var(--bg-surface)" }}>
                <div className="text-[11px] text-[var(--text-dim)]">{x.l}</div>
                <div className="text-[var(--text)] font-semibold mt-0.5 mono-number">{x.v}</div>
              </div>
            ))}
          </div>

          {!hasBilling && (
            <div className="space-y-4 pt-4 border-t border-[var(--border)]/60">
              {/* 플랜 변경 */}
              <div>
                <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">요금제 변경</div>
                <div className="flex flex-wrap gap-2">
                  {plans.map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => sub?.plan_slug !== p.slug && runSub({ action: "change-plan", planSlug: p.slug }, `${c.name} 의 플랜을 ${p.name}(으)로 변경할까요?`)}
                      disabled={subPending === "change-plan"}
                      className={`pf-chip ${sub?.plan_slug === p.slug ? "pf-chip-on" : ""}`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 체험 연장 */}
              <div>
                <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">체험 기간 연장</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className="field-input w-24" />
                  <span className="text-xs text-[var(--text-muted)]">일</span>
                  <button
                    type="button"
                    onClick={() => runSub({ action: "extend-trial", days: Number(trialDays) }, `${c.name} 의 체험 기간을 ${trialDays}일 연장할까요?`)}
                    disabled={subPending === "extend-trial" || !Number(trialDays)}
                    className="pf-btn pf-btn-sm"
                  >
                    {subPending === "extend-trial" ? "연장 중…" : "연장"}
                  </button>
                </div>
              </div>

              {/* 구독 상태 */}
              <div>
                <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">구독 상태</div>
                <div className="pf-seg">
                  {(["active", "trialing", "paused", "canceled"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => sub?.status !== s && runSub({ action: "set-subscription-status", status: s }, `구독 상태를 ${SUB_STATUS_META[s]}(으)로 변경할까요?`)}
                      disabled={subPending === "set-subscription-status" || !sub}
                      className={`pf-seg-item ${sub?.status === s ? "pf-seg-item-on" : ""}`}
                    >
                      {SUB_STATUS_META[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 좌석 조정 */}
              <div>
                <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">좌석 조정</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={1} max={500} value={seatsDraft} onChange={(e) => setSeatsDraft(e.target.value)} placeholder={String(seatCount)} className="field-input w-24" />
                  <span className="text-xs text-[var(--text-muted)]">명</span>
                  <button
                    type="button"
                    onClick={() => runSub({ action: "set-seats", seats: Number(seatsDraft) }, `좌석을 ${seatsDraft}명으로 변경할까요?`)}
                    disabled={subPending === "set-seats" || !Number(seatsDraft) || !sub}
                    className="pf-btn pf-btn-sm"
                  >
                    {subPending === "set-seats" ? "변경 중…" : "변경"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {subError && <div className="text-xs text-[var(--danger)] font-medium mt-3">{subError}</div>}
        </PfCardBody>
      </PfCard>

      {/* 멤버 관리 */}
      <PfCard i={9} hover={false}>
        <PfCardHead title="구성원" sub={`${companyMembers.length}명 — 행을 누르면 비밀번호·이메일·잠금·역할 조치가 펼쳐집니다`} />
        {companyMembers.length === 0 ? (
          <PfEmpty>구성원이 없습니다</PfEmpty>
        ) : (
          <div className="pf-rows">
            {companyMembers.map((m) => {
              const role = PLATFORM_ROLE_META[m.role || ""] || PLATFORM_ROLE_META.employee;
              const open = expandedMember === m.id;
              return (
                <div key={m.id}>
                  <button type="button" onClick={() => setExpandedMember(open ? null : m.id)} className="pf-row w-full text-left">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: "linear-gradient(135deg, var(--primary), #7C3AED)" }}>
                      {(m.name || m.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="pf-row-title">{m.name || "(이름 없음)"}</div>
                      <div className="pf-row-sub">{m.email}</div>
                    </div>
                    <span className="hidden sm:block text-[11px] text-[var(--text-dim)] mono-number">{m.created_at ? `가입 ${new Date(m.created_at).toLocaleDateString("ko-KR")}` : ""}</span>
                    <PfBadge tone={ROLE_TONE[m.role || ""] || "muted"}>{role.label}</PfBadge>
                    <svg className={`w-4 h-4 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
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
      </PfCard>

      {/* 운영자 안내 */}
      <PfIn i={10}>
        <div className="text-[11px] text-[var(--text-dim)] px-1">
          이 화면에서 한 조치(계정 지원·구독 변경)는 모두 감사 기록에 남습니다. 다른 회사 계정으로 대신 로그인하는 기능은 정책상 제공하지 않습니다.
        </div>
      </PfIn>
    </PfPage>
  );
}
