"use client";

// 경영흐름 콕핏 — 미래 현금 예측 헤더 (P1).
//   대시보드와 동일 엔진(getCashPulseData + buildCashPulse) 재사용 — 숫자 불일치 0.
//   현재 잔액 · 런웨이 · D+30/90 예상 · 5포인트 잔액추이 · 자금부족 경고.

import { useQuery } from "@tanstack/react-query";
import { getCashPulseData } from "@/lib/queries";
import { buildCashPulse, getPulseLevel, type CashPulseResult } from "@/lib/cash-pulse";
import { calcRunwayMonths, getRunwayLevel } from "@/lib/engines";

const won = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}`;
const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
};

const RUNWAY_TONE: Record<string, { text: string; bg: string; label: string }> = {
  CRITICAL: { text: "text-red-500", bg: "bg-red-500/10", label: "위급" },
  DANGER: { text: "text-red-500", bg: "bg-red-500/10", label: "위험" },
  WARNING: { text: "text-amber-500", bg: "bg-amber-500/10", label: "주의" },
  STABLE: { text: "text-[var(--text)]", bg: "bg-[var(--bg-surface)]", label: "안정" },
  SAFE: { text: "text-green-500", bg: "bg-green-500/10", label: "여유" },
};

export function CashPulseHeader({ companyId, userId }: { companyId: string; userId?: string }) {
  const { data: pulse, isLoading } = useQuery({
    queryKey: ["flow-cash-pulse", companyId, userId],
    queryFn: async (): Promise<CashPulseResult | null> => {
      const raw = await getCashPulseData(companyId, userId);
      return raw ? buildCashPulse(raw) : null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="glass-card p-6 text-sm text-[var(--text-muted)]">현금 예측 불러오는 중…</div>;
  if (!pulse) return <div className="glass-card p-6 text-sm text-[var(--text-muted)]">현금 예측 데이터가 없습니다. 통장·정기결제를 연결하면 표시됩니다.</div>;

  const runway = calcRunwayMonths(pulse.currentBalance, 0, 0, pulse.monthlyBurn);
  const runwayTone = RUNWAY_TONE[getRunwayLevel(runway)] || RUNWAY_TONE.STABLE;
  const pulseLevel = getPulseLevel(pulse.pulseScore);

  // 자금부족 시점 — 잔액이 음수가 되는 첫 예측 포인트
  const shortfall = pulse.forecastPoints.find((p) => p.balance < 0);
  // 막대 정규화
  const maxAbs = Math.max(1, ...pulse.forecastPoints.map((p) => Math.abs(p.balance)));

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">현재 현금 잔액</div>
          <div className="text-3xl font-extrabold mono-number text-[var(--text)]">₩{won(pulse.currentBalance)}</div>
          <div className="text-xs text-[var(--text-dim)] mt-1">월 소진(burn) ₩{won(pulse.monthlyBurn)}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-3 py-2 rounded-xl ${runwayTone.bg}`}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">런웨이</div>
            <div className={`text-xl font-extrabold mono-number ${runwayTone.text}`}>{runway >= 999 ? "∞" : `${runway}개월`} <span className="text-[11px] font-semibold">{runwayTone.label}</span></div>
          </div>
          <div className="px-3 py-2 rounded-xl bg-[var(--bg-surface)]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">펄스 점수</div>
            <div className={`text-xl font-extrabold mono-number ${pulseLevel === "critical" || pulseLevel === "danger" ? "text-red-500" : pulseLevel === "warning" ? "text-amber-500" : "text-green-500"}`}>{pulse.pulseScore}<span className="text-[11px]">/100</span></div>
          </div>
        </div>
      </div>

      {/* 자금부족 경고 */}
      {shortfall && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-xs font-semibold">
          ⚠ {shortfall.label} 시점 현금 부족 예상 (₩{won(shortfall.balance)}) — 입금 일정·지출 조정이 필요합니다
        </div>
      )}

      {/* 5포인트 잔액 추이 */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">미래 잔액 추이 (예측)</div>
        <div className="flex items-end gap-2" style={{ height: 96 }}>
          {pulse.forecastPoints.map((p) => {
            const h = Math.max(4, Math.round((Math.abs(p.balance) / maxAbs) * 80));
            const neg = p.balance < 0;
            return (
              <div key={p.label} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${p.label}: ₩${won(p.balance)}`}>
                <span className={`text-[10px] mono-number ${neg ? "text-red-500" : "text-[var(--text-muted)]"}`}>{fmtShort(p.balance)}</span>
                <div className={`w-full rounded-t ${neg ? "bg-red-500/70" : "bg-[var(--primary)]/70"}`} style={{ height: h }} />
                <span className="text-[10px] text-[var(--text-dim)]">{p.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-3">{pulse.briefing}</div>
    </div>
  );
}
