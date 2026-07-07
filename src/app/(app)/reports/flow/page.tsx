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

/* ── 6단계 정의 — 타임라인 노드 + 카드 액센트가 같은 소스를 공유 ── */
const FLOW_STEPS = [
  { no: 1, title: "영업", accent: "var(--primary)" },
  { no: 2, title: "매출", accent: "var(--info)" },
  { no: 3, title: "수금", accent: "var(--success)" },
  { no: 4, title: "비용", accent: "var(--warning)" },
  { no: 5, title: "손익 · 세금", accent: "var(--primary)" },
  { no: 6, title: "결산", accent: "#06b6d4" },
] as const;

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
    <div className="glass-card relative flex flex-col overflow-hidden p-5 transition-shadow hover:shadow-lg hover:shadow-black/5">
      {/* 단계 액센트 라인 — 흐름의 연속성을 색으로 표현 */}
      {/* <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 25%, transparent))` }}
      /> */}
      <div className="mb-3.5 flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[14px] font-black"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 30%, transparent)`,
          }}
        >
          {no}
        </div>
        <div className="text-[15px] font-extrabold tracking-tight text-[var(--text)]">{title}</div>
      </div>
      <div className="flex-1">{children}</div>
      <div className="mt-3.5 flex flex-wrap gap-2">
        {links.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold no-underline transition-opacity hover:opacity-80"
            style={{ color: accent, background: `color-mix(in srgb, ${accent} 10%, transparent)` }}
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
    <div className="flex items-center justify-between py-[5px]">
      <span className="text-[12.5px] text-[var(--text-muted)]">{label}</span>
      <span
        className={`mono-number ${bold ? "text-[15px] font-extrabold" : "text-[13px] font-semibold"}`}
        style={{ color: color || "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* 진행률 미니 바 — 수금률·결산 진행률 시각화 */
function MiniBar({ pct, color, label }: { pct: number; color: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="mt-1.5 mb-0.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-surface)]">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%`, background: color }}
        />
      </div>
      {label && (
        <div className="mt-1 text-right text-[10.5px] text-[var(--text-dim)]">{label}</div>
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

  /* ① 영업 파이프라인 — 진행중 딜. 프로젝트 목록과 동일 기준: 소프트 삭제(archived_at) 제외 + 상위 프로젝트만
     (세부 프로젝트(캠페인)는 상위 롤업에 포함되므로 건수·금액 중복 방지) */
  const { data: pipeline } = useQuery({
    queryKey: ["flow-pipeline", companyId],
    queryFn: async () => {
      const { data } = await db.from("deals")
        .select("contract_total, stage")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("archived_at", null)
        .is("parent_deal_id", null);
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
    <div className="space-y-6">
      {/* ═══ 툴바 — 뷰 전환(좌) + 기간·기본값 저장(우). 타이틀은 공통 헤더바가 표시 ═══ */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        {/* 뷰 전환 — 콕핏(미래·다각도) / 이번달 흐름(기존 6단계) / 월별표 */}
        <div className="seg-bar">
          {([{ k: "month", l: "이번달 흐름" }, { k: "cockpit", l: "콕핏 (미래·다각도)" }, { k: "matrix", l: "월별 표 (1년치)" }] as const).map((t) => (
            <button key={t.k} onClick={() => setFlowView(t.k)}
              className={`seg-item ${flowView === t.k ? "seg-item-active" : ""}`}>
              {t.l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthField
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            style={{
              padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--bg-surface)", color: "var(--text)", fontSize: 13,
            }}
          />
          <button
            onClick={saveFlowSettings}
            className="btn-secondary text-[11px]"
            title="현재 뷰·렌즈·기간을 기본값으로 저장"
          >
            {savedFlow ? "✓ 저장됨" : "기본값 저장"}
          </button>
        </div>
      </div>

      {/* ═══ 콕핏 — 미래 현금 예측 + 다각도 (P1~) ═══ */}
      {flowView === "cockpit" && companyId && (
        <div className="space-y-4">
          <div className="no-print -mb-1 flex items-center justify-end gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">과거 범위</span>
            <div className="seg-bar">
              {[6, 12].map((n) => (
                <button key={n} onClick={() => setPastN(n)}
                  className={`seg-item ${pastN === n ? "seg-item-active" : ""}`}>
                  {n}개월
                </button>
              ))}
            </div>
          </div>
          <CashPulseHeader companyId={companyId} userId={userId || undefined} />
          <FlowTrend companyId={companyId} userId={userId || undefined} anchorMonth={month} pastN={pastN} lens={lens} onLensChange={setLens} />
          <FlowSchedule companyId={companyId} userId={userId || undefined} />
        </div>
      )}

      {flowView === "matrix" && companyId && (
        <FlowMatrix companyId={companyId} currentMonth={month} />
      )}

      {flowView === "month" && (
      <>
      {/* ═══ 핵심 요약 스트립 — KPI ═══ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: `${monthLabel} 발행 매출`, value: issuedThisMonth, color: "var(--primary)", hint: "세금계산서 합계 (부가세 포함)" },
          { label: `${monthLabel} 수금`, value: settledThisMonth, color: "var(--success)", hint: "확정 매칭 입금 (부가세 포함)" },
          { label: `${monthLabel} 지출`, value: monthBudget?.expenseTotal ?? 0, color: "var(--warning)", hint: "고정비 + 변동비" },
          { label: "부가세 예상", value: monthVat?.netVAT ?? 0, color: "var(--primary)", hint: `${quarter.split("-")[1]} 분기 누적` },
        ].map((c) => (
          <div key={c.label} className="glass-card flex flex-col gap-3 p-5">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{c.label}</span>
            <div className="flex items-end gap-2">
              <span className="mono-number truncate text-[26px] leading-8 font-extrabold" style={{ color: c.color }}>₩{fmtKrw(c.value)}</span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">{c.hint}</div>
          </div>
        ))}
      </div>

      {/* ═══ 흐름 경고 — 단계 사이가 막힌 곳 ═══ */}
      {((receivable?.over30 ?? 0) > 0 || monthGap > 0 || (vatDday !== null && vatDday <= 30 && (monthVat?.netVAT ?? 0) > 0)) && (
        <div className="flex flex-col gap-2">
          {(receivable?.over30 ?? 0) > 0 && (
            <Link
              href="/partners/ledger"
              className="block rounded-2xl px-4 py-3 text-[12.5px] font-semibold no-underline transition-all hover:-translate-y-px hover:opacity-90"
              style={{
                background: "color-mix(in srgb, var(--danger) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)",
                color: "var(--danger)",
                boxShadow: "0 6px 20px -8px color-mix(in srgb, var(--danger) 35%, transparent), inset 0 1px 0 color-mix(in srgb, var(--danger) 10%, white)",
              }}
            >
              30일 넘은 미수금 ₩{fmtKrw(receivable!.over30)} — 거래처 원장에서 확인·독촉하세요 →
            </Link>
          )}
          {monthGap > 0 && (
            <Link
              href="/partners/reconciliation"
              className="block rounded-2xl px-4 py-3 text-[12.5px] font-semibold no-underline transition-all hover:-translate-y-px hover:opacity-90"
              style={{
                background: "color-mix(in srgb, var(--warning) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--warning) 25%, transparent)",
                color: "var(--warning)",
                boxShadow: "0 6px 20px -8px color-mix(in srgb, var(--warning) 35%, transparent), inset 0 1px 0 color-mix(in srgb, var(--warning) 10%, white)",
              }}
            >
              {monthLabel} 발행액 중 ₩{fmtKrw(monthGap)} 아직 수금 확인 안 됨 — 입금 매칭으로 확인하세요 →
            </Link>
          )}
          {vatDday !== null && vatDday <= 30 && (monthVat?.netVAT ?? 0) > 0 && (
            <Link
              href="/tax-invoices"
              className="block rounded-2xl px-4 py-3 text-[12.5px] font-semibold no-underline transition-all hover:-translate-y-px hover:opacity-90"
              style={{
                background: "color-mix(in srgb, var(--primary) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
                color: "var(--primary)",
                boxShadow: "0 6px 20px -8px color-mix(in srgb, var(--primary) 35%, transparent), inset 0 1px 0 color-mix(in srgb, var(--primary) 10%, white)",
              }}
            >
              부가세 신고 D-{vatDday} ({monthVat!.dueDate}) — 예상 납부 ₩{fmtKrw(monthVat!.netVAT)} 현금 준비 →
            </Link>
          )}
        </div>
      )}

      {/* ═══ 6단계 흐름 — 가로 타임라인 + 카드 그리드 ═══ */}
      <div>
        {/* 흐름 타임라인 — 단계 노드 + 연결선 (넓은 화면 전용 오리엔테이션) */}
        <div className="mb-4 hidden items-center px-1 lg:flex" aria-hidden="true">
          {FLOW_STEPS.map((s, i) => (
            <div key={s.no} className={`flex items-center ${i < FLOW_STEPS.length - 1 ? "flex-1" : "flex-none"}`}>
              <div className="flex items-center gap-2">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-black"
                  style={{
                    background: `color-mix(in srgb, ${s.accent} 14%, transparent)`,
                    color: s.accent,
                    boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${s.accent} 35%, transparent)`,
                  }}
                >
                  {s.no}
                </div>
                <span className="whitespace-nowrap text-xs font-bold text-[var(--text)]">{s.title}</span>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <div className="mx-3 flex flex-1 items-center">
                  <div
                    className="h-px flex-1"
                    style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${s.accent} 45%, transparent), color-mix(in srgb, ${FLOW_STEPS[i + 1].accent} 45%, transparent))` }}
                  />
                  <span className="ml-1 text-[10px] leading-none" style={{ color: `color-mix(in srgb, ${FLOW_STEPS[i + 1].accent} 60%, transparent)` }}>▶</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* ① 영업 */}
          <StepCard no={1} title="영업" accent="var(--primary)"
            links={[{ href: "/projects", label: "프로젝트" }, { href: "/partners", label: "거래처" }]}>
            <Row label="진행중 프로젝트" value={`${pipeline?.count ?? 0}건`} />
            <Row label="계약 총액 (파이프라인)" value={`₩${fmtKrw(pipeline?.total ?? 0)}`} bold />
            {(pipeline?.settling ?? 0) > 0 && (
              <Row label="정산 단계" value={`${pipeline!.settling}건`} color="var(--warning)" />
            )}
          </StepCard>

          {/* ② 매출 */}
          <StepCard no={2} title="매출" accent="var(--info)"
            links={[{ href: "/tax-invoices", label: "세금계산서" }]}>
            <Row label="매출 발행" value={`${monthInv?.salesCount ?? 0}건 · ₩${fmtKrw(monthInv?.salesTotal ?? 0)}`} bold />
            <Row label="공급가액" value={`₩${fmtKrw(monthInv?.salesSupply ?? 0)}`} />
            <Row label="매출세액 (부가세)" value={`₩${fmtKrw(monthInv?.salesTax ?? 0)}`} color="var(--text-muted)" />
          </StepCard>

          {/* ③ 수금 */}
          <StepCard no={3} title="수금" accent="var(--success)"
            links={[{ href: "/partners/ledger", label: "거래처 원장 · 입금 매칭" }, { href: "/bank", label: "통장" }]}>
            <Row label="확정 수금" value={`${settled?.count ?? 0}건 · ₩${fmtKrw(settledThisMonth)}`} bold color="var(--success)" />
            {issuedThisMonth > 0 && (
              <MiniBar
                pct={(settledThisMonth / issuedThisMonth) * 100}
                color="var(--success)"
                label={`${monthLabel} 발행 대비 수금률 ${Math.min(100, Math.round((settledThisMonth / issuedThisMonth) * 100))}%`}
              />
            )}
            <Row label="미수금 잔액 (전체)" value={`₩${fmtKrw(receivable?.total ?? 0)}`} color={(receivable?.total ?? 0) > 0 ? "var(--primary)" : "var(--text)"} />
            {(receivable?.over30 ?? 0) > 0 && (
              <Row label="30일+ 연체" value={`₩${fmtKrw(receivable!.over30)}`} color="var(--danger)" />
            )}
          </StepCard>

          {/* ④ 비용 */}
          <StepCard no={4} title="비용" accent="var(--warning)"
            links={[{ href: "/reports/costs", label: "고정비·변동비" }, { href: "/cards", label: "카드" }, { href: "/payments", label: "결제" }]}>
            <Row label="지출 합계" value={`₩${fmtKrw(monthBudget?.expenseTotal ?? 0)}`} bold color="var(--warning)" />
            <Row label="고정비" value={`₩${fmtKrw(monthBudget?.fixedCosts ?? 0)}`} />
            <Row label="변동비" value={`₩${fmtKrw(monthBudget?.variableCosts ?? 0)}`} />
          </StepCard>

          {/* ⑤ 손익 + 세무 */}
          <StepCard no={5} title="손익 · 세금" accent="var(--primary)"
            links={[{ href: "/reports/pnl", label: "손익계산서" }, { href: "/reports/bs", label: "재무상태표" }]}>
            <Row label="수입 합계 (자금 기준)" value={`₩${fmtKrw(monthBudget?.incomeTotal ?? 0)}`} />
            <Row label="이번 달 순흐름" value={`₩${fmtKrw(monthNet)}`} bold color={monthNet >= 0 ? "var(--success)" : "var(--danger)"} />
            <Row label={`부가세 예상 (${quarter.split("-")[1]})`} value={`₩${fmtKrw(monthVat?.netVAT ?? 0)}`} color="var(--primary)" />
            {vatDday !== null && (
              <Row label="신고 기한" value={vatDday >= 0 ? `${monthVat!.dueDate} (D-${vatDday})` : monthVat!.dueDate} color={vatDday >= 0 && vatDday <= 30 ? "var(--danger)" : "var(--text-muted)"} />
            )}
          </StepCard>

          {/* ⑥ 결산 */}
          <StepCard no={6} title="결산" accent="#06b6d4"
            links={[{ href: "/dashboard", label: "월결산 체크리스트" }]}>
            {closing ? (
              <>
                <Row label="필수 항목" value={`${closing.requiredDone} / ${closing.requiredTotal} 완료`} bold
                  color={closing.requiredDone === closing.requiredTotal ? "var(--success)" : "var(--text)"} />
                {closing.total > 0 && (
                  <MiniBar
                    pct={(closing.done / closing.total) * 100}
                    color={closing.requiredDone === closing.requiredTotal ? "var(--success)" : "#06b6d4"}
                    label={`전체 진행 ${Math.round((closing.done / closing.total) * 100)}%`}
                  />
                )}
                <Row label="전체 진행" value={`${closing.done} / ${closing.total}`} />
                <Row label="상태" value={closing.status === "locked" ? "잠금" : closing.status === "completed" ? "마감 완료" : "진행 중"}
                  color={closing.status === "open" ? "var(--text-muted)" : "var(--success)"} />
              </>
            ) : (
              <div className="py-2 text-[12.5px] text-[var(--text-dim)]">체크리스트 불러오는 중…</div>
            )}
          </StepCard>
        </div>
      </div>

      {/* Footer note */}
      <div className="glass-card px-5 py-4 text-xs leading-relaxed text-[var(--text-dim)]">
        <strong className="text-[var(--text-muted)]">숫자 기준</strong>
        <br />- 매출·부가세는 세금계산서(발행) 기준, 수금은 입금 매칭 확정 기준, 비용은 정기결제+카드+일회성 지출 기준입니다.
        <br />- 각 카드의 숫자는 해당 상세 화면(세금계산서·거래처 원장·고정비/변동비·손익계산서)과 동일한 집계를 사용합니다.
        <br />- 발행했는데 수금 확인이 안 된 금액은 거래처 원장의 입금 매칭에서 확정하면 즉시 반영됩니다.
      </div>
      </>
      )}
    </div>
  );
}
