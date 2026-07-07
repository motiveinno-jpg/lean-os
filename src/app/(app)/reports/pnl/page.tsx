"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { MonthField } from "@/components/month-field";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import PnlChart from "./pnl-chart";
import { ReportsTabs } from "../_components/ReportsTabs";
import { StatementsTabs } from "../_components/StatementsTabs";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
// 매출원가 분류 (운영비/판매관리비 와 분리 — 회계 의미상 별도)
const COGS_KEYWORDS = ["외주", "인프라", "서버", "호스팅", "AWS", "클라우드", "도메인"];

// 거래 category 가 비어있을 때만 사용하는 키워드 기반 fallback 라벨
const FALLBACK_KEYWORDS: Array<[string, string[]]> = [
  ["급여", ["급여", "인건비", "상여", "보너스"]],
  ["임대료", ["임대", "월세", "관리비", "스파크플러스"]],
  ["소프트웨어", ["소프트웨어", "SaaS", "구독", "라이선스"]],
  ["전문서비스", ["세무", "법무", "회계", "컨설팅", "자문", "전문서비스"]],
  ["복리후생", ["복리후생", "식대", "경조사", "체육", "건강검진"]],
  ["4대보험", ["4대보험", "국민연금", "건강보험", "고용보험", "산재보험"]],
];

function inferOpexCategory(counterparty: string | null, description: string | null): string {
  const combined = [counterparty, description].filter(Boolean).join(" ").toLowerCase();
  for (const [label, kws] of FALLBACK_KEYWORDS) {
    if (kws.some(kw => combined.includes(kw.toLowerCase()))) return label;
  }
  return "기타";
}

function isCogs(counterparty: string | null, description: string | null, category: string | null): { is: boolean; sub?: "외주비" | "인프라비용" } {
  const combined = [counterparty, description, category].filter(Boolean).join(" ").toLowerCase();
  if (!COGS_KEYWORDS.some(kw => combined.includes(kw.toLowerCase()))) return { is: false };
  if (combined.includes("외주")) return { is: true, sub: "외주비" };
  return { is: true, sub: "인프라비용" };
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface MonthlyRow {
  [month: string]: number;
}

interface PnlData {
  months: string[];
  prevMonths: string[]; // previous period months for comparison
  revenue: MonthlyRow;
  otherRevenue: MonthlyRow;
  outsourcing: MonthlyRow;
  infrastructure: MonthlyRow;
  // 판매관리비 — 사용자 category 동적 그룹 (key = 카테고리 이름)
  opexByCategory: Record<string, MonthlyRow>;
  salesRevenue: MonthlyRow;
  purchaseCost: MonthlyRow;
  totalSalary: MonthlyRow;
  uncategorizedCount: number;   // 분류 안 돼 판관비에서 빠진 출금 건수
  uncategorizedAmount: number;  // 그 합계 금액
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function getLastNMonths(n: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    result.push(`${yyyy}-${mm}`);
  }
  return result;
}

function getMonthsBetween(start: string, end: string): string[] {
  const result: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

function getMonthsBefore(month: string, count: number): string[] {
  const result: string[] = [];
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  for (let i = count; i >= 1; i--) {
    const prev = new Date(d.getFullYear(), d.getMonth() - i, 1);
    result.push(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}

function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function matchesAny(text: string | null, keywords: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function emptyRow(months: string[]): MonthlyRow {
  const row: MonthlyRow = {};
  months.forEach((m) => (row[m] = 0));
  return row;
}

function sumRow(row: MonthlyRow): number {
  return Object.values(row).reduce((a, b) => a + b, 0);
}

function formatKrw(value: number): string {
  if (value === 0) return "-";
  const isNeg = value < 0;
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString("ko-KR");
  return isNeg ? `(${formatted})` : formatted;
}

function formatMonthLabel(month: string): string {
  const [, mm] = month.split("-");
  return `${parseInt(mm, 10)}월`;
}

/* Print CSS */
const PRINT_CSS = `
@media print {
  body { background: white !important; color: black !important; }
  body * { visibility: hidden; }
  #pnl-printable, #pnl-printable * { visibility: visible; color: black !important; }
  #pnl-printable {
    position: absolute; left: 0; top: 0; width: 100%;
    padding: 20px; background: white !important;
  }
  nav, .sidebar, .no-print, button { display: none !important; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; }
  @page { margin: 15mm; }
}
`;

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */
async function fetchPnlData(companyId: string, monthsToShow: number = 6, customStart?: string, customEnd?: string): Promise<PnlData> {
  const months = customStart && customEnd
    ? getMonthsBetween(customStart, customEnd)
    : getLastNMonths(monthsToShow);
  const prevMonthsList = getMonthsBefore(months[0], months.length);
  const allMonths = [...prevMonthsList, ...months];
  const startDate = `${allMonths[0]}-01`;

  // PostgREST max-rows 1000 우회 — range 페이지네이션
  const [transactions, taxInvoices, empRes] = await Promise.all([
    fetchAllPaginated<any>((from, to) =>
      supabase
        .from("bank_transactions")
        .select("amount, type, transaction_date, counterparty, description, category")
        .eq("company_id", companyId)
        .gte("transaction_date", startDate)
        .order("transaction_date", { ascending: true })
        .range(from, to)
    ),
    fetchAllPaginated<any>((from, to) =>
      supabase
        .from("tax_invoices")
        .select("type, supply_amount, tax_amount, total_amount, issue_date, status, expense_category")
        .eq("company_id", companyId)
        .gte("issue_date", startDate)
        // 2026-05-22 무효(void) 세금계산서는 매출/매입에서 제외 (발생주의 — matched 등 나머지는 모두 인식)
        .neq("status", "void")
        .range(from, to)
    ),
    supabase
      .from("employees")
      .select("salary, is_4_insurance, status")
      .eq("company_id", companyId)
      .eq("status", "active"),
  ]);

  const employees = empRes.data || [];

  const prevMonths = prevMonthsList;

  const revenue = emptyRow(allMonths);
  const otherRevenue = emptyRow(allMonths);
  const outsourcing = emptyRow(allMonths);
  const infrastructure = emptyRow(allMonths);
  const opexByCategory: Record<string, MonthlyRow> = {};
  const salesRevenue = emptyRow(allMonths);
  const purchaseCost = emptyRow(allMonths);
  const totalSalary = emptyRow(allMonths);

  const ensureOpex = (cat: string): MonthlyRow => {
    if (!opexByCategory[cat]) opexByCategory[cat] = emptyRow(allMonths);
    return opexByCategory[cat];
  };

  // 2026-06-10 발생주의 통일 — 비용에서 제외할 자금이동/비-비용 카테고리(이체·대출·카드대금·세금·인출 등)
  const NON_EXPENSE_CAT = ["이체", "송금", "대출", "상환", "카드대금", "카드이용대금", "세금", "부가세", "인출", "충당", "보증금", "예치", "예금"];
  const isNonExpenseCat = (c: string) => NON_EXPENSE_CAT.some((k) => c.includes(k));

  // 미분류 출금 규모 — 판관비에서 빠진 금액(경고 배너용). 자금이동(이체/카드대금 등)은 원래 비용 아님이라 제외.
  let uncategorizedCount = 0;
  let uncategorizedAmount = 0;
  for (const tx of transactions as any[]) {
    const month = toMonth(tx.transaction_date);
    if (!allMonths.includes(month)) continue;
    const amt = Math.abs(tx.amount);

    // 매출=세금계산서(sales) 기준. 비용도 발생주의 통일 — 매출원가는 매입 세금계산서로 인식,
    //   통장 출금은 '사용자가 명시 분류한 판관비'만 비용 인식. 미분류·자금이동(이체/대출/카드대금/세금/인출)은
    //   비용에서 제외해 허수 과대계상 차단(99% 미분류 출금이 손익을 −4억 허수로 만들던 문제).
    if (tx.type === "expense" || tx.type === "출금") {
      const userCat = (tx.category && String(tx.category).trim()) || "";
      if (isNonExpenseCat(userCat)) continue;      // 자금이동 = 비용 아님(경고 대상도 아님)
      if (!userCat) { uncategorizedCount++; uncategorizedAmount += amt; continue; } // 미분류 = 판관비 누락
      ensureOpex(userCat)[month] += amt;
    }
  }

  for (const ti of taxInvoices) {
    const month = toMonth(ti.issue_date);
    if (!allMonths.includes(month)) continue;
    if (ti.type === "sales" || ti.type === "매출") {
      salesRevenue[month] += ti.supply_amount;
    } else if (ti.type === "purchase" || ti.type === "매입") {
      // 직원 QA 손익계산서 — 매입 세금계산서에 계정과목(expense_category)을 지정하면 그 판관비로,
      //   미지정이면 매출원가(COGS)로. "매입세금계산서라도 비용으로 빠질 건 빠지게".
      const cat = (ti.expense_category && String(ti.expense_category).trim()) || "";
      if (cat) ensureOpex(cat)[month] += ti.supply_amount;
      else purchaseCost[month] += ti.supply_amount;
    }
  }

  const monthlySalaryTotal = employees.reduce((sum, e) => sum + (e.salary || 0), 0);
  /* 사업주 부담 4대보험 요율 합계: 국민연금 4.5% + 건강보험 3.545% + 장기요양 0.459% + 고용보험 1.35% + 산재보험 0.7% = 10.554% */
  const EMPLOYER_INSURANCE_RATE = 0.1055;
  const monthlyInsurance = employees.reduce(
    (sum, e) => sum + (e.is_4_insurance && e.salary ? e.salary * EMPLOYER_INSURANCE_RATE : 0),
    0,
  );

  // 직원 등록 기반 급여·4대보험 — 거래에 같은 금액 없을 때 보강
  const salaryRow = ensureOpex("급여");
  const insuranceRow = ensureOpex("4대보험");
  for (const m of allMonths) {
    totalSalary[m] = monthlySalaryTotal;
    if (monthlySalaryTotal > (salaryRow[m] || 0)) salaryRow[m] = monthlySalaryTotal;
    if (monthlyInsurance > (insuranceRow[m] || 0)) insuranceRow[m] = monthlyInsurance;
  }

  // 2026-05-22 손익계산서 매출 = 세금계산서(sales) 공급가액 기준 (사장님 요청).
  //   기존 cross-reference(세금계산서 초과분 → 기타수익) 제거. revenue = salesRevenue.
  //   otherRevenue 는 0 유지(영업외수익 별도 소스 없음).
  for (const m of allMonths) {
    revenue[m] = salesRevenue[m];
  }

  return {
    months,
    prevMonths,
    revenue,
    otherRevenue,
    outsourcing,
    infrastructure,
    opexByCategory,
    salesRevenue,
    purchaseCost,
    totalSalary,
    uncategorizedCount,
    uncategorizedAmount,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PnlPage() {
  const { role } = useUser();
  if (role === "partner") {
    return <AccessDenied detail="손익계산서는 대표·관리자 전용입니다." />;
  }
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [data, setData] = useState<PnlData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompareMode, setIsCompareMode] = useState(false);
  // 기본 = 1회계기간(당해 회계연도 1월 ~ 현재월). 사용자가 달력으로 직접 조정 가능.
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01`; // 회계연도 시작 = 1월
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; // 현재월
  });
  // sync 후 강제 재fetch trigger
  const [refreshKey, setRefreshKey] = useState(0);
  // 손익 항목 드릴다운 (줄 클릭 → 원천 내역 모달)
  const [drill, setDrill] = useState<{ source: "sales" | "purchase" | "opex" | "computed"; category?: string; label: string; breakdown?: { label: string; amount: number }[] } | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) setCompanyId(u.company_id);
      else setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setIsLoading(true);
    setError(null);
    fetchPnlData(companyId, 0, customStart, customEnd)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [companyId, customStart, customEnd, refreshKey]);

  const computed = useMemo(() => {
    if (!data) return null;
    const { months, prevMonths } = data;
    const allM = [...prevMonths, ...months];

    const totalRevenue = emptyRow(allM);
    const cogs = emptyRow(allM);
    const grossProfit = emptyRow(allM);
    const totalOpex = emptyRow(allM);
    const operatingIncome = emptyRow(allM);
    const netIncome = emptyRow(allM);

    for (const m of allM) {
      totalRevenue[m] = (data.revenue[m] || 0) + (data.otherRevenue[m] || 0);
      // 발생주의: 매출원가 = 매입 세금계산서 공급가액(통장 출금 아님). 매출(세금계산서)과 기준 일치.
      cogs[m] = (data.purchaseCost[m] || 0);
      grossProfit[m] = totalRevenue[m] - cogs[m];
      let opexSum = 0;
      for (const row of Object.values(data.opexByCategory)) {
        opexSum += row[m] || 0;
      }
      totalOpex[m] = opexSum;
      operatingIncome[m] = grossProfit[m] - totalOpex[m];
      netIncome[m] = operatingIncome[m];
    }

    /* Previous period sums for comparison */
    const sumPrev = (row: MonthlyRow) => prevMonths.reduce((s, m) => s + (row[m] || 0), 0);
    const sumCurr = (row: MonthlyRow) => months.reduce((s, m) => s + (row[m] || 0), 0);

    const prevTotals = {
      totalRevenue: sumPrev(totalRevenue),
      cogs: sumPrev(cogs),
      grossProfit: sumPrev(grossProfit),
      totalOpex: sumPrev(totalOpex),
      operatingIncome: sumPrev(operatingIncome),
      netIncome: sumPrev(netIncome),
    };

    return { totalRevenue, cogs, grossProfit, totalOpex, operatingIncome, netIncome, prevTotals, sumPrev, sumCurr };
  }, [data]);

  const handleExportCsv = useCallback(() => {
    if (!data || !computed) return;
    const { months } = data;
    const lines: string[] = [];
    const header = ["항목", ...months.map(formatMonthLabel), "합계"];
    lines.push(header.join(","));

    const addLine = (label: string, row: MonthlyRow) => {
      const vals = months.map((m) => Math.round(row[m]));
      const total = vals.reduce((a, b) => a + b, 0);
      lines.push([label, ...vals, total].join(","));
    };

    addLine("매출 (세금계산서 기준)", data.revenue);
    lines.push("");
    addLine("매입원가 (매입 세금계산서)", data.purchaseCost);
    addLine("매출총이익", computed.grossProfit);
    lines.push("");
    for (const [name, row] of Object.entries(data.opexByCategory)) {
      addLine(name, row);
    }
    addLine("판매관리비 합계", computed.totalOpex);
    lines.push("");
    addLine("영업이익", computed.operatingIncome);
    addLine("당기순이익", computed.netIncome);

    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `손익계산서_${data.months[0]}_${data.months[data.months.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, computed]);

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */
  const renderRow = (
    label: string,
    row: MonthlyRow,
    months: string[],
    options?: {
      isBold?: boolean;
      isSubtotal?: boolean;
      isTotal?: boolean;
      indent?: boolean;
      prevTotal?: number;
      drill?: { source: "sales" | "purchase" | "opex" | "computed"; category?: string; breakdown?: { label: string; amount: number }[] };
    },
  ) => {
    const total = months.reduce((s, m) => s + (row[m] || 0), 0);
    const isHighlight = options?.isSubtotal || options?.isTotal;
    const delta = options?.prevTotal !== undefined ? total - options.prevTotal : undefined;

    return (
      <tr
        key={label}
        style={{
          borderTop: options?.isSubtotal ? "1px solid var(--border)" : undefined,
          borderBottom: options?.isTotal ? "2px solid var(--text)" : undefined,
        }}
      >
        <td
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: options?.isBold || isHighlight ? 600 : 400,
            color: isHighlight ? "var(--text)" : "var(--text-muted)",
            paddingLeft: options?.indent ? 36 : 16,
            whiteSpace: "nowrap",
            position: "sticky",
            left: 0,
            background: isHighlight ? "var(--bg-surface)" : "var(--bg-card)",
            zIndex: 2,
          }}
        >
          {options?.drill ? (
            <button
              type="button"
              onClick={() => setDrill({ source: options.drill!.source, category: options.drill!.category, breakdown: options.drill!.breakdown, label })}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
              className="hover:underline hover:text-[var(--primary)]"
              title="클릭하면 상세 내역을 봅니다"
            >
              {label} <span style={{ fontSize: 10, opacity: 0.55 }}>›</span>
            </button>
          ) : label}
        </td>
        <td
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "right",
            color: total < 0 ? "var(--danger)" : "var(--text)",
            background: isHighlight ? "var(--bg-surface)" : "var(--bg-card)",
            whiteSpace: "nowrap",
            position: "sticky",
            right: isCompareMode ? 120 : 0,
            zIndex: 2,
          }}
        >
          {formatKrw(total)}
        </td>
        {isCompareMode && (
          <td
            style={{
              padding: "10px 16px",
              fontSize: 12,
              fontWeight: 500,
              textAlign: "right",
              whiteSpace: "nowrap",
              color: delta === undefined || delta === 0
                ? "var(--text-dim)"
                : delta > 0 ? "var(--success)" : "var(--danger)",
              background: isHighlight ? "var(--bg-surface)" : "var(--bg-card)",
              position: "sticky",
              right: 0,
              zIndex: 2,
            }}
          >
            {delta === undefined || delta === 0
              ? "-"
              : `${delta > 0 ? "+" : ""}${formatKrw(delta)} ${delta > 0 ? "\u25B2" : "\u25BC"}`}
          </td>
        )}
      </tr>
    );
  };

  const getColCount = (_monthsArr: string[]) => 2 + (isCompareMode ? 1 : 0);

  const renderSectionHeader = (label: string, months: string[]) => (
    <tr key={`header-${label}`}>
      <td
        colSpan={getColCount(months)}
        style={{
          padding: "14px 16px 6px",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--primary)",
          background: "var(--bg-card)",
          position: "sticky",
          left: 0,
          zIndex: 2,
        }}
      >
        {label}
      </td>
    </tr>
  );

  const renderDivider = (months: string[], key: string) => (
    <tr key={key}>
      <td
        colSpan={getColCount(months)}
        style={{ padding: 0, height: 1, background: "var(--border)" }}
      />
    </tr>
  );

  /* ---------------------------------------------------------------- */
  /*  Main render                                                      */
  /* ---------------------------------------------------------------- */
  if (isLoading) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 20,
              height: 20,
              border: "2px solid var(--border)",
              borderTopColor: "var(--primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: 14 }}>
            손익계산서 데이터를 불러오는 중...
          </span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div
          style={{
            padding: "16px 20px",
            borderRadius: 8,
            background: "var(--danger-dim)",
            color: "var(--danger)",
            fontSize: 14,
          }}
        >
          데이터 로드 실패: {error}
        </div>
      </div>
    );
  }

  if (!data || !computed) {
    return (
      <div className="p-16 text-center">
        <div className="text-4xl mb-3">📊</div>
        <div className="text-sm font-medium text-[var(--text)]">거래 데이터가 쌓이면 손익계산서가 자동 생성됩니다</div>
        <div className="text-xs text-[var(--text-muted)] mt-1">거래내역 페이지에서 매출/비용을 먼저 등록해주세요</div>
      </div>
    );
  }

  const { months } = data;

  /* Helper: sum previous period for a data row */
  const prevSum = (row: MonthlyRow) => data.prevMonths.reduce((s, m) => s + (row[m] || 0), 0);

  return (
    <div id="pnl-printable">
      <style>{PRINT_CSS}</style>
      <ReportsTabs />
      <StatementsTabs />
      {/* 툴바 — 기간(좌) + 액션(우). 페이지 타이틀은 공통 헤더바가 표시 (2026-07-03 라운드6.5) */}
      <div className="page-sticky-header no-print-sticky mb-6 flex flex-wrap items-center justify-between gap-2">
        {/* 조회 기간 — 월 범위. 다른 페이지 달력과 동일한 단일 컨트롤 스타일(h-9·rounded-lg). 2026-06-30 테두리 중첩 제거 */}
        <div className="inline-flex items-center gap-1.5">
          <MonthField value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} title="시작 월"
            className="h-9 px-3 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:border-[var(--primary)] transition" />
          <span className="text-[var(--text-dim)] text-xs">~</span>
          <MonthField value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} title="종료 월"
            className="h-9 px-3 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:border-[var(--primary)] transition" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setIsCompareMode((v) => !v)}
            aria-label="전기 비교"
            className={isCompareMode ? "btn-primary text-xs" : "btn-secondary text-xs"}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" /></svg>
            전기 비교
          </button>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            aria-label="새로고침"
            title="DB 에서 최신 데이터 다시 불러오기"
            className="btn-ghost text-xs"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            새로고침
          </button>
          <button
            onClick={handleExportCsv}
            aria-label="CSV 다운로드"
            className="btn-secondary text-xs"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            CSV
          </button>
          <button
            onClick={() => window.print()}
            aria-label="인쇄"
            className="btn-secondary text-xs"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            인쇄
          </button>
        </div>
      </div>

      {/* 미분류 출금 경고 — 판관비 과소계상(영업이익 과대) 오해 방지 */}
      {data.uncategorizedCount > 0 && (
        <div className="kpi-callout warning mb-4 flex items-start gap-2 text-sm">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <div className="leading-relaxed">
            분류되지 않은 통장 출금 <b>{data.uncategorizedCount.toLocaleString()}건</b>(약 <b>₩{Math.round(data.uncategorizedAmount).toLocaleString()}</b>)이
            판매관리비에 <b>반영되지 않았습니다</b> — 실제보다 영업이익이 크게 보일 수 있습니다.
            <span className="text-[var(--text-muted)]"> 통장 거래내역 또는 거래 매칭에서 계정을 분류하면 손익에 자동 반영됩니다.</span>
          </div>
        </div>
      )}

      {/* Summary Cards — 대시보드 글래스카드 스타일 (2026-06-10 리디자인) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" style={{ marginBottom: 24 }}>
        {[
          {
            label: "총 매출",
            value: computed.sumCurr(computed.totalRevenue),
            prev: computed.prevTotals.totalRevenue,
            color: "var(--primary)",
          },
          {
            label: "매출총이익",
            value: computed.sumCurr(computed.grossProfit),
            prev: computed.prevTotals.grossProfit,
            color: "var(--success)",
          },
          {
            label: "영업이익",
            value: computed.sumCurr(computed.operatingIncome),
            prev: computed.prevTotals.operatingIncome,
            color: computed.sumCurr(computed.operatingIncome) >= 0 ? "var(--success)" : "var(--danger)",
          },
          {
            label: "당기순이익",
            value: computed.sumCurr(computed.netIncome),
            prev: computed.prevTotals.netIncome,
            color: computed.sumCurr(computed.netIncome) >= 0 ? "var(--success)" : "var(--danger)",
          },
        ].map((card) => {
          const d = card.value - card.prev;
          const pct = card.prev !== 0 ? Math.round((d / Math.abs(card.prev)) * 100) : 0;
          return (
            <div key={card.label} className="glass-card p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--text-muted)]">{card.label}</span>
                <span className={`kpi-icon ${card.value < 0 ? "danger" : card.label === "총 매출" ? "" : "success"}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M21 7v6m0-6h-6" /></svg>
                </span>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <span className={`text-[26px] leading-8 font-extrabold mono-number ${card.value < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
                  {card.value < 0 ? "-" : ""}₩{Math.abs(Math.round(card.value)).toLocaleString("ko-KR")}
                </span>
              </div>
              {isCompareMode && card.prev !== 0 && (
                <div className={`delta-chip self-start ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : "delta-flat"}`}>
                  전기 대비 {d > 0 ? "+" : ""}{pct}% {d > 0 ? "\u25B2" : d < 0 ? "\u25BC" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Table — 대시보드 글래스카드 (2026-06-10) */}
      <div className="glass-card" style={{ overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: 480,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
              }}
            >
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "left",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  position: "sticky",
                  left: 0,
                  background: "var(--bg-card)",
                  zIndex: 3,
                  whiteSpace: "nowrap",
                }}
              >
                항목
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  whiteSpace: "nowrap",
                  position: "sticky",
                  right: isCompareMode ? 120 : 0,
                  background: "var(--bg-card)",
                  zIndex: 3,
                }}
              >
                합계
              </th>
              {isCompareMode && (
                <th
                  style={{
                    padding: "12px 16px",
                    textAlign: "right",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    whiteSpace: "nowrap",
                    position: "sticky",
                    right: 0,
                    background: "var(--bg-card)",
                    zIndex: 3,
                  }}
                >
                  전기 대비
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {/* Revenue Section — 2026-05-22 세금계산서(sales) 공급가액 기준. 기타수익 분리 제거. */}
            {renderSectionHeader("매출 (Revenue)", months)}
            {renderRow("매출 (세금계산서 기준)", data.revenue, months, { isSubtotal: true, isBold: true, prevTotal: isCompareMode ? prevSum(data.revenue) : undefined, drill: { source: "sales" } })}

            {renderDivider(months, "div-1")}

            {/* Cost of Revenue — 발생주의: 매입 세금계산서 기준 (2026-06-10) */}
            {renderSectionHeader("매출원가 (COGS · 매입 세금계산서)", months)}
            {renderRow("매입원가", data.purchaseCost, months, { indent: true, prevTotal: isCompareMode ? prevSum(data.purchaseCost) : undefined, drill: { source: "purchase" } })}

            {renderDivider(months, "div-2")}

            {/* Gross Profit */}
            {renderRow("매출총이익 (Gross Profit)", computed.grossProfit, months, {
              isTotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.grossProfit : undefined,
              drill: { source: "computed", breakdown: [
                { label: "매출 (세금계산서 기준)", amount: months.reduce((s, m) => s + (data.revenue[m] || 0), 0) },
                { label: "매입원가", amount: -months.reduce((s, m) => s + (data.purchaseCost[m] || 0), 0) },
              ] },
            })}

            {renderDivider(months, "div-3")}

            {/* 판매관리비 — 사용자 category 동적 그룹 (사용자가 직접 입력한 카테고리도 자동 표시) */}
            {renderSectionHeader("판매관리비 (Sales & Admin Expenses)", months)}
            {Object.entries(data.opexByCategory)
              .sort((a, b) => {
                const sa = months.reduce((s, m) => s + (a[1][m] || 0), 0);
                const sb = months.reduce((s, m) => s + (b[1][m] || 0), 0);
                return sb - sa;
              })
              .map(([name, row]) => renderRow(name, row, months, {
                indent: true,
                prevTotal: isCompareMode ? data.prevMonths.reduce((s, m) => s + (row[m] || 0), 0) : undefined,
                drill: { source: "opex", category: name },
              }))}
            {renderRow("판매관리비 합계", computed.totalOpex, months, {
              isSubtotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.totalOpex : undefined,
            })}

            {renderDivider(months, "div-4")}

            {/* Operating Income */}
            {renderRow("영업이익 (Operating Income)", computed.operatingIncome, months, {
              isTotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.operatingIncome : undefined,
              drill: { source: "computed", breakdown: [
                { label: "매출총이익", amount: months.reduce((s, m) => s + (computed.grossProfit[m] || 0), 0) },
                { label: "판매관리비 합계", amount: -months.reduce((s, m) => s + (computed.totalOpex[m] || 0), 0) },
              ] },
            })}

            {renderDivider(months, "div-5")}

            {/* Net Income */}
            {renderRow("당기순이익 (Net Income)", computed.netIncome, months, {
              isTotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.netIncome : undefined,
              drill: { source: "computed", breakdown: [
                { label: "영업이익 (영업외손익·법인세 미반영)", amount: months.reduce((s, m) => s + (computed.operatingIncome[m] || 0), 0) },
              ] },
            })}
          </tbody>
        </table>
      </div>

      {/* Chart — 표 아래 */}
      <div style={{ marginTop: 20 }}>
        <PnlChart
          months={months}
          totalRevenue={computed.totalRevenue}
          totalExpenses={(() => {
            const row: Record<string, number> = {};
            for (const m of months) {
              row[m] = computed.cogs[m] + computed.totalOpex[m];
            }
            return row;
          })()}
          netIncome={computed.netIncome}
        />
      </div>

      {/* 정확도 안내 배너 — 미분류 비용 제외 한계 */}
      <div className="kpi-callout mt-4 flex items-start gap-2.5">
        <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 16v-4m0-4h.01" /></svg>
        <p className="text-[11.5px] leading-relaxed">
          <b>매출·매입원가는 세금계산서(발생주의) 기준</b>이라 정확합니다. 단 <b>판매관리비는 카테고리가 분류된 출금만</b> 반영됩니다 — 미분류 출금은 자금이동(이체·카드대금 등)과 섞여 허수를 만들기에 제외돼, 비용이 실제보다 적게(이익은 많게) 보일 수 있습니다. <Link href="/transactions" className="underline font-semibold">거래내역</Link>에서 비용을 분류할수록 정확해집니다.
        </p>
      </div>

      {/* 산출 기준 — 접이식 */}
      <details className="mt-4 group rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
            <svg className="w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 16v-4m0-4h.01" /></svg>
            산출 기준 자세히 보기
          </span>
          <svg className="w-4 h-4 text-[var(--text-dim)] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </summary>
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[11.5px] leading-relaxed text-[var(--text-dim)] border-t border-[var(--border)] pt-3">
          <div>· <b className="text-[var(--text-muted)]">매출</b> = 매출 세금계산서 공급가액(발생주의)</div>
          <div>· <b className="text-[var(--text-muted)]">매출원가</b> = 매입 세금계산서 공급가액</div>
          <div>· <b className="text-[var(--text-muted)]">판매관리비</b> = 카테고리 분류된 출금(자금이동·미분류 제외)</div>
          <div>· <b className="text-[var(--text-muted)]">급여</b> = 등록 직원 월급여, <b className="text-[var(--text-muted)]">4대보험</b> = 급여×약 10.55%(사업주 부담 추정)</div>
          <div className="sm:col-span-2">· <b className="text-[var(--text-muted)]">당기순이익</b> = 영업이익 (영업외손익·법인세 미반영)</div>
        </div>
      </details>

      {drill && companyId && data && (
        <PnlDrillModal
          companyId={companyId}
          source={drill.source}
          category={drill.category}
          label={drill.label}
          breakdown={drill.breakdown}
          start={months[0]}
          end={months[months.length - 1]}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// 손익 항목 드릴다운 모달 — 클릭한 줄의 원천 내역(매출/매입 세금계산서 · 판관비 분류 거래)을 기간으로 조회.
function PnlDrillModal({ companyId, source, category, label, start, end, breakdown, onClose }: {
  companyId: string;
  source: "sales" | "purchase" | "opex" | "computed";
  category?: string;
  label: string;
  start: string;
  end: string;
  breakdown?: { label: string; amount: number }[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ date: string; name: string; amount: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (source === "computed") return;
    const startDate = `${start}-01`;
    const [ey, em] = end.split("-").map(Number);
    const endExclusive = em === 12 ? `${ey + 1}-01-01` : `${ey}-${String(em + 1).padStart(2, "0")}-01`;
    (async () => {
      try {
        if (source === "opex") {
          const { data, error } = await (supabase as any)
            .from("bank_transactions")
            .select("transaction_date, counterparty, description, amount, category")
            .eq("company_id", companyId).in("type", ["expense", "출금"]).eq("category", category)
            .gte("transaction_date", startDate).lt("transaction_date", endExclusive)
            .order("transaction_date", { ascending: true }).limit(2000);
          if (error) throw error;
          setRows((data || []).map((r: any) => ({ date: r.transaction_date, name: r.counterparty || r.description || "—", amount: Math.abs(Number(r.amount || 0)) })));
        } else {
          const types = source === "sales" ? ["sales", "매출"] : ["purchase", "매입"];
          const { data, error } = await (supabase as any)
            .from("tax_invoices")
            .select("issue_date, counterparty_name, supply_amount, type, status")
            .eq("company_id", companyId).in("type", types).neq("status", "void")
            .gte("issue_date", startDate).lt("issue_date", endExclusive)
            .order("issue_date", { ascending: true }).limit(2000);
          if (error) throw error;
          setRows((data || []).map((r: any) => ({ date: r.issue_date, name: r.counterparty_name || "—", amount: Number(r.supply_amount || 0) })));
        }
      } catch (e: any) { setErr(e?.message || "불러오기 실패"); }
    })();
  }, [companyId, source, category, start, end]);

  const bd = breakdown || [];
  const total = source === "computed" ? bd.reduce((s, b) => s + b.amount, 0) : (rows || []).reduce((s, r) => s + r.amount, 0);
  const srcLabel = source === "computed" ? "산출 구성" : source === "opex" ? "분류된 거래내역" : source === "sales" ? "매출 세금계산서" : "매입 세금계산서";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[82vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">{label} — 상세 내역</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{source === "computed" ? srcLabel : `${start} ~ ${end} · ${srcLabel}`}</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
        </div>
        <div className="flex-1 overflow-auto">
          {source === "computed" ? (
            <table className="w-full text-sm">
              <tbody>
                {bd.map((b, i) => (
                  <tr key={i} className="border-t border-[var(--border)]/40 first:border-t-0">
                    <td className="px-5 py-3 text-[var(--text-muted)]">{b.amount < 0 ? "− " : "+ "}{b.label}</td>
                    <td className="px-5 py-3 text-right mono-number" style={{ color: b.amount < 0 ? "var(--danger)" : "var(--text)" }}>{formatKrw(Math.abs(b.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : err ? (
            <div className="p-8 text-center text-sm text-red-400">{err}</div>
          ) : rows === null ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">해당 기간 내역이 없습니다.{source === "opex" ? " (급여·4대보험 등은 직원 등록 기반 추정치라 거래가 없을 수 있습니다.)" : ""}</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--bg-surface)] text-[var(--text-muted)]">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold whitespace-nowrap">일자</th>
                  <th className="text-left px-4 py-2 font-semibold">{source === "opex" ? "거래처 / 적요" : "거래처"}</th>
                  <th className="text-right px-4 py-2 font-semibold whitespace-nowrap">금액</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50">
                    <td className="px-4 py-2 text-[var(--text-muted)] mono-number whitespace-nowrap align-top">{r.date}</td>
                    <td className="px-4 py-2 text-[var(--text)]">{r.name}</td>
                    <td className="px-4 py-2 text-right mono-number text-[var(--text)] whitespace-nowrap align-top">{formatKrw(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-muted)]">{source === "computed" ? "" : rows ? `${rows.length}건` : ""}</span>
          <span className="text-sm font-bold mono-number text-[var(--text)]">{source === "computed" ? label : "합계"} {formatKrw(total)}</span>
        </div>
      </div>
    </div>
  );
}
