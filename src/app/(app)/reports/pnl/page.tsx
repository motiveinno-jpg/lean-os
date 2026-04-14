"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const MONTHS_TO_SHOW = 6;

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

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */
async function fetchPnlData(companyId: string): Promise<PnlData> {
  const months = getLastNMonths(MONTHS_TO_SHOW);
  const startDate = `${months[0]}-01`;

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

  const revenue = emptyRow(months);
  const otherRevenue = emptyRow(months);
  const outsourcing = emptyRow(months);
  const infrastructure = emptyRow(months);
  const salary = emptyRow(months);
  const rent = emptyRow(months);
  const software = emptyRow(months);
  const professional = emptyRow(months);
  const welfare = emptyRow(months);
  const insurance = emptyRow(months);
  const otherOpex = emptyRow(months);
  const salesRevenue = emptyRow(months);
  const purchaseCost = emptyRow(months);
  const totalSalary = emptyRow(months);

  for (const tx of transactions) {
    const month = toMonth(tx.transaction_date);
    if (!months.includes(month)) continue;
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
    if (!months.includes(month)) continue;
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

  for (const m of months) {
    totalSalary[m] = monthlySalaryTotal;
    if (monthlySalaryTotal > salary[m]) {
      salary[m] = Math.max(salary[m], monthlySalaryTotal);
    }
    if (monthlyInsurance > insurance[m]) {
      insurance[m] = Math.max(insurance[m], monthlyInsurance);
    }
  }

  // Cross-reference: if tax invoice sales > bank income, use tax invoice figure
  for (const m of months) {
    if (salesRevenue[m] > revenue[m]) {
      otherRevenue[m] += salesRevenue[m] - revenue[m];
    }
  }

  return {
    months,
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
    const { months } = data;

    const totalRevenue = emptyRow(months);
    const cogs = emptyRow(months);
    const grossProfit = emptyRow(months);
    const totalOpex = emptyRow(months);
    const operatingIncome = emptyRow(months);
    const netIncome = emptyRow(months);

    for (const m of months) {
      totalRevenue[m] = data.revenue[m] + data.otherRevenue[m];
      cogs[m] = data.outsourcing[m] + data.infrastructure[m];
      grossProfit[m] = totalRevenue[m] - cogs[m];
      totalOpex[m] =
        data.salary[m] +
        data.rent[m] +
        data.software[m] +
        data.professional[m] +
        data.welfare[m] +
        data.insurance[m] +
        data.otherOpex[m];
      operatingIncome[m] = grossProfit[m] - totalOpex[m];
      netIncome[m] = operatingIncome[m];
    }

    return { totalRevenue, cogs, grossProfit, totalOpex, operatingIncome, netIncome };
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
    options?: { isBold?: boolean; isSubtotal?: boolean; isTotal?: boolean; indent?: boolean },
  ) => {
    const total = sumRow(row);
    const isHighlight = options?.isSubtotal || options?.isTotal;
    const isNegativeRow = total < 0;

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
        {months.map((m) => (
          <td
            key={m}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: isHighlight ? 600 : 400,
              textAlign: "right",
              color: row[m] < 0 ? "var(--danger)" : isHighlight ? "var(--text)" : "var(--text-muted)",
              background: isHighlight ? "var(--bg-surface)" : undefined,
              whiteSpace: "nowrap",
            }}
          >
            {formatKrw(row[m])}
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
            right: 0,
            zIndex: 2,
          }}
        >
          {formatKrw(total)}
        </td>
      </tr>
    );
  };

  const renderSectionHeader = (label: string, months: string[]) => (
    <tr key={`header-${label}`}>
      <td
        colSpan={months.length + 2}
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
        colSpan={months.length + 2}
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

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400 }}>
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
        <button
          onClick={handleExportCsv}
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
            value: sumRow(computed.totalRevenue),
            color: "var(--primary)",
          },
          {
            label: "매출총이익",
            value: sumRow(computed.grossProfit),
            color: "#10b981",
          },
          {
            label: "영업이익",
            value: sumRow(computed.operatingIncome),
            color: sumRow(computed.operatingIncome) >= 0 ? "#10b981" : "var(--danger)",
          },
          {
            label: "당기순이익",
            value: sumRow(computed.netIncome),
            color: sumRow(computed.netIncome) >= 0 ? "#10b981" : "var(--danger)",
          },
        ].map((card) => (
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
          </div>
        ))}
      </div>

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
                  right: 0,
                  background: "var(--bg-surface)",
                  zIndex: 3,
                }}
              >
                합계
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue Section */}
            {renderSectionHeader("매출 (Revenue)", months)}
            {renderRow("매출", data.revenue, months, { indent: true })}
            {renderRow("기타수익", data.otherRevenue, months, { indent: true })}
            {renderRow("총 매출", computed.totalRevenue, months, { isSubtotal: true, isBold: true })}

            {renderDivider(months, "div-1")}

            {/* Cost of Revenue */}
            {renderSectionHeader("매출원가 (COGS)", months)}
            {renderRow("외주비", data.outsourcing, months, { indent: true })}
            {renderRow("인프라비용", data.infrastructure, months, { indent: true })}
            {renderRow("매출원가 합계", computed.cogs, months, { isSubtotal: true, isBold: true })}

            {renderDivider(months, "div-2")}

            {/* Gross Profit */}
            {renderRow("매출총이익 (Gross Profit)", computed.grossProfit, months, {
              isTotal: true,
              isBold: true,
            })}

            {renderDivider(months, "div-3")}

            {/* Operating Expenses */}
            {renderSectionHeader("운영비용 (Operating Expenses)", months)}
            {renderRow("급여", data.salary, months, { indent: true })}
            {renderRow("임대료", data.rent, months, { indent: true })}
            {renderRow("소프트웨어", data.software, months, { indent: true })}
            {renderRow("전문서비스", data.professional, months, { indent: true })}
            {renderRow("복리후생", data.welfare, months, { indent: true })}
            {renderRow("4대보험", data.insurance, months, { indent: true })}
            {renderRow("기타 운영비", data.otherOpex, months, { indent: true })}
            {renderRow("운영비용 합계", computed.totalOpex, months, {
              isSubtotal: true,
              isBold: true,
            })}

            {renderDivider(months, "div-4")}

            {/* Operating Income */}
            {renderRow("영업이익 (Operating Income)", computed.operatingIncome, months, {
              isTotal: true,
              isBold: true,
            })}

            {renderDivider(months, "div-5")}

            {/* Net Income */}
            {renderRow("당기순이익 (Net Income)", computed.netIncome, months, {
              isTotal: true,
              isBold: true,
            })}
          </tbody>
        </table>
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
        - 급여는 등록된 직원 정보의 월급여 데이터가 반영됩니다. 4대보험은 급여의 약 9.5%로 추정 계산됩니다.
        <br />
        - 정확한 분류를 위해 거래내역의 거래처/적요를 상세히 기입해주세요.
      </div>
    </div>
  );
}
