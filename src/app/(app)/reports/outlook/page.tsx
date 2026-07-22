"use client";

// 미래 대비 — "이대로 가면?"에 답하는 대표용 화면(2026-07-08).
//   현금 예측(오늘~D+90 통장 잔액) + 자금부족 예상 시점 경고 + 버티는 기간 + 간단 시나리오.
//   소스: buildCashPulse(getCashPulseData) — 읽기 전용. 상세 현금흐름은 경영 흐름으로 연결.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser, getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";
import { calcRunwayMonths, getRunwayLevel } from "@/lib/engines";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";
import { fmt } from "../_components/kit";
import { IntroCard, Section } from "@/components/report-kit";

const TONE: Record<string, string> = { success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)" };
function runwayTone(months: number): string {
  const lv = getRunwayLevel(months);
  return lv === "CRITICAL" || lv === "DANGER" ? "danger" : lv === "WARNING" ? "warning" : "success";
}

export default function OutlookPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => { getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } }); }, []);

  const { data: pulse } = useQuery({
    queryKey: ["outlook-pulse", companyId, userId],
    queryFn: async () => { const raw = await getCashPulseData(companyId!, userId || undefined); return raw ? buildCashPulse(raw) : null; },
    enabled: !!companyId, staleTime: 60_000,
  });

  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="미래 대비는 대표·관리자 전용입니다." />;
  }

  const balance = pulse?.currentBalance ?? 0;
  const burn = pulse?.monthlyBurn ?? 0;
  const points = pulse?.forecastPoints ?? [];
  const runway = calcRunwayMonths(balance, 0, 0, burn);
  const rTone = runwayTone(runway);
  const runwayTxt = runway >= 999 ? "무기한" : `약 ${runway.toFixed(1)}개월`;
  const shortfall = points.find((p) => p.balance < 0);

  // 시나리오 — 매달 나가는 돈 민감도(정직한 what-if)
  const scen = [
    { label: "현 수준 유지", months: runway, tone: rTone },
    { label: "지출 10% 증가", months: calcRunwayMonths(balance, 0, 0, burn * 1.1), tone: "" },
    { label: "지출 10% 감소", months: calcRunwayMonths(balance, 0, 0, burn * 0.9), tone: "" },
  ].map((s) => ({ ...s, tone: s.tone || runwayTone(s.months) }));

  const loading = !companyId || !pulse;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.balance)), balance);

  // 규칙 기반 요약 코멘트 — 경영요약 '이번 달 상태'와 동일 방식(월 지출·운영가능기간·부족시점 조합, LLM 아님)
  const fmtMan = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  const shortTxt = shortfall
    ? ` 다만 ${shortfall.label} 무렵 잔액이 마이너스가 될 수 있어 자금 계획이 필요합니다.`
    : " 예측상 90일 안에는 통장이 마이너스가 되지 않습니다.";
  const outLine = `현재 지출 속도(월 약 ${fmtMan(burn)})라면 ${runwayTxt} 운영할 수 있습니다.${shortTxt}`;

  return (
    <>
      <ReportsTabs />
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="outlook-page-content">
          <IntroCard
            eyebrow="앞으로 전망 요약"
            title={outLine}
            desc={`가용 현금 ${fmt(balance)} · 월 지출 약 ${fmt(burn)} 기준의 전망입니다.`}
            callout={shortfall
              ? { label: "자금 부족 예상", value: `${shortfall.label} 무렵 부족`, sub: `그 시점 예상 잔액 ${fmt(shortfall.balance)} — 자금 계획 필요`, tone: "danger" }
              : { label: "자금 부족 예상", value: "90일 내 부족 없음 🟢", sub: "예측상 통장이 마이너스가 되지 않습니다", tone: "success" }}
          />

          {/* 통장 잔액 예측(오늘~D+90) */}
          <Section title="현금 잔액 전망" desc="향후 90일 예측">
            <div className="outlook-forecast-bars">
              {points.map((p) => {
                const neg = p.balance < 0;
                const h = Math.max(3, Math.round((Math.abs(p.balance) / maxAbs) * 100));
                return (
                  <div key={p.label} className="outlook-forecast-bar">
                    <span className="mono-number text-[10px] font-semibold" style={{ color: neg ? "var(--danger)" : "var(--text-muted)" }}>{fmt(p.balance)}</span>
                    <div className="w-full rounded-t-md" style={{ height: `${h}%`, background: neg ? "var(--danger)" : "color-mix(in srgb, var(--primary) 55%, transparent)" }} title={`${p.label}: ${fmt(p.balance)}`} />
                    <span className="text-[10px] text-[var(--text-dim)]">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 시나리오 */}
          <Section title="시나리오 분석" desc="지출 변동 시 운영 가능 기간">
            <div className="outlook-scenario-grid">
              {scen.map((s) => (
                <div key={s.label} className="outlook-scenario-tile stat-tile">
                  <div className="stat-tile-label">{s.label}</div>
                  <div className="stat-tile-value mono-number" style={{ color: TONE[s.tone] }}>{s.months >= 999 ? "무기한" : `${s.months.toFixed(1)}개월`}</div>
                </div>
              ))}
            </div>
          </Section>

          <div className="text-center">
            <Link href="/reports/flow" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--primary)] hover:underline no-underline">
              자세한 현금 흐름·월별 표 보기 →
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
