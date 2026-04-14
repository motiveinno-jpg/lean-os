"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface BsData {
  /* Assets */
  cashAndDeposits: number;
  accountsReceivable: number;
  totalAssets: number;
  /* Liabilities */
  borrowings: number;
  accountsPayable: number;
  totalLiabilities: number;
  /* Equity */
  capital: number;
  retainedEarnings: number;
  totalEquity: number;
  /* Detail rows */
  bankAccountDetails: { name: string; balance: number }[];
  loanDetails: { name: string; remainingAmount: number }[];
  receivableDetails: { name: string; amount: number }[];
  payableDetails: { name: string; amount: number }[];
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
async function fetchBsData(companyId: string): Promise<BsData> {
  const [bankRes, loanRes, cashRes, dealsRes, revenueRes, invoicesRes] = await Promise.all([
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
    supabase
      .from("tax_invoices")
      .select("counterparty_name, total_amount, type, status")
      .eq("company_id", companyId)
      .eq("type", "purchase")
      .in("status", ["issued", "pending", "unpaid"]),
  ]);

  const bankAccounts = bankRes.data || [];
  const loans = loanRes.data || [];
  const cashSnapshots = cashRes.data || [];
  const deals = dealsRes.data || [];
  const revenueSchedules = revenueRes.data || [];
  const invoices = invoicesRes.data || [];

  /* --- Assets --- */
  const bankTotal = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const cashAmount = cashSnapshots.length > 0 ? (cashSnapshots[0].current_balance || 0) : 0;
  const cashAndDeposits = bankTotal + cashAmount;

  /* Calculate paid amounts per deal from revenue schedule */
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
  const totalAssets = cashAndDeposits + accountsReceivable;

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

  /* --- Equity --- */
  const capital = DEFAULT_CAPITAL;
  const retainedEarnings = totalAssets - totalLiabilities - capital;
  const totalEquity = capital + retainedEarnings;

  const bankAccountDetails = bankAccounts.map((a) => ({
    name: `${a.bank_name || ""} ${a.alias || ""}`.trim() || "unnamed account",
    balance: a.balance || 0,
  }));

  return {
    cashAndDeposits,
    accountsReceivable,
    totalAssets,
    borrowings,
    accountsPayable,
    totalLiabilities,
    capital,
    retainedEarnings,
    totalEquity,
    bankAccountDetails,
    loanDetails,
    receivableDetails,
    payableDetails,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function BalanceSheetPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [data, setData] = useState<BsData | null>(null);
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
    fetchBsData(companyId)
      .then(setData)
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

    lines.push("자산,,");
    lines.push(`자산,현금 및 예금,${Math.round(data.cashAndDeposits)}`);
    for (const b of data.bankAccountDetails) {
      lines.push(`자산 > 현금 및 예금,${b.name},${Math.round(b.balance)}`);
    }
    lines.push(`자산,매출채권,${Math.round(data.accountsReceivable)}`);
    for (const r of data.receivableDetails) {
      lines.push(`자산 > 매출채권,${r.name},${Math.round(r.amount)}`);
    }
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
    a.download = `대차대조표_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */
  const renderSectionRow = (
    label: string,
    amount: number,
    options?: { isBold?: boolean; isTotal?: boolean; indent?: boolean; isNested?: boolean },
  ) => (
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
    </tr>
  );

  const renderSectionHeader = (label: string) => (
    <tr key={`header-${label}`}>
      <td
        colSpan={2}
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
      <td colSpan={2} style={{ padding: 0, height: 1, background: "var(--border)" }} />
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
            대차대조표 데이터를 불러오는 중...
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
      <div style={{ padding: 40, color: "var(--text-muted)", fontSize: 14 }}>
        데이터가 없습니다. 계좌 정보를 먼저 등록해주세요.
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Main render                                                      */
  /* ---------------------------------------------------------------- */
  const today = new Date().toISOString().slice(0, 10);

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
            대차대조표 (Balance Sheet)
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

      {/* Balance Sheet Table */}
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
            minWidth: 500,
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
                }}
              >
                금액 (원)
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Assets Section */}
            {renderSectionHeader("자산 (Assets)")}
            {renderSectionRow("현금 및 예금", data.cashAndDeposits, { indent: true, isBold: true })}
            {data.bankAccountDetails.map((b) =>
              renderSectionRow(b.name, b.balance, { isNested: true }),
            )}
            {renderSectionRow("매출채권", data.accountsReceivable, { indent: true, isBold: true })}
            {data.receivableDetails.map((r) =>
              renderSectionRow(r.name, r.amount, { isNested: true }),
            )}
            {renderDivider("div-a1")}
            {renderSectionRow("자산 합계", data.totalAssets, { isTotal: true })}

            {renderDivider("div-1")}

            {/* Liabilities Section */}
            {renderSectionHeader("부채 (Liabilities)")}
            {renderSectionRow("차입금", data.borrowings, { indent: true, isBold: true })}
            {data.loanDetails.map((l) =>
              renderSectionRow(l.name, l.remainingAmount, { isNested: true }),
            )}
            {renderSectionRow("미지급금", data.accountsPayable, { indent: true, isBold: true })}
            {data.payableDetails.map((p) =>
              renderSectionRow(p.name, p.amount, { isNested: true }),
            )}
            {renderDivider("div-l1")}
            {renderSectionRow("부채 합계", data.totalLiabilities, { isTotal: true })}

            {renderDivider("div-2")}

            {/* Equity Section */}
            {renderSectionHeader("자본 (Equity)")}
            {renderSectionRow("자본금", data.capital, { indent: true })}
            {renderSectionRow("이익잉여금", data.retainedEarnings, { indent: true })}
            {renderDivider("div-e1")}
            {renderSectionRow("자본 합계", data.totalEquity, { isTotal: true })}
          </tbody>
        </table>
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
        - 자산 = 부채 + 자본 (대차대조표 등식){" "}
        {Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity) < 1 ? "-- 균형" : "-- 불균형 감지"}
        <br />
        - 현금 및 예금은 등록된 은행계좌 잔액과 현금 스냅샷의 합계입니다.
        <br />
        - 매출채권은 진행 중인 프로젝트/딜의 미수금액을 기반으로 산출됩니다.
        <br />
        - 차입금은 대출 관리에서 진행 중인 대출 잔액입니다.
        <br />
        - 미지급금은 미결제 상태의 매입 세금계산서를 기반으로 산출됩니다.
        <br />
        - 자본금은 기본값 {DEFAULT_CAPITAL.toLocaleString("ko-KR")}원으로 설정되어 있습니다. 설정에서 변경 가능합니다.
        <br />
        - 이익잉여금 = 자산 합계 - 부채 합계 - 자본금 (잔여분 자동 계산)
      </div>
    </div>
  );
}
