"use client";

// 대시보드 경영 요약 — "지금 회사 괜찮나?"를 한 카드로: 손익·통장잔액·런웨이 + 매출·비용까지 펼쳐서(2026-07-14).
//   너무 심플하던 3신호에서 이번 달 매출·비용 breakdown 추가. 카드 클릭 시 전체 경영 요약(/reports/summary).

import Link from "next/link";
import { Ico } from "@/components/ui-icon";

function won(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 100000000) return `${sign}${(a / 100000000).toFixed(1)}억`;
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString("ko")}만`;
  return `${sign}${a.toLocaleString("ko")}`;
}
function runwayText(m: number): string {
  if (!isFinite(m) || m >= 99) return "충분";
  if (m <= 0) return "위험";
  return `${m.toFixed(1)}개월`;
}
function runwayTone(m: number): string {
  if (!isFinite(m) || m >= 6) return "success";
  if (m >= 3) return "warning";
  return "danger";
}
const col = (t: string) => (t === "success" ? "var(--success)" : t === "warning" ? "var(--warning)" : t === "danger" ? "var(--danger)" : t === "primary" ? "var(--primary)" : "var(--text)");

// 브리핑 숫자 스트립과 동일 문법(위젯 통일, 2026-08-10 사장님 확정)
function Signal({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="widget-stat">
      <div className="widget-stat-label">{label}</div>
      <div className="widget-stat-value mono-number" style={{ color: col(tone) }}>{value}</div>
    </div>
  );
}

export function DashboardBizSummary({ monthRevenue, expense, balance, runwayMonths, basis }: { monthRevenue: number; expense: number; balance: number; runwayMonths: number; basis?: string }) {
  const profit = monthRevenue - expense;
  return (
    <Link href="/reports/summary" className="dashboard-biz-summary glass-card">
      <div className="dashboard-biz-summary-header">
        <span className="text-[13px] font-bold text-[var(--text)]">경영 요약</span>
        <span className="widget-more-link">자세히 →</span>
      </div>
      {/* 건강 신호 5 — 브리핑 스트립과 같은 서피스 밴드 하나로(3+2 줄바꿈) */}
      <div className="widget-statband widget-statband-3">
        <Signal label={basis ? `이번 달 손익 · ${basis}` : "이번 달 손익"} value={`${profit >= 0 ? "+" : ""}${won(profit)}`} tone={profit >= 0 ? "success" : "danger"} />
        <Signal label="통장 잔액" value={won(balance)} tone="primary" />
        <Signal label="버티는 기간" value={runwayText(runwayMonths)} tone={runwayTone(runwayMonths)} />
        <Signal label="이번 달 매출" value={won(monthRevenue)} tone="success" />
        <Signal label="이번 달 비용" value={won(expense)} tone="warning" />
      </div>
      {/* 상세 분석·추이 보기 — 기존 대시보드 하단 단독 링크를 경영 요약 위젯 안으로 통합(2026-07-15).
          위젯 하단 남는 여백의 세로 중앙에 배치(flex-1) — 위 매출·비용과 겹쳐 보이지 않게 간격 확보. */}
      <div className="dashboard-biz-summary-cta">
        <span className="text-[11px] font-semibold text-[var(--primary)]"><Ico e="📊" /> 상세 분석·추이 보기 →</span>
      </div>
    </Link>
  );
}
