"use client";

// 대시보드 경영 요약 — "지금 회사 괜찮나?"를 한 카드로: 손익·통장잔액·런웨이 + 매출·비용까지 펼쳐서(2026-07-14).
//   너무 심플하던 3신호에서 이번 달 매출·비용 breakdown 추가. 카드 클릭 시 전체 경영 요약(/reports/summary).

import Link from "next/link";
import { Ico } from "@/components/ui-icon";
import { useQuery } from "@tanstack/react-query";
import { fetchBizSummary } from "@/lib/biz-summary";
import { todayKst } from "@/lib/kst";

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

export function DashboardBizSummary({ monthRevenue, expense, balance, runwayMonths, basis, companyId, userId }: { monthRevenue: number; expense: number; balance: number; runwayMonths: number; basis?: string; companyId?: string | null; userId?: string | null }) {
  //   2026-08-19 경영 요약 재편 파급 — 세 신호(돈·손익·받을 돈·낼 돈)를 경영 요약과 같은 함수(lib/biz-summary)로.
  //   쿼리 키가 경영 요약 화면과 같아 캐시를 나눠 쓴다. 아직 안 왔으면 예전 props 로 그린다(빈 카드 금지).
  const month = todayKst().slice(0, 7);
  const { data: s } = useQuery({
    queryKey: ["biz-summary", companyId, month],
    queryFn: () => fetchBizSummary(companyId!, month, userId || undefined),
    enabled: !!companyId, staleTime: 60_000,
  });
  const profit = s ? s.pnl.cur.operating : monthRevenue - expense;
  const bal = s ? s.cash.balance : balance;
  const runway = s ? s.cash.runway : runwayMonths;
  const TONE: Record<string, string> = { g: "success", y: "warning", r: "danger" };
  const todoN = s?.todos.length ?? 0;
  return (
    <Link href="/reports/summary" className="dashboard-biz-summary glass-card">
      <div className="dashboard-biz-summary-header">
        <span className="text-[13px] font-bold text-[var(--text)]">경영 요약{s && <span className={`ml-2 text-[11px] font-bold`} style={{ color: col(TONE[s.overall.tone]) }}>{s.overall.label}</span>}</span>
        <span className="widget-more-link">자세히 →</span>
      </div>
      {/* 세 신호 + 세부 — 브리핑 스트립과 같은 서피스 밴드 하나로(3+3 줄바꿈) */}
      <div className="widget-statband widget-statband-3">
        <Signal label={s ? "이번 달 영업이익 · 확정 전표" : basis ? `이번 달 손익 · ${basis}` : "이번 달 손익"} value={`${profit >= 0 ? "+" : ""}${won(profit)}`} tone={s ? TONE[s.pnl.tone] : profit >= 0 ? "success" : "danger"} />
        <Signal label="통장 잔액" value={won(bal)} tone={s ? TONE[s.cash.tone] : "primary"} />
        <Signal label="운영 가능" value={runwayText(runway)} tone={runwayTone(runway)} />
        {s ? <>
          <Signal label="받을 돈 (원장)" value={won(s.arap.ar)} tone="success" />
          <Signal label="낼 돈 (30일)" value={won(s.arap.due30)} tone={TONE[s.arap.tone]} />
          <Signal label="이번 주 챙길 것" value={todoN ? `${todoN}건` : "없음"} tone={todoN ? "warning" : "success"} />
        </> : <>
          <Signal label="이번 달 매출" value={won(monthRevenue)} tone="success" />
          <Signal label="이번 달 비용" value={won(expense)} tone="warning" />
        </>}
      </div>
      <div className="dashboard-biz-summary-cta">
        <span className="text-[11px] font-semibold text-[var(--primary)]"><Ico e="📊" /> 세 신호 · 챙길 것 · 달라진 것 →</span>
      </div>
    </Link>
  );
}
