"use client";

// 대시보드 메인 — 2026-06-09 Stitch 시안(modern_business_financial_dashboard) 정렬 + 다크/라이트 적응.
//   라운드6.5: 레퍼런스 골격 정렬 — 히어로+메트릭3 을 KPI 4카드 행(grid-cols-2 lg:grid-cols-4)으로 압축,
//   비용 구성 도넛은 DashboardCostDonut 으로 분리(본문 2/3 컬럼 배치용). 계산/fetch 무변경, 표시 전용.
//   표면(카드/배경/텍스트/보더)은 테마 토큰(var(--bg-card) 등)으로 → 다크모드 자동 적응.

import { useState } from "react";
import Link from "next/link";

const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const wonM = (n: number) => `₩${(n / 1_000_000).toFixed(1)}M`;

type Cat = { label: string; amount: number };
type Breakdown = { fixed: Cat[]; variable: Cat[] };

// 강조 팔레트 — 전부 CSS 토큰(라이트/다크 자동 대응). 포인트는 인디고(--primary).
const A = { blue: "var(--info)", green: "var(--success)", red: "var(--danger)", amber: "var(--warning)" };
const SEG = ["var(--primary)", "var(--info)", "var(--warning)", "var(--danger)", "var(--success)", "var(--text-dim)"];

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
}) {
  const [showBalance, setShowBalance] = useState(true);
  const bal = balance ?? 0;
  const expense = fixedCost + variableCost;
  const perfPct = monthTarget > 0 ? Math.round((monthRevenue / monthTarget) * 100) : null;
  void pendingApprovals; // 사진 템플릿엔 승인 카드 없음 — prop 시그니처는 보존

  // 메트릭 3 (사진: MRR / Sales Revenue / Accounts Receivable → 우리: 매출 / 운영비 / 미수금)
  const fixedPct = expense > 0 ? (fixedCost / expense) * 100 : 0;
  const arOverPct = arTotal > 0 ? (arOver30 / arTotal) * 100 : 0;
  const metrics: {
    label: string; value: string; sub: string;
    chip?: { text: string; up: boolean };
    segments: { pct: number; color: string }[];
  }[] = [
    {
      // 2026-06-11 매출 단일 기준: 세금계산서 공급가액 (손익계산서·하단 매출 카드와 동일 소스)
      label: "이번달 매출", value: won(monthRevenue),
      sub: perfPct != null ? `목표 ${wonM(monthTarget)} · 공급가액 기준` : "세금계산서 공급가액 기준",
      chip: perfPct != null ? { text: `${perfPct}%`, up: perfPct >= 100 } : undefined,
      segments: [{ pct: Math.min(perfPct ?? 0, 100), color: A.green }],
    },
    {
      label: "월 운영비", value: won(expense),
      sub: `고정 ${wonM(fixedCost)} · 변동 ${wonM(variableCost)}`,
      segments: [{ pct: fixedPct, color: A.red }, { pct: 100 - fixedPct, color: A.amber }],
    },
    {
      label: "미수금", value: won(arTotal),
      sub: arOver30 > 0 ? `30일+ ${wonM(arOver30)}` : "정상 회수 중",
      chip: arOver30 > 0 ? { text: "지연", up: false } : { text: "정상", up: true },
      segments: [{ pct: arOverPct, color: A.red }, { pct: 100 - arOverPct, color: A.blue }],
    },
  ];

  // ── KPI 4카드 행 (잔고 + 매출/운영비/미수금) ──
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 총 자금 (잔액 히어로 → KPI 카드) */}
      <div className="glass-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 자금</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setShowBalance((v) => !v)}
              className="p-1 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition shrink-0" aria-label="잔액 표시/숨김">
              {showBalance ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 4.6A9.8 9.8 0 0112 4.5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
              )}
            </button>
            <Link href="/bank" aria-label="통장 상세 보기"
              className="p-1 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </div>
        <p className="text-[22px] sm:text-[26px] leading-8 font-extrabold mono-number tracking-tight text-[var(--text)] truncate" title={showBalance ? won(bal) : undefined}>
          {showBalance ? won(bal) : "••••••"}
        </p>
        <div className={`kpi-callout ${netCashflow >= 0 ? "success" : "danger"} inline-flex items-center gap-1.5 w-auto self-start max-w-full`}>
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d={netCashflow >= 0 ? "M5 11l7-7 7 7M12 4v16" : "M19 13l-7 7-7-7M12 20V4"} />
          </svg>
          <b className="mono-number truncate">{won(netCashflow)}</b>
          <span className="shrink-0">이번달 순흐름</span>
        </div>
      </div>

      {/* 메트릭 3 (KPI 카드 패턴 · delta-chip · 미니바) */}
      {metrics.map((m) => (
        <div key={m.label} className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{m.label}</span>
            {m.chip && (
              <span className={`delta-chip ${m.chip.up ? "delta-up" : "delta-down"}`}>
                {m.chip.up ? "▲" : "▼"} {m.chip.text}
              </span>
            )}
          </div>
          {/* QA 2026-06-12: 9자리+ 금액이 좁은 화면에서 넘치던 것 → 반응형 폰트 + truncate */}
          <p className="text-[22px] sm:text-[26px] leading-8 font-extrabold mono-number tracking-tight text-[var(--text)] truncate" title={m.value}>{m.value}</p>
          <div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--bg-surface)]">
              {m.segments.map((s, i) => (
                <div key={i} style={{ width: `${Math.max(0, Math.min(s.pct, 100))}%`, backgroundColor: s.color }} className="h-full" />
              ))}
            </div>
            <p className="text-[11px] mt-2 truncate text-[var(--text-dim)]">{m.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Cost Composition (도넛 + 범례 %) — 본문 2/3 컬럼 배치용 분리 카드 ──
export function DashboardCostDonut({ costBreakdown }: { costBreakdown?: Breakdown }) {
  // 고정/변동 병합 → 비중
  const cats: Cat[] = [...(costBreakdown?.fixed || []), ...(costBreakdown?.variable || [])]
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const catTotal = cats.reduce((s, c) => s + c.amount, 0);

  if (cats.length === 0) return null;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-[var(--text)]">비용 구성</h3>
        <Link href="/reports/pnl" className="text-[13px] font-semibold text-[var(--primary)]">상세 보기</Link>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-9">
        <div className="relative shrink-0" style={{ width: 176, height: 176 }}>
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--bg-surface)" strokeWidth="3.4" />
            {(() => {
              let cum = 0;
              return cats.map((c, i) => {
                const pct = catTotal > 0 ? (c.amount / catTotal) * 100 : 0;
                const seg = (
                  <circle key={c.label} cx="18" cy="18" r="15.9155" fill="none"
                    stroke={SEG[i % SEG.length]} strokeWidth="3.4"
                    strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-cum} strokeLinecap="butt" />
                );
                cum += pct;
                return seg;
              });
            })()}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-semibold text-[var(--text-dim)]">총 비용</span>
            <span className="text-[15px] font-bold mono-number text-[var(--text)]">{wonM(catTotal)}</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-3">
          {cats.map((c, i) => {
            const pct = catTotal > 0 ? Math.round((c.amount / catTotal) * 100) : 0;
            return (
              <div key={c.label} className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SEG[i % SEG.length] }} />
                <span className="flex-1 text-[14px] font-medium truncate text-[var(--text)]">{c.label}</span>
                <span className="text-[12px] mono-number shrink-0 text-[var(--text-dim)]">{won(c.amount)}</span>
                <span className="text-[14px] font-bold mono-number w-10 text-right shrink-0 text-[var(--text)]">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
