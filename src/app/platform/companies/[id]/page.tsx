"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

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

export default function PlatformCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading, error } = useQuery({
    queryKey: ["p-company-overview", id],
    queryFn: async () => {
      const { data, error } = await db.rpc("get_company_overview", { p_company_id: id });
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
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
            {plan.name || plan.slug || "Free"} · {sub?.status || "—"}
          </span>
        )}
      </div>

      {/* 핵심 지표 */}
      <div className="platform-company-kpi-grid">
        {[
          { label: "사용자", value: `${data.user_count}명`, sub: `관리자 ${data.admin_count} · 직원 ${data.employee_count}` },
          { label: "딜", value: `${data.deals_count}개`, sub: `진행중 ${data.deals_active_count}` },
          { label: "통장 거래", value: `${data.bank_tx_count.toLocaleString()}건`, sub: `카드 ${data.card_tx_count.toLocaleString()}건` },
          { label: "누적 결제", value: fmtW(Number(data.paid_invoices_total || 0)), sub: `${data.paid_invoices_count}건` },
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
            {data.errors_24h}건
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

      {/* 구독 상세 */}
      {sub && (
        <div className="platform-company-subscription-card glass-card">
          <h3 className="section-title text-[var(--text)]">구독 상세</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--text-dim)]">상태</div>
              <div className="text-[var(--text)] font-semibold mt-0.5">{sub.status || "—"}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--text-dim)]">좌석 수</div>
              <div className="text-[var(--text)] font-semibold mt-0.5">{sub.seat_count ?? 1}명</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--text-dim)]">기간 종료</div>
              <div className="text-[var(--text)] font-semibold mt-0.5">{sub.current_period_end ? fmtDate(sub.current_period_end) : "—"}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-surface)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--text-dim)]">월 요금 (base+seat)</div>
              <div className="text-[var(--text)] font-semibold mt-0.5 mono-number">
                {plan ? fmtW((plan.base_price || 0) + (plan.per_seat_price || 0) * (sub.seat_count || 1)) : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 운영자 안내 */}
      <div className="kpi-callout">
        <b>OP-B</b> · 회사 드릴다운은 읽기 전용입니다.
        impersonate(다른 회사로 로그인)는 정책상 비활성 — 데이터 변경은 회사 owner를 통해 진행하세요.
        이 페이지 조회는 후속 PR-F의 감사 로그에 자동 기록 예정.
      </div>
    </div>
  );
}
