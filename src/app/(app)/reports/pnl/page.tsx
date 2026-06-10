"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import PnlChart from "./pnl-chart";

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
        .select("type, supply_amount, tax_amount, total_amount, issue_date, status")
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

  for (const tx of transactions as any[]) {
    const month = toMonth(tx.transaction_date);
    if (!allMonths.includes(month)) continue;
    const amt = Math.abs(tx.amount);

    // 매출=세금계산서(sales) 기준. 비용도 발생주의 통일 — 매출원가는 매입 세금계산서로 인식,
    //   통장 출금은 '사용자가 명시 분류한 판관비'만 비용 인식. 미분류·자금이동(이체/대출/카드대금/세금/인출)은
    //   비용에서 제외해 허수 과대계상 차단(99% 미분류 출금이 손익을 −4억 허수로 만들던 문제).
    if (tx.type === "expense" || tx.type === "출금") {
      const userCat = (tx.category && String(tx.category).trim()) || "";
      if (!userCat || isNonExpenseCat(userCat)) continue;
      ensureOpex(userCat)[month] += amt;
    }
  }

  for (const ti of taxInvoices) {
    const month = toMonth(ti.issue_date);
    if (!allMonths.includes(month)) continue;
    if (ti.type === "sales" || ti.type === "매출") {
      salesRevenue[month] += ti.supply_amount;
    } else if (ti.type === "purchase" || ti.type === "매입") {
      purchaseCost[month] += ti.supply_amount;
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
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PnlPage() {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
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
          {label}
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
            borderLeft: "1px solid var(--border)",
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
                : delta > 0 ? "#10b981" : "#ef4444",
              background: isHighlight ? "var(--bg-surface)" : "var(--bg-card)",
              borderLeft: "1px solid var(--border)",
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
      <Link href="/reports" className="no-print" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", textDecoration: "none", marginBottom: 14 }}>
        ← 분석 허브
      </Link>
      {/* Header — 표준 .page-sticky-header(z-30·blur·앱 상단바 안 가림). 2026-06-10 커스텀 sticky(z-10 짤림) 교체 */}
      <div
        className="page-sticky-header no-print-sticky"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--text)",
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            손익계산서 (P&L)
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-dim)",
              margin: "4px 0 0",
            }}
          >
            {formatMonthLabel(months[0])} ~ {formatMonthLabel(months[months.length - 1])} 월별 손익 현황 (단위: 원)
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* 조회 기간 — 달력만 (preset 제거) */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <label style={{ color: "var(--text-dim)", marginRight: 4 }}>조회 기간:</label>
            <input
              type="month"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: 12,
              }}
            />
            <span style={{ color: "var(--text-dim)" }}>~</span>
            <input
              type="month"
              value={customEnd}
              min={customStart}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: 12,
              }}
            />
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-muted)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={isCompareMode}
              onChange={(e) => setIsCompareMode(e.target.checked)}
              style={{ accentColor: "var(--primary)" }}
            />
            전기 비교
          </label>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            aria-label="새로고침"
            title="DB 에서 최신 데이터 다시 불러오기"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--primary)",
              background: "var(--primary)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            새로고침
          </button>
          <button
            onClick={handleExportCsv}
            aria-label="CSV 다운로드"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--primary)";
              (e.target as HTMLElement).style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--border)";
              (e.target as HTMLElement).style.color = "var(--text-muted)";
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            CSV 다운로드
          </button>
          <button
            onClick={() => window.print()}
            aria-label="인쇄"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--primary)";
              (e.target as HTMLElement).style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--border)";
              (e.target as HTMLElement).style.color = "var(--text-muted)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            인쇄
          </button>
        </div>
      </div>

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
            color: "#10b981",
          },
          {
            label: "영업이익",
            value: computed.sumCurr(computed.operatingIncome),
            prev: computed.prevTotals.operatingIncome,
            color: computed.sumCurr(computed.operatingIncome) >= 0 ? "#10b981" : "var(--danger)",
          },
          {
            label: "당기순이익",
            value: computed.sumCurr(computed.netIncome),
            prev: computed.prevTotals.netIncome,
            color: computed.sumCurr(computed.netIncome) >= 0 ? "#10b981" : "var(--danger)",
          },
        ].map((card) => {
          const d = card.value - card.prev;
          const pct = card.prev !== 0 ? Math.round((d / Math.abs(card.prev)) * 100) : 0;
          return (
            <div key={card.label} className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                {card.label}
              </div>
              <div className="mono-number" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: card.color, lineHeight: 1.1 }}>
                {card.value < 0 ? "-" : ""}₩{Math.abs(card.value).toLocaleString("ko-KR")}
              </div>
              <div style={{ height: 3, width: 36, borderRadius: 999, marginTop: 12, background: card.color, opacity: 0.85 }} />
              {isCompareMode && card.prev !== 0 && (
                <div style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: d === 0 ? "var(--text-dim)" : d > 0 ? "#10b981" : "#ef4444",
                  fontWeight: 500,
                }}>
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
                borderBottom: "2px solid var(--border)",
                background: "var(--bg-surface)",
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
                  background: "var(--bg-surface)",
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
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  borderLeft: "1px solid var(--border)",
                  position: "sticky",
                  right: isCompareMode ? 120 : 0,
                  background: "var(--bg-surface)",
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
                    borderLeft: "1px solid var(--border)",
                    position: "sticky",
                    right: 0,
                    background: "var(--bg-surface)",
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
            {renderRow("매출 (세금계산서 기준)", data.revenue, months, { isSubtotal: true, isBold: true, prevTotal: isCompareMode ? prevSum(data.revenue) : undefined })}

            {renderDivider(months, "div-1")}

            {/* Cost of Revenue — 발생주의: 매입 세금계산서 기준 (2026-06-10) */}
            {renderSectionHeader("매출원가 (COGS · 매입 세금계산서)", months)}
            {renderRow("매입원가", data.purchaseCost, months, { indent: true, prevTotal: isCompareMode ? prevSum(data.purchaseCost) : undefined })}

            {renderDivider(months, "div-2")}

            {/* Gross Profit */}
            {renderRow("매출총이익 (Gross Profit)", computed.grossProfit, months, {
              isTotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.grossProfit : undefined,
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
            })}

            {renderDivider(months, "div-5")}

            {/* Net Income */}
            {renderRow("당기순이익 (Net Income)", computed.netIncome, months, {
              isTotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.netIncome : undefined,
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

      {/* Footer note */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 8,
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-dim)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--text-muted)" }}>참고</strong>
        <br />
        - 매출/비용은 은행 거래내역(bank_transactions)과 세금계산서(tax_invoices) 데이터를 기반으로 자동 분류됩니다.
        <br />
        - 급여는 등록된 직원 정보의 월급여 데이터가 반영됩니다. 4대보험은 사업주 부담분 기준 급여의 약 10.55%로 추정 계산됩니다.
        <br />
        - 정확한 분류를 위해 거래내역의 거래처/적요를 상세히 기입해주세요.
      </div>
    </div>
  );
}
