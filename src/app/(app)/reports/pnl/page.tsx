"use client";
import { WaterfallChart } from "@/components/charts/kit";

import { Fragment, useEffect, useState, useMemo, useCallback } from "react";
import { Ico } from "@/components/ui-icon";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { DateRangeField } from "@/components/date-range-field";
import { fetchJournalLines, countUnposted, pnlAmount, type JournalLine } from "@/lib/journal-reports";
import Link from "next/link";
import { fetchAllPaginated } from "@/lib/supabase-paginated";
import { getCurrentUser } from "@/lib/queries";
import { getAccountMap, classifyAccount, accountById, NATURE_LABEL } from "@/lib/account-nature";
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

// 세금계산서 expense_category(영문 키) → 한글 계정과목 라벨 — tax-invoices EXPENSE_CATEGORIES 와 동일 키.
//   미매핑 시 영문 키가 판관비 행 이름으로 노출되고 통장 분류(한글)와 분리 집계되던 버그 수정 (2026-07-10).
const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  goods: "상품매입", service: "용역/서비스", rent: "임대료", commission: "수수료",
  advertising: "광고선전비", consumables: "소모품비", transport: "운반비", maintenance: "수선유지비",
  insurance: "보험료", utilities: "수도광열비", communication: "통신비", travel: "여비교통비",
  education: "교육훈련비", other: "기타",
};
const expenseCategoryLabel = (key: string): string => EXPENSE_CATEGORY_LABELS[key] || key;

// 카드 분류에 계정이 연결돼 있지 않을 때 쓰는 판관비 행 이름 — 뭉뚱그리되 정체는 밝힌다
const CARD_UNMAPPED_LABEL = "카드 사용액 (계정 미지정)";

//   카드 자동분류(classification)는 {"label":"통신비",…} 형태의 JSON 문자열로 들어온다 — 이름만 꺼낸다
function cardLabelOf(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  if (s.startsWith("{")) {
    try { return String(JSON.parse(s)?.label || "").trim(); } catch { return ""; }
  }
  return s;
}
//   계정과목표에서 실제로 찾은 것만 받는다 — 이름 추정으로 카드 지출의 자리를 정하지는 않는다
const pickKnown = (a: ReturnType<typeof classifyAccount>) => (a && a.known ? a : null);

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
  // 판매관리비 — 사용자 category 동적 그룹 (key = 카테고리 이름). 8xx 판관비 계정만 들어온다.
  opexByCategory: Record<string, MonthlyRow>;
  // 계정 성격에 따라 갈라 담는 나머지 손익 항목 (2026-08-10)
  nonOpIncomeByCategory: Record<string, MonthlyRow>;   // 9xx 영업외수익
  nonOpExpenseByCategory: Record<string, MonthlyRow>;  // 9xx 영업외비용 (이자비용·기부금 등)
  taxByCategory: Record<string, MonthlyRow>;           // 998 법인세비용
  salesRevenue: MonthlyRow;
  purchaseCost: MonthlyRow;
  totalSalary: MonthlyRow;
  uncategorizedCount: number;   // 분류 안 돼 판관비에서 빠진 출금 건수
  uncategorizedAmount: number;  // 그 합계 금액
  //   비용이 아닌 계정(자산·부채·자본)으로 분류돼 손익에서 뺀 출금 — 어디로 갔는지 알려주려고 모은다
  nonPnlOut: { category: string; nature: string; count: number; amount: number }[];
  cardUnmappedAmount: number;  // 계정이 연결 안 된 카드 사용액(판관비엔 들어가되 계정은 미상)
  //   아직 전표로 만들지 않은 자료 — 재무제표가 비어 보이는 이유를 화면이 말하게 한다
  unposted: { taxInvoice: number; card: number; bank: number; total: number };
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

  //   ★ 2026-08-11 사장님 지시 — 손익계산서는 **전표로 처리된 것만** 반영한다.
  //     예전엔 통장·세금계산서·카드·직원급여 원본을 직접 집계했다. 그러면 '아직 장부에 안 올린 것'과
  //     '올린 것'이 섞여 재무제표가 장부와 따로 논다. 이제 확정 전표(일반전표·매입매출전표)만 읽는다.
  //     그래서 전표를 안 만든 자료는 여기 안 나온다 — 화면이 '미기장 N건'을 배너로 알려 준다.
  const prevMonths = prevMonthsList;
  const lastMonth = allMonths[allMonths.length - 1];
  const [ly, lm] = lastMonth.split("-").map(Number);
  const endDate = `${lastMonth}-${String(new Date(ly, lm, 0).getDate()).padStart(2, "0")}`;
  const [lines, unposted] = await Promise.all([
    fetchJournalLines(companyId, startDate, endDate),
    countUnposted(companyId, `${months[0]}-01`, endDate),
  ]);

  const revenue = emptyRow(allMonths);
  const otherRevenue = emptyRow(allMonths);
  const outsourcing = emptyRow(allMonths);
  const infrastructure = emptyRow(allMonths);
  const opexByCategory: Record<string, MonthlyRow> = {};
  const nonOpIncomeByCategory: Record<string, MonthlyRow> = {};
  const nonOpExpenseByCategory: Record<string, MonthlyRow> = {};
  const taxByCategory: Record<string, MonthlyRow> = {};
  const salesRevenue = emptyRow(allMonths);
  const purchaseCost = emptyRow(allMonths);
  const totalSalary = emptyRow(allMonths);

  const ensureIn = (bucket: Record<string, MonthlyRow>, cat: string): MonthlyRow => {
    if (!bucket[cat]) bucket[cat] = emptyRow(allMonths);
    return bucket[cat];
  };

  for (const l of lines) {
    const m = l.month;
    if (!(m in revenue)) continue;              // 조회 기간 밖
    const amt = pnlAmount(l);
    if (amt === 0) continue;
    switch (l.section) {
      case "revenue":
        salesRevenue[m] += amt; break;
      case "nonop_income":
        otherRevenue[m] += amt; ensureIn(nonOpIncomeByCategory, l.name)[m] += amt; break;
      case "cogs":
        //   매출원가 안에서 외주비는 따로 보여 준다(계정 이름 기준 — 회사마다 계정명이 다르다)
        if (l.name.includes("외주")) outsourcing[m] += amt;
        else infrastructure[m] += amt;
        purchaseCost[m] += amt;
        break;
      case "opex":
        ensureIn(opexByCategory, l.name)[m] += amt;
        if (l.name.includes("급여") || l.name.includes("임금")) totalSalary[m] += amt;
        break;
      case "nonop_expense":
        ensureIn(nonOpExpenseByCategory, l.name)[m] += amt; break;
      case "tax":
        ensureIn(taxByCategory, l.name)[m] += amt; break;
      default:
        break;                                  // 자산·부채·자본 줄은 손익이 아니다
    }
  }

  for (const m of allMonths) revenue[m] = salesRevenue[m];

  //   전표 기준에서는 '미분류 출금' 개념이 없다 — 전표가 있으면 계정이 반드시 정해져 있다.
  //   대신 **아직 전표로 만들지 않은 자료 건수**를 알려 준다(비어 보이는 이유).
  const uncategorizedCount = 0;
  const uncategorizedAmount = 0;
  const nonPnlOut: { category: string; nature: string; count: number; amount: number }[] = [];
  const cardUnmappedAmount = 0;

  return {
    months,
    prevMonths,
    revenue,
    otherRevenue,
    outsourcing,
    infrastructure,
    opexByCategory,
    nonOpIncomeByCategory,
    nonOpExpenseByCategory,
    taxByCategory,
    salesRevenue,
    purchaseCost,
    totalSalary,
    uncategorizedCount,
    uncategorizedAmount,
    nonPnlOut,
    cardUnmappedAmount,
    unposted,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function PnlPage() {
  const { role } = useUser();
  // 게이트 early return 뒤 훅 = React #310 결함류 — 본문 분리 (2026-08-03)
  if (role === "partner") {
    return <AccessDenied detail="손익계산서는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }
  return <PnlPageInner />;
}

function PnlPageInner() {
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
    const totalNonOpIncome = emptyRow(allM);
    const totalNonOpExpense = emptyRow(allM);
    const pretaxIncome = emptyRow(allM);
    const totalTax = emptyRow(allM);
    const netIncome = emptyRow(allM);

    const sumBucket = (bucket: Record<string, MonthlyRow>, m: string) =>
      Object.values(bucket).reduce((s, row) => s + (row[m] || 0), 0);

    for (const m of allM) {
      totalRevenue[m] = (data.revenue[m] || 0) + (data.otherRevenue[m] || 0);
      // 발생주의: 매출원가 = 매입 세금계산서 공급가액(+ 매출원가 계정으로 분류한 출금).
      cogs[m] = (data.purchaseCost[m] || 0);
      grossProfit[m] = totalRevenue[m] - cogs[m];
      totalOpex[m] = sumBucket(data.opexByCategory, m);
      operatingIncome[m] = grossProfit[m] - totalOpex[m];
      //   영업외손익·법인세를 계정 성격대로 따로 세운다 — 이자비용을 판관비에 섞지 않는다 (2026-08-10)
      totalNonOpIncome[m] = sumBucket(data.nonOpIncomeByCategory, m);
      totalNonOpExpense[m] = sumBucket(data.nonOpExpenseByCategory, m);
      pretaxIncome[m] = operatingIncome[m] + totalNonOpIncome[m] - totalNonOpExpense[m];
      totalTax[m] = sumBucket(data.taxByCategory, m);
      netIncome[m] = pretaxIncome[m] - totalTax[m];
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
      totalNonOpIncome: sumPrev(totalNonOpIncome),
      totalNonOpExpense: sumPrev(totalNonOpExpense),
      pretaxIncome: sumPrev(pretaxIncome),
      totalTax: sumPrev(totalTax),
      netIncome: sumPrev(netIncome),
    };

    return {
      totalRevenue, cogs, grossProfit, totalOpex, operatingIncome,
      totalNonOpIncome, totalNonOpExpense, pretaxIncome, totalTax, netIncome,
      prevTotals, sumPrev, sumCurr,
    };
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
    lines.push("");
    for (const [name, row] of Object.entries(data.nonOpIncomeByCategory)) addLine(`영업외수익 - ${name}`, row);
    addLine("영업외수익 합계", computed.totalNonOpIncome);
    for (const [name, row] of Object.entries(data.nonOpExpenseByCategory)) addLine(`영업외비용 - ${name}`, row);
    addLine("영업외비용 합계", computed.totalNonOpExpense);
    addLine("법인세비용", computed.totalTax);
    lines.push("");
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
      // 표기 규칙(단순화 2026-07-10): 초록 배경 = 이익 소계 딱 3줄(매출총이익·영업이익·당기순이익).
      //   굵은 글씨 = Ⅰ~Ⅵ 주요 계정. 들여쓴 일반 글씨 = 세부 항목. 그 외 색 없음.
      profit?: boolean;
      big?: boolean;
      drill?: { source: "sales" | "purchase" | "opex" | "computed"; category?: string; breakdown?: { label: string; amount: number }[] };
    },
  ) => {
    const total = months.reduce((s, m) => s + (row[m] || 0), 0);
    const isHighlight = options?.isSubtotal || options?.isTotal || options?.profit;
    const toneBg = options?.profit
      ? "color-mix(in srgb, var(--success) 9%, var(--bg-card))"
      : "var(--bg-card)";
    const fontSize = options?.big ? 14.5 : 13;
    const delta = options?.prevTotal !== undefined ? total - options.prevTotal : undefined;

    return (
      <tr
        key={label}
        className="pnl-table-row"
        style={{
          borderTop: options?.isSubtotal || options?.profit ? "1px solid var(--border)" : undefined,
          borderBottom: options?.isTotal ? "2px solid var(--text)" : undefined,
        }}
      >
        <td
          style={{
            padding: options?.big ? "12px 16px" : "10px 16px",
            fontSize,
            fontWeight: options?.isBold || isHighlight ? 700 : 400,
            color: isHighlight ? "var(--text)" : "var(--text-muted)",
            paddingLeft: options?.indent ? 36 : 16,
            whiteSpace: "nowrap",
            position: "sticky",
            left: 0,
            background: toneBg,
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
            padding: options?.big ? "12px 16px" : "10px 16px",
            fontSize,
            fontWeight: isHighlight ? 700 : 600,
            textAlign: "right",
            color: total < 0 ? "var(--danger)" : "var(--text)",
            background: toneBg,
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
              background: toneBg,
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

  /* ---------------------------------------------------------------- */
  /*  Main render                                                      */
  /* ---------------------------------------------------------------- */
  if (isLoading) {
    return (
      <div className="p-10">
        <div className="flex items-center gap-3">
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
          <span className="text-[var(--text-muted)] text-sm">
            손익계산서 데이터를 불러오는 중...
          </span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10">
        <div className="py-4 px-5 rounded-lg bg-[var(--danger-dim)] text-[var(--danger)] text-sm">
          데이터 로드 실패: {error}
        </div>
      </div>
    );
  }

  if (!data || !computed) {
    return (
      <div className="p-16 text-center">
        <div className="text-4xl mb-3"><Ico e="📊" /></div>
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
      <div className="pnl-toolbar page-sticky-header no-print-sticky">
        {/* 조회 기간 — 세금계산서·계산서와 같은 위젯(월 단위). 손익계산서는 **월이 최소 단위**라
            일 단위로 열지 않는다 — 반달 손익은 회계적으로 의미가 흐리다 (2026-08-11). */}
        <div className="pnl-period-picker">
          <DateRangeField
            unit="month" label="조회 기간"
            from={customStart} to={customEnd}
            onChange={(f, t) => { setCustomStart(f); setCustomEnd(t); }}
          />
        </div>
        <div className="pnl-toolbar-actions">
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

      {/*   ★ 전표만 반영한다 — 비어 보이는 이유를 화면이 스스로 말한다 (2026-08-11 사장님 지시).
            "손익계산서와 재무상태표에는 전표로 처리된 내역만 반영되게. 불러오기만 한 건 반영되지 않게." */}
      {data.unposted.total > 0 && (
        <div className="pnl-unposted-banner kpi-callout warning">
          <span className="text-base leading-none mt-0.5"><Ico e="⚠" /></span>
          <div className="leading-relaxed">
            이 표는 <b>전표로 처리된 것만</b> 보여 줍니다. 아직 전표로 만들지 않은 자료가{" "}
            <b>{data.unposted.total.toLocaleString()}건</b> 있습니다
            {" ("}
            {[
              data.unposted.taxInvoice > 0 ? `세금계산서 ${data.unposted.taxInvoice.toLocaleString()}` : null,
              data.unposted.card > 0 ? `카드 ${data.unposted.card.toLocaleString()}` : null,
              data.unposted.bank > 0 ? `통장 ${data.unposted.bank.toLocaleString()}` : null,
            ].filter(Boolean).join(" · ")}
            {") — 그만큼 이 표에 빠져 있습니다."}
            <span className="text-[var(--text-muted)]">
              {" "}<Link href="/collect" className="underline font-semibold">수집·전표</Link>에서 전표를 만들면 바로 반영됩니다.
            </span>
          </div>
        </div>
      )}

      {/* 미분류 출금 경고 — 판관비 과소계상(영업이익 과대) 오해 방지 */}
      {data.uncategorizedCount > 0 && (
        <div className="pnl-uncategorized-warning kpi-callout warning">
          <span className="text-base leading-none mt-0.5"><Ico e="⚠" /></span>
          <div className="leading-relaxed">
            분류되지 않은 통장 출금 <b>{data.uncategorizedCount.toLocaleString()}건</b>(약 <b>₩{Math.round(data.uncategorizedAmount).toLocaleString()}</b>)이
            판매관리비에 <b>반영되지 않았습니다</b> — 실제보다 영업이익이 크게 보일 수 있습니다.
            <span className="text-[var(--text-muted)]"> 통장 거래내역 또는 거래 매칭에서 계정을 분류하면 손익에 자동 반영됩니다.</span>
          </div>
        </div>
      )}

      {/* 비용이 아닌 계정으로 분류된 출금 — 손익에서 빼되 어디로 갔는지 밝힌다 (2026-08-10 사장님 지적:
          "판매비와관리비에 미지급금이 나온다"). 이건 오류가 아니라 자리를 옮긴 것이므로 경고가 아닌 안내 톤. */}
      {data.nonPnlOut.length > 0 && (
        <div className="pnl-nonpnl-note kpi-callout">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 16v-4m0-4h.01" /></svg>
          <div className="leading-relaxed">
            <b>비용이 아닌 계정</b>으로 분류된 출금 {data.nonPnlOut.reduce((s, r) => s + r.count, 0).toLocaleString()}건
            (₩{Math.round(data.nonPnlOut.reduce((s, r) => s + r.amount, 0)).toLocaleString()})은
            손익계산서에서 <b>제외</b>했습니다 — 자산·부채·자본 계정은 <Link href="/reports/bs" className="underline font-semibold">재무상태표</Link> 항목입니다.
            <div className="pnl-nonpnl-list">
              {data.nonPnlOut.slice(0, 6).map((r) => (
                <span key={r.category} className="pnl-nonpnl-chip">
                  {r.category}<i>{r.nature}</i> ₩{Math.round(r.amount).toLocaleString()}
                </span>
              ))}
              {data.nonPnlOut.length > 6 && <span className="pnl-nonpnl-chip">외 {data.nonPnlOut.length - 6}개</span>}
            </div>
          </div>
        </div>
      )}

      {/* 카드 분류에 계정이 안 붙어 있으면 — 금액은 이미 판관비에 들어갔고, 계정만 못 정했다 */}
      {data.cardUnmappedAmount > 0 && (
        <div className="pnl-nonpnl-note kpi-callout">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
          <div className="leading-relaxed">
            법인카드 사용액 <b>₩{Math.round(data.cardUnmappedAmount).toLocaleString()}</b>은 계정과목이 연결돼 있지 않아
            <b> &lsquo;{CARD_UNMAPPED_LABEL}&rsquo;</b> 한 줄로 판관비에 넣었습니다.
            <Link href="/cards" className="underline font-semibold">법인카드</Link>에서 전표처리할 때
            <b> 이 분류의 기본 계정으로 기억</b>을 체크해 두면 다음부터 제 계정으로 나뉩니다.
          </div>
        </div>
      )}

      {/* Summary Cards — 대시보드 글래스카드 스타일 (2026-06-10 리디자인) */}
      <div className="pnl-summary-cards" style={{ marginBottom: 24 }}>
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
            <div key={card.label} className="pnl-summary-card glass-card">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--text-muted)]">{card.label}</span>
                <span className={`kpi-icon ${card.value < 0 ? "danger" : card.label === "총 매출" ? "" : "success"}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M21 7v6m0-6h-6" /></svg>
                </span>
              </div>
              <div className="stat-fit flex items-end gap-2 flex-wrap">
                <span className={`stat-fit-value font-extrabold mono-number ${card.value < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
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

      {/* 표기 규칙 — 단 한 가지: 초록 배경 = 이익 소계 3줄. 나머지는 표준 양식의 위계(굵은 Ⅰ~Ⅵ / 들여쓴 세부). */}
      <div className="pnl-legend">
        <span className="font-semibold text-[var(--text)]">표기 규칙</span>
        <span className="inline-flex items-center gap-1.5"><b className="text-[var(--text)]">굵은 Ⅰ~Ⅸ</b> = 주요 계정</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-3.5 rounded" style={{ background: "color-mix(in srgb, var(--success) 9%, var(--bg-card))", border: "1px solid var(--border)" }} />초록 배경 = 이익 소계(Ⅲ·Ⅴ·Ⅸ)</span>
        <span>들여쓴 항목 = 판관비 세부 내역 · 항목명 클릭 = 원천 내역</span>
      </div>

      {/* Table — 대시보드 글래스카드 (2026-06-10) */}
      <div className="pnl-table-container glass-card" style={{ overflow: "auto" }}>
        {/* 머리단은 공용 표 머리단(색·선) — 조회 표준 Wave 5 (2026-08-18). 항목·합계 칸의 좌우 고정은 유지 */}
        <table className="pnl-table ev-table ev-lined rpt-table">
          <thead>
            <tr>
              <th className="rpt-th-left">항목</th>
              <th className="rpt-th-right" style={{ right: isCompareMode ? 120 : 0 }}>합계</th>
              {isCompareMode && <th className="rpt-th-right" style={{ right: 0 }}>전기 대비</th>}
            </tr>
          </thead>
          <tbody>
            {/* 표준 손익계산서 양식(Ⅰ~Ⅵ) — 주요 계정은 굵은 로마숫자 행에 금액, 세부는 들여쓰기 (2026-07-10) */}
            {renderRow("Ⅰ. 매출액", data.revenue, months, {
              isBold: true,
              prevTotal: isCompareMode ? prevSum(data.revenue) : undefined,
              drill: { source: "sales" },
            })}
            {renderRow("Ⅱ. 매출원가", data.purchaseCost, months, {
              isBold: true,
              prevTotal: isCompareMode ? prevSum(data.purchaseCost) : undefined,
              drill: { source: "purchase" },
            })}
            {renderRow("Ⅲ. 매출총이익 (Ⅰ−Ⅱ)", computed.grossProfit, months, {
              profit: true, isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.grossProfit : undefined,
              drill: { source: "computed", breakdown: [
                { label: "매출액", amount: months.reduce((s, m) => s + (data.revenue[m] || 0), 0) },
                { label: "매출원가", amount: -months.reduce((s, m) => s + (data.purchaseCost[m] || 0), 0) },
              ] },
            })}

            {renderRow("Ⅳ. 판매비와관리비", computed.totalOpex, months, {
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.totalOpex : undefined,
            })}
            {Object.entries(data.opexByCategory)
              .sort((a, b) => {
                const sa = months.reduce((s, m) => s + (a[1][m] || 0), 0);
                const sb = months.reduce((s, m) => s + (b[1][m] || 0), 0);
                return sb - sa;
              })
              .filter(([, row]) => months.reduce((s, m) => s + (row[m] || 0), 0) !== 0)
              .map(([name, row]) => renderRow(name, row, months, {
                indent: true,
                prevTotal: isCompareMode ? data.prevMonths.reduce((s, m) => s + (row[m] || 0), 0) : undefined,
                drill: { source: "opex", category: name },
              }))}

            {renderRow("Ⅴ. 영업이익 (Ⅲ−Ⅳ)", computed.operatingIncome, months, {
              profit: true, isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.operatingIncome : undefined,
              drill: { source: "computed", breakdown: [
                { label: "매출총이익", amount: months.reduce((s, m) => s + (computed.grossProfit[m] || 0), 0) },
                { label: "판매비와관리비", amount: -months.reduce((s, m) => s + (computed.totalOpex[m] || 0), 0) },
              ] },
            })}

            {/* Ⅵ~Ⅷ 영업외손익·법인세 — 이자비용·기부금 같은 9xx 계정을 판관비에 섞지 않고 제자리에 둔다.
                금액이 없어도 줄은 남긴다(표준 손익계산서 형식 + 로마숫자가 흔들리지 않게). 2026-08-10 */}
            {renderRow("Ⅵ. 영업외수익", computed.totalNonOpIncome, months, {
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.totalNonOpIncome : undefined,
            })}
            {Object.entries(data.nonOpIncomeByCategory)
              .filter(([, row]) => months.reduce((s, m) => s + (row[m] || 0), 0) !== 0)
              .map(([name, row]) => renderRow(name, row, months, { indent: true }))}

            {renderRow("Ⅶ. 영업외비용", computed.totalNonOpExpense, months, {
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.totalNonOpExpense : undefined,
            })}
            {Object.entries(data.nonOpExpenseByCategory)
              .filter(([, row]) => months.reduce((s, m) => s + (row[m] || 0), 0) !== 0)
              .map(([name, row]) => renderRow(name, row, months, {
                indent: true,
                drill: { source: "opex", category: name },
              }))}

            {renderRow("Ⅷ. 법인세비용", computed.totalTax, months, {
              isBold: true,
              prevTotal: isCompareMode ? computed.prevTotals.totalTax : undefined,
            })}

            {renderRow("Ⅸ. 당기순이익 (Ⅴ+Ⅵ−Ⅶ−Ⅷ)", computed.netIncome, months, {
              profit: true, isBold: true, big: true, isTotal: true,
              prevTotal: isCompareMode ? computed.prevTotals.netIncome : undefined,
              drill: { source: "computed", breakdown: [
                { label: "영업이익", amount: months.reduce((s, m) => s + (computed.operatingIncome[m] || 0), 0) },
                { label: "영업외수익", amount: months.reduce((s, m) => s + (computed.totalNonOpIncome[m] || 0), 0) },
                { label: "영업외비용", amount: -months.reduce((s, m) => s + (computed.totalNonOpExpense[m] || 0), 0) },
                { label: "법인세비용", amount: -months.reduce((s, m) => s + (computed.totalTax[m] || 0), 0) },
              ] },
            })}
          </tbody>
        </table>
      </div>

      {/* 손익 구조 — 무엇이 얼마를 깎아 이익이 남는지. 막대 여럿으로는 이 관계가 안 보여
          폭포수로 그린다 (2026-08-07 사장님: "자료에 최적인 그래프를 판단해서") */}
      <div className="pnl-chart-section">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-3">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-[var(--text)]">손익 구조</h3>
            <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">고른 기간 합계 · 매출에서 무엇이 빠져 영업이익이 남는지</p>
          </div>
          <WaterfallChart steps={(() => {
            const sum = (row: Record<string, number>) => months.reduce((n, m) => n + (row[m] || 0), 0);
            const rev = sum(computed.totalRevenue);
            const cogs = sum(computed.cogs);
            const opex = sum(computed.totalOpex);
            return [
              { label: "매출", value: rev, kind: "add" as const },
              { label: "매출원가", value: cogs, kind: "sub" as const },
              { label: "매출총이익", value: rev - cogs, kind: "total" as const },
              { label: "판관비", value: opex, kind: "sub" as const },
              { label: "영업이익", value: rev - cogs - opex, kind: "total" as const },
            ];
          })()} />
        </div>
        <PnlChart
          months={months}
          totalRevenue={computed.totalRevenue}
          totalExpenses={(() => {
            const row: Record<string, number> = {};
            for (const m of months) {
              //   순이익과 어긋나지 않게 영업외비용·법인세까지 더한 '총 비용' (2026-08-10)
              row[m] = computed.cogs[m] + computed.totalOpex[m] + computed.totalNonOpExpense[m] + computed.totalTax[m];
            }
            return row;
          })()}
          netIncome={computed.netIncome}
        />
      </div>

      {/* 정확도 안내 배너 — 미분류 비용 제외 한계 */}
      <div className="pnl-accuracy-banner kpi-callout">
        <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 16v-4m0-4h.01" /></svg>
        <p className="text-[11.5px] leading-relaxed">
          <b>매출·매입원가는 세금계산서(발생주의) 기준</b>이라 정확합니다. 단 <b>판매관리비는 계정과목이 분류된 출금만</b> 반영됩니다 — 미분류 출금은 무엇인지 알 수 없어 제외되므로, 비용이 실제보다 적게(이익은 많게) 보일 수 있습니다. <Link href="/collect?tab=bank" className="underline font-semibold">수집·전표 › 통장</Link>에서 계정을 골라 전표를 만들수록 정확해집니다.
        </p>
      </div>

      {/* 산출 기준 — 접이식 */}
      <details className="pnl-basis-details group">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
            <svg className="w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 16v-4m0-4h.01" /></svg>
            산출 기준 자세히 보기
          </span>
          <svg className="w-4 h-4 text-[var(--text-dim)] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </summary>
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[11.5px] leading-relaxed text-[var(--text-dim)] border-t border-[var(--border)] pt-3">
          <div>· <b className="text-[var(--text-muted)]">Ⅰ. 매출액</b> = 매출 세금계산서 공급가액(발생주의)</div>
          <div>· <b className="text-[var(--text-muted)]">Ⅱ. 매출원가</b> = <b className="text-[var(--text-muted)]">계정과목 미지정</b> 매입 세금계산서 공급가액 + 매출원가(451)·매입(501) 계정으로 분류한 출금 — 매입 계산서에 판관비 계정을 지정하면 그쪽으로 이동(Ⅱ 클릭 → 건별 지정 가능)</div>
          <div>· <b className="text-[var(--text-muted)]">Ⅳ. 판매비와관리비</b> = ① 판관비 계정(코드 8xx)으로 분류된 통장 출금(AI 자동분류 포함) + ② 판관비 계정을 지정한 매입 세금계산서 + ③ <b className="text-[var(--text-muted)]">법인카드 사용액</b>(분류→계정 매핑이 있으면 그 계정, 없으면 &lsquo;{CARD_UNMAPPED_LABEL}&rsquo; 한 줄). 카드 취소·환불은 음수로 상계되고, 카드대금 통장 출금은 부채 상환이라 빠지므로 이중계상되지 않습니다</div>
          <div>· <b className="text-[var(--text-muted)]">급여</b> = 재직 중인 직원(재직·합류) 월급여 자동 반영 — 초대만 하고 합류 전인 사람은 제외. <b className="text-[var(--text-muted)]">4대보험</b> = 급여×약 10.55%(사업주 부담 추정) — 거래가 없어도 직원 등록만으로 자동 계상</div>
          <div>· <b className="text-[var(--text-muted)]">Ⅵ·Ⅶ·Ⅷ 영업외손익·법인세</b> = 영업외 계정(코드 9xx)으로 분류한 거래. 이자비용·기부금 등은 판관비에 섞지 않고 여기로 갑니다. 입금은 <b className="text-[var(--text-muted)]">영업외수익 계정</b>만 인식(매출 계정 입금은 세금계산서 매출과 중복이라 제외)</div>
          <div className="sm:col-span-2">· <b className="text-[var(--text-muted)]">계정 성격 기준</b> — 자리는 <Link href="/settings" className="underline">회사설정 → 계정과목</Link>의 성격(자산·부채·자본·수익·비용)과 코드로 정합니다. <b className="text-[var(--text-muted)]">자산·부채·자본 계정(미지급금 상환·이체·보증금 등)은 손익계산서가 아니라 재무상태표 항목</b>이라 제외되며, 미분류 출금도 제외됩니다</div>
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

/** 원장 한 줄 — 위하고 '원장조회'와 같은 칸 구성 (2026-08-12 사장님이 그 화면을 기준으로 주셨다) */
type DrillRow = {
  date: string; memo: string; partner: string | null;
  debit: number; credit: number; voucherNo: number | null;
};

/**
 * 손익 항목 드릴다운 — 그 계정의 **원장**을 보여 준다.
 *   ★ 2026-08-12 사장님 지시: "비용계정 눌렀을 때 **그날의 전표로 보여주고 월계 나눠주세요**".
 *     참고로 준 위하고 원장조회를 그대로 따른다 — 일자·적요·거래처·차변·대변·잔액·전표번호,
 *     달이 바뀌는 자리에 **[월 계]** 와 **[누 계]**.
 *   ★ 그전엔 일자·거래처·금액 세 칸이었는데 '거래처' 칸에 **계정 이름**이 들어가 있었다
 *     (지급수수료 13줄이 전부 "지급수수료"). 이제 진짜 거래처와 적요가 들어간다.
 */
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
  const [rows, setRows] = useState<DrillRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 읽기 전용 드릴다운 팝업 — ESC로만 닫기
  useModalKeys(true, onClose);

  useEffect(() => {
    if (source === "computed") return;
    //   ★ 2026-08-12 — **전표에서 읽는다** (사장님 제보).
    //     표는 2026-08-11 부터 확정 전표만 집계하는데 이 상세 창은 세금계산서·통장 **원본**을 읽고 있었다.
    //     그래서 표는 1,024원인데 열어 보면 703,612,329원 — 한 화면에 서로 다른 두 값이 있었다.
    //     판관비는 옛 '비목(category)' 으로 찾아 아무것도 안 나왔다(표는 계정 **이름**으로 묶는다).
    //     이제 표와 상세가 **같은 원천**을 본다 — 숫자가 어긋날 수 없다.
    const startDate = `${start}-01`;
    const [ey, em] = end.split("-").map(Number);
    const lastDay = new Date(ey, em, 0).getDate();
    const endDate = `${ey}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    (async () => {
      try {
        const lines = await fetchJournalLines(companyId, startDate, endDate);
        const want = (l: JournalLine) =>
          source === "sales" ? l.section === "revenue"
            : source === "purchase" ? l.section === "cogs"
              : l.section === "opex" && l.name === category;
        const picked: DrillRow[] = lines.filter(want)
          .filter((l) => l.debit !== 0 || l.credit !== 0)
          .map((l) => ({
            date: l.date, memo: l.memo, partner: l.partnerName,
            debit: l.debit, credit: l.credit, voucherNo: l.voucherNo,
          }))
          //   같은 날은 전표번호 순 — 위하고 원장과 같은 차례
          .sort((a, b) => a.date.localeCompare(b.date) || (a.voucherNo ?? 0) - (b.voucherNo ?? 0));
        setRows(picked);
      } catch (e: any) { setErr(e?.message || "불러오기 실패"); }
    })();
  }, [companyId, source, category, start, end]);

  //   ⚠️ 여기 있던 '계정과목 지정' 칸은 지웠다 — 2026-08-12 원천을 전표로 바꾸면서
  //     행에 tax_invoices.id 가 안 실려 **눌러도 아무 일도 안 일어나는 상태**였다.
  //     매출원가 건의 계정 변경은 수집·전표(전표 취소 → 계정 다시 고르기)에서 한다.

  /** 이 계정에서 이 줄이 늘어난 금액인가 — 수익은 대변이 +, 비용은 차변이 + */
  const signed = (r: DrillRow) => (source === "sales" ? r.credit - r.debit : r.debit - r.credit);

  const bd = breakdown || [];
  const total = source === "computed" ? bd.reduce((s, b) => s + b.amount, 0) : (rows || []).reduce((s, r) => s + signed(r), 0);

  /**
   * 월별로 끊고 [월 계]·[누 계] 를 끼운다. 잔액은 줄마다 누적(위하고 원장과 같다).
   *   조회 기간 안에서만 누적한다 — 기간 밖 잔액은 이 창이 읽지 않는다.
   */
  const ledger = useMemo(() => {
    const out: ({ kind: "row"; r: DrillRow; balance: number }
      | { kind: "sum"; month: string; monthly: number; running: number })[] = [];
    let running = 0, monthly = 0, cur = "";
    for (const r of rows || []) {
      const m = r.date.slice(0, 7);
      if (cur && m !== cur) { out.push({ kind: "sum", month: cur, monthly, running }); monthly = 0; }
      cur = m;
      const v = signed(r);
      running += v; monthly += v;
      out.push({ kind: "row", r, balance: running });
    }
    if (cur) out.push({ kind: "sum", month: cur, monthly, running });
    return out;
  }, [rows, source]);
  //   이제 전부 확정 전표를 본다 — 표와 같은 원천이라는 것을 창이 직접 말한다
  const srcLabel = source === "computed" ? "산출 구성" : "확정 전표";

  return (
    <div className="pnl-drill-modal-overlay fixed inset-0" onClick={onClose}>
      <div className="pnl-drill-modal" onClick={(e) => e.stopPropagation()}>
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
                  <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">일자</th>
                  <th className="text-center px-3 py-2 font-semibold">적요</th>
                  <th className="text-center px-3 py-2 font-semibold">거래처</th>
                  <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">차변</th>
                  <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">대변</th>
                  <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">잔액</th>
                  <th className="text-center px-3 py-2 font-semibold whitespace-nowrap">전표번호</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((x, i) => x.kind === "sum" ? (
                  //   달이 끝나는 자리 — [월 계]·[누 계] 두 줄 (위하고 원장과 같은 모양)
                  <Fragment key={`s${i}`}>
                    <tr className="pnl-ledger-sum">
                      <td className="px-3 py-1.5 mono-number whitespace-nowrap">{x.month}</td>
                      <td className="px-3 py-1.5 font-bold" colSpan={2}>[ 월 계 ]</td>
                      <td className="px-3 py-1.5 text-right mono-number font-bold whitespace-nowrap" colSpan={3}>{formatKrw(x.monthly)}</td>
                      <td />
                    </tr>
                    <tr className="pnl-ledger-sum">
                      <td />
                      <td className="px-3 py-1.5 font-bold" colSpan={2}>[ 누 계 ]</td>
                      <td className="px-3 py-1.5 text-right mono-number font-bold whitespace-nowrap" colSpan={3}>{formatKrw(x.running)}</td>
                      <td />
                    </tr>
                  </Fragment>
                ) : (
                  <tr key={`r${i}`} className="border-t border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50">
                    <td className="px-3 py-2 text-[var(--text-muted)] mono-number whitespace-nowrap align-top">{x.r.date.slice(5)}</td>
                    <td className="px-3 py-2 text-[var(--text)]">{x.r.memo || <span className="text-[var(--text-dim)]">—</span>}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{x.r.partner || <span className="text-[var(--text-dim)]">—</span>}</td>
                    <td className="px-3 py-2 text-right mono-number whitespace-nowrap align-top">{x.r.debit ? formatKrw(x.r.debit) : ""}</td>
                    <td className="px-3 py-2 text-right mono-number whitespace-nowrap align-top">{x.r.credit ? formatKrw(x.r.credit) : ""}</td>
                    <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] whitespace-nowrap align-top">{formatKrw(x.balance)}</td>
                    <td className="px-3 py-2 text-right mono-number text-[var(--text-dim)] whitespace-nowrap align-top">{x.r.voucherNo ?? "—"}</td>
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
