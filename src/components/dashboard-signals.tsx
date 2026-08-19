"use client";

// 대시보드 층 1 · 신호 6칸 — "회사가 지금 안전한가" (2026-08-19 대시보드 재편, docs/20260819_PLAN_dashboard_redesign.md)
//   통장 잔액 · 30일 뒤 잔액 · 이번 달 손익 · 받을 돈 · 낼 돈(30일) · 세금 — 경영 요약과 **같은 함수(lib/biz-summary)** 가 낸 값.
//   예전엔 브리핑 카드 안 숫자 스트립 + 경영 요약 위젯 + 자산 위젯 세 곳에 같은 숫자가 있었다 → 여기 하나.
//   숫자는 전부 검정, 상태는 이름 옆 작은 칩(좋음/보통/주의/위험)으로만 — 큰 숫자를 빨강·초록으로 칠하지 않는다(사장님: 촌스럽지 않게).
//   칸을 누르면 그 화면으로 간다.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchBizSummary, type Tone } from "@/lib/biz-summary";
import { todayKst } from "@/lib/kst";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";

export function wonShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 100000000) return `${sign}${(a / 100000000).toFixed(1)}억`;
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString("ko")}만`;
  return `${sign}${Math.round(a).toLocaleString("ko")}`;
}
const TONE_LABEL: Record<Tone | "n", string> = { g: "좋음", y: "주의", r: "위험", n: "보통" };
const runwayText = (m: number) => (!isFinite(m) || m >= 99 ? "충분" : m <= 0 ? "바닥" : `${m >= 12 ? Math.floor(m) : m.toFixed(1)}개월`);

function Cell({ href, label, value, sub, tone = "n", title }: { href: string; label: string; value: string; sub?: string; tone?: Tone | "n"; title?: string }) {
  return (
    <Link href={href} className="dash-sig" title={title}>
      <span className="dash-sig-label">{label}<span className={`dash-sig-tone dash-sig-tone-${tone}`}>{TONE_LABEL[tone]}</span></span>
      <span className="dash-sig-value mono-number">{value}</span>
      {sub && <span className="dash-sig-sub">{sub}</span>}
    </Link>
  );
}

export function DashboardSignals({ companyId, userId, forecast30, balanceFallback }: { companyId: string; userId?: string | null; forecast30?: number | null; balanceFallback?: number }) {
  const month = todayKst().slice(0, 7);
  //   쿼리 키가 경영 요약 화면·옛 위젯과 같아 캐시를 나눠 쓴다
  const { data: s } = useQuery({
    queryKey: ["biz-summary", companyId, month],
    queryFn: () => fetchBizSummary(companyId, month, userId || undefined),
    enabled: !!companyId, staleTime: 60_000,
  });
  const nextTax = getUpcomingTaxDeadlines(60)[0] ?? null;
  const balance = s ? s.cash.balance : (balanceFallback ?? 0);
  const f30 = forecast30 ?? null;
  const d30 = f30 == null ? null : f30 - balance;
  const runway = s?.cash.runway ?? 0;
  //   30일 뒤 톤 — 음수면 위험, 10% 넘게 줄면 주의, 아니면 좋음. 전망값이 없으면 보통
  const f30Tone: Tone | "n" = f30 == null ? "n" : f30 < 0 ? "r" : (d30 ?? 0) < -balance * 0.1 ? "y" : "g";
  //   받을 돈 톤 — 30일 넘은 미수가 없으면 좋음, 있으면 주의, 전체의 30% 넘으면 위험
  const arTone: Tone | "n" = !s ? "n" : s.arap.over30 <= 0 ? "g" : s.arap.over30 > s.arap.ar * 0.3 ? "r" : "y";
  const taxTone: Tone | "n" = !nextTax ? "g" : nextTax.daysLeft <= 7 ? "r" : nextTax.daysLeft <= 14 ? "y" : "g";
  const pnl = s?.pnl.cur;
  return (
    <div className="dash-signals">
      <Cell href="/bank" label="통장 잔액" value={wonShort(balance)} tone={s ? s.cash.tone : "n"}
        sub={s ? `이번 달 +${wonShort(s.cash.inflow)} · −${wonShort(s.cash.outflow)}` : undefined} title="통장 잔액 합계 · 누르면 통장으로" />
      <Cell href="/reports/outlook" label="30일 뒤 잔액" value={f30 == null ? "—" : wonShort(f30)} tone={f30Tone}
        sub={f30 == null ? "전망 자료 없음" : `${d30! >= 0 ? "▲ " : "▼ "}${wonShort(Math.abs(d30!))} · ${runwayText(runway)} 운영 가능`} title="예정된 입출금으로 본 30일 뒤 잔액 · 누르면 자금 전망으로" />
      <Cell href="/reports/profit" label="이번 달 손익" value={pnl ? `${pnl.operating >= 0 ? "+" : ""}${wonShort(pnl.operating)}` : "—"} tone={s ? s.pnl.tone : "n"}
        sub={pnl ? `매출 ${wonShort(pnl.revenue)} − 비용 ${wonShort(pnl.cogs + pnl.opex)} · 확정 전표` : undefined} title="확정 전표 기준 영업이익 · 누르면 손익 현황으로" />
      <Cell href="/partners/ledger?type=sales" label="받을 돈" value={s ? wonShort(s.arap.ar) : "—"} tone={arTone}
        sub={s ? (s.arap.over30 > 0 ? `30일+ ${wonShort(s.arap.over30)} · ${s.arap.over30Partners}곳` : "30일 넘은 미수 없음") : undefined} title="거래처 원장 미수금 합계 · 누르면 거래처 원장으로" />
      <Cell href="/payments" label="낼 돈 (30일)" value={s ? wonShort(s.arap.due30) : "—"} tone={s ? s.arap.tone : "n"}
        sub={s ? `정기 지출·급여·대출 · 미지급 별도 ${wonShort(s.arap.ap)}` : undefined} title="30일 안에 날짜가 있는 예정 지출 · 누르면 정기 지출로" />
      <Cell href={nextTax?.href || "/reports/vat"} label="세금" value={nextTax ? (nextTax.daysLeft === 0 ? "오늘" : `D-${nextTax.daysLeft}`) : "없음"} tone={taxTone}
        sub={nextTax ? `${nextTax.title} · ${nextTax.date ?? ""}`.replace(/ · $/, "") : "60일 안에 낼 세금 없음"} title="다가오는 세금 마감 · 누르면 그 신고 화면으로" />
    </div>
  );
}
