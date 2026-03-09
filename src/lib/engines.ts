/**
 * Founder Metrics Engines — 순수 계산 레이어
 * UI 없이 숫자만 계산. 데이터가 없으면 0 리턴. 절대 에러/무한로딩 없음.
 */

// ── Types ──
export type RiskLabel = 'LOW_MARGIN' | 'DUE_SOON' | 'AR_OVER_30' | 'OUTSOURCE_OVER_MARGIN';

export interface RiskItem {
  label: RiskLabel;
  name: string;
  detail: string;
  amount?: number;
  margin?: number;
  daysLeft?: number;
  daysOverdue?: number;
  projectName?: string;
}

export interface SixPack {
  cashBalance: number;        // 통장 총 잔고
  netCashflow: number;        // 이번달 예상 순현금흐름
  runwayMonths: number;       // 생존 가능 개월
  arTotal: number;            // 미수금 총액
  arOver30: number;           // 미수금 30일 이상
  pendingApprovals: number;   // 승인 대기 비용 총액
  monthlyBurn: number;        // 월 고정비(월 burn)
}

export interface GrowthMetrics {
  monthRevenue: number;
  quarterRevenue: number;
  yearRevenue: number;
  monthTarget: number;
  quarterTarget: number;
  yearTarget: number;
  monthGap: number;
  quarterGap: number;
  yearGap: number;
}

export interface FounderDashboardData {
  sixPack: SixPack;
  risks: RiskItem[];
  growth: GrowthMetrics;
  riskCounts: Record<RiskLabel, number>;
}

// ── Input types ──
export interface MonthlyFinancial {
  month: string;
  bank_balance: number;
  total_income: number;
  total_expense: number;
  fixed_cost: number;
  variable_cost: number;
  net_cashflow: number;
  revenue: number;
}

export interface FinancialItem {
  category: string;
  name: string;
  amount: number;
  due_date: string | null;
  status: string;
  risk_label: string | null;
  project_name: string | null;
  account_type: string | null;
}

export interface DealData {
  id: string;
  name: string;
  revenue: number;
  cost: number;
  margin: number;
  endDate: string | null;
  status: string;
}

// ═══════════════════════════════════════════
// Engine 1: Cashflow Engine
// ═══════════════════════════════════════════
export function calcNetCashflow(totalIncome: number, totalExpense: number): number {
  return totalIncome - Math.abs(totalExpense);
}

// ═══════════════════════════════════════════
// Engine 2: Survival Engine
// ═══════════════════════════════════════════
export function calcRunwayMonths(
  currentBalance: number,
  confirmedIncome: number,
  committedExpense: number,
  monthlyBurn: number
): number {
  if (monthlyBurn <= 0) return currentBalance > 0 ? 999 : 0;
  const adjustedBalance = currentBalance + confirmedIncome - Math.abs(committedExpense);
  const months = adjustedBalance / Math.abs(monthlyBurn);
  return Math.round(Math.max(0, months) * 10) / 10;
}

export function getRunwayLevel(months: number): 'CRITICAL' | 'DANGER' | 'WARNING' | 'STABLE' | 'SAFE' {
  if (months < 1) return 'CRITICAL';
  if (months < 2) return 'DANGER';
  if (months < 3) return 'WARNING';
  if (months < 6) return 'STABLE';
  return 'SAFE';
}

// ═══════════════════════════════════════════
// Engine 3: Risk Engine (4 auto-labels)
// ═══════════════════════════════════════════
export function detectRisks(
  deals: DealData[],
  receivables: FinancialItem[],
  expenses: FinancialItem[],
  today: Date = new Date()
): RiskItem[] {
  const risks: RiskItem[] = [];
  const todayMs = today.getTime();

  // LOW_MARGIN: 딜 마진 < 20%
  for (const deal of deals) {
    if (deal.revenue > 0 && deal.margin < 20) {
      risks.push({
        label: 'LOW_MARGIN',
        name: deal.name,
        detail: `마진 ${deal.margin.toFixed(1)}% (매출 ₩${fmt(deal.revenue)}, 비용 ₩${fmt(deal.cost)})`,
        margin: deal.margin,
        amount: deal.revenue - deal.cost,
        projectName: deal.name,
      });
    }
  }

  // DUE_SOON: D-7 이내
  for (const deal of deals) {
    if (deal.endDate) {
      const daysLeft = Math.ceil((new Date(deal.endDate).getTime() - todayMs) / (86400000));
      if (daysLeft >= 0 && daysLeft <= 7) {
        risks.push({
          label: 'DUE_SOON',
          name: deal.name,
          detail: `마감 D-${daysLeft}`,
          daysLeft,
          projectName: deal.name,
        });
      }
    }
  }

  // AR_OVER_30: 미수금 30일 이상
  for (const item of receivables) {
    if (item.due_date && (item.status === 'pending' || item.status === 'overdue')) {
      const dueDate = new Date(item.due_date);
      const daysOverdue = Math.floor((todayMs - dueDate.getTime()) / 86400000);
      if (daysOverdue >= 30) {
        risks.push({
          label: 'AR_OVER_30',
          name: item.name,
          detail: `${daysOverdue}일 연체 (₩${fmt(item.amount)})`,
          daysOverdue,
          amount: item.amount,
          projectName: item.project_name || undefined,
        });
      }
    }
  }

  // OUTSOURCE_OVER_MARGIN: 외주/변동비가 기여이익 잠식
  for (const deal of deals) {
    if (deal.revenue > 0 && deal.cost > deal.revenue * 0.8) {
      // 비용이 매출의 80% 이상 → 마진 잠식
      risks.push({
        label: 'OUTSOURCE_OVER_MARGIN',
        name: deal.name,
        detail: `비용 ₩${fmt(deal.cost)} > 매출의 80% (₩${fmt(deal.revenue * 0.8)})`,
        amount: deal.cost - (deal.revenue * 0.8),
        margin: deal.margin,
        projectName: deal.name,
      });
    }
  }

  return risks;
}

// ═══════════════════════════════════════════
// Engine 4: Margin Engine
// ═══════════════════════════════════════════
export function calcContributionMargin(revenue: number, directCost: number): number {
  return revenue - directCost;
}

export function calcMarginRate(revenue: number, directCost: number): number {
  if (revenue <= 0) return 0;
  return ((revenue - directCost) / revenue) * 100;
}

export function allocateFixedCost(monthlyFixed: number, activeDealCount: number): number {
  if (activeDealCount <= 0) return monthlyFixed;
  return monthlyFixed / activeDealCount;
}

// ═══════════════════════════════════════════
// Aggregator: Build complete dashboard data
// ═══════════════════════════════════════════
export function buildFounderDashboard(
  currentMonth: MonthlyFinancial | null,
  items: FinancialItem[],
  deals: DealData[],
  targets: { monthTarget: number; quarterTarget: number; yearTarget: number },
  quarterRevenue: number,
  yearRevenue: number,
  realMonthlyBurn?: number,
): FounderDashboardData {
  const mf = currentMonth;

  // 6-Pack
  const cashBalance = mf?.bank_balance ?? 0;
  const totalIncome = mf?.total_income ?? 0;
  const totalExpense = mf?.total_expense ?? 0;
  const fixedCost = mf?.fixed_cost ?? 0;
  const variableCost = mf?.variable_cost ?? 0;
  // monthlyBurn: recurring_payments + salary 실데이터가 있으면 사용, 없으면 fallback
  const monthlyBurn = (realMonthlyBurn && realMonthlyBurn > 0) ? realMonthlyBurn : (fixedCost || Math.abs(totalExpense));
  const netCashflow = calcNetCashflow(totalIncome, totalExpense);

  // AR
  const receivables = items.filter(i => i.category === 'receivable');
  const arTotal = receivables.reduce((s, i) => s + Math.abs(i.amount), 0);
  const today = new Date();
  const arOver30 = receivables
    .filter(i => i.due_date && (today.getTime() - new Date(i.due_date).getTime()) > 30 * 86400000)
    .reduce((s, i) => s + Math.abs(i.amount), 0);

  // Pending approvals
  const payables = items.filter(i => i.category === 'payable' && i.status === 'pending');
  const pendingApprovals = payables.reduce((s, i) => s + Math.abs(i.amount), 0);

  // Confirmed income for survival calc
  const confirmedIncome = items
    .filter(i => i.category === 'income' && i.status === 'confirmed')
    .reduce((s, i) => s + Math.abs(i.amount), 0);
  const committedExpense = items
    .filter(i => (i.category === 'expense' || i.category === 'payable') && (i.status === 'confirmed' || i.status === 'pending'))
    .reduce((s, i) => s + Math.abs(i.amount), 0);

  const runwayMonths = calcRunwayMonths(cashBalance, confirmedIncome, committedExpense, monthlyBurn);

  const sixPack: SixPack = {
    cashBalance,
    netCashflow,
    runwayMonths,
    arTotal,
    arOver30,
    pendingApprovals,
    monthlyBurn,
  };

  // Risks
  const risks = detectRisks(deals, receivables, items.filter(i => i.category === 'expense'), today);
  const riskCounts: Record<RiskLabel, number> = {
    LOW_MARGIN: risks.filter(r => r.label === 'LOW_MARGIN').length,
    DUE_SOON: risks.filter(r => r.label === 'DUE_SOON').length,
    AR_OVER_30: risks.filter(r => r.label === 'AR_OVER_30').length,
    OUTSOURCE_OVER_MARGIN: risks.filter(r => r.label === 'OUTSOURCE_OVER_MARGIN').length,
  };

  // Growth
  const monthRevenue = mf?.revenue ?? 0;
  const growth: GrowthMetrics = {
    monthRevenue,
    quarterRevenue,
    yearRevenue,
    monthTarget: targets.monthTarget,
    quarterTarget: targets.quarterTarget,
    yearTarget: targets.yearTarget,
    monthGap: targets.monthTarget - monthRevenue,
    quarterGap: targets.quarterTarget - quarterRevenue,
    yearGap: targets.yearTarget - yearRevenue,
  };

  return { sixPack, risks, growth, riskCounts };
}

// ═══════════════════════════════════════════
// Engine 5: Financial Dashboard (Option C)
// ═══════════════════════════════════════════

export interface MonthlyChartData {
  month: string;      // YYYY-MM
  label: string;      // e.g. "3월"
  revenue: number;
  expense: number;
  netIncome: number;
}

export interface ClassificationAggregation {
  classification: string;
  color: string;
  dealCount: number;
  totalRevenue: number;
  totalCost: number;
  avgMargin: number;
}

export interface FinancialDashboardData {
  monthlyChart: MonthlyChartData[];
  classificationBreakdown: ClassificationAggregation[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

export function buildFinancialDashboard(
  allMonths: Array<{ month: string; revenue: number; totalIncome: number; totalExpense: number }>,
  deals: Array<{ classification: string; contractTotal: number; revenue: number; cost: number }>,
  classificationColors: Record<string, string>,
): FinancialDashboardData {
  // Monthly chart data (sorted oldest→newest)
  const sorted = [...allMonths].sort((a, b) => a.month.localeCompare(b.month));
  const monthlyChart: MonthlyChartData[] = sorted.map(m => {
    const [, mo] = m.month.split('-');
    return {
      month: m.month,
      label: `${parseInt(mo)}월`,
      revenue: m.totalIncome || m.revenue || 0,
      expense: Math.abs(m.totalExpense || 0),
      netIncome: (m.totalIncome || m.revenue || 0) - Math.abs(m.totalExpense || 0),
    };
  });

  // Classification breakdown
  const classificationBreakdown = aggregateByClassification(deals, classificationColors);

  // Totals
  const totalRevenue = monthlyChart.reduce((s, m) => s + m.revenue, 0);
  const totalExpense = monthlyChart.reduce((s, m) => s + m.expense, 0);
  const netIncome = totalRevenue - totalExpense;

  return { monthlyChart, classificationBreakdown, totalRevenue, totalExpense, netIncome };
}

export function aggregateByClassification(
  deals: Array<{ classification: string; contractTotal: number; revenue: number; cost: number }>,
  classificationColors: Record<string, string>,
): ClassificationAggregation[] {
  const groups = new Map<string, { count: number; revenue: number; cost: number }>();

  for (const d of deals) {
    const cls = d.classification || 'B2B';
    const g = groups.get(cls) || { count: 0, revenue: 0, cost: 0 };
    g.count++;
    g.revenue += d.revenue || d.contractTotal || 0;
    g.cost += d.cost || 0;
    groups.set(cls, g);
  }

  return Array.from(groups.entries()).map(([cls, g]) => ({
    classification: cls,
    color: classificationColors[cls] || '#3b82f6',
    dealCount: g.count,
    totalRevenue: g.revenue,
    totalCost: g.cost,
    avgMargin: g.revenue > 0 ? ((g.revenue - g.cost) / g.revenue) * 100 : 0,
  }));
}

// ── Helpers ──
function fmt(n: number): string {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (Math.abs(n) >= 1e4) return `${Math.round(n / 1e4)}만`;
  return n.toLocaleString();
}
