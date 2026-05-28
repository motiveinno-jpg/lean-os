"use client";

// 대시보드 메인 — 2026-05-27 새 시안(다크 잔액 카드 + 메트릭4 + Expense Breakdown + Alerts + 리포트 CTA).
//   전부 표시 전용: 데이터는 대시보드 page 의 기존 쿼리(cashPulse·realBurn·realVariable·costBreakdown·
//   sixPack·growth) 를 props 로 받아 표시만. 계산/fetch 무변경. owner/admin 만(호출처 게이트).
//   포인트색=인디고 토큰 / 다크 잔액카드·Alerts 의미색(amber/green/blue)만 유지.

import { useState } from "react";
import { IconTile, TileIcon } from "@/components/ui/icon-tile";

const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const wonM = (n: number) => `₩${(n / 1_000_000).toFixed(1)}M`;

type Cat = { label: string; amount: number };
type Breakdown = { fixed: Cat[]; variable: Cat[] };

// Expense Breakdown 점 색 팔레트 (시안 카테고리 색 점)
const DOT = ["bg-[var(--brand)]", "bg-[var(--success)]", "bg-purple-500", "bg-orange-500", "bg-pink-500", "bg-[var(--text-dim)]"];

export function DashboardSiyanHero({
  balance,
  monthRevenue,
  monthTarget,
  fixedCost,
  variableCost,
  arTotal,
  arOver30,
  pendingApprovals,
  netCashflow,
  costBreakdown,
}: {
  balance: number | null;
  monthRevenue: number;
  monthTarget: number;
  fixedCost: number;
  variableCost: number;
  arTotal: number;
  arOver30: number;
  pendingApprovals: number;
  netCashflow: number;
  costBreakdown?: Breakdown;
}) {
  const [showBalance, setShowBalance] = useState(true);
  const bal = balance ?? 0;
  const income = monthRevenue;
  const expense = fixedCost + variableCost;
  const net = income - expense;
  const perfPct = monthTarget > 0 ? Math.round((monthRevenue / monthTarget) * 100) : null;

  // Expense Breakdown — 고정/변동 항목 병합 → 비중
  const cats: Cat[] = [...(costBreakdown?.fixed || []), ...(costBreakdown?.variable || [])]
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const catTotal = cats.reduce((s, c) => s + c.amount, 0);

  // 메트릭 4 (실데이터)
  const metrics: { tone: "danger" | "info" | "success" | "warning"; icon: string; label: string; value: string; sub: string }[] = [
    { tone: "danger", icon: "trendingDown", label: "월 운영비", value: won(expense), sub: `고정 ${wonM(fixedCost)} · 변동 ${wonM(variableCost)}` },
    { tone: "info", icon: "trendingUp", label: "이번달 매출", value: won(income), sub: perfPct != null ? `목표 대비 ${perfPct}%` : "매출 합계" },
    { tone: "success", icon: "card", label: "미수금", value: won(arTotal), sub: arOver30 > 0 ? `30일+ ${won(arOver30)}` : "정상 회수 중" },
    { tone: "warning", icon: "clock", label: "승인 대기", value: won(pendingApprovals), sub: pendingApprovals > 0 ? "결재함 확인" : "대기 없음" },
  ];

  // Alerts (실데이터 파생)
  const alerts: { type: "warning" | "success" | "info"; title: string; desc: string }[] = [];
  if (net >= 0) alerts.push({ type: "success", title: "이번달 흑자 흐름", desc: `수입 − 비용 순 ${won(net)} (흑자)` });
  else alerts.push({ type: "warning", title: "이번달 적자 주의", desc: `수입 − 비용 순 ${won(net)} (적자) · 비용 점검 권장` });
  if (arOver30 > 0) alerts.push({ type: "warning", title: "미수금 회수 필요", desc: `30일 이상 미수금 ${won(arOver30)} — 거래처 확인` });
  if (pendingApprovals > 0) alerts.push({ type: "info", title: "승인 대기 건", desc: `결재 대기 금액 ${won(pendingApprovals)} — 결재함에서 처리` });
  while (alerts.length < 3) alerts.push({ type: "info", title: "월 결산·리포트", desc: "리포트에서 손익·현금흐름 상세를 확인하세요" });
  const alertTop = alerts.slice(0, 3);

  const ALERT_STYLE = {
    warning: { box: "bg-amber-500/10 border-amber-500/30", icon: "text-amber-500", d: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" },
    success: { box: "bg-emerald-500/10 border-emerald-500/30", icon: "text-emerald-500", d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    info: { box: "bg-blue-500/10 border-blue-500/30", icon: "text-blue-500", d: "M12 8h.01M11 12h1v4h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  } as const;

  return (
    <div className="space-y-6 mb-6">
      {/* 메인 잔액 카드 (다크 그라데이션) */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white shadow-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700">
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full -mr-32 -mt-32 blur-3xl bg-[var(--brand)]/20" />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full -ml-24 -mb-24 blur-3xl bg-emerald-500/10" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <p className="text-sm font-medium text-white/70 mb-2">총 자금</p>
              <div className="flex items-center gap-3">
                <p className="text-4xl sm:text-5xl font-bold mono-number">{showBalance ? won(bal) : "••••••"}</p>
                <button type="button" onClick={() => setShowBalance((v) => !v)}
                  className="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 transition" aria-label="잔액 표시/숨김">
                  {showBalance ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 4.6A9.8 9.8 0 0112 4.5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
                  )}
                </button>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/60 mb-2">이번달 순흐름</p>
              <div className="flex items-center gap-2 justify-end">
                <svg className={`w-5 h-5 ${netCashflow >= 0 ? "text-emerald-400" : "text-red-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={netCashflow >= 0 ? "M5 11l7-7 7 7M12 4v16" : "M19 13l-7 7-7-7M12 20V4"} />
                </svg>
                <span className={`text-xl sm:text-2xl font-bold mono-number ${netCashflow >= 0 ? "text-emerald-400" : "text-red-400"}`}>{won(netCashflow)}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {[{ l: "수입", v: income, c: "text-emerald-300" }, { l: "비용", v: expense, c: "text-red-300" }, { l: "순이익", v: net, c: net >= 0 ? "text-white" : "text-red-300" }].map((x) => (
              <div key={x.l} className="rounded-xl p-3 sm:p-4 bg-white/10 backdrop-blur-sm border border-white/20">
                <p className="text-xs text-white/70 mb-1.5">{x.l}</p>
                <p className={`text-base sm:text-xl font-bold mono-number ${x.c}`}>{won(x.v)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 메트릭 4 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="glass-card p-6">
            <div className="flex items-start justify-between mb-4">
              <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide pt-1">{m.label}</p>
              <IconTile tone={m.tone} size={40}><TileIcon name={m.icon} className="w-5 h-5 text-white" /></IconTile>
            </div>
            <p className="text-2xl font-bold text-[var(--text)] mono-number mb-1.5">{m.value}</p>
            <p className="text-[11px] text-[var(--text-dim)] truncate">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Expense Breakdown */}
      {cats.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-base font-bold text-[var(--text)] mb-4">비용 구성</h3>
          <div className="space-y-2.5">
            {cats.map((c, i) => {
              const pct = catTotal > 0 ? Math.round((c.amount / catTotal) * 100) : 0;
              return (
                <div key={c.label} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-surface)]/60">
                  <span className={`w-3 h-3 rounded-full shrink-0 ${DOT[i % DOT.length]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{c.label}</p>
                    <p className="text-xs text-[var(--text-dim)] mono-number">{won(c.amount)}</p>
                  </div>
                  <p className="text-sm font-semibold text-[var(--text)] mono-number shrink-0">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {alertTop.map((a, i) => {
          const s = ALERT_STYLE[a.type];
          return (
            <div key={i} className={`rounded-xl border p-4 ${s.box}`}>
              <div className="flex gap-3">
                <svg className={`w-5 h-5 shrink-0 mt-0.5 ${s.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.d} /></svg>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)] mb-0.5">{a.title}</p>
                  <p className="text-xs text-[var(--text-muted)]">{a.desc}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
