"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import PnlChart from "./pnl-chart";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const MONTHS_TO_SHOW = 6;
const PREV_MONTHS_TO_SHOW = 12; // fetch 12 months so we can compute previous period

const COGS_KEYWORDS = ["외주", "인프라", "서버", "호스팅", "AWS", "클라우드", "도메인"];
const SALARY_KEYWORDS = ["급여", "인건비", "상여", "보너스"];
const RENT_KEYWORDS = ["임대", "월세", "관리비", "스파크플러스"];
const SOFTWARE_KEYWORDS = ["소프트웨어", "SaaS", "구독", "라이선스"];
const PROFESSIONAL_KEYWORDS = ["세무", "법무", "회계", "컨설팅", "자문", "전문서비스"];
const WELFARE_KEYWORDS = ["복리후생", "식대", "경조사", "체육", "건강검진"];
const INSURANCE_KEYWORDS = ["4대보험", "국민연금", "건강보험", "고용보험", "산재보험"];

type CategoryKey =
  | "revenue"
  | "otherRevenue"
  | "outsourcing"
  | "infrastructure"
  | "salary"
  | "rent"
  | "software"
  | "professional"
  | "welfare"
  | "insurance"
  | "otherOpex";

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  revenue: "매출",
  otherRevenue: "기타수익",
  outsourcing: "외주비",
  infrastructure: "인프라비용",
  salary: "급여",
  rent: "임대료",
  software: "소프트웨어",
  professional: "전문서비스",
  welfare: "복리후생",
  insurance: "4대보험",
  otherOpex: "기타 운영비",
};

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
  salary: MonthlyRow;
  rent: MonthlyRow;
  software: MonthlyRow;
  professional: MonthlyRow;
  welfare: MonthlyRow;
  insurance: MonthlyRow;
  otherOpex: MonthlyRow;
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

function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function matchesAny(text: string | null, keywords: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function classifyExpense(
  counterparty: string | null,
  description: string | null,
  category: string | null,
): CategoryKey {
  const combined = [counterparty, description, category].filter(Boolean).join(" ");
  if (matchesAny(combined, COGS_KEYWORDS)) {
    if (matchesAny(combined, ["외주"])) return "outsourcing";
    return "infrastructure";
  }
  if (matchesAny(combined, SALARY_KEYWORDS)) return "salary";
  if (matchesAny(combined, RENT_KEYWORDS)) return "rent";
  if (matchesAny(combined, SOFTWARE_KEYWORDS)) return "software";
  if (matchesAny(combined, PROFESSIONAL_KEYWORDS)) return "professional";
  if (matchesAny(combined, WELFARE_KEYWORDS)) return "welfare";
  if (matchesAny(combined, INSURANCE_KEYWORDS)) return "insurance";
  return "otherOpex";
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

/* Category tooltip descriptions for classification criteria */
const CATEGORY_TOOLTIPS: Record<CategoryKey, string> = {
  revenue: "은행 입금 내역 중 '입금' 유형의 거래 합계",
  otherRevenue: "세금계산서 매출이 은행 입금보다 클 때의 차액 (미수금 등)",
  outsourcing: "거래처/적요에 '외주' 키워드가 포함된 지출",
  infrastructure: "거래처/적요에 '인프라, 서버, 호스팅, AWS, 클라우드, 도메인' 키워드가 포함된 지출",
  salary: "거래처/적요에 '급여, 인건비, 상여, 보너스' 키워드가 포함된 지출 또는 등록 직원 월급여",
  rent: "거래처/적요에 '임대, 월세, 관리비, 스파크플러스' 키워드가 포함된 지출",
  software: "거래처/적요에 '소프트웨어, SaaS, 구독, 라이선스' 키워드가 포함된 지출",
  professional: "거래처/적요에 '세무, 법무, 회계, 컨설팅, 자문' 키워드가 포함된 지출",
  welfare: "거래처/적요에 '복리후생, 식대, 경조사, 체육, 건강검진' 키워드가 포함된 지출",
  insurance: "거래처/적요에 '4대보험, 국민연금, 건강보험, 고용보험, 산재보험' 키워드가 포함된 지출 또는 등록 직원 급여의 약 9.5%",
  otherOpex: "위 분류에 해당하지 않는 나머지 지출",
};

/* Print CSS */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #pnl-printable, #pnl-printable * { visibility: visible; }
  #pnl-printable { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
  @page { margin: 15mm; }
}
`;

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */
async function fetchPnlData(companyId: string): Promise<PnlData> {
  const allMonths = getLastNMonths(PREV_MONTHS_TO_SHOW);
  const months = allMonths.slice(-MONTHS_TO_SHOW);
  const startDate = `${allMonths[0]}-01`;

  const [txRes, tiRes, empRes] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("amount, type, transaction_date, counterparty, description, category")
      .eq("company_id", companyId)
      .gte("transaction_date", startDate)
      .order("transaction_date", { ascending: true }),
    supabase
      .from("tax_invoices")
      .select("type, supply_amount, tax_amount, total_amount, issue_date")
      .eq("company_id", companyId)
      .gte("issue_date", startDate),
    supabase
      .from("employees")
      .select("salary, is_4_insurance, status")
      .eq("company_id", companyId)
      .eq("status", "active"),
  ]);

  const transactions = txRes.data || [];
  const taxInvoices = tiRes.data || [];
  const employees = empRes.data || [];

  const prevMonths = allMonths.slice(0, MONTHS_TO_SHOW);

  const revenue = emptyRow(allMonths);
  const otherRevenue = emptyRow(allMonths);
  const outsourcing = emptyRow(allMonths);
  const infrastructure = emptyRow(allMonths);
  const salary = emptyRow(allMonths);
  const rent = emptyRow(allMonths);
  const software = emptyRow(allMonths);
  const professional = emptyRow(allMonths);
  const welfare = emptyRow(allMonths);
  const insurance = emptyRow(allMonths);
  const otherOpex = emptyRow(allMonths);
  const salesRevenue = emptyRow(allMonths);
  const purchaseCost = emptyRow(allMonths);
  const totalSalary = emptyRow(allMonths);

  for (const tx of transactions) {
    const month = toMonth(tx.transaction_date);
    if (!allMonths.includes(month)) continue;
    const amt = Math.abs(tx.amount);

    if (tx.type === "income" || tx.type === "입금") {
      revenue[month] += amt;
    } else if (tx.type === "expense" || tx.type === "출금") {
      const cat = classifyExpense(tx.counterparty, tx.description, tx.category);
      const target: Record<CategoryKey, MonthlyRow> = {
        revenue,
        otherRevenue,
        outsourcing,
        infrastructure,
        salary,
        rent,
        software,
        professional,
        welfare,
        insurance,
        otherOpex,
      };
      target[cat][month] += amt;
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
  const monthlyInsurance = employees.reduce(
    (sum, e) => sum + (e.is_4_insurance && e.salary ? e.salary * 0.095 : 0),
    0,
  );

  for (const m of allMonths) {
    totalSalary[m] = monthlySalaryTotal;
    if (monthlySalaryTotal > salary[m]) {
      salary[m] = Math.max(salary[m], monthlySalaryTotal);
    }
    if (monthlyInsurance > insurance[m]) {
      insurance[m] = Math.max(insurance[m], monthlyInsurance);
    }
  }

  // Cross-reference: if tax invoice sales > bank income, use tax invoice figure
  for (const m of allMonths) {
    if (salesRevenue[m] > revenue[m]) {
      otherRevenue[m] += salesRevenue[m] - revenue[m];
    }
  }

  return {
    months,
    prevMonths,
    revenue,
    otherRevenue,
    outsourcing,
    infrastructure,
    salary,
    rent,
    software,
    professional,
    welfare,
    insurance,
    otherOpex,
    salesRevenue,
    purchaseCost,
    totalSalary,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PnlPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [data, setData] = useState<PnlData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [tooltipKey, setTooltipKey] = useState<CategoryKey | null>(null);

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
    fetchPnlData(companyId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [companyId]);

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
      cogs[m] = (data.outsourcing[m] || 0) + (data.infrastructure[m] || 0);
      grossProfit[m] = totalRevenue[m] - cogs[m];
      totalOpex[m] =
        (data.salary[m] || 0) +
        (data.rent[m] || 0) +
        (data.software[m] || 0) +
        (data.professional[m] || 0) +
        (data.welfare[m] || 0) +
        (data.insurance[m] || 0) +
        (data.otherOpex[m] || 0);
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

    addLine("매출", data.revenue);
    addLine("기타수익", data.otherRevenue);
    addLine("총 매출", computed.totalRevenue);
    lines.push("");
    addLine("외주비", data.outsourcing);
    addLine("인프라비용", data.infrastructure);
    addLine("매출원가 합계", computed.cogs);
    addLine("매출총이익", computed.grossProfit);
    lines.push("");
    addLine("급여", data.salary);
    addLine("임대료", data.rent);
    addLine("소프트웨어", data.software);
    addLine("전문서비스", data.professional);
    addLine("복리후생", data.welfare);
    addLine("4대보험", data.insurance);
    addLine("기타 운영비", data.otherOpex);
    addLine("운영비용 합계", computed.totalOpex);
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
      categoryKey?: CategoryKey;
      prevTotal?: number;
    },
  ) => {
    const total = months.reduce((s, m) => s + (row[m] || 0), 0);
    const isHighlight = options?.isSubtotal || options?.isTotal;
    const delta = options?.prevTotal !== undefined ? total - options.prevTotal : undefined;
    const hasTooltip = options?.categoryKey && CATEGORY_TOOLTIPS[options.categoryKey];

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
            cursor: hasTooltip ? "help" : undefined,
          }}
          title={hasTooltip ? CATEGORY_TOOLTIPS[options!.categoryKey!] : undefined}
          onMouseEnter={() => options?.categoryKey && setTooltipKey(options.categoryKey)}
          onMouseLeave={() => setTooltipKey(null)}
        >
          {label}
          {hasTooltip && (
            <span style={{ marginLeft: 4, fontSize: 10, color: "var(--text-dim)", verticalAlign: "super" }}>
              ?
            </span>
          )}
        </td>
        {months.map((m) => (
          <td
            key={m}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: isHighlight ? 600 : 400,
              textAlign: "right",
              color: (row[m] || 0) < 0 ? "var(--danger)" : isHighlight ? "var(--text)" : "var(--text-muted)",
              background: isHighlight ? "var(--bg-surface)" : undefined,
              whiteSpace: "nowrap",
            }}
          >
            {formatKrw(row[m] || 0)}
          </td>
        ))}
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

  const getColCount = (monthsArr: string[]) => monthsArr.length + 2 + (isCompareMode ? 1 : 0);

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
      <div style={{ padding: 40, color: "var(--text-muted)", fontSize: 14 }}>
        데이터가 없습니다. 거래내역을 먼저 등록해주세요.
      </div>
    );
  }

  const { months } = data;

  /* Helper: sum previous period for a data row */
  const prevSum = (row: MonthlyRow) => data.prevMonths.reduce((s, m) => s + (row[m] || 0), 0);

  return (
    <div id="pnl-printable" style={{ padding: "24px 28px", maxWidth: 1400 }}>
      <style>{PRINT_CSS}</style>
      {/* Header */}
      <div
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
            {formatMonthLabel(months[0])} ~ {formatMonthLabel(months[months.length - 1])} 월별 손익 현황
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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

      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
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
            <div
              key={card.label}
              style={{
                padding: "18px 20px",
                borderRadius: 12,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, fontWeight: 500 }}
              >
                {card.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>
                {card.value < 0 ? "-" : ""}
                {Math.abs(card.value).toLocaleString("ko-KR")}
                <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 2 }}>원</span>
              </div>
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

      {/* Chart */}
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

      {/* Table */}
      <div
        style={{
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          overflow: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: 700,
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
              {months.map((m) => (
                <th
                  key={m}
                  style={{
                    padding: "12px 16px",
                    textAlign: "right",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.split("-")[0]}년 {formatMonthLabel(m)}
                </th>
              ))}
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
            {/* Revenue Section */}
            {renderSectionHeader("매출 (Revenue)", months)}
            {renderRow("매출", data.revenue, months, { indent: true, categoryKey: "revenue", prevTotal: isCompareMode ? prevSum(data.revenue) : undefined })}
            {renderRow("기타수익", data.otherRevenue, months, { indent: true, categoryKey: "otherRevenue", prevTotal: isCompareMode ? prevSum(data.otherRevenue) : undefined })}
            {renderRow("총 매출", computed.totalRevenue, months, { isSubtotal: true, isBold: true, prevTotal: isCompareMode ? computed.prevTotals.totalRevenue : undefined })}

            {renderDivider(months, "div-1")}

            {/* Cost of Revenue */}
            {renderSectionHeader("매출원가 (COGS)", months)}
            {renderRow("외주비", data.outsourcing, months, { indent: true, categoryKey: "outsourcing", prevTotal: isCompareMode ? prevSum(data.outsourcing) : undefined })}
            {renderRow("인프라비용", data.infrastructure, months, { indent: true, categoryKey: "infrastructure", prevTotal: isCompareMode ? prevSum(data.infrastructure) : undefined })}
            {renderRow("매출원가 합계", computed.cogs, months, { isSubtotal: true, isBold: true, prevTotal: isCompareMode ? computed.prevTotals.cogs : undefined })}

            {renderDivider(months, "div-2")}

            {/* Gross Profit */}
            {renderRow("매출총이익 (Gross Profit)", computed.grossProfit, months, {
              isTotal: true,
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.grossProfit : undefined,
            })}

            {renderDivider(months, "div-3")}

            {/* Operating Expenses */}
            {renderSectionHeader("운영비용 (Operating Expenses)", months)}
            {renderRow("급여", data.salary, months, { indent: true, categoryKey: "salary", prevTotal: isCompareMode ? prevSum(data.salary) : undefined })}
            {renderRow("임대료", data.rent, months, { indent: true, categoryKey: "rent", prevTotal: isCompareMode ? prevSum(data.rent) : undefined })}
            {renderRow("소프트웨어", data.software, months, { indent: true, categoryKey: "software", prevTotal: isCompareMode ? prevSum(data.software) : undefined })}
            {renderRow("전문서비스", data.professional, months, { indent: true, categoryKey: "professional", prevTotal: isCompareMode ? prevSum(data.professional) : undefined })}
            {renderRow("복리후생", data.welfare, months, { indent: true, categoryKey: "welfare", prevTotal: isCompareMode ? prevSum(data.welfare) : undefined })}
            {renderRow("4대보험", data.insurance, months, { indent: true, categoryKey: "insurance", prevTotal: isCompareMode ? prevSum(data.insurance) : undefined })}
            {renderRow("기타 운영비", data.otherOpex, months, { indent: true, categoryKey: "otherOpex", prevTotal: isCompareMode ? prevSum(data.otherOpex) : undefined })}
            {renderRow("운영비용 합계", computed.totalOpex, months, {
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

      {/* Category Tooltip */}
      {tooltipKey && CATEGORY_TOOLTIPS[tooltipKey] && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--primary)",
            color: "#fff",
            fontSize: 12,
            lineHeight: 1.5,
            maxWidth: 500,
          }}
        >
          <strong>{CATEGORY_LABELS[tooltipKey]}</strong>: {CATEGORY_TOOLTIPS[tooltipKey]}
        </div>
      )}

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
        - 급여는 등록된 직원 정보의 월급여 데이터가 반영됩니다. 4대보험은 급여의 약 9.5%로 추정 계산됩니다.
        <br />
        - 정확한 분류를 위해 거래내역의 거래처/적요를 상세히 기입해주세요.
      </div>
    </div>
  );
}
