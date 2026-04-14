"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { getVATPreview } from "@/lib/tax-invoice";
import Link from "next/link";

import type { VATPreview } from "@/lib/tax-invoice";

// ── 포맷 헬퍼 ──

function formatKrwCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0원";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function quarterLabel(q: string): string {
  return q.replace("-Q", "년 ") + "분기";
}

function changeIndicator(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "-";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (pct > 0) return `+${pct.toFixed(1)}%`;
  if (pct < 0) return `${pct.toFixed(1)}%`;
  return "0%";
}

// ── 막대차트 ──

function BarChart({ data }: { data: VATPreview[] }) {
  const maxVal = Math.max(...data.map((d) => Math.max(d.salesTax, d.purchaseTax + d.cardDeduction, Math.abs(d.netVAT))), 1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 16 }}>
      {data.map((q) => {
        const salesPct = (q.salesTax / maxVal) * 100;
        const purchasePct = ((q.purchaseTax + q.cardDeduction) / maxVal) * 100;
        const netPct = (Math.abs(q.netVAT) / maxVal) * 100;
        const isRefund = q.netVAT < 0;
        return (
          <div key={q.quarter} style={{ textAlign: "center" }}>
            <div style={{ height: 160, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
              <div style={{ width: 24, height: `${salesPct}%`, background: "var(--primary, #3b82f6)", borderRadius: "4px 4px 0 0", minHeight: 4 }} title={`매출세액: ${formatKrwCompact(q.salesTax)}`} />
              <div style={{ width: 24, height: `${purchasePct}%`, background: "var(--success, #22c55e)", borderRadius: "4px 4px 0 0", minHeight: 4 }} title={`매입+카드: ${formatKrwCompact(q.purchaseTax + q.cardDeduction)}`} />
              <div style={{ width: 24, height: `${netPct}%`, background: isRefund ? "var(--warning, #eab308)" : "var(--danger, #ef4444)", borderRadius: "4px 4px 0 0", minHeight: 4 }} title={`납부예상: ${formatKrwCompact(q.netVAT)}`} />
            </div>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>{q.quarter.replace("-", "년 ")}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── 메인 페이지 ──

export default function VATReportPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const companyId = user?.company_id;

  const { data: vatData, isLoading, error } = useQuery({
    queryKey: ["vatPreview", companyId, year],
    queryFn: () => getVATPreview(companyId!, year),
    enabled: !!companyId,
  });

  const quarters = vatData ?? [];
  const annualSalesTax = quarters.reduce((s, q) => s + q.salesTax, 0);
  const annualPurchaseTax = quarters.reduce((s, q) => s + q.purchaseTax, 0);
  const annualCardDeduction = quarters.reduce((s, q) => s + q.cardDeduction, 0);
  const annualNetVAT = quarters.reduce((s, q) => s + q.netVAT, 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/tax-invoices" style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 14 }}>
            ← 세금계산서
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>부가세 예측 리포트</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setYear((y) => y - 1)} style={yearBtnStyle}>◀</button>
          <span style={{ fontSize: 16, fontWeight: 600, minWidth: 60, textAlign: "center" }}>{year}년</span>
          <button onClick={() => setYear((y) => y + 1)} style={yearBtnStyle} disabled={year >= currentYear + 1}>▶</button>
        </div>
      </div>

      {isLoading && <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40 }}>데이터 로딩 중...</p>}
      {error && <p style={{ color: "var(--danger)", textAlign: "center", padding: 40 }}>데이터를 불러올 수 없습니다.</p>}

      {!isLoading && !error && quarters.length > 0 && (
        <>
          {/* 범례 */}
          <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12, color: "var(--text-secondary)" }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--primary, #3b82f6)", borderRadius: 2, marginRight: 4 }} />매출세액</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--success, #22c55e)", borderRadius: 2, marginRight: 4 }} />매입+카드공제</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--danger, #ef4444)", borderRadius: 2, marginRight: 4 }} />납부예상</span>
          </div>

          {/* 차트 */}
          <div style={cardStyle}>
            <BarChart data={quarters} />
          </div>

          {/* 분기별 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginTop: 20 }}>
            {quarters.map((q, i) => {
              const days = daysUntil(q.dueDate);
              const isUrgent = days >= 0 && days <= 30;
              const isPast = days < 0;
              const prev = i > 0 ? quarters[i - 1] : null;
              const change = prev ? changeIndicator(q.netVAT, prev.netVAT) : null;

              return (
                <div key={q.quarter} style={{ ...cardStyle, borderLeft: isUrgent ? "3px solid var(--danger, #ef4444)" : isPast ? "3px solid var(--text-secondary)" : "3px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{quarterLabel(q.quarter)}</h3>
                    {isUrgent && <span style={urgentBadgeStyle}>D-{days}</span>}
                    {isPast && <span style={{ ...urgentBadgeStyle, background: "var(--text-secondary)", color: "#fff" }}>마감</span>}
                  </div>
                  <Row label="매출세액" value={q.salesTax} />
                  <Row label="매입세액" value={q.purchaseTax} isNegative />
                  <Row label="카드공제" value={q.cardDeduction} isNegative />
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>납부예상액</span>
                    <span style={{ fontWeight: 700, color: q.netVAT > 0 ? "var(--danger, #ef4444)" : "var(--success, #22c55e)" }}>
                      {formatKrwCompact(q.netVAT)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                    <span>납부기한: {q.dueDate}</span>
                    {change && (
                      <span style={{ color: change.startsWith("+") ? "var(--danger, #ef4444)" : "var(--success, #22c55e)" }}>
                        전분기 대비 {change}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 연간 합계 */}
          <div style={{ ...cardStyle, marginTop: 20, background: "var(--card-bg-accent, var(--card-bg))" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{year}년 연간 합계</h3>
            <Row label="매출세액 합계" value={annualSalesTax} />
            <Row label="매입세액 합계" value={annualPurchaseTax} isNegative />
            <Row label="카드공제 합계" value={annualCardDeduction} isNegative />
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>연간 납부예상 총액</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: annualNetVAT > 0 ? "var(--danger, #ef4444)" : "var(--success, #22c55e)" }}>
                {formatKrwCompact(annualNetVAT)}
              </span>
            </div>
          </div>
        </>
      )}

      {!isLoading && !error && quarters.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>
          <p style={{ fontSize: 15 }}>{year}년 세금계산서 데이터가 없습니다.</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>세금계산서를 등록하면 부가세 예측이 표시됩니다.</p>
        </div>
      )}
    </div>
  );
}

// ── 공통 컴포넌트 ──

function Row({ label, value, isNegative }: { label: string; value: number; isNegative?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span>{isNegative && value > 0 ? "-" : ""}{formatKrwCompact(value)}</span>
    </div>
  );
}

// ── 스타일 ──

const cardStyle: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
};

const yearBtnStyle: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
  color: "inherit",
  fontSize: 14,
};

const urgentBadgeStyle: React.CSSProperties = {
  background: "var(--danger, #ef4444)",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 10,
};
