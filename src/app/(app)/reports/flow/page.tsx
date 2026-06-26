"use client";

import { useEffect, useState, useMemo } from "react";
import { MonthField } from "@/components/month-field";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { getTaxInvoiceSummary, getVATPreview, type PeriodSummary, type VATPreview } from "@/lib/tax-invoice";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getOrCreateChecklist } from "@/lib/closing";
import { CashPulseHeader } from "./_components/CashPulseHeader";
import { FlowTrend, type FlowLens } from "./_components/FlowTrend";
import { FlowSchedule } from "./_components/FlowSchedule";
import { FlowMatrix } from "./_components/FlowMatrix";

/* ------------------------------------------------------------------ */
/*  경영 흐름 — 매출 → 수금 → 비용 → 손익 → 세무 → 결산                 */
/*  5개 도메인(영업·자금·회계·세무·결산)을 월 단위 한 흐름으로 연결.     */
/*  전부 기존 집계 재사용(읽기 전용): tax-invoice / cash-budget /        */
/*  invoice_settlements / closing. 숫자는 각 원본 화면과 동일 소스라      */
/*  화면 간 불일치가 없다. DB 무변경.                                    */
/* ------------------------------------------------------------------ */

const db = supabase as any;

function fmtKrw(value: number): string {
  if (!value) return "0";
  const isNeg = value < 0;
  const abs = Math.abs(Math.round(value));
  return (isNeg ? "-" : "") + abs.toLocaleString("ko-KR");
}

/** YYYY-MM → [당월 1일, 익월 1일) — 월말 31일 하드코딩 금지 규칙 준수 */
function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ── 단계 카드 공통 — 상단 액센트 라인 + 단계 번호 칩 ── */
function StepCard({
  no, title, accent, links, children,
}: {
  no: number;
  title: string;
  accent: string;
  links: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card" style={{ padding: 18, position: "relative", overflow: "hidden" }}>
      {/* 단계 액센트 라인 — 흐름의 연속성을 색으로 표현 */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 25%, transparent))`,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div
          style={{
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent, fontSize: 13, fontWeight: 800,
          }}
        >
          {no}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {links.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            style={{
              fontSize: 11.5, fontWeight: 600, color: accent, textDecoration: "none",
              padding: "4px 10px", borderRadius: 999,
              background: `color-mix(in srgb, ${accent} 10%, transparent)`,
            }}
          >
            {l.label} →
          </Link>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{label}</span>
      <span className="mono-number" style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 600, color: color || "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

/* 진행률 미니 바 — 수금률·결산 진행률 시각화 */
function MiniBar({ pct, color, label }: { pct: number; color: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div style={{ margin: "6px 0 2px" }}>
      <div style={{ height: 6, borderRadius: 999, background: "var(--bg-surface)", overflow: "hidden" }}>
        <div style={{ width: `${clamped}%`, height: "100%", borderRadius: 999, background: color, transition: "width 0.4s ease" }} />
      </div>
      {label && (
        <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 4, textAlign: "right" }}>{label}</div>
      )}
    </div>
  );
}

export default function BusinessFlowPage() {
  const { role } = useUser();
  const blocked = role === "partner";

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [flowView, setFlowView] = useState<"cockpit" | "matrix" | "month">("month");
  const [lens, setLens] = useState<FlowLens>("income");
  const [pastN, setPastN] = useState(6);
  const [savedFlow, setSavedFlow] = useState(false);
  const [month, setMonth] = useState(thisMonth());
  const year = Number(month.split("-")[0]);
  const { start, end } = monthRange(month);

  useEffect(() => {
    if (blocked) return;
    getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } });
  }, [blocked]);

  // 개인화 설정 로드 (user_preferences.flow_settings)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const db = supabase as any;
      const { data } = await db.from("user_preferences").select("flow_settings").eq("user_id", userId).maybeSingle();
      const fs = data?.flow_settings;
      if (fs && typeof fs === "object") {
        if (fs.default_view === "cockpit" || fs.default_view === "matrix" || fs.default_view === "month") setFlowView(fs.default_view);
        if (fs.default_lens === "income" || fs.default_lens === "expense" || fs.default_lens === "net") setLens(fs.default_lens);
        if (fs.past_n === 6 || fs.past_n === 12) setPastN(fs.past_n);
      }
    })();
  }, [userId]);

  const saveFlowSettings = async () => {
    if (!userId || !companyId) return;
    const db = supabase as any;
    await db.from("user_preferences").upsert({
      user_id: userId, company_id: companyId,
      flow_settings: { default_view: flowView, default_lens: lens, past_n: pastN },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,company_id" });
    setSavedFlow(true);
    setTimeout(() => setSavedFlow(false), 2000);
  };

  /* ① 영업 파이프라인 — 진행중 딜 (deals, /projects 동일 소스) */
  const { data: pipeline } = useQuery({
    queryKey: ["flow-pipeline", companyId],
    queryFn: async () => {
      const { data } = await db.from("deals")
        .select("contract_total, stage")
        .eq("company_id", companyId)
        .eq("status", "active");
      const rows = (data || []) as { contract_total: number | null; stage: string | null }[];
      return {
        count: rows.length,
        total: rows.reduce((s, d) => s + Number(d.contract_total || 0), 0),
        settling: rows.filter((d) => d.stage === "settlement").length,
      };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  /* ①·④·⑤ 세금계산서 월별 집계 (tax-invoices 화면 동일 소스) */
  const { data: invoiceSummary = [] } = useQuery<PeriodSummary[]>({
    queryKey: ["flow-invoice-summary", companyId, year],
    queryFn: () => getTaxInvoiceSummary(companyId!, year, "monthly"),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const monthInv = invoiceSummary.find((s) => s.period === month);

  /* ② 당월 확정 수금 — invoice_settlements(confirmed) × 입금일 (거래처 원장 동일 소스) */
  const { data: settled } = useQuery({
    queryKey: ["flow-settled", companyId, month],
    queryFn: async () => {
      const { data } = await db.from("invoice_settlements")
        .select("amount, bank_transactions!inner(transaction_date)")
        .eq("company_id", companyId)
        .eq("status", "confirmed")
        .gte("bank_transactions.transaction_date", start)
        .lt("bank_transactions.transaction_date", end);
      const rows = (data || []) as { amount: number | null }[];
      return { count: rows.length, total: rows.reduce((s, r) => s + Number(r.amount || 0), 0) };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  /* ② 미수금 잔액 — 대시보드 요약 위젯과 동일 소스/조건 (화면 간 숫자 일치) */
  const { data: receivable } = useQuery({
    queryKey: ["flow-receivable", companyId],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices")
        .select("total_amount, issue_date")
        .eq("company_id", companyId)
        .eq("type", "sales") // 2026-06-11 미수금=매출 계산서만 (매입 혼입 차단)
        .in("status", ["issued", "sent", "pending", "overdue"]);
      const rows = (data || []) as { total_amount: number | null; issue_date: string | null }[];
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const total = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const over30 = rows
        .filter((r) => (r.issue_date || "") < cutoff)
        .reduce((s, r) => s + Number(r.total_amount || 0), 0);
      return { total, over30 };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  /* ③·④ 비용/손익 — cash-budget 월별 집계 (/reports/costs 동일 소스) */
  const { data: budget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["flow-budget", companyId, year],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const monthBudget = budget.find((b) => b.month === month);
  const monthNet = monthBudget ? monthBudget.incomeTotal - monthBudget.expenseTotal : 0;

  /* ⑤ 부가세 — 해당 분기 미리보기 (tax-invoices VAT 탭 동일 소스) */
  const { data: vat = [] } = useQuery<VATPreview[]>({
    queryKey: ["flow-vat", companyId, year],
    queryFn: () => getVATPreview(companyId!, year),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const quarter = `${year}-Q${Math.ceil(Number(month.split("-")[1]) / 3)}`;
  const monthVat = vat.find((v) => v.quarter === quarter);
  const vatDday = useMemo(() => {
    if (!monthVat?.dueDate) return null;
    const diff = Math.ceil((new Date(monthVat.dueDate).getTime() - Date.now()) / (24 * 3600 * 1000));
    return diff;
  }, [monthVat]);

  /* ⑥ 월결산 체크리스트 (대시보드 월결산 위젯 동일 소스) */
  const { data: checklist } = useQuery({
    queryKey: ["flow-closing", companyId, month],
    queryFn: () => getOrCreateChecklist(companyId!, month),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const closing = useMemo(() => {
    if (!checklist) return null;
    const items = (checklist.items || []) as { is_required: boolean; is_completed: boolean }[];
    const required = items.filter((i) => i.is_required);
    return {
      status: checklist.status as string,
      done: items.filter((i) => i.is_completed).length,
      total: items.length,
      requiredDone: required.filter((i) => i.is_completed).length,
      requiredTotal: required.length,
    };
  }, [checklist]);

  /* 흐름 갭 — 발행 vs 수금 */
  const issuedThisMonth = monthInv?.salesTotal ?? 0;
  const settledThisMonth = settled?.total ?? 0;
  const monthGap = issuedThisMonth - settledThisMonth;

  if (blocked) {
    return <AccessDenied detail="경영 흐름은 대표·관리자 전용입니다." />;
  }

  const monthLabel = `${Number(month.split("-")[1])}월`;

  return (
    <div>
      <Link href="/reports" className="no-print" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", textDecoration: "none", marginBottom: 14 }}>
        ← 분석 허브
      </Link>
      <div className="page-sticky-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: "var(--text)", margin: 0 }}>
            경영 흐름
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6 }}>
            영업 → 매출 → 수금 → 비용 → 손익 → 세금 → 결산. 회사 돈의 흐름을 한 줄로 봅니다.
          </p>
        </div>
        <MonthField
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          style={{
            padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg-card)", color: "var(--text)", fontSize: 13,
          }}
        />
      </div>

      {/* ═══ 뷰 전환 — 콕핏(미래·다각도) / 이번달 흐름(기존 6단계) ═══ */}
      <div className="flex gap-1.5 mb-4 no-print">
        {([{ k: "month", l: "이번달 흐름" }, { k: "cockpit", l: "콕핏 (미래·다각도)" }, { k: "matrix", l: "월별 표 (1년치)" }] as const).map((t) => (
          <button key={t.k} onClick={() => setFlowView(t.k)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg border transition ${flowView === t.k ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ═══ 콕핏 — 미래 현금 예측 + 다각도 (P1~) ═══ */}
      {flowView === "cockpit" && companyId && (
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-2 no-print -mb-1">
            <span className="text-[11px] text-[var(--text-muted)]">과거 범위</span>
            {[6, 12].map((n) => (
              <button key={n} onClick={() => setPastN(n)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition ${pastN === n ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>
                {n}개월
              </button>
            ))}
            <button onClick={saveFlowSettings} className="ml-1 px-2.5 py-1 text-[11px] font-semibold rounded-full border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]" title="현재 뷰·렌즈·기간을 기본값으로 저장">
              {savedFlow ? "✓ 저장됨" : "⭐ 기본값 저장"}
            </button>
          </div>
          <CashPulseHeader companyId={companyId} userId={userId || undefined} />
          <FlowTrend companyId={companyId} userId={userId || undefined} anchorMonth={month} pastN={pastN} lens={lens} onLensChange={setLens} />
          <FlowSchedule companyId={companyId} userId={userId || undefined} />
        </div>
      )}

      {flowView === "matrix" && companyId && (
        <div className="space-y-2">
          <div className="flex justify-end no-print">
            <button onClick={saveFlowSettings} className="px-2.5 py-1 text-[11px] font-semibold rounded-full border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]" title="이 뷰를 기본값으로 저장">
              {savedFlow ? "✓ 저장됨" : "⭐ 기본값 저장"}
            </button>
          </div>
          <FlowMatrix companyId={companyId} currentMonth={month} />
        </div>
      )}

      {flowView === "month" && (
      <>
      {/* ═══ 핵심 요약 스트립 ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ marginBottom: 16 }}>
        {[
          { label: `${monthLabel} 발행 매출`, value: issuedThisMonth, color: "var(--primary)", hint: "세금계산서 합계 (부가세 포함)" },
          { label: `${monthLabel} 수금`, value: settledThisMonth, color: "#10b981", hint: "확정 매칭 입금 (부가세 포함)" },
          { label: `${monthLabel} 지출`, value: monthBudget?.expenseTotal ?? 0, color: "#f97316", hint: "고정비 + 변동비" },
          { label: "부가세 예상", value: monthVat?.netVAT ?? 0, color: "#ec4899", hint: `${quarter.split("-")[1]} 분기 누적` },
        ].map((c) => (
          <div key={c.label} className="glass-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{c.label}</div>
            <div className="mono-number" style={{ fontSize: 18, fontWeight: 800, color: c.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>₩{fmtKrw(c.value)}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>{c.hint}</div>
          </div>
        ))}
      </div>

      {/* ═══ 흐름 경고 — 단계 사이가 막힌 곳 ═══ */}
      {((receivable?.over30 ?? 0) > 0 || monthGap > 0 || (vatDday !== null && vatDday <= 30 && (monthVat?.netVAT ?? 0) > 0)) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {(receivable?.over30 ?? 0) > 0 && (
            <Link href="/partners/ledger" style={{ textDecoration: "none", display: "block", padding: "10px 14px", borderRadius: 10, background: "color-mix(in srgb, #ef4444 8%, transparent)", border: "1px solid color-mix(in srgb, #ef4444 25%, transparent)", fontSize: 12.5, color: "#ef4444", fontWeight: 600 }}>
              ⚠️ 30일 넘은 미수금 ₩{fmtKrw(receivable!.over30)} — 거래처 원장에서 확인·독촉하세요 →
            </Link>
          )}
          {monthGap > 0 && (
            <Link href="/partners/reconciliation" style={{ textDecoration: "none", display: "block", padding: "10px 14px", borderRadius: 10, background: "color-mix(in srgb, #f59e0b 8%, transparent)", border: "1px solid color-mix(in srgb, #f59e0b 25%, transparent)", fontSize: 12.5, color: "#d97706", fontWeight: 600 }}>
              💸 {monthLabel} 발행액 중 ₩{fmtKrw(monthGap)} 아직 수금 확인 안 됨 — 입금 매칭으로 확인하세요 →
            </Link>
          )}
          {vatDday !== null && vatDday <= 30 && (monthVat?.netVAT ?? 0) > 0 && (
            <Link href="/tax-invoices" style={{ textDecoration: "none", display: "block", padding: "10px 14px", borderRadius: 10, background: "color-mix(in srgb, #ec4899 8%, transparent)", border: "1px solid color-mix(in srgb, #ec4899 25%, transparent)", fontSize: 12.5, color: "#ec4899", fontWeight: 600 }}>
              🧾 부가세 신고 D-{vatDday} ({monthVat!.dueDate}) — 예상 납부 ₩{fmtKrw(monthVat!.netVAT)} 현금 준비 →
            </Link>
          )}
        </div>
      )}

      {/* ═══ 6단계 흐름 ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {/* ① 영업 */}
        <StepCard no={1} title="영업" accent="var(--primary)"
          links={[{ href: "/projects", label: "프로젝트" }, { href: "/partners", label: "거래처" }]}>
          <Row label="진행중 프로젝트" value={`${pipeline?.count ?? 0}건`} />
          <Row label="계약 총액 (파이프라인)" value={`₩${fmtKrw(pipeline?.total ?? 0)}`} bold />
          {(pipeline?.settling ?? 0) > 0 && (
            <Row label="정산 단계" value={`${pipeline!.settling}건`} color="#f59e0b" />
          )}
        </StepCard>

        {/* ② 매출 */}
        <StepCard no={2} title="매출" accent="#6366f1"
          links={[{ href: "/tax-invoices", label: "세금계산서" }]}>
          <Row label="매출 발행" value={`${monthInv?.salesCount ?? 0}건 · ₩${fmtKrw(monthInv?.salesTotal ?? 0)}`} bold />
          <Row label="공급가액" value={`₩${fmtKrw(monthInv?.salesSupply ?? 0)}`} />
          <Row label="매출세액 (부가세)" value={`₩${fmtKrw(monthInv?.salesTax ?? 0)}`} color="var(--text-muted)" />
        </StepCard>

        {/* ③ 수금 */}
        <StepCard no={3} title="수금" accent="#10b981"
          links={[{ href: "/partners/ledger", label: "거래처 원장 · 입금 매칭" }, { href: "/bank", label: "통장" }]}>
          <Row label="확정 수금" value={`${settled?.count ?? 0}건 · ₩${fmtKrw(settledThisMonth)}`} bold color="#10b981" />
          {issuedThisMonth > 0 && (
            <MiniBar
              pct={(settledThisMonth / issuedThisMonth) * 100}
              color="#10b981"
              label={`${monthLabel} 발행 대비 수금률 ${Math.min(100, Math.round((settledThisMonth / issuedThisMonth) * 100))}%`}
            />
          )}
          <Row label="미수금 잔액 (전체)" value={`₩${fmtKrw(receivable?.total ?? 0)}`} color={(receivable?.total ?? 0) > 0 ? "var(--primary)" : "var(--text)"} />
          {(receivable?.over30 ?? 0) > 0 && (
            <Row label="30일+ 연체" value={`₩${fmtKrw(receivable!.over30)}`} color="#ef4444" />
          )}
        </StepCard>

        {/* ④ 비용 */}
        <StepCard no={4} title="비용" accent="#f97316"
          links={[{ href: "/reports/costs", label: "고정비·변동비" }, { href: "/cards", label: "카드" }, { href: "/payments", label: "결제" }]}>
          <Row label="지출 합계" value={`₩${fmtKrw(monthBudget?.expenseTotal ?? 0)}`} bold color="#f97316" />
          <Row label="고정비" value={`₩${fmtKrw(monthBudget?.fixedCosts ?? 0)}`} />
          <Row label="변동비" value={`₩${fmtKrw(monthBudget?.variableCosts ?? 0)}`} />
        </StepCard>

        {/* ⑤ 손익 + 세무 */}
        <StepCard no={5} title="손익 · 세금" accent="#ec4899"
          links={[{ href: "/reports/pnl", label: "손익계산서" }, { href: "/reports/bs", label: "재무상태표" }]}>
          <Row label="수입 합계 (자금 기준)" value={`₩${fmtKrw(monthBudget?.incomeTotal ?? 0)}`} />
          <Row label="이번 달 순흐름" value={`₩${fmtKrw(monthNet)}`} bold color={monthNet >= 0 ? "#10b981" : "#ef4444"} />
          <Row label={`부가세 예상 (${quarter.split("-")[1]})`} value={`₩${fmtKrw(monthVat?.netVAT ?? 0)}`} color="#ec4899" />
          {vatDday !== null && (
            <Row label="신고 기한" value={vatDday >= 0 ? `${monthVat!.dueDate} (D-${vatDday})` : monthVat!.dueDate} color={vatDday >= 0 && vatDday <= 30 ? "#ef4444" : "var(--text-muted)"} />
          )}
        </StepCard>

        {/* ⑥ 결산 */}
        <StepCard no={6} title="결산" accent="#06b6d4"
          links={[{ href: "/dashboard", label: "월결산 체크리스트" }]}>
          {closing ? (
            <>
              <Row label="필수 항목" value={`${closing.requiredDone} / ${closing.requiredTotal} 완료`} bold
                color={closing.requiredDone === closing.requiredTotal ? "#10b981" : "var(--text)"} />
              {closing.total > 0 && (
                <MiniBar
                  pct={(closing.done / closing.total) * 100}
                  color={closing.requiredDone === closing.requiredTotal ? "#10b981" : "#06b6d4"}
                  label={`전체 진행 ${Math.round((closing.done / closing.total) * 100)}%`}
                />
              )}
              <Row label="전체 진행" value={`${closing.done} / ${closing.total}`} />
              <Row label="상태" value={closing.status === "locked" ? "잠금 🔒" : closing.status === "completed" ? "마감 완료 ✅" : "진행 중"}
                color={closing.status === "open" ? "var(--text-muted)" : "#10b981"} />
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", padding: "8px 0" }}>체크리스트 불러오는 중…</div>
          )}
        </StepCard>
      </div>

      {/* Footer note */}
      <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text-muted)" }}>숫자 기준</strong>
        <br />- 매출·부가세는 세금계산서(발행) 기준, 수금은 입금 매칭 확정 기준, 비용은 정기결제+카드+일회성 지출 기준입니다.
        <br />- 각 카드의 숫자는 해당 상세 화면(세금계산서·거래처 원장·고정비/변동비·손익계산서)과 동일한 집계를 사용합니다.
        <br />- 발행했는데 수금 확인이 안 된 금액은 거래처 원장의 입금 매칭에서 확정하면 즉시 반영됩니다.
      </div>
      </>
      )}
    </div>
  );
}
