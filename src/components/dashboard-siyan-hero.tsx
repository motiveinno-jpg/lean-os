"use client";

// 대시보드 메인 — 2026-06-09 Stitch 시안(modern_business_financial_dashboard) 정렬 + 다크/라이트 적응.
//   라운드6.5: 히어로+메트릭3 을 KPI 4카드 행으로 압축.
//   라운드7.1 (대시보드 재설계):
//     - KPI 4카드 형식 통일 — [라벨행: 라벨+칩] / [값 26px] / [보조 한 줄] 동일 골격. 미니 진행바 제거,
//       위험 값(미수금 지연)만 색으로 구분. 미수금 카드엔 회수 관리 진입 링크(문제를 보여주면 동선을 붙인다).
//     - 비용 구성 도넛 → 가로 막대(Top 6). 급여 편중(80%+) 구조에선 막대가 항상 더 잘 읽힌다.
//   표면은 전부 테마 토큰 → 다크모드 자동 적응. 계산/fetch 무변경, 표시 전용.

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const wonM = (n: number) => `₩${(n / 1_000_000).toFixed(1)}M`;

type Cat = { label: string; amount: number };
type Breakdown = { fixed: Cat[]; variable: Cat[] };

// 막대 팔레트 — 전부 CSS 토큰(라이트/다크 자동 대응). 1위는 브랜드 인디고.
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
  void pendingApprovals; // 결재는 액션 인박스가 담당 — prop 시그니처는 보존

  const fixedPct = expense > 0 ? Math.round((fixedCost / expense) * 100) : 0;
  // 금액 길이에 따라 폰트 크기 조절 — 큰 금액(억 단위)이 모바일 2열 카드에서 잘리거나 삐져나오지 않게.
  //   truncate(…) 대신 길이 기반 축소로 전체 금액이 항상 보이도록.
  const valueBase = "leading-tight font-extrabold mono-number tracking-tight whitespace-nowrap";
  const fitSize = (s: string) =>
    s.length >= 15 ? "text-[13px] sm:text-[20px]"
    : s.length >= 13 ? "text-[15px] sm:text-[22px]"
    : s.length >= 11 ? "text-[18px] sm:text-[24px]"
    : "text-[22px] sm:text-[26px]";
  const valueCls = (s: string) => `${valueBase} ${fitSize(s)}`;

  // ── KPI 4카드 — 공통 골격: [라벨 + 우측 칩/버튼] / [값] / [보조 한 줄] ──
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 총 자금 */}
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
        <p className={`${valueCls(showBalance ? won(bal) : "••••••")} text-[var(--text)]`} title={showBalance ? won(bal) : undefined}>
          {showBalance ? won(bal) : "••••••"}
        </p>
        <p className="text-[11px] truncate">
          <span className={`delta-chip ${netCashflow >= 0 ? "delta-up" : "delta-down"}`}>
            {netCashflow >= 0 ? "▲" : "▼"} <span className="mono-number">{won(Math.abs(netCashflow))}</span>
          </span>
          <span className="ml-1.5 text-[var(--text-dim)]">이번달 순흐름</span>
        </p>
      </div>

      {/* 이번달 매출 */}
      <div className="glass-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">이번달 매출</span>
          {perfPct != null && (
            <span className={`delta-chip ${perfPct >= 100 ? "delta-up" : "delta-flat"}`}>목표 {perfPct}%</span>
          )}
        </div>
        <p className={`${valueCls(won(monthRevenue))} text-[var(--text)]`} title={won(monthRevenue)}>{won(monthRevenue)}</p>
        <p className="text-[11px] truncate text-[var(--text-dim)]">
          {perfPct != null ? `목표 ${wonM(monthTarget)} · ` : ""}세금계산서 공급가액 기준
        </p>
      </div>

      {/* 월 운영비 */}
      <div className="glass-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">월 운영비</span>
          <span className="delta-chip delta-flat">고정 {fixedPct}%</span>
        </div>
        <p className={`${valueCls(won(expense))} text-[var(--text)]`} title={won(expense)}>{won(expense)}</p>
        <p className="text-[11px] truncate text-[var(--text-dim)]">고정 {wonM(fixedCost)} · 변동 {wonM(variableCost)}</p>
      </div>

      {/* 미수금 — 위험 값만 색으로 구분 + 회수 관리 진입 링크 */}
      <div className="glass-card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">미수금</span>
          <span className={`delta-chip ${arOver30 > 0 ? "delta-down" : "delta-up"}`}>{arOver30 > 0 ? "▼ 지연" : "▲ 정상"}</span>
        </div>
        <p className={`${valueCls(won(arTotal))} ${arOver30 > 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`} title={won(arTotal)}>{won(arTotal)}</p>
        <p className="text-[11px] truncate">
          <Link href="/tax-invoices" className={`font-semibold hover:underline ${arOver30 > 0 ? "text-[var(--danger)]" : "text-[var(--primary)]"}`}>
            {arOver30 > 0 ? `30일+ ${wonM(arOver30)} · 회수 관리 →` : "정상 회수 중 · 현황 보기 →"}
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── 비용 구성 — 가로 막대 Top 6 (라운드7.1: 도넛 → 막대) ──
export function DashboardCostBars({ costBreakdown }: { costBreakdown?: Breakdown }) {
  // 고정/변동 병합 → 비중
  const cats: Cat[] = [...(costBreakdown?.fixed || []), ...(costBreakdown?.variable || [])]
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const catTotal = cats.reduce((s, c) => s + c.amount, 0);
  const maxAmount = cats.length > 0 ? cats[0].amount : 0;

  // 라운드7: 데이터 0건이어도 null 대신 EmptyState 카드 렌더 — 2/3 컬럼 높이 불균형 해소
  if (cats.length === 0) {
    return (
      <EmptyState
        card
        title="이번 달 비용 데이터가 없습니다"
        desc="거래내역이 등록·분류되면 비용 구성이 여기에 표시됩니다."
        action={<Link href="/transactions" className="btn-secondary">거래내역 보기</Link>}
      />
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-[var(--text)]">비용 구성</h3>
        <Link href="/reports/pnl" className="text-[13px] font-semibold text-[var(--primary)]">상세 보기</Link>
      </div>
      <p className="text-[11px] text-[var(--text-dim)] mb-4">이번 달 총 비용 <b className="text-[var(--text)] mono-number">{won(catTotal)}</b></p>
      <div className="space-y-3">
        {cats.map((c, i) => {
          const pct = catTotal > 0 ? Math.round((c.amount / catTotal) * 100) : 0;
          const barPct = maxAmount > 0 ? (c.amount / maxAmount) * 100 : 0; // 막대 길이는 최대 항목 대비 — 편중 구조에서도 차이가 읽힘
          return (
            <div key={c.label} className="flex items-center gap-3">
              <span className="w-20 text-[13px] font-medium truncate text-[var(--text)] shrink-0">{c.label}</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(barPct, 1.5)}%`, backgroundColor: SEG[i % SEG.length] }} />
              </div>
              <span className="text-[12px] mono-number shrink-0 text-[var(--text-dim)] w-24 text-right">{won(c.amount)}</span>
              <span className="text-[13px] font-bold mono-number w-10 text-right shrink-0 text-[var(--text)]">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 하위호환 — 기존 import 명(도넛) 유지. 실체는 가로 막대.
export { DashboardCostBars as DashboardCostDonut };
