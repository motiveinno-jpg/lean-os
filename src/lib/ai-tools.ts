/**
 * LeanOS AI Tools
 * L1: 즉시 조회 (읽기 전용)
 * L2: 로그 + 자동실행 (Solo MVP에서 자동승인)
 * L3: 승인 필수 (pending_actions 큐)
 */
import { supabase } from './supabase';
const db = supabase as any;

// ── L1: Read-only tools (immediate) ──

export async function aiSearchEntities(companyId: string, query: string) {
  // Cross-search deals, partners, documents, employees
  const results: any = { deals: [], partners: [], documents: [], employees: [] };

  const [deals, partners, docs, emps] = await Promise.all([
    supabase.from('deals').select('id, name, status, amount').eq('company_id', companyId)
      .ilike('name', `%${query}%`).limit(10),
    db.from('partners').select('id, name, type, contact_email').eq('company_id', companyId)
      .ilike('name', `%${query}%`).limit(10),
    supabase.from('documents').select('id, name, doc_type, status').eq('company_id', companyId)
      .ilike('name', `%${query}%`).limit(10),
    supabase.from('employees').select('id, name, position, department').eq('company_id', companyId)
      .ilike('name', `%${query}%`).limit(10),
  ]);

  results.deals = deals.data || [];
  results.partners = partners.data || [];
  results.documents = docs.data || [];
  results.employees = emps.data || [];

  return results;
}

export async function aiGetDashboardSummary(companyId: string) {
  const [deals, employees, expenses] = await Promise.all([
    supabase.from('deals').select('status, amount').eq('company_id', companyId),
    supabase.from('employees').select('id').eq('company_id', companyId),
    db.from('expense_requests').select('status, amount').eq('company_id', companyId),
  ]);

  const dealData = deals.data || [];
  const totalDeals = dealData.length;
  const totalAmount = dealData.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
  const activeDeals = dealData.filter((d: any) => !['closed', 'cancelled'].includes(d.status)).length;

  const expData = expenses.data || [];
  const pendingExpenses = expData.filter((e: any) => e.status === 'pending')
    .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);

  return {
    totalDeals, activeDeals, totalAmount,
    totalEmployees: (employees.data || []).length,
    pendingExpenses,
  };
}

export async function aiGetDealDetail(dealId: string) {
  const { data } = await supabase
    .from('deals')
    .select('*, sub_deals(*), deal_events(*)')
    .eq('id', dealId)
    .single();
  return data;
}

export async function aiGetFinancialSummary(companyId: string) {
  const [income, expense] = await Promise.all([
    supabase.from('bank_transactions').select('amount, category, transaction_date')
      .eq('company_id', companyId).eq('type', 'income'),
    supabase.from('bank_transactions').select('amount, category, transaction_date')
      .eq('company_id', companyId).eq('type', 'expense'),
  ]);

  const totalIncome = (income.data || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const totalExpense = (expense.data || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

  return { totalIncome, totalExpense, netIncome: totalIncome - totalExpense };
}

// ── L2: Auto-execute with logging ──

export async function aiCreateDeal(companyId: string, userId: string, params: {
  name: string; amount?: number; clientName?: string; status?: string;
}) {
  const { data, error } = await supabase
    .from('deals')
    .insert({
      company_id: companyId,
      name: params.name,
      amount: params.amount || 0,
      client_name: params.clientName || '',
      status: params.status || 'lead',
    })
    .select()
    .single();
  if (error) throw error;

  // Log interaction
  await logAiAction(companyId, userId, 'create_deal', 'deal', data.id, params);
  return data;
}

export async function aiCreateExpenseRequest(companyId: string, userId: string, params: {
  title: string; amount: number; category?: string;
}) {
  const { data, error } = await db
    .from('expense_requests')
    .insert({
      company_id: companyId,
      requester_id: userId,
      title: params.title,
      amount: params.amount,
      category: params.category || 'general',
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;

  await logAiAction(companyId, userId, 'create_expense', 'expense_request', data.id, params);
  return data;
}

// ── L3: Requires approval ──

export async function aiRequestDeletion(companyId: string, userId: string, entityType: string, entityId: string, reason: string) {
  const { data, error } = await db
    .from('ai_pending_actions')
    .insert({
      company_id: companyId,
      user_id: userId,
      action_type: 'delete',
      entity_type: entityType,
      entity_id: entityId,
      description: reason,
      payload: { entityType, entityId, action: 'delete' },
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function aiRequestFinancialUpdate(companyId: string, userId: string, entityType: string, entityId: string, updates: any, reason: string) {
  const { data, error } = await db
    .from('ai_pending_actions')
    .insert({
      company_id: companyId,
      user_id: userId,
      action_type: 'update_financials',
      entity_type: entityType,
      entity_id: entityId,
      description: reason,
      payload: { updates },
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Helpers ──

async function logAiAction(companyId: string, userId: string, actionType: string, entityType: string, entityId: string, payload: any) {
  await db.from('ai_interactions').insert({
    company_id: companyId,
    user_id: userId,
    query: `${actionType}: ${entityType}`,
    response: JSON.stringify({ entityId }),
    tool_calls: [{ action: actionType, ...payload }],
  });
}
