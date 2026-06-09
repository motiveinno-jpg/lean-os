"use client";

// 대시보드 메인 — 2026-06-09 Stitch 시안(modern_business_financial_dashboard) 정렬.
//   다크 잔액 히어로(총자금+순흐름 배지+상세보기) · 메트릭4(델타칩+미니바) · Cost Composition 도넛 · Alerts.
//   전부 표시 전용: 데이터는 대시보드 page 의 기존 쿼리(cashPulse·realBurn·realVariable·costBreakdown·
//   sixPack·growth) 를 props 로 받아 표시만. 계산/fetch 무변경. owner/admin 만(호출처 게이트).
//   포인트색=인디고 토큰 / 다크 히어로·의미색(amber/emerald/red/indigo)만 유지. 새 의존성 없음(인라인 SVG).

import { useState } from "react";
import Link from "next/link";

const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const wonM = (n: number) => `₩${(n / 1_000_000).toFixed(1)}M`;

type Cat = { label: string; amount: number };
type Breakdown = { fixed: Cat[]; variable: Cat[] };

// Cost Composition 세그먼트 색 (시안 도넛 팔레트 — 인디고·에메랄드·바이올렛·오렌지·핑크·그레이)
const SEG = ["var(--brand)", "var(--success)", "#8b5cf6", "#f97316", "#ec4899", "var(--text-dim)"];

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

  // Cost Composition — 고정/변동 항목 병합 → 비중
  const cats: Cat[] = [...(costBreakdown?.fixed || []), ...(costBreakdown?.variable || [])]
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const catTotal = cats.reduce((s, c) => s + c.amount, 0);

  // 메트릭 4 (실데이터) — 델타칩 + 미니바(실 비율). segments: 단색/이중색 막대.
  const fixedPct = expense > 0 ? (fixedCost / expense) * 100 : 0;
  const arOverPct = arTotal > 0 ? (arOver30 / arTotal) * 100 : 0;
  const metrics: {
    tone: "danger" | "info" | "success" | "warning";
    label: string;
    value: string;
    sub: string;
    chip?: { text: string; up: boolean };
    segments: { pct: number; color: string }[];
  }[] = [
    {
      tone: "info", label: "이번달 매출", value: won(income),
      sub: perfPct != null ? `목표 ${wonM(monthTarget)}` : "매출 합계",
      chip: perfPct != null ? { text: `${perfPct}%`, up: perfPct >= 100 } : undefined,
      segments: [{ pct: Math.min(perfPct ?? 0, 100), color: "var(--info)" }],
    },
    {
      tone: "danger", label: "월 운영비", value: won(expense),
      sub: `고정 ${wonM(fixedCost)} · 변동 ${wonM(variableCost)}`,
      segments: [
        { pct: fixedPct, color: "var(--danger)" },
        { pct: 100 - fixedPct, color: "var(--warning)" },
      ],
    },
    {
      tone: "success", label: "미수금", value: won(arTotal),
      sub: arOver30 > 0 ? `30일+ ${wonM(arOver30)}` : "정상 회수 중",
      chip: arOver30 > 0 ? { text: "지연", up: false } : undefined,
      segments: [{ pct: arOverPct, color: "var(--danger)" }],
    },
    {
      tone: "warning", label: "승인 대기", value: won(pendingApprovals),
      sub: pendingApprovals > 0 ? "결재함 확인 필요" : "대기 없음",
      segments: [{ pct: pendingApprovals > 0 ? 100 : 0, color: "var(--warning)" }],
    },
  ];

  // Alerts (실데이터 파생) — 시안엔 없지만 실가치 알림이라 단정하게 유지
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
      {/* ── 메인 잔액 히어로 (다크) — 시안: 총자금 + 순흐름 배지 + 상세보기 ── */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white shadow-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700">
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full -mr-32 -mt-32 blur-3xl bg-[var(--brand)]/25" />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full -ml-24 -mb-24 blur-3xl bg-emerald-500/10" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/60 mb-2">총 자금</p>
              <div className="flex items-center gap-3 mb-3">
                <p className="text-4xl sm:text-5xl font-bold mono-number tracking-tight">{showBalance ? won(bal) : "••••••"}</p>
                <button type="button" onClick={() => setShowBalance((v) => !v)}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition shrink-0" aria-label="잔액 표시/숨김">
                  {showBalance ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 4.6A9.8 9.8 0 0112 4.5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
                  )}
                </button>
              </div>
              <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${netCashflow >= 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={netCashflow >= 0 ? "M5 11l7-7 7 7M12 4v16" : "M19 13l-7 7-7-7M12 20V4"} />
                </svg>
                <span className="mono-number">{won(netCashflow)}</span>
                <span className="text-white/50 font-medium">이번달 순흐름</span>
              </div>
            </div>
            <Link href="/bank"
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-sm font-semibold transition">
              상세 보기
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
          {/* 수입 · 비용 · 순이익 */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-6">
            {[{ l: "수입", v: income, c: "text-emerald-300" }, { l: "비용", v: expense, c: "text-red-300" }, { l: "순이익", v: net, c: net >= 0 ? "text-white" : "text-red-300" }].map((x) => (
              <div key={x.l} className="rounded-xl p-3 sm:p-4 bg-white/10 backdrop-blur-sm border border-white/15">
                <p className="text-xs text-white/60 mb-1.5">{x.l}</p>
                <p className={`text-base sm:text-xl font-bold mono-number ${x.c}`}>{won(x.v)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 메트릭 4 (시안: 라벨+델타칩 / 큰 숫자 / 미니바) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{m.label}</p>
              {m.chip && (
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${m.chip.up ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-[var(--danger)]/12 text-[var(--danger)]"}`}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={m.chip.up ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} /></svg>
                  {m.chip.text}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-[var(--text)] mono-number mb-1">{m.value}</p>
            <p className="text-[11px] text-[var(--text-dim)] truncate mb-3">{m.sub}</p>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--bg-surface)]">
              {m.segments.map((s, i) => (
                <div key={i} style={{ width: `${Math.max(0, Math.min(s.pct, 100))}%`, backgroundColor: s.color }} className="h-full" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Cost Composition (시안: 도넛 + 범례) ── */}
      {cats.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-[var(--text)]">비용 구성</h3>
            <Link href="/reports/pnl" className="text-[13px] font-semibold text-[var(--brand)] hover:text-[var(--brand-to)]">상세 보기</Link>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
            {/* 도넛 */}
            <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--bg-surface)" strokeWidth="3.6" />
                {(() => {
                  let cum = 0;
                  return cats.map((c, i) => {
                    const pct = catTotal > 0 ? (c.amount / catTotal) * 100 : 0;
                    const seg = (
                      <circle key={c.label} cx="18" cy="18" r="15.9155" fill="none"
                        stroke={SEG[i % SEG.length]} strokeWidth="3.6"
                        strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-cum}
                        strokeLinecap="butt" />
                    );
                    cum += pct;
                    return seg;
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                <span className="text-[10px] text-[var(--text-dim)] font-semibold">총 비용</span>
                <span className="text-sm font-bold text-[var(--text)] mono-number">{wonM(catTotal)}</span>
              </div>
            </div>
            {/* 범례 */}
            <div className="flex-1 w-full space-y-2.5">
              {cats.map((c, i) => {
                const pct = catTotal > 0 ? Math.round((c.amount / catTotal) * 100) : 0;
                return (
                  <div key={c.label} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SEG[i % SEG.length] }} />
                    <span className="flex-1 text-sm font-medium text-[var(--text)] truncate">{c.label}</span>
                    <span className="text-xs text-[var(--text-dim)] mono-number shrink-0">{won(c.amount)}</span>
                    <span className="text-sm font-bold text-[var(--text)] mono-number w-10 text-right shrink-0">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Alerts ── */}
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
