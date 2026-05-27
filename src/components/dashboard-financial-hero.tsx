"use client";

// 대시보드 메인 재무 요약 — 2026-05-27 새 디자인 시안 적용(1차).
//   총자금(그라데이션 숫자) + 고정비/변동비/기타 3열(총액·비중 pill). 글래스 카드.
//   데이터는 owner 대시보드 기존 값 재사용(잔고/월고정비/이번달변동비). 항목 세부·카드/자산/매출은 2차.
//   직원 금액 가림은 호출처에서 제어(owner/admin 만 렌더).

import { Card } from "@/components/ui/card";
import { FinancialNumber } from "@/components/ui/financial-number";
import { Badge } from "@/components/ui/badge";

const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

export function DashboardFinancialHero({
  balance,
  fixedCost,
  variableCost,
}: {
  balance: number | null;
  fixedCost: number | null;
  variableCost: number | null;
}) {
  const fixed = fixedCost ?? 0;
  const variable = variableCost ?? 0;
  const totalCost = fixed + variable;
  const fixedPct = totalCost > 0 ? Math.round((fixed / totalCost) * 100) : 0;
  const variablePct = totalCost > 0 ? 100 - fixedPct : 0;

  return (
    <Card className="p-6 sm:p-8 mb-6 bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-surface)]">
      {/* 총 자금 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[14px] text-[var(--text-muted)] mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--success)] rounded-full animate-pulse" />
            총 자금
          </div>
          <FinancialNumber size="large">{fmtW(balance ?? 0)}</FinancialNumber>
        </div>
        <div className="bg-gradient-to-br from-[var(--brand)]/10 to-[var(--brand-to)]/10 p-4 rounded-xl">
          <svg className="w-8 h-8 text-[var(--brand)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>

      {/* 3열: 고정비 / 변동비 / 기타 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* 고정비 */}
        <div className="rounded-[16px] p-5 border border-[var(--danger)]/20 bg-[var(--danger)]/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--danger)]/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--danger)] to-[#B91C1C] flex items-center justify-center shadow-lg shadow-[var(--danger)]/30">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              </div>
              <span className="text-[15px] font-semibold text-[var(--text)]">고정비</span>
            </div>
            <Badge tone="danger">{fixedPct}%</Badge>
          </div>
          <FinancialNumber size="medium" tone="danger">-{fmtW(fixed)}</FinancialNumber>
          <div className="text-[11px] text-[var(--text-dim)] mt-2">급여·정기지출·임대료 등 월 고정비</div>
        </div>

        {/* 변동비 */}
        <div className="rounded-[16px] p-5 border border-[var(--brand-info)]/20 bg-[var(--brand-info)]/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--brand-info)]/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-info)] to-[#2563EB] flex items-center justify-center shadow-lg shadow-[var(--brand-info)]/30">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <span className="text-[15px] font-semibold text-[var(--text)]">변동비</span>
            </div>
            <Badge tone="info">{variablePct}%</Badge>
          </div>
          <FinancialNumber size="medium" tone="info">-{fmtW(variable)}</FinancialNumber>
          <div className="text-[11px] text-[var(--text-dim)] mt-2">이번 달 카드 사용액 등</div>
        </div>

        {/* 기타 */}
        <div className="rounded-[16px] p-5 border border-[var(--border)] bg-[var(--bg-surface)]/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6B7280] to-[#4B5563] flex items-center justify-center shadow-lg shadow-black/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
              </div>
              <span className="text-[15px] font-semibold text-[var(--text)]">기타</span>
            </div>
            <Badge tone="muted">0%</Badge>
          </div>
          <FinancialNumber size="medium" tone="muted">₩0</FinancialNumber>
          <div className="text-[11px] text-[var(--text-dim)] mt-2">미분류 항목</div>
        </div>
      </div>
    </Card>
  );
}
