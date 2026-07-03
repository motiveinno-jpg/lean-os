"use client";

// 경영흐름 콕핏 — 미래 현금 예측 헤더 (P1).
//   대시보드와 동일 엔진(getCashPulseData + buildCashPulse) 재사용 — 숫자 불일치 0.
//   현재 잔액 · 런웨이 · 펄스 점수 · 미래 잔액 추이(AreaTrend) · 자금부족 경고.

import { useQuery } from "@tanstack/react-query";
import { getCashPulseData } from "@/lib/queries";
import { buildCashPulse, getPulseLevel, type CashPulseResult } from "@/lib/cash-pulse";
import { calcRunwayMonths, getRunwayLevel } from "@/lib/engines";
import { AreaTrend, type TrendPoint } from "./AreaTrend";

const won = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}`;

const RUNWAY_TONE: Record<string, { color: string; label: string }> = {
  CRITICAL: { color: "#ef4444", label: "위급" },
  DANGER: { color: "#ef4444", label: "위험" },
  WARNING: { color: "#f59e0b", label: "주의" },
  STABLE: { color: "var(--text)", label: "안정" },
  SAFE: { color: "#10b981", label: "여유" },
};

function StatPill({ label, value, unit, sub, color }: { label: string; value: string; unit?: string; sub?: string; color: string }) {
  return (
    <div
      className="px-4 py-2.5 rounded-2xl min-w-[92px]"
      style={{
        background: `color-mix(in srgb, ${color} 9%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mono-number font-extrabold leading-none mt-1" style={{ fontSize: 20, color }}>
        {value}
        {unit && <span className="text-[11px] font-semibold ml-0.5">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] font-semibold mt-1" style={{ color }}>{sub}</div>}
    </div>
  );
}

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
  const pulseColor = pulseLevel === "critical" || pulseLevel === "danger" ? "#ef4444" : pulseLevel === "warning" ? "#f59e0b" : "#10b981";

  // 자금부족 시점 — 잔액이 음수가 되는 첫 예측 포인트
  const shortfall = pulse.forecastPoints.find((p) => p.balance < 0);

  const forecastPts: TrendPoint[] = pulse.forecastPoints.map((p) => ({
    label: p.label,
    value: p.balance,
    tone: p.balance < 0 ? "danger" : "normal",
  }));

  return (
    <div className="glass-card p-5 sm:p-6 space-y-5">
      {/* 상단: 현재 잔액 + 런웨이 / 펄스 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">현재 현금 잔액</div>
          <div className="mono-number font-extrabold text-[var(--text)] leading-none" style={{ fontSize: 34 }}>₩{won(pulse.currentBalance)}</div>
          <div className="text-xs text-[var(--text-dim)] mt-2">
            월 소진(burn) <span className="mono-number font-semibold text-[var(--text-muted)]">₩{won(pulse.monthlyBurn)}</span>
          </div>
        </div>
        <div className="flex items-stretch gap-2.5">
          <StatPill label="런웨이" value={runway >= 999 ? "∞" : String(runway)} unit={runway >= 999 ? undefined : "개월"} sub={runwayTone.label} color={runwayTone.color} />
          <StatPill label="펄스 점수" value={String(pulse.pulseScore)} unit="/100" color={pulseColor} />
        </div>
      </div>

      {/* 자금부족 경고 */}
      {shortfall && (
        <div className="kpi-callout danger">
          ⚠ {shortfall.label} 시점 현금 부족 예상 (<b>₩{won(shortfall.balance)}</b>) — 입금 일정·지출 조정이 필요합니다
        </div>
      )}

      {/* 미래 잔액 추이 (예측) */}
      <div className="rounded-2xl border border-[var(--border)] p-4" style={{ background: "color-mix(in srgb, var(--primary) 4%, transparent)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">미래 잔액 추이 (예측)</div>
          <div className="text-[10px] text-[var(--text-dim)]">오늘 → D+90</div>
        </div>
        <AreaTrend points={forecastPts} height={124} showValues markerIndex={0} />
      </div>

      <div className="text-xs text-[var(--text-muted)] leading-relaxed border-t border-[var(--border)] pt-3">{pulse.briefing}</div>
    </div>
  );
}
