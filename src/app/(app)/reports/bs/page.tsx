"use client";

import { useEffect, useState, useCallback } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface PayableInvoice {
  id: string;
  issueDate: string;
  amount: number;
  itemName: string | null;
  status: string;
  ntsConfirmNo: string | null;
}

interface PayableVendor {
  vendor: string;          // counterparty_name
  bizno: string | null;    // counterparty_bizno
  totalAmount: number;
  invoiceCount: number;
  invoices: PayableInvoice[];
}

interface BsData {
  /* Assets — Current */
  cashAndDeposits: number;
  accountsReceivable: number;
  currentAssets: number;
  /* Assets — Fixed */
  fixedAssets: number;
  fixedAssetDetails: { name: string; value: number; type: string; date?: string | null }[];
  totalAssets: number;
  /* Liabilities */
  borrowings: number;
  accountsPayable: number;
  totalLiabilities: number;
  /* Equity */
  capital: number;
  isCapitalDefault: boolean;
  retainedEarnings: number;
  totalEquity: number;
  /* Detail rows */
  bankAccountDetails: { name: string; balance: number; date?: string | null }[];
  loanDetails: { name: string; remainingAmount: number; date?: string | null }[];
  receivableDetails: { name: string; amount: number; date?: string | null }[];
  payableDetails: { name: string; amount: number; date?: string | null }[];
  /* 미지급금 드릴다운: 거래처별 그룹 + 세부 인보이스 */
  payableByVendor: PayableVendor[];
}

// 통합 세부 모달용 행 (날짜/거래처/금액)
interface DetailRow {
  date: string | null;
  name: string;
  amount: number;
  subText?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const DEFAULT_CAPITAL = 10_000_000;

function formatKrw(value: number): string {
  if (value === 0) return "-";
  const isNeg = value < 0;
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString("ko-KR");
  return isNeg ? `(${formatted})` : formatted;
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */
/* Fetch B/S data for a specific cutoff date (or current if not provided) */
async function fetchBsData(companyId: string, cutoffDate?: string, arApMonths = 6): Promise<BsData> {
  // 2026-06-10 AR/AP 기간 하한 — 최근 arApMonths 개월 송장만 미수금/미지급금으로 집계.
  //   매칭 워크플로우 미유지 시 1년치 송장이 통째로 미수/미지급으로 부풀려지던 문제 보정.
  //   그 이전(fromDate 미만)은 이미 정산된 것으로 간주.
  const cutoff = cutoffDate || new Date().toISOString().slice(0, 10);
  const fromDate = (() => { const d = new Date(cutoff); d.setMonth(d.getMonth() - arApMonths); return d.toISOString().slice(0, 10); })();
  // 큰 테이블(tax_invoices) 은 페이지네이션 — PostgREST 1000건 제약 회피
  const [bankRes, loanRes, invoices, vaultRes, companyRes, settlements] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("bank_name, alias, balance")
      .eq("company_id", companyId),
    supabase
      .from("loans")
      .select("lender, name, remaining_balance, status, maturity_date, start_date")
      .eq("company_id", companyId)
      .neq("status", "completed"),
    // 매출(sales)·매입(purchase) 세금계산서. status NOT IN ('void','matched') = 미입금·미지급분.
    //   'matched' = 통장 입출금 연결 → 현금에 반영(이중계상 방지), 'void' = 무효 제외.
    //   + 기간 하한(fromDate) — 최근 N개월만 outstanding 으로 간주(스테일 송장 부풀림 차단).
    fetchAllPaginated<any>((from, to) => {
      const q = supabase
        .from("tax_invoices")
        .select("id, counterparty_name, counterparty_bizno, total_amount, type, status, issue_date, item_name, nts_confirm_no")
        .eq("company_id", companyId)
        .not("status", "in", '("void","matched")')
        .gte("issue_date", fromDate)
        .lte("issue_date", cutoff);
      return q.range(from, to);
    }),
    supabase
      .from("vault_assets")
      .select("name, value, type, status, purchase_date, created_at, useful_life_months")
      .eq("company_id", companyId)
      .neq("status", "disposed"),
    // 자본금 — companies.tax_settings(jsonb).capital (회사설정에서 입력)
    supabase.from("companies").select("tax_settings").eq("id", companyId).maybeSingle(),
    // 정산 원장 — 확정(confirmed) 정산액을 송장별로 차감해 미수금·미지급금을 정밀 산출.
    fetchAllPaginated<any>((from, to) =>
      (supabase as any)
        .from("invoice_settlements")
        .select("tax_invoice_id, amount, status")
        .eq("company_id", companyId)
        .eq("status", "confirmed")
        .range(from, to)),
  ]);

  const bankAccounts = bankRes.data || [];
  const loans = loanRes.data || [];
  // database.ts 수기 타입에 useful_life_months 미반영 — any 캐스트로 우회 (DB 컬럼은 PR1 에서 추가됨).
  const vaultAssets = (vaultRes.data || []) as any[];

  // 송장별 확정 정산액 합계 — 미수금/미지급금에서 차감(부분정산 정확 반영).
  const settledByInvoice = new Map<string, number>();
  for (const s of (settlements as any[]) || []) {
    if (!s.tax_invoice_id) continue;
    settledByInvoice.set(s.tax_invoice_id, (settledByInvoice.get(s.tax_invoice_id) || 0) + Number(s.amount || 0));
  }
  const outstandingOf = (inv: any) => Math.max(0, Number(inv.total_amount || 0) - (settledByInvoice.get(inv.id) || 0));

  // 세금계산서 매출/매입 분리 (status NOT IN void,matched — 미입금·미지급분만)
  const salesInvoices = (invoices as any[]).filter((inv) => inv.type === "sales");
  const purchaseInvoices = (invoices as any[]).filter((inv) => inv.type === "purchase");

  /* --- Assets: Current --- */
  // 2026-06-10 현금·예금 = 통장 잔액 합(라이브 단일 소스). cash_snapshot 가산 제거 —
  //   스테일(갱신 멈춤) + 통장 잔액과 이중계상 위험이라 통장만 사용.
  const cashAndDeposits = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  // 매출채권 = 미입금(미매칭) 매출 세금계산서. 매칭(matched)된 건은 통장 입금 확인 → 현금에 반영됨.
  const receivableDetails = salesInvoices
    .map((inv: any) => ({
      name: inv.counterparty_name || "거래처 미상",
      amount: outstandingOf(inv),
      date: inv.issue_date || null,
    }))
    .filter((r) => r.amount > 0);
  const accountsReceivable = receivableDetails.reduce((sum, r) => sum + r.amount, 0);
  const currentAssets = cashAndDeposits + accountsReceivable;

  /* --- Assets: Fixed (vault_assets) --- */
  const ASSET_TYPE_LABELS: Record<string, string> = {
    equipment: "장비", vehicle: "차량", furniture: "가구", it_equipment: "IT장비",
    software: "소프트웨어", real_estate: "부동산", other: "기타",
  };
  // 2026-05-22 고정자산은 감가상각 장부가로 표시 (정액법) — vault 자산 화면과 정합.
  //   내용연수(useful_life_months)·취득일 없으면 취득가 유지.
  const bookValueOf = (value: number, purchaseDate: string | null | undefined, usefulLifeMonths: number | null | undefined): number => {
    const v = Number(value || 0);
    if (!usefulLifeMonths || usefulLifeMonths <= 0 || !purchaseDate) return v;
    const start = new Date(purchaseDate).getTime();
    if (isNaN(start)) return v;
    const monthsElapsed = Math.max(0, (Date.now() - start) / (1000 * 60 * 60 * 24 * 30.44));
    const ratio = Math.min(monthsElapsed / usefulLifeMonths, 1);
    return Math.max(Math.round(v * (1 - ratio)), 0);
  };
  const fixedAssetDetails = (vaultAssets as any[])
    .map((a: any) => ({
      name: a.name || "unnamed asset",
      value: bookValueOf(a.value, a.purchase_date, a.useful_life_months),  // 장부가
      type: ASSET_TYPE_LABELS[a.type] || a.type,
      date: a.purchase_date || a.created_at?.slice(0, 10) || null,
    }))
    .filter((a) => a.value > 0);
  const fixedAssets = fixedAssetDetails.reduce((sum, a) => sum + a.value, 0);
  const totalAssets = currentAssets + fixedAssets;

  /* --- Liabilities --- */
  const loanDetails = (loans as any[]).map((l: any) => ({
    name: `${l.lender || ""} ${l.name || ""}`.trim() || "unnamed loan",
    remainingAmount: l.remaining_balance || 0,
    date: l.maturity_date || l.start_date || null,
  }));
  const borrowings = loanDetails.reduce((sum, l) => sum + l.remainingAmount, 0);

  // 미지급금 = 미지급(미매칭) 매입 세금계산서. 매칭(matched)된 건은 통장 출금 확인 → 현금에서 차감됨.
  const payableDetails = purchaseInvoices
    .map((inv: any) => ({
      name: inv.counterparty_name || "unnamed",
      amount: outstandingOf(inv),
      date: inv.issue_date || null,
    }))
    .filter((p) => p.amount > 0);
  const accountsPayable = payableDetails.reduce((sum, p) => sum + p.amount, 0);
  const totalLiabilities = borrowings + accountsPayable;

  /* 미지급금 드릴다운: 거래처별 그룹 + 세부 인보이스 */
  const vendorMap = new Map<string, PayableVendor>();
  for (const inv of purchaseInvoices as any[]) {
    const outstanding = outstandingOf(inv);
    if (outstanding <= 0) continue; // 정산 완료분 제외
    const vendor = (inv.counterparty_name || "(거래처 미상)").trim() || "(거래처 미상)";
    const key = `${vendor}|${inv.counterparty_bizno || ""}`;
    const cur = vendorMap.get(key) || {
      vendor,
      bizno: inv.counterparty_bizno || null,
      totalAmount: 0, invoiceCount: 0, invoices: [] as PayableInvoice[],
    };
    cur.totalAmount += outstanding;
    cur.invoiceCount++;
    cur.invoices.push({
      id: inv.id,
      issueDate: inv.issue_date || '',
      amount: outstanding,
      itemName: inv.item_name || null,
      status: inv.status || 'unknown',
      ntsConfirmNo: inv.nts_confirm_no || null,
    });
    vendorMap.set(key, cur);
  }
  const payableByVendor = Array.from(vendorMap.values())
    .map((v) => ({ ...v, invoices: v.invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate)) }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  /* --- Equity --- */
  // 자본금 = companies.tax_settings.capital (회사설정 입력값). 미입력 시 기본값 + 안내 플래그.
  //   자본금이 실제값이면 이익잉여금(= 순자산 − 납입자본금)도 자동으로 의미를 가짐(역산이 곧 정의).
  const capitalRaw = (companyRes as any)?.data?.tax_settings?.capital;
  const isCapitalDefault = capitalRaw == null || Number(capitalRaw) <= 0;
  const capital = isCapitalDefault ? DEFAULT_CAPITAL : Number(capitalRaw);
  const totalEquity = totalAssets - totalLiabilities;     // 순자산(자산−부채) — 항상 정합
  const retainedEarnings = totalEquity - capital;          // 이익잉여금 등 = 순자산 − 납입자본금

  const bankAccountDetails = bankAccounts.map((a) => ({
    name: `${a.bank_name || ""} ${a.alias || ""}`.trim() || "unnamed account",
    balance: a.balance || 0,
  }));

  return {
    cashAndDeposits,
    accountsReceivable,
    currentAssets,
    fixedAssets,
    fixedAssetDetails,
    totalAssets,
    borrowings,
    accountsPayable,
    totalLiabilities,
    capital,
    isCapitalDefault,
    retainedEarnings,
    totalEquity,
    bankAccountDetails,
    loanDetails,
    receivableDetails,
    payableDetails,
    payableByVendor,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Financial ratio helpers                                            */
/* ------------------------------------------------------------------ */
interface RatioInfo {
  label: string;
  value: number;
  unit: string;
  health: "green" | "yellow" | "red";
  description: string;
}

function computeRatios(d: BsData): RatioInfo[] {
  const currentLiabilities = d.accountsPayable;

  const currentRatio = currentLiabilities > 0
    ? (d.currentAssets / currentLiabilities) * 100
    : d.currentAssets > 0 ? 999 : 0;

  const debtToEquity = d.totalEquity > 0
    ? (d.totalLiabilities / d.totalEquity) * 100
    : d.totalLiabilities > 0 ? 999 : 0;

  const equityRatio = d.totalAssets > 0
    ? (d.totalEquity / d.totalAssets) * 100
    : 0;

  return [
    {
      label: "유동비율 (Current Ratio)",
      value: Math.round(currentRatio),
      unit: "%",
      health: currentRatio >= 200 ? "green" : currentRatio >= 100 ? "yellow" : "red",
      description: "200% 이상 양호 / 100% 미만 단기 유동성 위험",
    },
    {
      label: "부채비율 (Debt-to-Equity)",
      value: Math.round(debtToEquity),
      unit: "%",
      health: debtToEquity <= 100 ? "green" : debtToEquity <= 200 ? "yellow" : "red",
      description: "100% 이하 안정 / 200% 초과 과다부채",
    },
    {
      label: "자기자본비율 (Equity Ratio)",
      value: Math.round(equityRatio),
      unit: "%",
      health: equityRatio >= 50 ? "green" : equityRatio >= 30 ? "yellow" : "red",
      description: "50% 이상 건전 / 30% 미만 자본 취약",
    },
  ];
}

const HEALTH_COLORS: Record<string, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
};

/* ------------------------------------------------------------------ */
/*  Print CSS                                                          */
/* ------------------------------------------------------------------ */
const PRINT_CSS = `
@media print {
  body { background: white !important; color: black !important; }
  body * { visibility: hidden; }
  #bs-printable, #bs-printable * { visibility: visible; color: black !important; }
  #bs-printable {
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
/*  Component                                                          */
/* ------------------------------------------------------------------ */
interface TrendPoint {
  month: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

async function fetchBsTrend(companyId: string, months: number = 6): Promise<TrendPoint[]> {
  const points: TrendPoint[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const cutoff = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    const label = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      const bs = await fetchBsData(companyId, cutoff);
      points.push({ month: label, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity });
    } catch {
      points.push({ month: label, totalAssets: 0, totalLiabilities: 0, totalEquity: 0 });
    }
  }
  return points;
}

export default function BalanceSheetPage() {
  const { role } = useUser();
  if (role === "partner") {
    return <AccessDenied detail="재무상태표는 대표·관리자 전용입니다." />;
  }
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [data, setData] = useState<BsData | null>(null);
  const [prevData, setPrevData] = useState<BsData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompareMode, setIsCompareMode] = useState(false);
  // 기준일 — 빈 값이면 오늘, 사용자가 지정하면 그 시점 BS 조회
  const [cutoffInput, setCutoffInput] = useState<string>('');
  // 2026-06-10 매출채권/미지급금 집계 기간(개월) — 최근 N개월 송장만 outstanding 으로 간주
  const [arApMonths, setArApMonths] = useState<number>(6);
  const [showPayableDrill, setShowPayableDrill] = useState(false);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  // 통합 세부 모달: 자산/부채 항목 클릭 시 열림
  const [detailModal, setDetailModal] = useState<{ title: string; total: number; rows: DetailRow[]; prevTotal?: number } | null>(null);

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

    // 기준일: 사용자가 지정 했으면 그 날짜, 아니면 오늘
    const baseDate = cutoffInput || new Date().toISOString().slice(0, 10);
    const baseObj = new Date(baseDate);
    const prevMonth = new Date(baseObj.getFullYear(), baseObj.getMonth() - 1, 1);
    const prevCutoff = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    Promise.all([
      fetchBsData(companyId, cutoffInput || undefined, arApMonths),
      fetchBsData(companyId, prevCutoff, arApMonths),
      fetchBsTrend(companyId, 6),
    ])
      .then(([current, prev, trendData]) => {
        setData(current);
        setPrevData(prev);
        setTrend(trendData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [companyId, cutoffInput, arApMonths]);

  /* ---------------------------------------------------------------- */
  /*  CSV Export                                                       */
  /* ---------------------------------------------------------------- */
  const handleExportCsv = useCallback(() => {
    if (!data) return;
    const lines: string[] = [];
    lines.push("구분,항목,금액");

    lines.push("유동자산,,");
    lines.push(`유동자산,현금 및 예금,${Math.round(data.cashAndDeposits)}`);
    for (const b of data.bankAccountDetails) {
      lines.push(`유동자산 > 현금 및 예금,${b.name},${Math.round(b.balance)}`);
    }
    lines.push(`유동자산,매출채권,${Math.round(data.accountsReceivable)}`);
    for (const r of data.receivableDetails) {
      lines.push(`유동자산 > 매출채권,${r.name},${Math.round(r.amount)}`);
    }
    lines.push(`유동자산 소계,,${Math.round(data.currentAssets)}`);
    lines.push("");
    lines.push("고정자산,,");
    for (const a of data.fixedAssetDetails) {
      lines.push(`고정자산,${a.name} (${a.type}),${Math.round(a.value)}`);
    }
    lines.push(`고정자산 소계,,${Math.round(data.fixedAssets)}`);
    lines.push(`자산 합계,,${Math.round(data.totalAssets)}`);

    lines.push("");
    lines.push("부채,,");
    lines.push(`부채,차입금,${Math.round(data.borrowings)}`);
    for (const l of data.loanDetails) {
      lines.push(`부채 > 차입금,${l.name},${Math.round(l.remainingAmount)}`);
    }
    lines.push(`부채,미지급금,${Math.round(data.accountsPayable)}`);
    for (const p of data.payableDetails) {
      lines.push(`부채 > 미지급금,${p.name},${Math.round(p.amount)}`);
    }
    lines.push(`부채 합계,,${Math.round(data.totalLiabilities)}`);

    lines.push("");
    lines.push("자본,,");
    lines.push(`자본,자본금,${Math.round(data.capital)}`);
    lines.push(`자본,이익잉여금,${Math.round(data.retainedEarnings)}`);
    lines.push(`자본 합계,,${Math.round(data.totalEquity)}`);

    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `재무상태표_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */
  const renderSectionRow = (
    label: string,
    amount: number,
    options?: { isBold?: boolean; isTotal?: boolean; indent?: boolean; isNested?: boolean; prevAmount?: number },
  ) => {
    const delta = options?.prevAmount !== undefined ? amount - options.prevAmount : undefined;
    return (
      <tr
        key={label}
        style={{
          borderBottom: options?.isTotal ? "2px solid var(--text)" : undefined,
          background: options?.isTotal ? "var(--bg-surface)" : undefined,
        }}
      >
        <td
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: options?.isBold || options?.isTotal ? 600 : 400,
            color: options?.isTotal ? "var(--text)" : options?.isNested ? "var(--text-dim)" : "var(--text-muted)",
            paddingLeft: options?.isNested ? 48 : options?.indent ? 32 : 16,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </td>
        <td
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: options?.isBold || options?.isTotal ? 600 : 400,
            textAlign: "right",
            color: amount < 0 ? "var(--danger)" : options?.isTotal ? "var(--text)" : "var(--text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {formatKrw(amount)}
        </td>
        {isCompareMode && (
          <td
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: options?.isBold || options?.isTotal ? 600 : 400,
              textAlign: "right",
              whiteSpace: "nowrap",
              color: delta === undefined || delta === 0
                ? "var(--text-dim)"
                : delta > 0 ? "#10b981" : "#ef4444",
            }}
          >
            {delta === undefined ? "-" : delta === 0 ? "-" : `${delta > 0 ? "+" : ""}${formatKrw(delta)} ${delta > 0 ? "\u25B2" : "\u25BC"}`}
          </td>
        )}
      </tr>
    );
  };

  const colCount = isCompareMode ? 3 : 2;

  const renderSectionHeader = (label: string) => (
    <tr key={`header-${label}`}>
      <td
        colSpan={colCount}
        style={{
          padding: "14px 16px 6px",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--primary)",
          background: "var(--bg-card)",
        }}
      >
        {label}
      </td>
    </tr>
  );

  const renderDivider = (key: string) => (
    <tr key={key}>
      <td colSpan={colCount} style={{ padding: 0, height: 1, background: "var(--border)" }} />
    </tr>
  );

  /* ---------------------------------------------------------------- */
  /*  Loading / Error / Empty states                                   */
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
            재무상태표 데이터를 불러오는 중...
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

  if (!data) {
    return (
      <div className="p-16 text-center">
        <div className="text-4xl mb-3">📋</div>
        <div className="text-sm font-medium text-[var(--text)]">거래 데이터가 쌓이면 재무상태표가 자동 생성됩니다</div>
        <div className="text-xs text-[var(--text-muted)] mt-1">거래내역과 계좌 정보를 먼저 등록해주세요</div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Main render                                                      */
  /* ---------------------------------------------------------------- */
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div id="bs-printable">
      <style>{PRINT_CSS}</style>
      {/* 툴바 — 기준일·채권채무 필터(좌) + 액션(우). 페이지 타이틀은 공통 헤더바가 표시 (2026-07-03 라운드6.5) */}
      <div className="page-sticky-header mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[var(--text-dim)]">기준일</label>
            <DateField value={cutoffInput || today} max={today} onChange={(e) => setCutoffInput(e.target.value)}
              className="h-8 px-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]" />
            {cutoffInput && cutoffInput !== today && (
              <button onClick={() => setCutoffInput('')} className="text-[11px] text-[var(--primary)] font-semibold hover:underline" title="오늘로 초기화">↺ 오늘</button>
            )}
          </div>
          <div className="h-5 w-px bg-[var(--border)] hidden sm:block" />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-[var(--text-dim)]">채권·채무</label>
            <div className="seg-bar">
              {[3, 6, 12].map((m) => (
                <button key={m} type="button" onClick={() => setArApMonths(m)}
                  className={`seg-item ${arApMonths === m ? "seg-item-active" : ""}`}>
                  {m}개월
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[var(--text-dim)]">이내 미매칭 세금계산서만 집계</span>
          </div>
        </div>
        <div className="no-print flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setIsCompareMode((v) => !v)} aria-label="전월 비교"
            className={isCompareMode ? "btn-primary text-xs" : "btn-secondary text-xs"}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" /></svg>
            전월 비교
          </button>
          <button onClick={handleExportCsv} aria-label="CSV 다운로드"
            className="btn-secondary text-xs">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            CSV
          </button>
          <button onClick={() => window.print()} aria-label="인쇄"
            className="btn-secondary text-xs">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" /></svg>
            인쇄
          </button>
        </div>
      </div>

      {/* Summary Cards — 그라데이션 액센트 + 전월 델타 (2026-06-25 리디자인) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { key: "asset", label: "총 자산", value: data.totalAssets, prev: prevData?.totalAssets, tone: "",
            icon: <path strokeLinecap="round" strokeLinejoin="round" d="M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5M18 12a2 2 0 000 4h3v-4h-3z" /> },
          { key: "liab", label: "총 부채", value: data.totalLiabilities, prev: prevData?.totalLiabilities, tone: "danger",
            icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M21 7v6m0-6h-6" /> },
          { key: "equity", label: "순자산 (자본)", value: data.totalEquity, prev: prevData?.totalEquity, tone: data.totalEquity >= 0 ? "success" : "danger",
            icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4" /> },
        ].map((card) => {
          const delta = isCompareMode && card.prev !== undefined ? card.value - card.prev : undefined;
          return (
            <div key={card.key} className="glass-card p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--text-muted)]">{card.label}</span>
                <span className={`kpi-icon ${card.tone}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">{card.icon}</svg>
                </span>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <span className={`text-[26px] leading-8 font-extrabold mono-number ${card.value < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
                  {card.value < 0 ? "-" : ""}₩{Math.abs(Math.round(card.value)).toLocaleString("ko-KR")}
                </span>
                {delta !== undefined && (
                  <span className={`delta-chip ${delta === 0 ? "delta-flat" : delta > 0 ? "delta-up" : "delta-down"}`}>
                    {delta === 0 ? "전월과 동일" : `${delta > 0 ? "▲" : "▼"} ₩${Math.abs(Math.round(delta)).toLocaleString("ko-KR")}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Balance Sheet — T자 레이아웃 (좌: 자산 / 우: 부채 + 자본) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── 좌: 자산 ── */}
        <div className="glass-card" style={{ overflow: "auto" }}>
          <div style={{ padding: "14px 16px", borderBottom: "2px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>자산 (Assets)</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>금액 (원)</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
            <tbody>
              {renderSectionHeader("유동자산 (Current Assets)")}
              <ClickableRow
                label="현금 및 예금" amount={data.cashAndDeposits}
                prevAmount={isCompareMode && prevData ? prevData.cashAndDeposits : undefined}
                isCompareMode={isCompareMode}
                onClick={() => setDetailModal({
                  title: '현금 및 예금 세부',
                  total: data.cashAndDeposits,
                  prevTotal: isCompareMode && prevData ? prevData.cashAndDeposits : undefined,
                  rows: data.bankAccountDetails.map((b: any) => ({ date: b.date || null, name: b.name, amount: b.balance })),
                })}
              />
              <ClickableRow
                label="매출채권" amount={data.accountsReceivable}
                prevAmount={isCompareMode && prevData ? prevData.accountsReceivable : undefined}
                isCompareMode={isCompareMode}
                onClick={() => setDetailModal({
                  title: '매출채권 세부',
                  total: data.accountsReceivable,
                  prevTotal: isCompareMode && prevData ? prevData.accountsReceivable : undefined,
                  rows: data.receivableDetails.map((r: any) => ({ date: r.date || null, name: r.name, amount: r.amount })),
                })}
              />
              {renderDivider("div-ca-left")}
              {renderSectionRow("유동자산 소계", data.currentAssets, { isTotal: true, prevAmount: isCompareMode && prevData ? prevData.currentAssets : undefined })}

              {renderSectionHeader("고정자산 (Fixed Assets)")}
              <ClickableRow
                label="고정자산" amount={data.fixedAssets}
                prevAmount={isCompareMode && prevData ? prevData.fixedAssets : undefined}
                isCompareMode={isCompareMode}
                onClick={() => setDetailModal({
                  title: '고정자산 세부',
                  total: data.fixedAssets,
                  prevTotal: isCompareMode && prevData ? prevData.fixedAssets : undefined,
                  rows: data.fixedAssetDetails.map((a: any) => ({ date: a.date || null, name: `${a.name} (${a.type})`, amount: a.value })),
                })}
              />
              {renderDivider("div-fa-left")}
              {renderSectionRow("고정자산 소계", data.fixedAssets, { isTotal: true, prevAmount: isCompareMode && prevData ? prevData.fixedAssets : undefined })}
            </tbody>
          </table>
        </div>

        {/* ── 우: 부채 + 자본 ── */}
        <div className="glass-card" style={{ overflow: "auto" }}>
          <div style={{ padding: "14px 16px", borderBottom: "2px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>부채 + 자본 (Liabilities + Equity)</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>금액 (원)</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
            <tbody>
              {renderSectionHeader("부채 (Liabilities)")}
              <ClickableRow
                label="차입금" amount={data.borrowings}
                prevAmount={isCompareMode && prevData ? prevData.borrowings : undefined}
                isCompareMode={isCompareMode}
                onClick={() => setDetailModal({
                  title: '차입금 세부',
                  total: data.borrowings,
                  prevTotal: isCompareMode && prevData ? prevData.borrowings : undefined,
                  rows: data.loanDetails.map((l: any) => ({ date: l.date || null, name: l.name, amount: l.remainingAmount })),
                })}
              />
              <ClickableRow
                label="미지급금" amount={data.accountsPayable}
                prevAmount={isCompareMode && prevData ? prevData.accountsPayable : undefined}
                isCompareMode={isCompareMode}
                onClick={() => setDetailModal({
                  title: '미지급금 세부',
                  total: data.accountsPayable,
                  prevTotal: isCompareMode && prevData ? prevData.accountsPayable : undefined,
                  rows: data.payableDetails.map((p: any) => ({ date: p.date || null, name: p.name, amount: p.amount })),
                })}
              />
              {renderDivider("div-l-right")}
              {renderSectionRow("부채 합계", data.totalLiabilities, { isTotal: true, prevAmount: isCompareMode && prevData ? prevData.totalLiabilities : undefined })}

              {renderSectionHeader("자본 (Equity)")}
              {renderSectionRow(
                data.isCapitalDefault ? "자본금 (기본값)" : "자본금",
                data.capital,
                { indent: true, prevAmount: isCompareMode && prevData ? prevData.capital : undefined },
              )}
              {renderSectionRow("이익잉여금", data.retainedEarnings, { indent: true, prevAmount: isCompareMode && prevData ? prevData.retainedEarnings : undefined })}
              {renderDivider("div-e-right")}
              {renderSectionRow("자본 합계", data.totalEquity, { isTotal: true, prevAmount: isCompareMode && prevData ? prevData.totalEquity : undefined })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 합계 요약 — 자산 vs 부채+자본 (표 바로 아래 정적 요약, sticky 제거: 하단 콘텐츠 위로 떠다니고 헤더와 z충돌하던 문제 수정 2026-06-10) */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--primary)]/8 border border-[var(--primary)]/20">
          <div className="text-xs font-bold text-[var(--primary)]">자산 합계</div>
          <div className="text-base font-extrabold text-[var(--primary)] mono-number">₩{Math.round(data.totalAssets).toLocaleString("ko-KR")}</div>
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-orange-500/8 border border-orange-500/20">
          <div className="text-xs font-bold text-orange-600 dark:text-orange-400">부채 + 자본 합계</div>
          <div className="text-base font-extrabold text-orange-600 dark:text-orange-400 mono-number">₩{Math.round(data.totalLiabilities + data.totalEquity).toLocaleString("ko-KR")}</div>
        </div>
        {/* 균형 여부 표시 — 회계 정합성 */}
        {Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)) > 1 && (
          <div className="md:col-span-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-[10px] text-yellow-700 dark:text-yellow-400">
            ⚠ 차변(자산) - 대변(부채+자본) 차이 ₩{Math.round(data.totalAssets - (data.totalLiabilities + data.totalEquity)).toLocaleString("ko-KR")} — 자본금 / 이익잉여금 데이터 확인 필요
          </div>
        )}
      </div>

      {/* Asset vs Liability Composition Bar — 섹션 제목을 카드 안 헤더로 흡수 (2026-07-03 라운드6.5) */}
      <div className="glass-card mt-8 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="m-0 text-sm font-bold text-[var(--text)]">자산/부채 구성</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Assets bar */}
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, fontWeight: 500 }}>
              자산 {data.totalAssets > 0 ? `₩${Math.round(data.totalAssets).toLocaleString("ko-KR")}` : ""}
            </div>
            <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface)" }}>
              {data.totalAssets > 0 && (
                <>
                  <div
                    style={{
                      width: `${Math.round((data.cashAndDeposits / data.totalAssets) * 100)}%`,
                      background: "var(--primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.cashAndDeposits > 0 ? 40 : 0,
                    }}
                    title={`현금 및 예금: ₩${Math.round(data.cashAndDeposits).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((data.cashAndDeposits / data.totalAssets) * 100) > 10 ? "현금" : ""}
                  </div>
                  <div
                    style={{
                      width: `${Math.round((data.accountsReceivable / data.totalAssets) * 100)}%`,
                      background: "#10b981",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.accountsReceivable > 0 ? 40 : 0,
                    }}
                    title={`매출채권: ₩${Math.round(data.accountsReceivable).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((data.accountsReceivable / data.totalAssets) * 100) > 10 ? "채권" : ""}
                  </div>
                  {data.fixedAssets > 0 && (
                    <div
                      style={{
                        width: `${Math.round((data.fixedAssets / data.totalAssets) * 100)}%`,
                        background: "#8b5cf6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        color: "#fff",
                        fontWeight: 600,
                        minWidth: 40,
                      }}
                      title={`고정자산: ₩${Math.round(data.fixedAssets).toLocaleString("ko-KR")}`}
                    >
                      {Math.round((data.fixedAssets / data.totalAssets) * 100) > 10 ? "고정" : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {/* Liabilities + Equity bar */}
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, fontWeight: 500 }}>
              부채 + 자본
            </div>
            <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface)" }}>
              {(data.totalLiabilities + data.totalEquity) > 0 && (
                <>
                  <div
                    style={{
                      width: `${Math.round((data.totalLiabilities / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100)}%`,
                      background: "#ef4444",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.totalLiabilities > 0 ? 40 : 0,
                    }}
                    title={`부채: ₩${Math.round(data.totalLiabilities).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((data.totalLiabilities / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100) > 10 ? "부채" : ""}
                  </div>
                  <div
                    style={{
                      width: `${Math.round((Math.max(data.totalEquity, 0) / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100)}%`,
                      background: "#10b981",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.totalEquity > 0 ? 40 : 0,
                    }}
                    title={`자본: ₩${Math.round(data.totalEquity).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((Math.max(data.totalEquity, 0) / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100) > 10 ? "자본" : ""}
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--text-dim)", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--primary)", display: "inline-block" }} />현금
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981", display: "inline-block" }} />채권/자본
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#8b5cf6", display: "inline-block" }} />고정자산
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#ef4444", display: "inline-block" }} />부채
            </span>
          </div>
        </div>
      </div>

      {/* 데이터 신뢰도 배너 — 자본 섹션 추정값 안내 (정확도 투명성) */}
      {data.isCapitalDefault && (
        <div className="kpi-callout warning mt-4 flex items-start gap-2.5">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86l-8.1 14A1 1 0 003 19.5h18a1 1 0 00.87-1.5l-8.1-14a1 1 0 00-1.74 0z" /></svg>
          <p className="text-[11.5px] leading-relaxed">
            <b>자본금이 미등록 상태입니다.</b> 기본값 {DEFAULT_CAPITAL.toLocaleString("ko-KR")}원으로 표시 중이라 자본·이익잉여금이 부정확합니다. <Link href="/settings?tab=company" className="underline font-semibold">회사 설정 → 회사정보</Link>에서 자본금을 입력하면 정확해집니다.
          </p>
        </div>
      )}

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
          <div>· <b className="text-[var(--text-muted)]">현금·예금</b> = 등록 은행계좌 잔액 합계</div>
          <div>· <b className="text-[var(--text-muted)]">매출채권</b> = 미입금(미매칭) 매출 세금계산서. 입금 매칭 시 현금으로 이동·상계</div>
          <div>· <b className="text-[var(--text-muted)]">고정자산</b> = 자산관리(Vault) 등록 자산의 감가상각 장부가</div>
          <div>· <b className="text-[var(--text-muted)]">차입금</b> = 진행 중 대출 잔액</div>
          <div>· <b className="text-[var(--text-muted)]">미지급금</b> = 미지급 매입 세금계산서 − 확정 정산액(부분정산 반영)</div>
          <div>· <b className="text-[var(--text-muted)]">매출채권/미지급금</b>은 확정 정산액을 차감해 산출(정산 원장 반영)</div>
          <div>· <b className="text-[var(--text-muted)]">이익잉여금</b> = 순자산(자산−부채) − 납입자본금</div>
        </div>
      </details>

      {/* Monthly Trend Chart — 섹션 제목을 카드 안 헤더로 흡수 (2026-07-03 라운드6.5) */}
      {trend.length > 0 && (
        <div className="mt-8">
          <div style={{ padding: "20px", borderRadius: 12, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="m-0 text-sm font-bold text-[var(--text)]">월별 추이 (최근 6개월)</h3>
            </div>
            {(() => {
              const maxVal = Math.max(...trend.map(p => Math.max(p.totalAssets, p.totalLiabilities + Math.max(p.totalEquity, 0))), 1);
              return (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
                  {trend.map((p) => {
                    const assetH = Math.round((p.totalAssets / maxVal) * 140);
                    const liabH = Math.round((p.totalLiabilities / maxVal) * 140);
                    const eqH = Math.round((Math.max(p.totalEquity, 0) / maxVal) * 140);
                    return (
                      <div key={p.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 140 }}>
                          <div style={{ width: 18, height: assetH, background: "var(--primary)", borderRadius: "3px 3px 0 0", minHeight: 2 }} title={`자산: ₩${p.totalAssets.toLocaleString()}`} />
                          <div style={{ width: 18, height: liabH, background: "#ef4444", borderRadius: "3px 3px 0 0", minHeight: 2 }} title={`부채: ₩${p.totalLiabilities.toLocaleString()}`} />
                          <div style={{ width: 18, height: eqH, background: "#10b981", borderRadius: "3px 3px 0 0", minHeight: 2 }} title={`자본: ₩${Math.max(p.totalEquity, 0).toLocaleString()}`} />
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{p.month}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--text-dim)", marginTop: 12, justifyContent: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--primary)", display: "inline-block" }} />자산
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#ef4444", display: "inline-block" }} />부채
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981", display: "inline-block" }} />자본
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 통합 세부 모달 — 자산/부채 항목 클릭 시 열림 */}
      {detailModal && (
        <DetailModalView
          modal={detailModal}
          isCompareMode={isCompareMode}
          onClose={() => setDetailModal(null)}
        />
      )}

      {/* Financial Ratios */}
      <div className="mt-8">
        <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">Ratios</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>
          재무 비율 분석
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {computeRatios(data).map((ratio) => (
            <div key={ratio.label} className="glass-card" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: HEALTH_COLORS[ratio.health], flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", color: "var(--text-muted)" }}>
                  {ratio.label}
                </span>
              </div>
              <div className="mono-number" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: HEALTH_COLORS[ratio.health], marginBottom: 8 }}>
                {ratio.value === 999 ? "N/A" : `${ratio.value}${ratio.unit}`}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {ratio.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Sub-components                                                */
/* ============================================================ */

function ClickableRow({ label, amount, prevAmount, isCompareMode, onClick }: {
  label: string;
  amount: number;
  prevAmount?: number;
  isCompareMode: boolean;
  onClick: () => void;
}) {
  const delta = prevAmount !== undefined ? amount - prevAmount : undefined;
  return (
    <tr
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      className="hover:bg-[var(--bg-surface)] transition"
      title="클릭해서 세부 보기"
    >
      <td style={{ padding: "10px 16px", paddingLeft: 32, fontSize: 13, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
        {label}
      </td>
      <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "right", color: amount < 0 ? "var(--danger)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
        {amount === 0 ? "-" : (amount < 0 ? `(${Math.abs(Math.round(amount)).toLocaleString("ko-KR")})` : Math.round(amount).toLocaleString("ko-KR"))}
      </td>
      {isCompareMode && (
        <td style={{
          padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap",
          color: delta === undefined || delta === 0 ? "var(--text-dim)" : delta > 0 ? "#10b981" : "#ef4444",
        }}>
          {delta === undefined ? "-" : delta === 0 ? "-" : `${delta > 0 ? "+" : ""}${Math.round(delta).toLocaleString("ko-KR")} ${delta > 0 ? "▲" : "▼"}`}
        </td>
      )}
    </tr>
  );
}

type SortKey = 'date' | 'name' | 'amount';

function DetailModalView({ modal, isCompareMode, onClose }: {
  modal: { title: string; total: number; rows: DetailRow[]; prevTotal?: number };
  isCompareMode: boolean;
  onClose: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const sortedRows = [...modal.rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'amount') return (a.amount - b.amount) * dir;
    if (sortKey === 'date') return String(a.date || '').localeCompare(String(b.date || '')) * dir;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko') * dir;
  });

  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{modal.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{modal.rows.length}건 · 컬럼 헤더 클릭 시 정렬</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 18, color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
        </div>

        {/* 합계 */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>합계</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>₩{Math.round(modal.total).toLocaleString('ko-KR')}</div>
          </div>
          {isCompareMode && modal.prevTotal !== undefined && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>전월</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>₩{Math.round(modal.prevTotal).toLocaleString('ko-KR')}</div>
              {(() => {
                const delta = modal.total - modal.prevTotal!;
                return (
                  <div style={{ fontSize: 11, fontWeight: 600, color: delta === 0 ? 'var(--text-dim)' : delta > 0 ? '#10b981' : '#ef4444' }}>
                    {delta === 0 ? '-' : `${delta > 0 ? '+' : ''}${Math.round(delta).toLocaleString('ko-KR')} ${delta > 0 ? '▲' : '▼'}`}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* 표 */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {sortedRows.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-3xl mb-2">🗂️</div>
              <div className="text-[13px] font-semibold text-[var(--text)]">세부 항목이 없습니다.</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1">해당 항목에 집계된 내역이 아직 없어요</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th onClick={() => toggle('date')}
                    style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer', userSelect: 'none' }}>
                    날짜{arrow('date')}
                  </th>
                  <th onClick={() => toggle('name')}
                    style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer', userSelect: 'none' }}>
                    거래처/항목{arrow('name')}
                  </th>
                  <th onClick={() => toggle('amount')}
                    style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer', userSelect: 'none' }}>
                    금액{arrow('amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.date || '-'}</td>
                    <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text)' }}>
                      {r.name}
                      {r.subText && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.subText}</div>}
                    </td>
                    <td style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, textAlign: 'right', color: 'var(--text)' }}>
                      ₩{Math.round(r.amount).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
