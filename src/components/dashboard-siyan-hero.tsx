"use client";

// 대시보드 메인 — 2026-06-09 Stitch 시안(modern_business_financial_dashboard) 픽셀 정렬.
//   사진 팔레트를 그대로 하드코딩(라이트 고정): 네이비 히어로 #121E32→#27344A, 블루 #2F7DE1, 그린 #31AF71,
//   레드 #E04D4B, 카드 흰색/보더 #E7EAEF, 텍스트 #121E32/#68788D. 인디고 토큰 미사용(사진과 동일색 우선).
//   템플릿 구조: 잔액 히어로 + 메트릭3 + Cost Composition 도넛. (사진에 없는 3박스/Alerts/승인은 제외)
//   전부 표시 전용 — page 의 기존 props 만 표시. 계산/fetch 무변경. owner/admin 만(호출처 게이트). 인라인 SVG.

import { useState } from "react";
import Link from "next/link";

const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const wonM = (n: number) => `₩${(n / 1_000_000).toFixed(1)}M`;

type Cat = { label: string; amount: number };
type Breakdown = { fixed: Cat[]; variable: Cat[] };

// 사진 추출 팔레트 (픽셀 샘플링 결과)
const C = {
  navyFrom: "#121E32", navyVia: "#1B2A44", navyTo: "#27344A",
  blue: "#2F7DE1", green: "#31AF71", red: "#E04D4B", teal: "#5E8C92", amber: "#E0A33A",
  card: "#FFFFFF", surface: "#F4F6F9", border: "#E7EAEF",
  text: "#121E32", muted: "#68788D", dim: "#9AA1AC",
};
const SEG = [C.blue, C.green, C.amber, C.red, C.teal, "#9AA1AC"];

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
  const expense = fixedCost + variableCost;
  const perfPct = monthTarget > 0 ? Math.round((monthRevenue / monthTarget) * 100) : null;
  void pendingApprovals; // 사진 템플릿엔 승인 카드 없음 — prop 시그니처는 보존

  // Cost Composition — 고정/변동 병합 → 비중
  const cats: Cat[] = [...(costBreakdown?.fixed || []), ...(costBreakdown?.variable || [])]
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const catTotal = cats.reduce((s, c) => s + c.amount, 0);

  // 메트릭 3 (사진: MRR / Sales Revenue / Accounts Receivable → 우리: 매출 / 운영비 / 미수금)
  const fixedPct = expense > 0 ? (fixedCost / expense) * 100 : 0;
  const arOverPct = arTotal > 0 ? (arOver30 / arTotal) * 100 : 0;
  const metrics: {
    label: string; value: string; sub: string;
    chip?: { text: string; up: boolean };
    segments: { pct: number; color: string }[];
  }[] = [
    {
      label: "이번달 매출", value: won(monthRevenue),
      sub: perfPct != null ? `목표 ${wonM(monthTarget)}` : "매출 합계",
      chip: perfPct != null ? { text: `${perfPct}%`, up: perfPct >= 100 } : undefined,
      segments: [{ pct: Math.min(perfPct ?? 0, 100), color: C.green }],
    },
    {
      label: "월 운영비", value: won(expense),
      sub: `고정 ${wonM(fixedCost)} · 변동 ${wonM(variableCost)}`,
      segments: [{ pct: fixedPct, color: C.red }, { pct: 100 - fixedPct, color: C.amber }],
    },
    {
      label: "미수금", value: won(arTotal),
      sub: arOver30 > 0 ? `30일+ ${wonM(arOver30)}` : "정상 회수 중",
      chip: arOver30 > 0 ? { text: "지연", up: false } : { text: "정상", up: true },
      segments: [{ pct: arOverPct, color: C.red }, { pct: 100 - arOverPct, color: C.blue }],
    },
  ];

  return (
    <div className="space-y-5 mb-6">
      {/* ── 잔액 히어로 (사진: 네이비 그라데이션 + 그린 증감 pill + View Details) ── */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 sm:p-7 text-white shadow-lg"
        style={{ background: `linear-gradient(135deg, ${C.navyFrom} 0%, ${C.navyVia} 55%, ${C.navyTo} 100%)` }}
      >
        <div className="absolute top-0 right-0 w-56 h-56 rounded-full -mr-24 -mt-24 blur-3xl" style={{ background: "rgba(47,125,225,0.20)" }} />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-white/55 mb-2">총 자금</p>
            <div className="flex items-center gap-2.5 mb-3">
              <p className="text-3xl sm:text-4xl font-bold mono-number tracking-tight">{showBalance ? won(bal) : "••••••"}</p>
              <button type="button" onClick={() => setShowBalance((v) => !v)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition shrink-0" aria-label="잔액 표시/숨김">
                {showBalance ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 4.6A9.8 9.8 0 0112 4.5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
                )}
              </button>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[13px] font-semibold"
              style={{ background: netCashflow >= 0 ? "rgba(49,175,113,0.18)" : "rgba(224,77,75,0.18)", color: netCashflow >= 0 ? "#4FD89B" : "#FF8A88" }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d={netCashflow >= 0 ? "M5 11l7-7 7 7M12 4v16" : "M19 13l-7 7-7-7M12 20V4"} />
              </svg>
              <span className="mono-number">{won(netCashflow)}</span>
              <span className="opacity-70 font-medium">이번달 순흐름</span>
            </div>
          </div>
          <Link href="/bank"
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition"
            style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)" }}>
            상세 보기
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </Link>
        </div>
      </div>

      {/* ── 메트릭 3 (사진: 흰 카드 / 라벨 / 큰 숫자 / 그린 델타칩 / 미니바) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(18,30,50,0.04)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] font-medium" style={{ color: C.muted }}>{m.label}</p>
              {m.chip && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-bold"
                  style={{ background: m.chip.up ? "rgba(49,175,113,0.12)" : "rgba(224,77,75,0.12)", color: m.chip.up ? C.green : C.red }}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={m.chip.up ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} /></svg>
                  {m.chip.text}
                </span>
              )}
            </div>
            <p className="text-[26px] font-bold mono-number mb-3 tracking-tight" style={{ color: C.text }}>{m.value}</p>
            <div className="flex h-1.5 rounded-full overflow-hidden" style={{ background: C.surface }}>
              {m.segments.map((s, i) => (
                <div key={i} style={{ width: `${Math.max(0, Math.min(s.pct, 100))}%`, backgroundColor: s.color }} className="h-full" />
              ))}
            </div>
            <p className="text-[11px] mt-2 truncate" style={{ color: C.dim }}>{m.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Cost Composition (사진: 도넛 + 범례 %) ── */}
      {cats.length > 0 && (
        <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(18,30,50,0.04)" }}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-[17px] font-bold" style={{ color: C.text }}>비용 구성</h3>
            <Link href="/reports/pnl" className="text-[13px] font-semibold" style={{ color: C.blue }}>상세 보기</Link>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-9">
            <div className="relative shrink-0" style={{ width: 176, height: 176 }}>
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke={C.surface} strokeWidth="3.4" />
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
                <span className="text-[10px] font-semibold" style={{ color: C.dim }}>총 비용</span>
                <span className="text-[15px] font-bold mono-number" style={{ color: C.text }}>{wonM(catTotal)}</span>
              </div>
            </div>
            <div className="flex-1 w-full space-y-3">
              {cats.map((c, i) => {
                const pct = catTotal > 0 ? Math.round((c.amount / catTotal) * 100) : 0;
                return (
                  <div key={c.label} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SEG[i % SEG.length] }} />
                    <span className="flex-1 text-[14px] font-medium truncate" style={{ color: C.text }}>{c.label}</span>
                    <span className="text-[12px] mono-number shrink-0" style={{ color: C.dim }}>{won(c.amount)}</span>
                    <span className="text-[14px] font-bold mono-number w-10 text-right shrink-0" style={{ color: C.text }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
