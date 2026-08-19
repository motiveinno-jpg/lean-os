"use client";

// 자금 전망 › 월별 흐름 — 예전 '경영 흐름'(2026-05 신설: 이번달 6단계 흐름 / 콕핏(미래·다각도) / 월별 표) 을 2026-08-19 정리.
//   · 콕핏은 '전망' 갈래(날짜별 예정 곡선)가 대신하므로 뺐다(FlowTrend·FlowSchedule·CashPulseHeader 삭제, docs/REMOVED_CODE_LOG.md).
//   · 보기 = [월별 표 · 이번 달 흐름] 칩 하나. 조회 줄 = 연도/기준 달 · 보기 설정(셀 표시) ‖ 인쇄. 결과 요약 = Stat.
//   · KPI 카드 4장·경고 배너·타임라인·StepCard(상자 안 상자) → Stat + 얇은 판(pnl-panel + bz-kv) 로. 숫자·소스는 그대로.
//   숫자 기준: 매출·부가세 = 세금계산서(발행), 수금 = 입금 매칭 확정, 비용 = 정기결제+카드+일회성 (통장·세금계산서 기준 — 손익 현황의 확정 전표와 다르다).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { kstDateStr } from "@/lib/kst";
import { MonthField } from "@/components/month-field";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportHead } from "../_components/ReportHead";
import { ChipGroup, ConditionPanel, ConditionRow, Stat } from "@/components/query-kit";
import { getTaxInvoiceSummary, getVATPreview, type PeriodSummary, type VATPreview } from "@/lib/tax-invoice";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getOrCreateChecklist } from "@/lib/closing";
import { FlowMatrix, FLOW_CELL_MODES, FLOW_MODE_HINT, type FlowCellMode } from "./_components/FlowMatrix";

const db = supabase;
const won = (n: number) => `${n < 0 ? "−" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
const num = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01` };
}
function thisMonth(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

export default function BusinessFlowPage() {
  const { role } = useUser();
  const blocked = role === "partner";
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "month">("matrix");
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const [mode, setMode] = useState<FlowCellMode>("amount");
  const [draftMode, setDraftMode] = useState<FlowCellMode>("amount");
  const [panelOpen, setPanelOpen] = useState(false);
  const { start, end } = monthRange(month);
  const mYear = Number(month.slice(0, 4));

  useEffect(() => { if (blocked) return; getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, [blocked]);

  /* ① 영업 파이프라인 — 진행중 상위 프로젝트 */
  const { data: pipeline } = useQuery({
    queryKey: ["flow-pipeline", companyId],
    queryFn: async () => {
      const data = logRead("flow/page:data", await db.from("deals").select("contract_total, stage").eq("company_id", companyId ?? "").eq("status", "active").is("archived_at", null).is("parent_deal_id", null));
      const rows = (data || []) as { contract_total: number | null; stage: string | null }[];
      return { count: rows.length, total: rows.reduce((s, d) => s + Number(d.contract_total || 0), 0), settling: rows.filter((d) => d.stage === "settlement").length };
    },
    enabled: !!companyId && view === "month", staleTime: 60_000,
  });
  /* ② 세금계산서 월별 집계 */
  const { data: invoiceSummary = [] } = useQuery<PeriodSummary[]>({
    queryKey: ["flow-invoice-summary", companyId, mYear], queryFn: () => getTaxInvoiceSummary(companyId!, mYear, "monthly"), enabled: !!companyId && view === "month", staleTime: 60_000,
  });
  const monthInv = invoiceSummary.find((s) => s.period === month);
  /* ③ 당월 확정 수금 */
  const { data: settled } = useQuery({
    queryKey: ["flow-settled", companyId, month],
    queryFn: async () => {
      const data = logRead("flow/page:data", await db.from("invoice_settlements").select("amount, bank_transactions!inner(transaction_date)").eq("company_id", companyId ?? "").eq("status", "confirmed").gte("bank_transactions.transaction_date", start).lt("bank_transactions.transaction_date", end));
      const rows = (data || []) as { amount: number | null }[];
      return { count: rows.length, total: rows.reduce((s, r) => s + Number(r.amount || 0), 0) };
    },
    enabled: !!companyId && view === "month", staleTime: 60_000,
  });
  /* ③ 미수금 잔액 (세금계산서 status 기준 — 거래처 원장 표시와 같은 방식) */
  const { data: receivable } = useQuery({
    queryKey: ["flow-receivable", companyId],
    queryFn: async () => {
      const data = logRead("flow/page:data", await db.from("tax_invoices").select("total_amount, issue_date").eq("company_id", companyId ?? "").eq("type", "sales").in("status", ["issued", "sent", "pending", "overdue"]));
      const rows = (data || []) as { total_amount: number | null; issue_date: string | null }[];
      const cutoff = kstDateStr(new Date(Date.now() - 30 * 24 * 3600 * 1000));
      return { total: rows.reduce((s, r) => s + Number(r.total_amount || 0), 0), over30: rows.filter((r) => (r.issue_date || "") < cutoff).reduce((s, r) => s + Number(r.total_amount || 0), 0) };
    },
    enabled: !!companyId && view === "month", staleTime: 60_000,
  });
  /* ④·⑤ 비용/손익 — cash-budget 월별 집계 (월별 표와 같은 소스) */
  const { data: budget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["flow-matrix-budget", companyId, view === "matrix" ? year : mYear], queryFn: () => getMonthlyBudgetOverview(companyId!, view === "matrix" ? year : mYear), enabled: !!companyId, staleTime: 60_000,
  });
  const monthBudget = budget.find((b) => b.month === month);
  const monthNet = monthBudget ? monthBudget.incomeTotal - monthBudget.expenseTotal : 0;
  /* ⑤ 부가세 */
  const { data: vat = [] } = useQuery<VATPreview[]>({
    queryKey: ["flow-vat", companyId, mYear], queryFn: () => getVATPreview(companyId!, mYear), enabled: !!companyId && view === "month", staleTime: 60_000,
  });
  const quarter = `${mYear}-Q${Math.ceil(Number(month.split("-")[1]) / 3)}`;
  const monthVat = vat.find((v) => v.quarter === quarter);
  const vatDday = useMemo(() => (monthVat?.dueDate ? Math.ceil((new Date(monthVat.dueDate).getTime() - Date.now()) / 864e5) : null), [monthVat]);
  /* ⑥ 월결산 체크리스트 */
  const { data: checklist } = useQuery({ queryKey: ["flow-closing", companyId, month], queryFn: () => getOrCreateChecklist(companyId!, month), enabled: !!companyId && view === "month", staleTime: 60_000 });
  const closing = useMemo(() => {
    if (!checklist) return null;
    const items = (checklist.items || []) as { is_required: boolean; is_completed: boolean }[];
    const required = items.filter((i) => i.is_required);
    return { status: checklist.status as string, done: items.filter((i) => i.is_completed).length, total: items.length, requiredDone: required.filter((i) => i.is_completed).length, requiredTotal: required.length };
  }, [checklist]);

  if (blocked) return <AccessDenied detail="월별 흐름은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const issued = monthInv?.salesTotal ?? 0, got = settled?.total ?? 0, gap = issued - got;
  const mLabel = `${Number(month.split("-")[1])}월`;
  const yIn = budget.reduce((s, b) => s + Number(b.incomeTotal || 0), 0), yOut = budget.reduce((s, b) => s + Number(b.expenseTotal || 0), 0);
  const curYear = Number(thisMonth().slice(0, 4));

  const Panel = ({ no, title, links, children }: { no: number; title: string; links: { href: string; label: string }[]; children: React.ReactNode }) => (
    <section className="pnl-panel bz-signal">
      <h3><span className="flow-step-no">{no}</span>{title}</h3>
      <dl className="bz-kv">{children}</dl>
      <p className="bz-why">{links.map((l, i) => <span key={l.href}>{i > 0 && " · "}<Link href={l.href} className="bz-link">{l.label} →</Link></span>)}</p>
    </section>
  );
  const KV = ({ k, v, tone }: { k: string; v: string; tone?: "plus" | "minus" | "warn" }) => <div><dt>{k}</dt><dd className={`mono-number ${tone === "plus" ? "bz-plus" : tone === "minus" ? "bz-minus" : tone === "warn" ? "bz-tone-y" : ""}`}>{v}</dd></div>;

  return (
    <>
      <ReportHead
        bar={<>
          {view === "matrix" ? (
            <>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">
                {[curYear, curYear - 1, curYear - 2].map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <ConditionPanel label="보기 설정" open={panelOpen} onOpenChange={(v) => { if (v) setDraftMode(mode); setPanelOpen(v); }} activeCount={mode !== "amount" ? 1 : 0}
                foot={<>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setDraftMode("amount")}>기본으로</button>
                  <span className="ml-auto" />
                  <button type="button" className="btn-primary btn-sm" onClick={() => { setMode(draftMode); setPanelOpen(false); }}>적용</button>
                </>}>
                <ConditionRow label="셀 표시" hint={FLOW_MODE_HINT[draftMode]}>
                  <span className="qk-quicks">{FLOW_CELL_MODES.map((m) => <button key={m.key} type="button" onClick={() => setDraftMode(m.key)} className={draftMode === m.key ? "qk-quick qk-quick-on" : "qk-quick"}>{m.label}</button>)}</span>
                </ConditionRow>
              </ConditionPanel>
            </>
          ) : (
            <MonthField value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="qk-input h-8 px-2.5 text-xs" />
          )}
          <ChipGroup value={view} onChange={setView} options={[{ value: "matrix", label: "월별 표 (1년치)" }, { value: "month", label: "이번 달 흐름" }] as const} />
          <span className="text-[11px] text-[var(--text-dim)]">통장·세금계산서 기준 (손익 현황의 확정 전표와 다릅니다)</span>
        </>}
        right={<button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button>}
        stats={view === "matrix" ? <>
          <Stat label={`${year}년 수입`} value={won(yIn)} tone="plus" />
          <Stat label="지출" value={won(yOut)} tone="minus" />
          <Stat label="순" value={won(yIn - yOut)} tone={yIn - yOut >= 0 ? "plus" : "minus"} />
          {mode !== "amount" && <Stat label="셀 표시" value={FLOW_CELL_MODES.find((m) => m.key === mode)?.label || ""} />}
        </> : <>
          <Stat label={`${mLabel} 발행 매출`} value={won(issued)} />
          <Stat label="수금" value={won(got)} tone="plus" />
          <Stat label="지출" value={won(monthBudget?.expenseTotal ?? 0)} tone="minus" />
          <Stat label="순 흐름" value={won(monthNet)} tone={monthNet >= 0 ? "plus" : "minus"} />
          <Stat label={`부가세 예상 (${quarter.split("-")[1]})`} value={won(monthVat?.netVAT ?? 0)} />
        </>}
      />

      {!companyId ? <div className="collect-empty">불러오는 중…</div> : view === "matrix" ? (
        <FlowMatrix companyId={companyId} currentMonth={thisMonth()} year={year} mode={mode} />
      ) : (
        <div className="bz-body">
          {((receivable?.over30 ?? 0) > 0 || gap > 0 || (vatDday !== null && vatDday <= 30 && (monthVat?.netVAT ?? 0) > 0)) && (
            <section className="pnl-panel">
              <h3>막힌 곳</h3>
              <ul className="ol-gaps">
                {(receivable?.over30 ?? 0) > 0 && <li><span>30일 넘은 미수금 <b className="mono-number bz-minus">{won(receivable!.over30)}</b> — 거래처 원장에서 확인·독촉</span><Link href="/partners/ledger" className="bz-link">원장 →</Link></li>}
                {gap > 0 && <li><span>{mLabel} 발행액 중 <b className="mono-number">{won(gap)}</b> 아직 수금 확인 안 됨 — 입금 매칭으로 확정</span><Link href="/collect?tab=bank" className="bz-link">수집·전표 →</Link></li>}
                {vatDday !== null && vatDday <= 30 && (monthVat?.netVAT ?? 0) > 0 && <li><span>부가세 신고 D-{vatDday} ({monthVat!.dueDate}) — 예상 납부 <b className="mono-number">{won(monthVat!.netVAT)}</b></span><Link href="/reports/vat" className="bz-link">부가세 →</Link></li>}
              </ul>
            </section>
          )}
          <div className="bz-grid3">
            <Panel no={1} title="영업" links={[{ href: "/projecthub", label: "프로젝트" }, { href: "/partners", label: "거래처" }]}>
              <KV k="진행중 프로젝트" v={`${pipeline?.count ?? 0}건`} />
              <KV k="계약 총액 (파이프라인)" v={num(pipeline?.total ?? 0)} />
              {(pipeline?.settling ?? 0) > 0 && <KV k="정산 단계" v={`${pipeline!.settling}건`} tone="warn" />}
            </Panel>
            <Panel no={2} title="매출" links={[{ href: "/tax-invoices", label: "세금계산서" }]}>
              <KV k="매출 발행" v={`${monthInv?.salesCount ?? 0}건 · ${num(issued)}`} />
              <KV k="공급가액" v={num(monthInv?.salesSupply ?? 0)} />
              <KV k="매출세액 (부가세)" v={num(monthInv?.salesTax ?? 0)} />
            </Panel>
            <Panel no={3} title="수금" links={[{ href: "/partners/ledger", label: "거래처 원장 · 입금 매칭" }, { href: "/bank", label: "통장" }]}>
              <KV k="확정 수금" v={`${settled?.count ?? 0}건 · ${num(got)}`} tone="plus" />
              {issued > 0 && <KV k={`${mLabel} 발행 대비 수금률`} v={`${Math.min(100, Math.round((got / issued) * 100))}%`} />}
              <KV k="미수금 잔액 (전체)" v={num(receivable?.total ?? 0)} />
              {(receivable?.over30 ?? 0) > 0 && <KV k="30일+ 연체" v={num(receivable!.over30)} tone="minus" />}
            </Panel>
            <Panel no={4} title="비용" links={[{ href: "/reports/expense", label: "비용" }, { href: "/cards", label: "카드" }, { href: "/payments", label: "결제" }]}>
              <KV k="지출 합계" v={num(monthBudget?.expenseTotal ?? 0)} tone="minus" />
              <KV k="고정비" v={num(monthBudget?.fixedCosts ?? 0)} />
              <KV k="변동비" v={num(monthBudget?.variableCosts ?? 0)} />
            </Panel>
            <Panel no={5} title="손익 · 세금" links={[{ href: "/reports/pnl", label: "손익계산서" }, { href: "/reports/vat", label: "부가세" }]}>
              <KV k="수입 합계 (자금 기준)" v={num(monthBudget?.incomeTotal ?? 0)} />
              <KV k="이번 달 순흐름" v={num(monthNet)} tone={monthNet >= 0 ? "plus" : "minus"} />
              <KV k={`부가세 예상 (${quarter.split("-")[1]})`} v={num(monthVat?.netVAT ?? 0)} />
              {vatDday !== null && <KV k="신고 기한" v={vatDday >= 0 ? `${monthVat!.dueDate} (D-${vatDday})` : monthVat!.dueDate} tone={vatDday >= 0 && vatDday <= 30 ? "minus" : undefined} />}
            </Panel>
            <Panel no={6} title="결산" links={[{ href: "/dashboard", label: "월결산 체크리스트" }]}>
              {closing ? <>
                <KV k="필수 항목" v={`${closing.requiredDone} / ${closing.requiredTotal} 완료`} tone={closing.requiredDone === closing.requiredTotal ? "plus" : undefined} />
                <KV k="전체 진행" v={`${closing.done} / ${closing.total}${closing.total ? ` (${Math.round((closing.done / closing.total) * 100)}%)` : ""}`} />
                <KV k="상태" v={closing.status === "locked" ? "잠금" : closing.status === "completed" ? "마감 완료" : "진행 중"} />
              </> : <KV k="체크리스트" v="불러오는 중…" />}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
