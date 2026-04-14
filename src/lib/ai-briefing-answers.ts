import type { CashPulseResult } from "@/lib/cash-pulse";
import type { FounderDashboardData } from "@/lib/engines";

export interface BriefingDataProps {
  cashPulse: CashPulseResult | null;
  dashboard: FounderDashboardData | null;
  hasData: boolean;
  companyName: string;
}

export function formatKrw(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0원";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
}

export function buildInitialMessage(p: BriefingDataProps): string {
  if (!p.hasData || !p.cashPulse) {
    return "아직 분석할 데이터가 충분하지 않습니다. 거래내역을 동기화하시면 상세 브리핑을 받으실 수 있습니다.";
  }
  const score = p.cashPulse.pulseScore;
  const scoreLabel = score >= 80 ? "양호" : score >= 50 ? "보통" : "주의 필요";
  const riskCount = p.dashboard?.risks.length ?? 0;
  return `${p.companyName} 경영 현황을 분석했습니다.\n\n` +
    `현재 현금 잔고는 ${formatKrw(p.cashPulse.currentBalance)}이며, 재무 건강 점수는 ${score}점(${scoreLabel})입니다.` +
    (riskCount > 0
      ? `\n주의가 필요한 항목이 ${riskCount}건 있습니다. 아래 버튼으로 상세 내역을 확인해 보세요.`
      : "\n특별히 주의가 필요한 항목은 없습니다.");
}

export function buildAnswer(key: string, p: BriefingDataProps): string {
  const sp = p.dashboard?.sixPack;
  const growth = p.dashboard?.growth;
  const pulse = p.cashPulse;
  if (!p.hasData || !sp || !pulse) return "데이터가 아직 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.";

  switch (key) {
    case "cashflow": {
      const dir = sp.netCashflow >= 0 ? "흑자" : "적자";
      return `이번 달 순현금흐름은 ${formatKrw(sp.netCashflow)} (${dir})입니다.\n\n` +
        `월 고정비: ${formatKrw(sp.monthlyBurn)} | 30일 후 예상 잔고: ${formatKrw(pulse.forecast30d)}\n` +
        (sp.netCashflow < 0 ? "지출이 수입을 초과하고 있으니, 비용 구조 점검을 권장합니다." : "현금 유입이 안정적인 흐름입니다.");
    }
    case "ar": {
      if (sp.arTotal === 0) return "현재 미수금이 없습니다. 수금 상태가 깨끗합니다.";
      const pct = sp.arTotal > 0 ? Math.round((sp.arOver30 / sp.arTotal) * 100) : 0;
      return `미수금 총액: ${formatKrw(sp.arTotal)}\n30일 초과: ${formatKrw(sp.arOver30)} (${pct}%)\n\n` +
        (sp.arOver30 > 0 ? "장기 연체 미수금이 있습니다. 수금 독촉을 권장합니다." : "장기 연체 미수금은 없습니다.");
    }
    case "vat": {
      const rev = growth?.monthRevenue ?? 0;
      const now = new Date();
      const q = Math.ceil((now.getMonth() + 1) / 3);
      const dm = q * 3 + 1;
      const due = dm <= 12 ? `${now.getFullYear()}년 ${dm}월 25일` : `${now.getFullYear() + 1}년 1월 25일`;
      return `${q}분기 예상 부가세: ${formatKrw(Math.round(rev * 0.1))}\n(이번 달 매출 ${formatKrw(rev)} 기준)\n납부 기한: ${due}\n\n실제 부가세는 매입세액 공제 후 달라질 수 있습니다.`;
    }
    case "risks": {
      const risks = p.dashboard?.risks ?? [];
      if (risks.length === 0) return "현재 주의가 필요한 프로젝트가 없습니다.";
      const rc = p.dashboard?.riskCounts;
      const lines = ["위험 프로젝트 현황:\n"];
      const entries: [string, number | undefined][] = [
        ["마진 20% 이하", rc?.LOW_MARGIN], ["마감 D-7 이내", rc?.DUE_SOON],
        ["미수금 30일+", rc?.AR_OVER_30], ["외주비 마진잠식", rc?.OUTSOURCE_OVER_MARGIN],
      ];
      entries.forEach(([label, count]) => { if (count && count > 0) lines.push(`- ${label}: ${count}건`); });
      lines.push("\n주요 항목:");
      risks.slice(0, 3).forEach((r) => lines.push(`- ${r.name}: ${r.detail}`));
      if (risks.length > 3) lines.push(`\n외 ${risks.length - 3}건`);
      return lines.join("\n");
    }
    case "runway": {
      const m = sp.runwayMonths;
      const assess = m >= 12 ? "안전한 수준입니다." : m >= 6 ? "안정적이나 모니터링 필요합니다." : m >= 3 ? "추가 자금 확보를 고려해 보세요." : "긴급한 자금 관리가 필요합니다.";
      return `런웨이 분석:\n\n잔고: ${formatKrw(pulse.currentBalance)} | 월 고정비: ${formatKrw(sp.monthlyBurn)}\n예상 생존: ${m > 0 ? `${m.toFixed(1)}개월` : "산출 불가"}\n\n${assess}`;
    }
    case "revenue": {
      if (!growth) return "매출 목표 데이터가 설정되지 않았습니다.";
      const mp = growth.monthTarget > 0 ? Math.round((growth.monthRevenue / growth.monthTarget) * 100) : 0;
      const qp = growth.quarterTarget > 0 ? Math.round((growth.quarterRevenue / growth.quarterTarget) * 100) : 0;
      const tip = mp >= 100 ? "월 목표 달성!" : mp >= 70 ? "목표 근접 중입니다." : "파이프라인 점검이 필요합니다.";
      return `매출 달성률:\n\n월: ${formatKrw(growth.monthRevenue)} / ${formatKrw(growth.monthTarget)} (${mp}%)\n분기: ${formatKrw(growth.quarterRevenue)} / ${formatKrw(growth.quarterTarget)} (${qp}%)\n\n${tip}`;
    }
    default:
      return "해당 분석은 아직 준비되지 않았습니다.";
  }
}
