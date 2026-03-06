/**
 * Cash Pulse Engine — 현금 펄스 계산기
 * 순수 계산 레이어. DB 접근 없음. 데이터 없으면 0 리턴.
 *
 * 코어 바: 잔고 / D+30·D+90 예측 / 펄스 점수 / 위험·대기
 * 위젯: 5-point 예측 + 브리핑
 */

import { calcRunwayMonths } from './engines';

// ── Input (getCashPulseData가 수집) ──
export interface CashPulseInput {
  bankBalances: Array<{ balance: number }>;
  revenueSchedules: Array<{ amount: number; due_date: string | null; status: string }>;
  costSchedules: Array<{ amount: number; due_date: string | null; status: string }>;
  recurringPayments: Array<{ amount: number; is_active: boolean }>;
  employeeSalaryTotal: number;
  paymentQueue: Array<{ amount: number; status: string }>;
  riskCount: number;
  pendingApprovalCount: number;
  arOver30Amount: number;
  matchedRate: number; // 0~1
}

// ── Output ──
export interface ForecastPoint {
  label: string;   // "오늘", "D+7", "D+30", "D+60", "D+90"
  days: number;
  balance: number;
}

export interface CashPulseResult {
  currentBalance: number;
  forecast30d: number;
  forecast90d: number;
  forecastPoints: ForecastPoint[];
  monthlyBurn: number;
  pulseScore: number; // 0-100
  scoreBreakdown: {
    runway: number;        // /40
    cashflowTrend: number; // /20
    arHealth: number;      // /15
    matchingRate: number;  // /10
    approvalLag: number;   // /15
  };
  riskCount: number;
  pendingApprovalCount: number;
  briefing: string;
}

// ── Helpers ──

function sumScheduledInWindow(
  schedules: Array<{ amount: number; due_date: string | null; status: string }>,
  fromDate: Date,
  daysAhead: number,
): number {
  const end = new Date(fromDate);
  end.setDate(end.getDate() + daysAhead);
  const endStr = end.toISOString().split('T')[0];
  const fromStr = fromDate.toISOString().split('T')[0];

  return schedules
    .filter(s => s.status === 'scheduled' && s.due_date && s.due_date >= fromStr && s.due_date <= endStr)
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);
}

function fmtBriefing(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (abs >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만원`;
  return `${n.toLocaleString()}원`;
}

// ── Main Engine ──

export function buildCashPulse(input: CashPulseInput): CashPulseResult {
  const now = new Date();

  // 1. Current balance
  const currentBalance = input.bankBalances.reduce((s, b) => s + Number(b.balance || 0), 0);

  // 2. Monthly burn
  const recurringTotal = input.recurringPayments
    .filter(r => r.is_active)
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const monthlyBurn = recurringTotal + input.employeeSalaryTotal;

  // 3. Pending payment queue (approved but not executed)
  const pendingPayments = input.paymentQueue
    .filter(p => p.status === 'approved' || p.status === 'pending')
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  // 4. Forecast at each point
  const forecastDays = [0, 7, 30, 60, 90];
  const forecastLabels = ['오늘', 'D+7', 'D+30', 'D+60', 'D+90'];

  const forecastPoints: ForecastPoint[] = forecastDays.map((days, i) => {
    if (days === 0) {
      return { label: forecastLabels[i], days, balance: currentBalance };
    }

    const incomingRevenue = sumScheduledInWindow(input.revenueSchedules, now, days);
    const outgoingCosts = sumScheduledInWindow(input.costSchedules, now, days);
    const burnForPeriod = monthlyBurn * (days / 30);

    const balance = currentBalance + incomingRevenue - outgoingCosts - burnForPeriod - (days <= 7 ? pendingPayments : 0);

    return { label: forecastLabels[i], days, balance: Math.round(balance) };
  });

  const forecast30d = forecastPoints.find(p => p.days === 30)?.balance || 0;
  const forecast90d = forecastPoints.find(p => p.days === 90)?.balance || 0;

  // 5. Pulse Score (0-100)
  const runwayMonths = calcRunwayMonths(currentBalance, 0, 0, monthlyBurn);

  // 5a. Runway score (40 points)
  let runwayScore: number;
  if (runwayMonths >= 6) runwayScore = 40;
  else if (runwayMonths >= 3) runwayScore = 30;
  else if (runwayMonths >= 2) runwayScore = 20;
  else if (runwayMonths >= 1) runwayScore = 10;
  else runwayScore = 0;

  // 5b. Cashflow trend score (20 points)
  const netCashflow30d = forecastPoints.find(p => p.days === 30)!.balance - currentBalance;
  let cashflowScore: number;
  if (netCashflow30d >= 0) cashflowScore = 20;
  else if (netCashflow30d >= -monthlyBurn) cashflowScore = 10;
  else cashflowScore = 0;

  // 5c. AR health score (15 points)
  const totalAR = input.revenueSchedules
    .filter(r => r.status === 'scheduled')
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  let arScore: number;
  if (input.arOver30Amount <= 0) arScore = 15;
  else if (totalAR > 0) arScore = Math.round(15 * Math.max(0, 1 - input.arOver30Amount / totalAR));
  else arScore = 15;

  // 5d. Matching rate score (10 points)
  let matchScore: number;
  if (input.matchedRate >= 0.9) matchScore = 10;
  else if (input.matchedRate >= 0.7) matchScore = 7;
  else if (input.matchedRate >= 0.5) matchScore = 4;
  else matchScore = 0;

  // 5e. Approval lag score (15 points)
  let approvalScore: number;
  if (input.pendingApprovalCount === 0) approvalScore = 15;
  else if (input.pendingApprovalCount <= 2) approvalScore = 10;
  else if (input.pendingApprovalCount <= 5) approvalScore = 5;
  else approvalScore = 0;

  const pulseScore = runwayScore + cashflowScore + arScore + matchScore + approvalScore;

  // 6. Briefing
  const parts: string[] = [];
  parts.push(`잔고 ${fmtBriefing(currentBalance)}`);

  if (forecast30d !== currentBalance) {
    parts.push(`30일 후 ${fmtBriefing(forecast30d)} 예상`);
  }

  if (input.arOver30Amount > 0) {
    parts.push(`미수금 연체 ${fmtBriefing(input.arOver30Amount)} 주의`);
  }

  if (input.pendingApprovalCount > 0) {
    parts.push(`승인대기 ${input.pendingApprovalCount}건`);
  }

  if (forecast90d < 0) {
    parts.push(`90일 내 현금 부족 경고`);
  }

  const briefing = parts.join('. ') + '.';

  return {
    currentBalance,
    forecast30d,
    forecast90d,
    forecastPoints,
    monthlyBurn,
    pulseScore,
    scoreBreakdown: {
      runway: runwayScore,
      cashflowTrend: cashflowScore,
      arHealth: arScore,
      matchingRate: matchScore,
      approvalLag: approvalScore,
    },
    riskCount: input.riskCount,
    pendingApprovalCount: input.pendingApprovalCount,
    briefing,
  };
}

// ── Score level for UI coloring ──
export function getPulseLevel(score: number): 'critical' | 'danger' | 'warning' | 'stable' | 'safe' {
  if (score < 20) return 'critical';
  if (score < 40) return 'danger';
  if (score < 60) return 'warning';
  if (score < 80) return 'stable';
  return 'safe';
}
