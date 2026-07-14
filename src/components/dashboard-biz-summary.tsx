"use client";

// 대시보드 경영 요약(압축) — "지금 회사 괜찮나?"를 세 신호로: 이번 달 손익 · 통장 잔액 · 버티는 기간.
//   자산 상세보다 회사 건강을 우선 노출(2026-07-14). 카드 클릭 시 전체 경영 요약(/reports/summary)으로.

import Link from "next/link";

function won(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 100000000) return `${sign}${(a / 100000000).toFixed(1)}억`;
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString("ko")}만`;
  return `${sign}${a.toLocaleString("ko")}`;
}

function runwayText(m: number): string {
  if (!isFinite(m) || m >= 99) return "충분";
  if (m <= 0) return "즉시 위험";
  return `${m.toFixed(1)}개월`;
}
function runwayTone(m: number): string {
  if (!isFinite(m) || m >= 6) return "success";
  if (m >= 3) return "warning";
  return "danger";
}
const col = (t: string) => (t === "success" ? "var(--success)" : t === "warning" ? "var(--warning)" : t === "danger" ? "var(--danger)" : "var(--text)");

function Signal({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-[var(--text-dim)] mb-0.5 truncate">{label}</div>
      <div className="text-[15px] leading-tight font-extrabold mono-number truncate" style={{ color: col(tone) }}>{value}</div>
    </div>
  );
}

export function DashboardBizSummary({ profit, balance, runwayMonths }: { profit: number; balance: number; runwayMonths: number }) {
  return (
    <Link href="/reports/summary" className="dashboard-biz-summary glass-card px-4 py-3 flex flex-col no-underline hover:border-[var(--primary)] transition">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--primary)" }}>경영 요약</span>
        <span className="text-[11px] font-semibold text-[var(--primary)]">자세히 →</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Signal label="이번 달 손익" value={`${profit >= 0 ? "+" : ""}${won(profit)}`} tone={profit >= 0 ? "success" : "danger"} />
        <Signal label="통장 잔액" value={won(balance)} tone="primary" />
        <Signal label="버티는 기간" value={runwayText(runwayMonths)} tone={runwayTone(runwayMonths)} />
      </div>
    </Link>
  );
}
