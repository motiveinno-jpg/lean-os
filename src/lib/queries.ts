import { supabase } from './supabase';
import { encryptCredential } from './crypto';
import type { User, Company, Deal, DealNode, CashSnapshot, BankAccount, SubDeal, DealMilestone, DealAssignment, PaymentQueue, DocTemplate, TaxInvoice, ChatChannel, ChatMessage, ChatParticipant, VaultAccount, VaultAsset, VaultDoc, AutoDiscoveryResult, DealClassification, CorporateCard, CardTransaction, ClosingChecklist, ClosingChecklistItem, AuditLog, Partner } from '@/types/models';

// ── Auth helpers ──
export type CurrentUser = {
  id: string;
  auth_id: string | null;
  company_id: string;
  email: string;
  name: string | null;
  role: string | null;
  created_at: string | null;
  companies: { id: string; name: string; industry: string | null; created_at: string | null } | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // maybeSingle: users 테이블에 행이 없어도 에러 대신 null 반환
  const { data, error } = await supabase
    .from('users')
    .select('*, companies(*)')
    .eq('auth_id', user.id)
    .maybeSingle();
  if (error) { console.error('getCurrentUser error:', error.message); return null; }
  // auth_id로 못 찾으면 id로 폴백 (이전 데이터 호환)
  if (!data) {
    const { data: fallback } = await supabase
      .from('users')
      .select('*, companies(*)')
      .eq('id', user.id)
      .maybeSingle();
    if (!fallback || !fallback.company_id) return null;
    return fallback as unknown as CurrentUser;
  }
  if (!data.company_id) return null;
  return data as unknown as CurrentUser;
}

// ── Survival Data Types ──
export type SurvivalLevel = 'CRITICAL' | 'DANGER' | 'WARNING' | 'STABLE' | 'SAFE';

export interface SurvivalData {
  // Core survival metrics
  balance: number;
  monthlyFixedCost: number;
  survivalMonths: number;
  survivalLevel: SurvivalLevel;

  // Cashflow
  outstandingReceivables: number;  // 미수금 총액
  upcomingExpenses: number;        // 예정 지출 총액
  netCashflow30d: number;          // 30일 순현금흐름 예측
  netCashflow90d: number;          // 90일 순현금흐름 예측

  // Deal health
  totalDeals: number;
  activeDeals: number;
  avgMargin: number;
  totalRevenue: number;
  totalCost: number;

  // Risk zone
  riskDeals: RiskDeal[];
  deadlineDeals: DeadlineDeal[];
  agingReceivables: AgingBucket[];
  unapprovedCosts: UnapprovedCost[];

  // VAT
  vatPreview: number;

  // Deal details for table
  dealMargins: DealMargin[];

  // Monthly revenue trend (last 6 months)
  monthlyRevenue: MonthlyRevenue[];
}

export interface RiskDeal {
  id: string;
  name: string;
  contractTotal: number;
  revenue: number;
  cost: number;
  margin: number;
  status: string | null;
}

export interface DeadlineDeal {
  id: string;
  dealName: string;
  nodeName: string;
  deadline: string;
  daysLeft: number;
  status: string | null;
}

export interface AgingBucket {
  label: string;
  days: string;
  amount: number;
  count: number;
  level: 'safe' | 'warning' | 'danger' | 'critical';
}

export interface UnapprovedCost {
  id: string;
  dealNodeId: string;
  amount: number;
  dueDate: string | null;
  status: string | null;
}

export interface DealMargin {
  id: string;
  name: string;
  contractTotal: number;
  revenue: number;
  cost: number;
  margin: number;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface MonthlyRevenue {
  month: string;       // YYYY-MM
  label: string;       // MM월
  received: number;    // 수금 완료
  scheduled: number;   // 수금 예정
}

// ── Survival Level Calculator ──
function getSurvivalLevel(months: number): SurvivalLevel {
  if (months < 1) return 'CRITICAL';
  if (months < 2) return 'DANGER';
  if (months < 3) return 'WARNING';
  if (months < 6) return 'STABLE';
  return 'SAFE';
}

// ── Main Survival Data Engine ──
export async function getSurvivalData(companyId: string): Promise<SurvivalData> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const [cash, deals, revenue, costs, transactions, nodes, employees] = await Promise.all([
    supabase.from('cash_snapshot').select('*').eq('company_id', companyId).single(),
    supabase.from('deals').select('*').eq('company_id', companyId),
    supabase.from('deal_revenue_schedule').select('*, deals!inner(company_id, name)').eq('deals.company_id', companyId),
    supabase.from('deal_cost_schedule').select('*, deal_nodes!inner(deal_id, name, deals!inner(company_id))'),
    supabase.from('transactions').select('*').eq('company_id', companyId),
    supabase.from('deal_nodes').select('*, deals!inner(company_id, name)').eq('deals.company_id', companyId),
    supabase.from('employees').select('*').eq('company_id', companyId).eq('status', 'active'),
  ]);

  const cashData = cash.data as CashSnapshot | null;
  const dealsData = (deals.data || []) as Deal[];
  const revenueData = revenue.data || [];
  const costsData = costs.data || [];
  const transactionsData = transactions.data || [];
  const nodesData = nodes.data || [];
  const employeesData = employees.data || [];

  // ── Core Survival Metrics ──
  const balance = cashData?.current_balance || 0;
  const employeeSalaryTotal = employeesData.reduce((s: number, e: any) => s + Number(e.salary || 0), 0);
  const monthlyFixedCost = cashData?.monthly_fixed_cost || employeeSalaryTotal || 0;
  const survivalMonths = monthlyFixedCost > 0 ? balance / monthlyFixedCost : (balance > 0 ? 999 : 0);
  const survivalLevel = getSurvivalLevel(survivalMonths);

  // ── Cashflow ──
  const outstandingReceivables = revenueData
    .filter((r: any) => r.status === 'scheduled')
    .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  const upcomingExpenses = costsData
    .filter((c: any) => c.status === 'scheduled')
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  // 30-day window
  const d30 = new Date(now);
  d30.setDate(d30.getDate() + 30);
  const d30str = d30.toISOString().split('T')[0];

  const receivable30d = revenueData
    .filter((r: any) => r.status === 'scheduled' && r.due_date && r.due_date <= d30str)
    .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const expense30d = costsData
    .filter((c: any) => c.status === 'scheduled' && c.due_date && c.due_date <= d30str)
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const netCashflow30d = receivable30d - expense30d;

  // 90-day window
  const d90 = new Date(now);
  d90.setDate(d90.getDate() + 90);
  const d90str = d90.toISOString().split('T')[0];

  const receivable90d = revenueData
    .filter((r: any) => r.status === 'scheduled' && r.due_date && r.due_date <= d90str)
    .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const expense90d = costsData
    .filter((c: any) => c.status === 'scheduled' && c.due_date && c.due_date <= d90str)
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const netCashflow90d = receivable90d - expense90d;

  // ── Deal Health ──
  const activeDeals = dealsData.filter(d => d.status === 'active');

  const dealMargins: DealMargin[] = dealsData.map(d => {
    const rev = revenueData
      .filter((r: any) => r.deal_id === d.id)
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const cost = costsData
      .filter((c: any) => {
        const nodeMatch = nodesData.find((n: any) => n.id === c.deal_node_id);
        return nodeMatch && (nodeMatch as any).deal_id === d.id;
      })
      .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
    const margin = rev > 0 ? ((rev - cost) / rev) * 100 : 0;
    return {
      id: d.id,
      name: d.name,
      contractTotal: Number(d.contract_total || 0),
      revenue: rev,
      cost,
      margin,
      status: d.status,
      startDate: d.start_date,
      endDate: d.end_date,
    };
  });

  const totalRevenue = dealMargins.reduce((s, d) => s + d.revenue, 0);
  const totalCost = dealMargins.reduce((s, d) => s + d.cost, 0);
  const avgMargin = dealMargins.length > 0
    ? dealMargins.reduce((s, d) => s + d.margin, 0) / dealMargins.length : 0;

  // ── Risk Deals (margin < 20%) ──
  const riskDeals: RiskDeal[] = dealMargins
    .filter(d => d.margin < 20 && d.revenue > 0)
    .sort((a, b) => a.margin - b.margin)
    .map(d => ({
      id: d.id,
      name: d.name,
      contractTotal: d.contractTotal,
      revenue: d.revenue,
      cost: d.cost,
      margin: d.margin,
      status: d.status,
    }));

  // ── Deadline Approaching (D-7) ──
  const d7 = new Date(now);
  d7.setDate(d7.getDate() + 7);
  const d7str = d7.toISOString().split('T')[0];

  const deadlineDeals: DeadlineDeal[] = nodesData
    .filter((n: any) => n.deadline && n.deadline >= today && n.deadline <= d7str && n.status !== 'completed')
    .map((n: any) => {
      const daysLeft = Math.ceil((new Date(n.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: n.id,
        dealName: (n as any).deals?.name || '',
        nodeName: n.name,
        deadline: n.deadline,
        daysLeft,
        status: n.status,
      };
    })
    .sort((a: DeadlineDeal, b: DeadlineDeal) => a.daysLeft - b.daysLeft);

  // ── Aging Receivables ──
  const scheduledRevenue = revenueData.filter((r: any) => r.status === 'scheduled' && r.due_date);
  const agingReceivables: AgingBucket[] = [
    { label: '정상', days: '0-30일', amount: 0, count: 0, level: 'safe' as const },
    { label: '주의', days: '30-60일', amount: 0, count: 0, level: 'warning' as const },
    { label: '위험', days: '60-90일', amount: 0, count: 0, level: 'danger' as const },
    { label: '심각', days: '90일+', amount: 0, count: 0, level: 'critical' as const },
  ];

  scheduledRevenue.forEach((r: any) => {
    const overdueDays = Math.floor((now.getTime() - new Date(r.due_date).getTime()) / (1000 * 60 * 60 * 24));
    if (overdueDays <= 0) {
      agingReceivables[0].amount += Number(r.amount || 0);
      agingReceivables[0].count++;
    } else if (overdueDays <= 30) {
      agingReceivables[0].amount += Number(r.amount || 0);
      agingReceivables[0].count++;
    } else if (overdueDays <= 60) {
      agingReceivables[1].amount += Number(r.amount || 0);
      agingReceivables[1].count++;
    } else if (overdueDays <= 90) {
      agingReceivables[2].amount += Number(r.amount || 0);
      agingReceivables[2].count++;
    } else {
      agingReceivables[3].amount += Number(r.amount || 0);
      agingReceivables[3].count++;
    }
  });

  // ── Unapproved Costs ──
  const unapprovedCosts: UnapprovedCost[] = costsData
    .filter((c: any) => !c.approved)
    .map((c: any) => ({
      id: c.id,
      dealNodeId: c.deal_node_id,
      amount: Number(c.amount || 0),
      dueDate: c.due_date,
      status: c.status,
    }));

  // ── VAT ──
  const incomeTotal = transactionsData.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const expenseTotal = transactionsData.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const vatPreview = (incomeTotal * 0.1) - (expenseTotal * 0.1);

  // ── Monthly Revenue Trend (last 6 months) ──
  const monthlyRevenue: MonthlyRevenue[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${d.getMonth() + 1}월`;

    const received = revenueData
      .filter((r: any) => r.status === 'received' && r.due_date && r.due_date.startsWith(monthStr))
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const scheduled = revenueData
      .filter((r: any) => r.status === 'scheduled' && r.due_date && r.due_date.startsWith(monthStr))
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    monthlyRevenue.push({ month: monthStr, label, received, scheduled });
  }

  return {
    balance,
    monthlyFixedCost,
    survivalMonths: Math.round(survivalMonths * 10) / 10,
    survivalLevel,
    outstandingReceivables: Math.round(outstandingReceivables),
    upcomingExpenses: Math.round(upcomingExpenses),
    netCashflow30d: Math.round(netCashflow30d),
    netCashflow90d: Math.round(netCashflow90d),
    totalDeals: dealsData.length,
    activeDeals: activeDeals.length,
    avgMargin: Math.round(avgMargin * 10) / 10,
    totalRevenue: Math.round(totalRevenue),
    totalCost: Math.round(totalCost),
    riskDeals,
    deadlineDeals,
    agingReceivables,
    unapprovedCosts,
    vatPreview: Math.round(vatPreview),
    dealMargins,
    monthlyRevenue,
  };
}

// ── Legacy alias (backward compat) ──
export async function getDashboardKPIs(companyId: string) {
  const s = await getSurvivalData(companyId);
  return {
    balance: s.balance,
    survivalMonths: s.survivalMonths,
    vatPreview: s.vatPreview,
    avgMargin: s.avgMargin,
    riskDealCount: s.riskDeals.length,
    outstanding: s.outstandingReceivables,
    totalDeals: s.totalDeals,
    unapprovedExpenses: s.unapprovedCosts.length,
    dealMargins: s.dealMargins.map(d => ({
      ...d,
      contract_total: d.contractTotal,
    })),
  };
}

// ── Deals ──
export async function getDeals(companyId: string) {
  const { data } = await supabase
    .from('deals')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getDealWithNodes(dealId: string) {
  const [deal, nodes, revenue, costs] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('deal_nodes').select('*').eq('deal_id', dealId).order('created_at'),
    supabase.from('deal_revenue_schedule').select('*').eq('deal_id', dealId).order('due_date'),
    supabase.from('deal_cost_schedule').select('*, deal_nodes!inner(deal_id)').eq('deal_nodes.deal_id', dealId).order('due_date'),
  ]);
  if (deal.error && !deal.data) throw new Error('딜 데이터를 불러올 수 없습니다');
  return {
    deal: deal.data || null,
    nodes: nodes.data || [],
    revenue: revenue.data || [],
    costs: costs.data || [],
  };
}

// ── Tree builder ──
export type TreeNode = DealNode & { children: TreeNode[] };

export function buildTree(nodes: DealNode[]): TreeNode[] {
  const map = new Map<string | null, DealNode[]>();
  nodes.forEach(n => {
    const key = n.parent_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  });

  function attach(parentId: string | null): TreeNode[] {
    return (map.get(parentId) || []).map(n => ({
      ...n,
      children: attach(n.id),
    }));
  }
  return attach(null);
}

// ═══════════════════════════════════════════════
// Founder Layer: Data from monthly_financials + financial_items
// ═══════════════════════════════════════════════

export async function getFounderData(companyId: string) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const quarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
  const year = String(now.getFullYear());

  const [mfRes, itemsRes, targetsRes, dealsRes] = await Promise.all([
    supabase.from('monthly_financials').select('*').eq('company_id', companyId).order('month', { ascending: false }),
    supabase.from('financial_items').select('*').eq('company_id', companyId).eq('month', thisMonth),
    supabase.from('growth_targets').select('*').eq('company_id', companyId),
    supabase.from('deals').select('*').eq('company_id', companyId),
  ]);

  const allMonths = mfRes.data || [];
  const currentMonth = allMonths.find((m: any) => m.month === thisMonth) || allMonths[0] || null;
  const items = itemsRes.data || [];
  const targets = targetsRes.data || [];
  const deals = dealsRes.data || [];

  // Get target values
  const monthTarget = Number(targets.find((t: any) => t.period === thisMonth)?.target_revenue || 0);
  const quarterTarget = Number(targets.find((t: any) => t.period === quarter)?.target_revenue || 0);
  const yearTarget = Number(targets.find((t: any) => t.period === year)?.target_revenue || 0);

  // Calculate quarter/year revenue from allMonths
  const quarterMonths = allMonths.filter((m: any) => {
    const [y, mo] = m.month.split('-').map(Number);
    const q = Math.ceil(mo / 3);
    return y === now.getFullYear() && q === Math.ceil((now.getMonth() + 1) / 3);
  });
  const quarterRevenue = quarterMonths.reduce((s: number, m: any) => s + Number(m.revenue || 0), 0);

  const yearMonths = allMonths.filter((m: any) => m.month.startsWith(year));
  const yearRevenue = yearMonths.reduce((s: number, m: any) => s + Number(m.revenue || 0), 0);

  return {
    currentMonth: currentMonth ? {
      month: currentMonth.month,
      bank_balance: Number(currentMonth.bank_balance || 0),
      total_income: Number(currentMonth.total_income || 0),
      total_expense: Number(currentMonth.total_expense || 0),
      fixed_cost: Number(currentMonth.fixed_cost || 0),
      variable_cost: Number(currentMonth.variable_cost || 0),
      net_cashflow: Number(currentMonth.net_cashflow || 0),
      revenue: Number(currentMonth.revenue || 0),
    } : null,
    items: items.map((i: any) => ({
      category: i.category,
      name: i.name,
      amount: Number(i.amount || 0),
      due_date: i.due_date,
      status: i.status || 'pending',
      risk_label: i.risk_label,
      project_name: i.project_name,
      account_type: i.account_type,
    })),
    deals: deals.map((d: any) => ({
      id: d.id,
      name: d.name,
      revenue: Number(d.contract_total || 0),
      cost: 0,
      margin: 0,
      endDate: d.end_date,
      status: d.status || 'active',
    })),
    targets: { monthTarget, quarterTarget, yearTarget },
    quarterRevenue,
    yearRevenue,
    allMonths: allMonths.map((m: any) => ({
      month: m.month,
      revenue: Number(m.revenue || 0),
      totalIncome: Number(m.total_income || 0),
      totalExpense: Number(m.total_expense || 0),
    })),
    hasData: allMonths.length > 0 || items.length > 0,
  };
}

export async function saveExcelData(
  companyId: string,
  months: Array<{ month: string; bank_balance: number; total_income: number; total_expense: number; fixed_cost: number; variable_cost: number; net_cashflow: number; revenue: number }>,
  items: Array<{ category: string; name: string; amount: number; due_date: string | null; status: string; project_name: string | null; account_type: string | null; month: string }>
) {
  // Clear previous excel data
  await supabase.from('monthly_financials').delete().eq('company_id', companyId).eq('source', 'excel');
  await supabase.from('financial_items').delete().eq('company_id', companyId).eq('source', 'excel');

  // Insert months
  for (const m of months) {
    await supabase.from('monthly_financials').upsert({
      company_id: companyId,
      ...m,
      source: 'excel',
    }, { onConflict: 'company_id,month' });
  }

  // Insert items
  if (items.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize).map(item => ({
        company_id: companyId,
        ...item,
        source: 'excel',
      }));
      await supabase.from('financial_items').insert(batch);
    }
  }

  // Update cash_snapshot with latest balance
  const latestMonth = months.sort((a, b) => b.month.localeCompare(a.month))[0];
  if (latestMonth) {
    await supabase.from('cash_snapshot').upsert({
      company_id: companyId,
      current_balance: latestMonth.bank_balance,
      monthly_fixed_cost: latestMonth.fixed_cost,
    }, { onConflict: 'company_id' });
  }
}

// ═══════════════════════════════════════════════
// Phase 1: Bank Accounts + Routing + Sub-deals + Milestones + Assignments + Payment Queue
// ═══════════════════════════════════════════════

// ── Bank Accounts ──
export async function getBankAccounts(companyId: string) {
  const { data } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('company_id', companyId)
    .order('is_primary', { ascending: false });
  return (data || []) as BankAccount[];
}

export async function upsertBankAccount(account: {
  id?: string;
  company_id: string;
  bank_name: string;
  account_number: string;
  alias?: string;
  role: string;
  balance?: number;
  is_primary?: boolean;
}) {
  if (account.id) {
    const { error } = await supabase
      .from('bank_accounts')
      .update({
        bank_name: account.bank_name,
        account_number: account.account_number,
        alias: account.alias || null,
        role: account.role,
        balance: account.balance ?? 0,
        is_primary: account.is_primary ?? false,
      })
      .eq('id', account.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('bank_accounts')
      .insert(account);
    if (error) throw error;
  }
}

export async function deleteBankAccount(id: string) {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) throw error;
}

// ── Routing Rules ──
export async function getRoutingRules(companyId: string) {
  const { data } = await supabase
    .from('routing_rules')
    .select('*, bank_accounts(*)')
    .eq('company_id', companyId)
    .order('priority', { ascending: false });
  return data || [];
}

export async function upsertRoutingRule(rule: {
  id?: string;
  company_id: string;
  cost_type: string;
  bank_account_id: string;
  priority?: number;
}) {
  if (rule.id) {
    const { error } = await supabase
      .from('routing_rules')
      .update({
        cost_type: rule.cost_type,
        bank_account_id: rule.bank_account_id,
        priority: rule.priority ?? 0,
      })
      .eq('id', rule.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('routing_rules')
      .insert(rule);
    if (error) throw error;
  }
}

// ── Sub Deals ──
export async function getSubDeals(dealId: string) {
  const { data } = await supabase
    .from('sub_deals')
    .select('*, vendors(*), bank_accounts(*)')
    .eq('parent_deal_id', dealId)
    .order('created_at');
  return data || [];
}

// ── Deal Milestones ──
export async function getMilestones(dealId: string) {
  const { data } = await supabase
    .from('deal_milestones')
    .select('*')
    .eq('deal_id', dealId)
    .order('sort_order')
    .order('due_date');
  return (data || []) as DealMilestone[];
}

export async function upsertMilestone(milestone: {
  id?: string;
  deal_id: string;
  name: string;
  due_date: string;
  status?: string;
  sort_order?: number;
}) {
  if (milestone.id) {
    const { error } = await supabase
      .from('deal_milestones')
      .update({
        name: milestone.name,
        due_date: milestone.due_date,
        status: milestone.status,
        sort_order: milestone.sort_order,
      })
      .eq('id', milestone.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('deal_milestones')
      .insert(milestone);
    if (error) throw error;
  }
}

export async function completeMilestone(id: string, userId?: string) {
  const { data: ms } = await supabase
    .from('deal_milestones')
    .select('deal_id, name')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('deal_milestones')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;

  // Dispatch business event
  if (ms?.deal_id && userId) {
    const { dispatchBusinessEvent } = await import('./business-events');
    await dispatchBusinessEvent({
      dealId: ms.deal_id,
      eventType: 'milestone_completed',
      userId,
      referenceId: id,
      referenceTable: 'deal_milestones',
      summary: { title: ms.name },
    });
  }
}

// ── Deal Assignments ──
export async function getAssignments(dealId: string) {
  const { data } = await supabase
    .from('deal_assignments')
    .select('*, users(*)')
    .eq('deal_id', dealId)
    .eq('is_active', true)
    .order('assigned_at');
  return data || [];
}

// ── Payment Queue ──
export async function getPaymentQueue(companyId: string) {
  const { data } = await supabase
    .from('payment_queue')
    .select('*, bank_accounts(*), deal_cost_schedule(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Extended Deal Fetch with Phase 1 data ──
export async function getDealWithExtras(dealId: string) {
  const [base, subDeals, milestones, assignments] = await Promise.all([
    getDealWithNodes(dealId),
    getSubDeals(dealId),
    getMilestones(dealId),
    getAssignments(dealId),
  ]);
  return {
    ...base,
    subDeals,
    milestones,
    assignments,
  };
}

// ═══════════════════════════════════════════════
// Phase 2: Documents + Tax Invoices
// ═══════════════════════════════════════════════

// ── Doc Templates ──
export async function getDocTemplates(companyId: string) {
  const { data } = await supabase
    .from('doc_templates')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  return (data || []) as DocTemplate[];
}

// ── Documents ──
export async function getDocuments(companyId: string) {
  const { data } = await supabase
    .from('documents')
    .select('*, deals(name), doc_templates(name, type), users!documents_created_by_fkey(name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getDocument(documentId: string) {
  const { data, error } = await supabase
    .from('documents')
    .select('*, deals(name), doc_templates(name, type), users!documents_created_by_fkey(name, email)')
    .eq('id', documentId)
    .single();
  if (error || !data) return null;
  return data;
}

export async function getDocRevisions(documentId: string) {
  const { data } = await supabase
    .from('doc_revisions')
    .select('*, users(name, email)')
    .eq('document_id', documentId)
    .order('version', { ascending: false });
  return data || [];
}

export async function getDocApprovals(documentId: string) {
  const { data } = await supabase
    .from('doc_approvals')
    .select('*, users(name, email)')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Tax Invoices ──
export async function getTaxInvoices(companyId: string) {
  const { data } = await supabase
    .from('tax_invoices')
    .select('*, deals(name)')
    .eq('company_id', companyId)
    .order('issue_date', { ascending: false });
  return data || [];
}

// ═══════════════════════════════════════════════
// Phase 3: Chat
// ═══════════════════════════════════════════════

// ── Chat Channels ──
export async function getChannels(companyId: string) {
  const { data } = await supabase
    .from('chat_channels')
    .select('*, deals(name), sub_deals(name)')
    .eq('company_id', companyId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getChannel(channelId: string) {
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*, deals(name), sub_deals(name)')
    .eq('id', channelId)
    .single();
  if (error || !data) return null;
  return data;
}

export async function getChannelByDeal(dealId: string) {
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*')
    .eq('deal_id', dealId)
    .eq('is_archived', false)
    .limit(1)
    .single();
  if (error || !data) return null;
  return data;
}

// ── Chat Messages ──
export async function getMessages(channelId: string, limit = 100) {
  const { data } = await supabase
    .from('chat_messages')
    .select('*, users:sender_id(name, email)')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(limit);
  return data || [];
}

/** Paginated messages: fetches `pageSize` messages ending before `beforeCreatedAt`.
 *  Returns messages in ascending order (oldest first). */
export async function getMessagesPaginated(
  channelId: string,
  pageSize = 50,
  beforeCreatedAt?: string,
): Promise<{ data: any[]; hasMore: boolean }> {
  let query = supabase
    .from('chat_messages')
    .select('*, users:sender_id(name, email)')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1); // fetch one extra to check hasMore

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt);
  }

  const { data } = await query;
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const sliced = hasMore ? rows.slice(0, pageSize) : rows;
  // Reverse to ascending order
  sliced.reverse();
  return { data: sliced, hasMore };
}

export async function getPinnedMessages(channelId: string) {
  const { data } = await supabase
    .from('chat_messages')
    .select('*, users:sender_id(name, email)')
    .eq('channel_id', channelId)
    .eq('pinned', true)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Chat Participants ──
export async function getParticipants(channelId: string) {
  const { data } = await supabase
    .from('chat_participants')
    .select('*, users(name, email)')
    .eq('channel_id', channelId)
    .order('invited_at');
  return data || [];
}

// ── Chat Events ──
export async function getChannelEvents(channelId: string) {
  const { data } = await supabase
    .from('chat_events')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data || [];
}

// ── Search messages in a channel ──
export async function searchChannelMessages(channelId: string, query: string, limit = 50) {
  const { data } = await supabase
    .from('chat_messages')
    .select('*, users:sender_id(name, email)')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ── Unread mentions for a user ──
export async function getUnreadMentions(userId: string) {
  const { data } = await supabase
    .from('chat_mentions')
    .select('*, chat_messages(content, channel_id, sender_id, created_at, users:sender_id(name))')
    .eq('mentioned_user_id', userId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(50);
  return data || [];
}

// ── Mark mention as read ──
export async function markMentionRead(mentionId: string) {
  const { error } = await supabase
    .from('chat_mentions')
    .update({ read: true })
    .eq('id', mentionId);
  if (error) throw error;
}

// ── Reactions for a message ──
export async function getMessageReactions(messageId: string) {
  const { data } = await supabase
    .from('chat_reactions')
    .select('*, users(name)')
    .eq('message_id', messageId);
  return data || [];
}

// ── Reactions for multiple messages (batch) ──
export async function getBatchReactions(messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, any[]>();
  const { data } = await supabase
    .from('chat_reactions')
    .select('*, users(name)')
    .in('message_id', messageIds);
  const map = new Map<string, any[]>();
  (data || []).forEach((r: any) => {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id)!.push(r);
  });
  return map;
}

// ── Action cards for a channel ──
export async function getActionCards(channelId: string) {
  const { data } = await supabase
    .from('chat_action_cards')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Chat files for a channel ──
export async function getChannelFiles(channelId: string) {
  const { data } = await supabase
    .from('chat_files')
    .select('*, users:uploader_id(name, email)')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Company users for @mention dropdown ──
export async function getCompanyUsers(companyId: string) {
  const { data } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('company_id', companyId);
  return data || [];
}

// ── Unread count per channel ──
export async function getUnreadCounts(companyId: string, userId: string) {
  const { data: channels } = await supabase
    .from('chat_channels')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_archived', false);

  if (!channels || channels.length === 0) return new Map<string, number>();

  const { data: participants } = await supabase
    .from('chat_participants')
    .select('channel_id, last_read_at')
    .eq('user_id', userId);

  const readMap = new Map<string, string | null>();
  (participants || []).forEach((p: any) => readMap.set(p.channel_id, p.last_read_at));

  const counts = new Map<string, number>();
  for (const ch of channels) {
    const lastRead = readMap.get(ch.id);
    let query = supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', ch.id);
    if (lastRead) {
      query = query.gt('created_at', lastRead);
    }
    const { count } = await query;
    if (count && count > 0) counts.set(ch.id, count);
  }
  return counts;
}

// ══════════════════════════════════════════════
// Phase 4: Vault + Auto-Discovery
// ══════════════════════════════════════════════

// ── Vault Accounts (SaaS/구독) ──
export async function getVaultAccounts(companyId: string) {
  const { data } = await supabase
    .from('vault_accounts')
    .select('*, users:owner_id(name, email)')
    .eq('company_id', companyId)
    .order('monthly_cost', { ascending: false, nullsFirst: false });
  return data || [];
}

export async function createVaultAccount(params: {
  companyId: string;
  serviceName: string;
  url?: string;
  loginId?: string;
  loginPassword?: string;
  monthlyCost?: number;
  paymentMethod?: string;
  billingDay?: number;
  renewalDate?: string;
  ownerId?: string;
  notes?: string;
}) {
  // Encrypt the password server-side before storing
  const encryptedPw = params.loginPassword
    ? await encryptCredential(params.loginPassword)
    : null;

  const { data, error } = await supabase
    .from('vault_accounts')
    .insert({
      company_id: params.companyId,
      service_name: params.serviceName,
      url: params.url,
      login_id: params.loginId,
      login_password: encryptedPw ? '***encrypted***' : null,
      encrypted_password: encryptedPw,
      monthly_cost: params.monthlyCost || 0,
      payment_method: params.paymentMethod,
      billing_day: params.billingDay,
      renewal_date: params.renewalDate,
      owner_id: params.ownerId,
      notes: params.notes,
      status: 'active',
      source: 'manual',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVaultAccount(id: string, updates: Record<string, any>) {
  // If login_password is being updated, encrypt it
  if (updates.login_password && updates.login_password !== '***encrypted***') {
    const encryptedPw = await encryptCredential(updates.login_password);
    updates.encrypted_password = encryptedPw;
    updates.login_password = '***encrypted***';
  }

  const { error } = await supabase
    .from('vault_accounts')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteVaultAccount(id: string) {
  const { error } = await supabase
    .from('vault_accounts')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
}

// ── Vault Assets (유형/무형 자산) ──
export async function getVaultAssets(companyId: string) {
  const { data } = await supabase
    .from('vault_assets')
    .select('*')
    .eq('company_id', companyId)
    .order('value', { ascending: false, nullsFirst: false });
  return data || [];
}

export async function createVaultAsset(params: {
  companyId: string;
  type: string;
  name: string;
  purchaseDate?: string;
  value?: number;
  location?: string;
  notes?: string;
}) {
  const { data, error } = await supabase
    .from('vault_assets')
    .insert({
      company_id: params.companyId,
      type: params.type,
      name: params.name,
      purchase_date: params.purchaseDate,
      value: params.value || 0,
      location: params.location,
      notes: params.notes,
      status: 'in_use',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVaultAsset(id: string, updates: Record<string, any>) {
  const { error } = await supabase
    .from('vault_assets')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteVaultAsset(id: string) {
  const { error } = await supabase
    .from('vault_assets')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Vault Docs (중요 문서) ──
export async function getVaultDocs(companyId: string) {
  const { data } = await supabase
    .from('vault_docs')
    .select('*, deals:linked_deal_id(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function createVaultDoc(params: {
  companyId: string;
  category: string;
  name: string;
  fileUrl?: string;
  tags?: string[];
  linkedDealId?: string;
  expiryDate?: string;
}) {
  const { data, error } = await supabase
    .from('vault_docs')
    .insert({
      company_id: params.companyId,
      category: params.category,
      name: params.name,
      file_url: params.fileUrl,
      tags: params.tags,
      linked_deal_id: params.linkedDealId,
      expiry_date: params.expiryDate,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVaultDoc(id: string, updates: Record<string, any>) {
  const { error } = await supabase
    .from('vault_docs')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteVaultDoc(id: string) {
  const { error } = await supabase
    .from('vault_docs')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Auto-Discovery Results ──
export async function getDiscoveryResults(companyId: string) {
  const { data } = await supabase
    .from('auto_discovery_results')
    .select('*, vault_accounts:vault_account_id(service_name)')
    .eq('company_id', companyId)
    .order('estimated_monthly_cost', { ascending: false, nullsFirst: false });
  return data || [];
}

export async function getPendingDiscoveries(companyId: string) {
  const { data } = await supabase
    .from('auto_discovery_results')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('estimated_monthly_cost', { ascending: false, nullsFirst: false });
  return data || [];
}

export async function getVaultSummary(companyId: string) {
  const [accounts, assets, docs, pending] = await Promise.all([
    getVaultAccounts(companyId),
    getVaultAssets(companyId),
    getVaultDocs(companyId),
    getPendingDiscoveries(companyId),
  ]);

  const activeAccounts = accounts.filter((a: any) => a.status === 'active');
  const totalMonthlyCost = activeAccounts.reduce((sum: number, a: any) => sum + (a.monthly_cost || 0), 0);
  const totalAssetValue = assets.filter((a: any) => a.status === 'in_use').reduce((sum: number, a: any) => sum + (a.value || 0), 0);
  const expiringDocs = docs.filter((d: any) => {
    if (!d.expiry_date) return false;
    const days = (new Date(d.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days >= 0 && days <= 30;
  });

  return {
    accounts,
    assets,
    docs,
    pendingDiscoveries: pending,
    stats: {
      activeSubscriptions: activeAccounts.length,
      totalMonthlyCost,
      totalAssetValue,
      totalDocs: docs.length,
      expiringDocsCount: expiringDocs.length,
      pendingDiscoveryCount: pending.length,
    },
  };
}

// ══════════════════════════════════════════════
// Option C: Deal Classifications + Financial Dashboard
// ══════════════════════════════════════════════

// ── Deal Classifications ──
export async function getDealClassifications(companyId: string) {
  const { data } = await supabase
    .from('deal_classifications')
    .select('*')
    .eq('company_id', companyId)
    .order('sort_order');
  return (data || []) as DealClassification[];
}

export async function upsertDealClassification(params: {
  id?: string;
  companyId: string;
  name: string;
  color?: string;
  sortOrder?: number;
}) {
  if (params.id) {
    const { error } = await supabase
      .from('deal_classifications')
      .update({
        name: params.name,
        color: params.color || '#3b82f6',
        sort_order: params.sortOrder ?? 0,
      })
      .eq('id', params.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('deal_classifications')
      .insert({
        company_id: params.companyId,
        name: params.name,
        color: params.color || '#3b82f6',
        sort_order: params.sortOrder ?? 0,
        is_system: false,
      });
    if (error) throw error;
  }
}

export async function deleteDealClassification(id: string) {
  const { error } = await supabase.from('deal_classifications').delete().eq('id', id);
  if (error) throw error;
}

// ── Financial Dashboard Data ──
export async function getFinancialDashboardData(companyId: string) {
  const [mfRes, itemsRes, dealsRes, classRes] = await Promise.all([
    supabase.from('monthly_financials').select('*').eq('company_id', companyId).order('month'),
    supabase.from('financial_items').select('*').eq('company_id', companyId),
    supabase.from('deals').select('*').eq('company_id', companyId),
    supabase.from('deal_classifications').select('*').eq('company_id', companyId).order('sort_order'),
  ]);

  const allMonths = (mfRes.data || []).map((m: any) => ({
    month: m.month as string,
    revenue: Number(m.revenue || 0),
    totalIncome: Number(m.total_income || 0),
    totalExpense: Number(m.total_expense || 0),
  }));

  const items = (itemsRes.data || []).map((i: any) => ({
    id: i.id as string,
    name: i.name as string,
    category: i.category as string,
    amount: Number(i.amount || 0),
    status: (i.status || 'pending') as string,
    due_date: i.due_date as string | null,
    month: i.month as string,
    deal_id: i.deal_id as string | null,
    project_name: i.project_name as string | null,
  }));

  const deals = (dealsRes.data || []).map((d: any) => ({
    id: d.id as string,
    name: d.name as string,
    classification: (d.classification || 'B2B') as string,
    contractTotal: Number(d.contract_total || 0),
    revenue: Number(d.contract_total || 0),
    cost: 0,
    status: d.status as string | null,
  }));

  const classifications = (classRes.data || []) as DealClassification[];
  const classificationColors: Record<string, string> = {};
  classifications.forEach(c => { classificationColors[c.name] = c.color || '#3b82f6'; });

  return { allMonths, items, deals, classifications, classificationColors };
}

// ══════════════════════════════════════════════
// Phase D: 은행 거래내역 + 분류 규칙
// ══════════════════════════════════════════════

export async function getBankTransactions(companyId: string, filters?: {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
}) {
  let q = supabase
    .from('bank_transactions')
    .select('*, deals(name), bank_accounts(alias, bank_name)')
    .eq('company_id', companyId)
    .order('transaction_date', { ascending: false });

  if (filters?.status) q = q.eq('mapping_status', filters.status);
  if (filters?.type) q = q.eq('type', filters.type);
  if (filters?.dateFrom) q = q.gte('transaction_date', filters.dateFrom);
  if (filters?.dateTo) q = q.lte('transaction_date', filters.dateTo);

  const { data } = await q.limit(500);
  return data || [];
}

export async function getBankTransactionStats(companyId: string) {
  const { data } = await supabase
    .from('bank_transactions')
    .select('mapping_status, type, amount')
    .eq('company_id', companyId);

  const items = data || [];
  return {
    total: items.length,
    unmapped: items.filter(i => i.mapping_status === 'unmapped').length,
    autoMapped: items.filter(i => i.mapping_status === 'auto_mapped').length,
    manualMapped: items.filter(i => i.mapping_status === 'manual_mapped').length,
    totalIncome: items.filter(i => i.type === 'income').reduce((s, i) => s + Number(i.amount || 0), 0),
    totalExpense: items.filter(i => i.type === 'expense').reduce((s, i) => s + Number(i.amount || 0), 0),
  };
}

export async function mapBankTransaction(id: string, params: {
  dealId?: string | null;
  classification?: string | null;
  category?: string | null;
  isFixedCost?: boolean;
  mappedBy: string;
}) {
  const { error } = await supabase
    .from('bank_transactions')
    .update({
      deal_id: params.dealId ?? null,
      classification: params.classification ?? null,
      category: params.category ?? null,
      is_fixed_cost: params.isFixedCost ?? false,
      mapping_status: 'manual_mapped',
      mapped_by: params.mappedBy,
      mapped_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;

  // Rule learning: extract counterparty and learn
  const { data: tx } = await supabase
    .from('bank_transactions')
    .select('counterparty, company_id')
    .eq('id', id)
    .single();
  if (tx?.counterparty) {
    const { learnRuleFromMapping } = await import('./card-transactions');
    await learnRuleFromMapping(tx.company_id, {
      merchantName: tx.counterparty,
      category: params.category || undefined,
      classification: params.classification || undefined,
      dealId: params.dealId || undefined,
      isFixedCost: params.isFixedCost,
    });
  }
}

export async function ignoreBankTransaction(id: string) {
  const { error } = await supabase
    .from('bank_transactions')
    .update({ mapping_status: 'ignored' })
    .eq('id', id);
  if (error) throw error;
}

export async function getClassificationRules(companyId: string) {
  const { data } = await supabase
    .from('bank_classification_rules')
    .select('*, deals(name)')
    .eq('company_id', companyId)
    .order('priority', { ascending: false });
  return data || [];
}

export async function upsertClassificationRule(params: {
  id?: string;
  companyId: string;
  ruleName: string;
  matchType: string;
  matchField: string;
  matchValue: string;
  assignCategory?: string;
  assignClassification?: string;
  assignDealId?: string;
  isFixedCost?: boolean;
  priority?: number;
}) {
  const row: any = {
    company_id: params.companyId,
    rule_name: params.ruleName,
    match_type: params.matchType,
    match_field: params.matchField,
    match_value: params.matchValue,
    assign_category: params.assignCategory || null,
    assign_classification: params.assignClassification || null,
    assign_deal_id: params.assignDealId || null,
    is_fixed_cost: params.isFixedCost || false,
    priority: params.priority || 0,
  };
  if (params.id) row.id = params.id;

  const { error } = await supabase.from('bank_classification_rules').upsert(row);
  if (error) throw error;
}

export async function deleteClassificationRule(id: string) {
  const { error } = await supabase.from('bank_classification_rules').delete().eq('id', id);
  if (error) throw error;
}

// ── Drill-Down 4-Level: Month → Category → Counterparty → Ledger ──

export interface DrillLevel2Item {
  category: string;
  count: number;
  totalAmount: number;
}

export interface DrillLevel3Item {
  counterparty: string;
  count: number;
  totalAmount: number;
}

export async function getDrillDownLevel2(companyId: string, month: string): Promise<DrillLevel2Item[]> {
  // Aggregate financial_items + bank_transactions by category for a given month
  const { data: fiItems } = await supabase
    .from('financial_items')
    .select('category, amount')
    .eq('company_id', companyId)
    .eq('month', month);

  const { data: bankTx } = await supabase
    .from('bank_transactions')
    .select('category, amount, transaction_date')
    .eq('company_id', companyId)
    .gte('transaction_date', `${month}-01`)
    .lte('transaction_date', `${month}-31`);

  const groups = new Map<string, { count: number; totalAmount: number }>();

  for (const item of fiItems || []) {
    const cat = item.category || '미분류';
    const g = groups.get(cat) || { count: 0, totalAmount: 0 };
    g.count++;
    g.totalAmount += Math.abs(Number(item.amount || 0));
    groups.set(cat, g);
  }

  for (const tx of bankTx || []) {
    const cat = tx.category || '미분류';
    const g = groups.get(cat) || { count: 0, totalAmount: 0 };
    g.count++;
    g.totalAmount += Math.abs(Number(tx.amount || 0));
    groups.set(cat, g);
  }

  return Array.from(groups.entries())
    .map(([category, g]) => ({ category, ...g }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export async function getDrillDownLevel3(companyId: string, month: string, category: string): Promise<DrillLevel3Item[]> {
  const { data: bankTx } = await supabase
    .from('bank_transactions')
    .select('counterparty, amount')
    .eq('company_id', companyId)
    .eq('category', category)
    .gte('transaction_date', `${month}-01`)
    .lte('transaction_date', `${month}-31`);

  const { data: fiItems } = await supabase
    .from('financial_items')
    .select('name, amount')
    .eq('company_id', companyId)
    .eq('category', category)
    .eq('month', month);

  const groups = new Map<string, { count: number; totalAmount: number }>();

  for (const tx of bankTx || []) {
    const cp = tx.counterparty || '알 수 없음';
    const g = groups.get(cp) || { count: 0, totalAmount: 0 };
    g.count++;
    g.totalAmount += Math.abs(Number(tx.amount || 0));
    groups.set(cp, g);
  }

  for (const item of fiItems || []) {
    const cp = item.name || '알 수 없음';
    const g = groups.get(cp) || { count: 0, totalAmount: 0 };
    g.count++;
    g.totalAmount += Math.abs(Number(item.amount || 0));
    groups.set(cp, g);
  }

  return Array.from(groups.entries())
    .map(([counterparty, g]) => ({ counterparty, ...g }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export async function getDrillDownLevel4(companyId: string, month: string, category: string, counterparty: string) {
  // Full ledger items
  const { data: bankTx } = await supabase
    .from('bank_transactions')
    .select('id, transaction_date, amount, type, description, counterparty, deal_id, deals(name)')
    .eq('company_id', companyId)
    .eq('category', category)
    .eq('counterparty', counterparty)
    .gte('transaction_date', `${month}-01`)
    .lte('transaction_date', `${month}-31`)
    .order('transaction_date', { ascending: true });

  return bankTx || [];
}

// ── Deal → Invoice → Tax Invoice → Payment Matching Status ──

export interface DealMatchingStatus {
  dealId: string;
  dealName: string;
  contractTotal: number;
  invoicedAmount: number;
  taxInvoicedAmount: number;
  paidAmount: number;
  matchRate: number;
}

export async function getDealMatchingStatuses(companyId: string): Promise<DealMatchingStatus[]> {
  // Get all active deals
  const { data: deals } = await supabase
    .from('deals')
    .select('id, name, contract_total')
    .eq('company_id', companyId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (!deals?.length) return [];

  const dealIds = deals.map(d => d.id);

  // Get revenue schedule per deal (actual invoiced amounts)
  const { data: revenueSchedules } = await supabase
    .from('deal_revenue_schedule')
    .select('deal_id, amount')
    .in('deal_id', dealIds);

  // Get tax invoices per deal
  const { data: taxInvoices } = await supabase
    .from('tax_invoices')
    .select('deal_id, total_amount, type')
    .eq('company_id', companyId)
    .in('deal_id', dealIds);

  // Get bank transactions per deal (income)
  const { data: bankPayments } = await supabase
    .from('bank_transactions')
    .select('deal_id, amount, type')
    .eq('company_id', companyId)
    .eq('type', 'income')
    .in('deal_id', dealIds);

  // Aggregate revenue schedule per deal
  const revByDeal = new Map<string, number>();
  for (const rs of revenueSchedules || []) {
    if (rs.deal_id) {
      revByDeal.set(rs.deal_id, (revByDeal.get(rs.deal_id) || 0) + Number(rs.amount || 0));
    }
  }

  // Aggregate per deal
  const tiByDeal = new Map<string, number>();
  for (const ti of taxInvoices || []) {
    if (ti.deal_id && ti.type === 'sales') {
      tiByDeal.set(ti.deal_id, (tiByDeal.get(ti.deal_id) || 0) + Number(ti.total_amount || 0));
    }
  }

  const paidByDeal = new Map<string, number>();
  for (const p of bankPayments || []) {
    if (p.deal_id) {
      paidByDeal.set(p.deal_id, (paidByDeal.get(p.deal_id) || 0) + Number(p.amount || 0));
    }
  }

  return deals.map(d => {
    const ct = Number(d.contract_total || 0);
    const invoicedAmt = revByDeal.get(d.id) || ct; // Use revenue schedule sum, fallback to contract_total
    const taxAmt = tiByDeal.get(d.id) || 0;
    const paidAmt = paidByDeal.get(d.id) || 0;
    return {
      dealId: d.id,
      dealName: d.name,
      contractTotal: ct,
      invoicedAmount: invoicedAmt,
      taxInvoicedAmount: taxAmt,
      paidAmount: paidAmt,
      matchRate: ct > 0 ? Math.round((paidAmt / ct) * 100) : 0,
    };
  });
}

// ══════════════════════════════════════════════
// Phase J: Dormant Deal Management
// ══════════════════════════════════════════════

// Mark deals as dormant (30 days no activity)
export async function markDormantDeals() {
  const db = supabase as any;
  const { data, error } = await db.rpc('mark_dormant_deals');
  if (error) throw error;
  return data;
}

// Get dormant deals
export async function getDormantDeals(companyId: string) {
  const db = supabase as any;
  const { data } = await db
    .from('deals')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_dormant', true)
    .order('last_activity_at', { ascending: true });
  return data || [];
}

// Reactivate dormant deal
export async function reactivateDeal(dealId: string) {
  const db = supabase as any;
  const { error } = await db
    .from('deals')
    .update({ is_dormant: false, last_activity_at: new Date().toISOString() })
    .eq('id', dealId);
  if (error) throw error;
}

// Update deal activity timestamp
export async function touchDealActivity(dealId: string) {
  const db = supabase as any;
  const { error } = await db
    .from('deals')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', dealId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
// Cash Pulse Data (for buildCashPulse engine)
// ═══════════════════════════════════════════════
export async function getCashPulseData(companyId: string) {
  const db = supabase as any;

  const [banks, revenue, costs, recurring, employees, paymentQ, riskItems, approvalItems] = await Promise.all([
    // 1. Bank balances
    supabase.from('bank_accounts').select('balance').eq('company_id', companyId),
    // 2. Revenue schedules
    supabase.from('deal_revenue_schedule').select('amount, due_date, status, deals!inner(company_id)').eq('deals.company_id', companyId),
    // 3. Cost schedules
    db.from('deal_cost_schedule').select('amount, due_date, status, deal_nodes!inner(deal_id, deals!inner(company_id))'),
    // 4. Recurring payments
    db.from('recurring_payments').select('amount, is_active').eq('company_id', companyId),
    // 5. Employee salary total
    supabase.from('employees').select('salary').eq('company_id', companyId).eq('status', 'active'),
    // 6. Payment queue
    supabase.from('payment_queue').select('amount, status').eq('company_id', companyId),
    // 7. Risk count (financial_items with risk_label)
    supabase.from('financial_items').select('risk_label').eq('company_id', companyId).not('risk_label', 'is', null),
    // 8. Pending approvals (documents in review + payment_queue pending)
    supabase.from('documents').select('id').eq('company_id', companyId).eq('status', 'review'),
  ]);

  const employeeSalaryTotal = (employees.data || []).reduce((s: number, e: any) => s + Number(e.salary || 0), 0);

  // Calculate AR over 30 days
  const now = new Date();
  let arOver30Amount = 0;
  (revenue.data || []).forEach((r: any) => {
    if (r.status === 'scheduled' && r.due_date) {
      const overdueDays = Math.floor((now.getTime() - new Date(r.due_date).getTime()) / (1000 * 60 * 60 * 24));
      if (overdueDays > 30) arOver30Amount += Number(r.amount || 0);
    }
  });

  // Calculate matched rate from revenue schedules
  const totalRevItems = (revenue.data || []).length;
  const receivedCount = (revenue.data || []).filter((r: any) => r.status === 'received').length;
  const matchedRate = totalRevItems > 0 ? receivedCount / totalRevItems : 0;

  // Pending approvals count: documents in review + payment_queue pending
  const pendingPaymentCount = (paymentQ.data || []).filter((p: any) => p.status === 'pending').length;
  const pendingApprovalCount = (approvalItems.data || []).length + pendingPaymentCount;

  // Risk count from financial_items
  const riskCount = (riskItems.data || []).length;

  return {
    bankBalances: (banks.data || []).map((b: any) => ({ balance: Number(b.balance || 0) })),
    revenueSchedules: (revenue.data || []).map((r: any) => ({
      amount: Number(r.amount || 0),
      due_date: r.due_date || null,
      status: r.status || 'scheduled',
    })),
    costSchedules: (costs.data || []).map((c: any) => ({
      amount: Number(c.amount || 0),
      due_date: c.due_date || null,
      status: c.status || 'scheduled',
    })),
    recurringPayments: (recurring.data || []).map((r: any) => ({
      amount: Number(r.amount || 0),
      is_active: r.is_active ?? true,
    })),
    employeeSalaryTotal,
    paymentQueue: (paymentQ.data || []).map((p: any) => ({
      amount: Number(p.amount || 0),
      status: p.status || 'pending',
    })),
    riskCount,
    pendingApprovalCount,
    arOver30Amount,
    matchedRate,
  };
}

// ── Archived Deals ──
export async function getArchivedDeals(companyId: string) {
  const { data } = await supabase
    .from('deals')
    .select('*')
    .eq('company_id', companyId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  return data || [];
}
