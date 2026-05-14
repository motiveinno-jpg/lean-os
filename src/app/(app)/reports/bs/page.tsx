"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";

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
  fixedAssetDetails: { name: string; value: number; type: string }[];
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
  bankAccountDetails: { name: string; balance: number }[];
  loanDetails: { name: string; remainingAmount: number }[];
  receivableDetails: { name: string; amount: number }[];
  payableDetails: { name: string; amount: number }[];
  /* 미지급금 드릴다운: 거래처별 그룹 + 세부 인보이스 */
  payableByVendor: PayableVendor[];
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
async function fetchBsData(companyId: string, cutoffDate?: string): Promise<BsData> {
  const [bankRes, loanRes, cashRes, dealsRes, revenueRes, invoicesRes, companyRes, settingsRes, vaultRes] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("bank_name, alias, balance")
      .eq("company_id", companyId),
    supabase
      .from("loans")
      .select("lender, name, remaining_balance, status")
      .eq("company_id", companyId)
      .neq("status", "completed"),
    supabase
      .from("cash_snapshot")
      .select("current_balance")
      .eq("company_id", companyId)
      .limit(1),
    supabase
      .from("deals")
      .select("id, name, contract_total, status")
      .eq("company_id", companyId)
      .in("status", ["in_progress", "pending", "contracted"]),
    supabase
      .from("deal_revenue_schedule")
      .select("deal_id, amount, status")
      .in("status", ["received", "paid"]),
    (() => {
      let q = supabase
        .from("tax_invoices")
        .select("id, counterparty_name, counterparty_bizno, total_amount, type, status, issue_date, item_name, nts_confirm_no")
        .eq("company_id", companyId)
        .eq("type", "purchase")
        .in("status", ["received", "issued", "modified"]);
      if (cutoffDate) q = q.lte("issue_date", cutoffDate);
      return q;
    })(),
    supabase
      .from("companies")
      .select("capital, registered_capital")
      .eq("id", companyId)
      .maybeSingle(),
    (supabase as any)
      .from("company_settings")
      .select("capital")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("vault_assets")
      .select("name, value, type, status")
      .eq("company_id", companyId)
      .neq("status", "disposed"),
  ]);

  const bankAccounts = bankRes.data || [];
  const loans = loanRes.data || [];
  const cashSnapshots = cashRes.data || [];
  const deals = dealsRes.data || [];
  const revenueSchedules = revenueRes.data || [];
  const invoices = (invoicesRes.data || []) as any[];
  const vaultAssets = (vaultRes.data || []) as { name: string; value: number | null; type: string; status: string | null }[];

  /* --- Assets: Current --- */
  const bankTotal = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const cashAmount = cashSnapshots.length > 0 ? (cashSnapshots[0].current_balance || 0) : 0;
  const cashAndDeposits = bankTotal + cashAmount;

  const paidByDeal = new Map<string, number>();
  for (const rs of revenueSchedules) {
    if (!rs.deal_id) continue;
    paidByDeal.set(rs.deal_id, (paidByDeal.get(rs.deal_id) || 0) + (rs.amount || 0));
  }

  const receivableDetails = deals
    .filter((d) => {
      const paid = paidByDeal.get(d.id) || 0;
      const outstanding = (d.contract_total || 0) - paid;
      return outstanding > 0;
    })
    .map((d) => {
      const paid = paidByDeal.get(d.id) || 0;
      return {
        name: d.name || "unnamed deal",
        amount: (d.contract_total || 0) - paid,
      };
    });
  const accountsReceivable = receivableDetails.reduce((sum, r) => sum + r.amount, 0);
  const currentAssets = cashAndDeposits + accountsReceivable;

  /* --- Assets: Fixed (vault_assets) --- */
  const ASSET_TYPE_LABELS: Record<string, string> = {
    equipment: "장비", vehicle: "차량", furniture: "가구", it_equipment: "IT장비",
    software: "소프트웨어", real_estate: "부동산", other: "기타",
  };
  const fixedAssetDetails = vaultAssets
    .filter((a) => (a.value || 0) > 0)
    .map((a) => ({
      name: a.name || "unnamed asset",
      value: a.value || 0,
      type: ASSET_TYPE_LABELS[a.type] || a.type,
    }));
  const fixedAssets = fixedAssetDetails.reduce((sum, a) => sum + a.value, 0);
  const totalAssets = currentAssets + fixedAssets;

  /* --- Liabilities --- */
  const loanDetails = loans.map((l) => ({
    name: `${l.lender || ""} ${l.name || ""}`.trim() || "unnamed loan",
    remainingAmount: l.remaining_balance || 0,
  }));
  const borrowings = loanDetails.reduce((sum, l) => sum + l.remainingAmount, 0);

  const payableDetails = invoices.map((inv) => ({
    name: inv.counterparty_name || "unnamed",
    amount: inv.total_amount || 0,
  }));
  const accountsPayable = payableDetails.reduce((sum, p) => sum + p.amount, 0);
  const totalLiabilities = borrowings + accountsPayable;

  /* 미지급금 드릴다운: 거래처별 그룹 + 세부 인보이스 */
  const vendorMap = new Map<string, PayableVendor>();
  for (const inv of invoices as any[]) {
    const vendor = (inv.counterparty_name || "(거래처 미상)").trim() || "(거래처 미상)";
    const key = `${vendor}|${inv.counterparty_bizno || ""}`;
    const cur = vendorMap.get(key) || {
      vendor,
      bizno: inv.counterparty_bizno || null,
      totalAmount: 0, invoiceCount: 0, invoices: [] as PayableInvoice[],
    };
    cur.totalAmount += Number(inv.total_amount || 0);
    cur.invoiceCount++;
    cur.invoices.push({
      id: inv.id,
      issueDate: inv.issue_date || '',
      amount: Number(inv.total_amount || 0),
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
  /* 자본금: companies → company_settings → DEFAULT_CAPITAL 순으로 조회 */
  const companyData = companyRes.data as Record<string, unknown> | null;
  const settingsData = settingsRes.data as Record<string, unknown> | null;
  const dbCapital =
    (companyData?.capital as number) ||
    (companyData?.registered_capital as number) ||
    (settingsData?.capital as number) ||
    0;
  const isCapitalDefault = dbCapital <= 0;
  const capital = isCapitalDefault ? DEFAULT_CAPITAL : dbCapital;
  const retainedEarnings = totalAssets - totalLiabilities - capital;
  const totalEquity = capital + retainedEarnings;

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
  if (role === "employee" || role === "partner") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-[var(--text-muted)]">
        <div className="text-center">
          <p className="text-lg font-medium">접근 권한이 없습니다</p>
          <p className="text-sm mt-1">관리자에게 문의하세요</p>
        </div>
      </div>
    );
  }
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [data, setData] = useState<BsData | null>(null);
  const [prevData, setPrevData] = useState<BsData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [showPayableDrill, setShowPayableDrill] = useState(false);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

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

    /* Fetch current + previous month data in parallel */
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevCutoff = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    Promise.all([
      fetchBsData(companyId),
      fetchBsData(companyId, prevCutoff),
      fetchBsTrend(companyId, 6),
    ])
      .then(([current, prev, trendData]) => {
        setData(current);
        setPrevData(prev);
        setTrend(trendData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [companyId]);

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
          borderBottom: options?.isTotal ? "2px solid var(--text)" : "1px solid var(--border)",
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
    <div id="bs-printable" style={{ padding: "24px 28px", maxWidth: 1400 }}>
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
            재무상태표 (Balance Sheet)
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-dim)",
              margin: "4px 0 0",
            }}
          >
            기준일: {today}
          </p>
        </div>
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
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
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
          전월 비교
        </label>
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
            label: "총 자산",
            value: data.totalAssets,
            color: "var(--primary)",
          },
          {
            label: "총 부채",
            value: data.totalLiabilities,
            color: data.totalLiabilities > 0 ? "var(--danger)" : "var(--text-muted)",
          },
          {
            label: "순자산 (자본)",
            value: data.totalEquity,
            color: data.totalEquity >= 0 ? "#10b981" : "var(--danger)",
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

      {/* Balance Sheet — T자 레이아웃 (좌: 자산 / 우: 부채 + 자본) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── 좌: 자산 ── */}
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-card)", overflow: "auto" }}>
          <div style={{ padding: "14px 16px", borderBottom: "2px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>자산 (Assets)</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>금액 (원)</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
            <tbody>
              {renderSectionHeader("유동자산 (Current Assets)")}
              {renderSectionRow("현금 및 예금", data.cashAndDeposits, { indent: true, isBold: true, prevAmount: isCompareMode && prevData ? prevData.cashAndDeposits : undefined })}
              {data.bankAccountDetails.map((b) => renderSectionRow(b.name, b.balance, { isNested: true }))}
              {renderSectionRow("매출채권", data.accountsReceivable, { indent: true, isBold: true, prevAmount: isCompareMode && prevData ? prevData.accountsReceivable : undefined })}
              {data.receivableDetails.map((r) => renderSectionRow(r.name, r.amount, { isNested: true }))}
              {renderDivider("div-ca-left")}
              {renderSectionRow("유동자산 소계", data.currentAssets, { isTotal: true, prevAmount: isCompareMode && prevData ? prevData.currentAssets : undefined })}

              {renderSectionHeader("고정자산 (Fixed Assets)")}
              {data.fixedAssetDetails.length > 0 ? (
                data.fixedAssetDetails.map((a) => renderSectionRow(`${a.name} (${a.type})`, a.value, { isNested: true }))
              ) : (
                renderSectionRow("등록된 고정자산 없음", 0, { indent: true })
              )}
              {renderDivider("div-fa-left")}
              {renderSectionRow("고정자산 소계", data.fixedAssets, { isTotal: true, prevAmount: isCompareMode && prevData ? prevData.fixedAssets : undefined })}
            </tbody>
          </table>
        </div>

        {/* ── 우: 부채 + 자본 ── */}
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-card)", overflow: "auto" }}>
          <div style={{ padding: "14px 16px", borderBottom: "2px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>부채 + 자본 (Liabilities + Equity)</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>금액 (원)</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
            <tbody>
              {renderSectionHeader("부채 (Liabilities)")}
              {renderSectionRow("차입금", data.borrowings, { indent: true, isBold: true, prevAmount: isCompareMode && prevData ? prevData.borrowings : undefined })}
              {data.loanDetails.map((l) => renderSectionRow(l.name, l.remainingAmount, { isNested: true }))}
              <tr
                onClick={() => setShowPayableDrill(true)}
                style={{
                  borderBottom: "1px solid var(--border)",
                  cursor: 'pointer',
                }}
                className="hover:bg-[var(--bg-surface)] transition"
                title="클릭해서 거래처별·건별 세부 보기"
              >
                <td style={{ padding: "10px 16px", paddingLeft: 32, fontSize: 13, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  미지급금 <span className="text-[10px] text-[var(--primary)] ml-1">▶ 세부보기</span>
                </td>
                <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "right", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {formatKrw(data.accountsPayable)}
                </td>
                {isCompareMode && (() => {
                  const delta = prevData ? data.accountsPayable - prevData.accountsPayable : undefined;
                  return (
                    <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap",
                      color: delta === undefined || delta === 0 ? "var(--text-dim)" : delta > 0 ? "#ef4444" : "#10b981" }}>
                      {delta === undefined ? "-" : delta === 0 ? "-" : `${delta > 0 ? "+" : ""}${formatKrw(delta)} ${delta > 0 ? "▲" : "▼"}`}
                    </td>
                  );
                })()}
              </tr>
              {/* 거래처별 요약 (상위 5개) — 자세히는 클릭 모달 */}
              {data.payableByVendor.slice(0, 5).map((v) => renderSectionRow(`${v.vendor} (${v.invoiceCount}건)`, v.totalAmount, { isNested: true }))}
              {data.payableByVendor.length > 5 && (
                <tr>
                  <td colSpan={colCount} style={{ padding: "6px 16px", paddingLeft: 48, fontSize: 11, color: 'var(--primary)', cursor: 'pointer' }}
                    onClick={() => setShowPayableDrill(true)}
                  >
                    + {data.payableByVendor.length - 5}개 거래처 더 보기 →
                  </td>
                </tr>
              )}
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

      {/* 하단 sticky 합계 — 자산 vs 부채+자본 */}
      <div className="sticky bottom-0 z-20 mt-3 mb-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-[0_-4px_12px_-4px_rgba(15,23,42,0.08)]">
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

      {/* Asset vs Liability Composition Bar */}
      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>
          자산/부채 구성
        </h2>
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

      {/* Balance Check */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 8,
          background: Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity) < 1
            ? "var(--bg-surface)"
            : "var(--danger-dim)",
          border: "1px solid var(--border)",
          fontSize: 12,
          color: Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity) < 1
            ? "var(--text-dim)"
            : "var(--danger)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--text-muted)" }}>참고</strong>
        <br />
        - 자산 = 부채 + 자본 (재무상태표 등식){" "}
        {Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity) < 1 ? "-- 균형" : "-- 불균형 감지"}
        <br />
        - 현금 및 예금은 등록된 은행계좌 잔액과 현금 스냅샷의 합계입니다.
        <br />
        - 매출채권은 진행 중인 프로젝트/딜의 미수금액을 기반으로 산출됩니다.
        <br />
        - 고정자산은 자산관리(Vault)에 등록된 장비, 차량, 소프트웨어 등의 자산가치입니다.
        <br />
        - 차입금은 대출 관리에서 진행 중인 대출 잔액입니다.
        <br />
        - 미지급금은 미결제 상태의 매입 세금계산서를 기반으로 산출됩니다.
        <br />
        - 자본금은 {data.isCapitalDefault
          ? `DB에 등록된 값이 없어 기본값 ${DEFAULT_CAPITAL.toLocaleString("ko-KR")}원으로 표시됩니다. 설정에서 변경해주세요.`
          : `${data.capital.toLocaleString("ko-KR")}원 (DB 등록값)`}
        <br />
        - 이익잉여금 = 자산 합계 - 부채 합계 - 자본금 (잔여분 자동 계산)
      </div>

      {/* Monthly Trend Chart */}
      {trend.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>
            월별 추이 (최근 6개월)
          </h2>
          <div style={{ padding: "20px", borderRadius: 12, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
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

      {/* 미지급금 드릴다운 모달 */}
      {showPayableDrill && data && (
        <div
          onClick={() => setShowPayableDrill(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '85vh',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* 모달 헤더 */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>미지급금 세부</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  거래처별 → 클릭해서 건별 펼침 · 출처: 매입 세금계산서 (status: received/issued/modified)
                </div>
              </div>
              <button onClick={() => setShowPayableDrill(false)}
                style={{ background: 'transparent', border: 'none', fontSize: 18, color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
            </div>

            {/* 합산 요약 */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>총 미지급금</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>
                  ₩{formatKrw(data.accountsPayable)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{data.payableByVendor.length}개 거래처 · {data.payableDetails.length}건</div>
              </div>
              {isCompareMode && prevData && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>전월</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>₩{formatKrw(prevData.accountsPayable)}</div>
                  {(() => {
                    const delta = data.accountsPayable - prevData.accountsPayable;
                    return (
                      <div style={{ fontSize: 11, fontWeight: 600, color: delta === 0 ? 'var(--text-dim)' : delta > 0 ? '#ef4444' : '#10b981' }}>
                        {delta === 0 ? '-' : `${delta > 0 ? '+' : ''}${formatKrw(delta)} ${delta > 0 ? '▲' : '▼'}`}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* 거래처 리스트 */}
            <div style={{ overflow: 'auto', flex: 1 }}>
              {data.payableByVendor.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text-dim)' }}>
                  미지급금 거래처가 없습니다.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>거래처</th>
                      <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>건수</th>
                      <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>합계</th>
                      {isCompareMode && (
                        <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>전월 대비</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.payableByVendor.map((v) => {
                      const isExpanded = expandedVendor === v.vendor;
                      // 전월 비교: 전월 BsData 에서 같은 vendor 찾기
                      const prevVendor = isCompareMode && prevData
                        ? prevData.payableByVendor.find((pv) => pv.vendor === v.vendor)
                        : null;
                      const delta = prevVendor ? v.totalAmount - prevVendor.totalAmount : null;
                      return (
                        <>
                          <tr
                            key={v.vendor}
                            onClick={() => setExpandedVendor(isExpanded ? null : v.vendor)}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              cursor: 'pointer',
                              background: isExpanded ? 'var(--bg-surface)' : undefined,
                            }}
                          >
                            <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text)' }}>
                              <span style={{ display: 'inline-block', width: 12, color: 'var(--text-dim)' }}>{isExpanded ? '▾' : '▸'}</span>
                              {' '}{v.vendor}
                              {v.bizno && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{v.bizno}</span>}
                            </td>
                            <td style={{ padding: '10px 16px', fontSize: 12, textAlign: 'center', color: 'var(--text-muted)' }}>{v.invoiceCount}</td>
                            <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, textAlign: 'right', color: 'var(--text)' }}>
                              {formatKrw(v.totalAmount)}
                            </td>
                            {isCompareMode && (
                              <td style={{ padding: '10px 16px', fontSize: 12, textAlign: 'right',
                                color: delta == null || delta === 0 ? 'var(--text-dim)' : delta > 0 ? '#ef4444' : '#10b981'
                              }}>
                                {delta == null ? '-' : delta === 0 ? '-' : `${delta > 0 ? '+' : ''}${formatKrw(delta)} ${delta > 0 ? '▲' : '▼'}`}
                              </td>
                            )}
                          </tr>
                          {isExpanded && v.invoices.map((inv) => (
                            <tr key={inv.id} style={{ background: 'var(--bg-surface)/40', borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '6px 16px 6px 40px', fontSize: 11, color: 'var(--text-muted)' }}>
                                <span className="mono-number">{inv.issueDate}</span>
                                {inv.itemName && <span style={{ marginLeft: 8 }}>{inv.itemName}</span>}
                                {inv.ntsConfirmNo && <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--text-dim)' }}>{inv.ntsConfirmNo}</span>}
                              </td>
                              <td style={{ padding: '6px 16px', fontSize: 10, textAlign: 'center' }}>
                                <span style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)', color: 'var(--text-muted)' }}>{inv.status}</span>
                              </td>
                              <td style={{ padding: '6px 16px', fontSize: 11, fontWeight: 600, textAlign: 'right', color: 'var(--text)' }}>
                                {formatKrw(inv.amount)}
                              </td>
                              {isCompareMode && <td />}
                            </tr>
                          ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Financial Ratios */}
      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>
          재무 비율 분석
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {computeRatios(data).map((ratio) => (
            <div
              key={ratio.label}
              style={{
                padding: "20px",
                borderRadius: 12,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: HEALTH_COLORS[ratio.health],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>
                  {ratio.label}
                </span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: HEALTH_COLORS[ratio.health], marginBottom: 8 }}>
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
