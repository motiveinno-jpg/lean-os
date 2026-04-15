/**
 * OwnerView Cash Receipt Management
 * 현금영수증 관리 — 매출(발행) / 매입(수취) CRUD + 집계
 */

import { supabase } from './supabase';

const db = supabase as any;

export interface CashReceipt {
  id: string;
  company_id: string;
  type: 'income' | 'expense';
  amount: number;
  supply_amount: number | null;
  tax_amount: number | null;
  counterparty_name: string | null;
  counterparty_bizno: string | null;
  issue_date: string;
  approval_number: string | null;
  identity_number: string | null;
  identity_type: 'phone' | 'bizno' | 'card' | null;
  purpose: 'expenditure_proof' | 'income_deduction' | null;
  status: 'issued' | 'cancelled' | 'void';
  source: 'manual' | 'hometax_sync' | 'pos';
  deal_id: string | null;
  memo: string | null;
  created_at: string;
}

export const PURPOSE_LABELS: Record<string, string> = {
  expenditure_proof: '지출증빙',
  income_deduction: '소득공제',
};

export const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  issued: { label: '발행', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  cancelled: { label: '취소', bg: 'bg-orange-500/10', text: 'text-orange-400' },
  void: { label: '무효', bg: 'bg-red-500/10', text: 'text-red-400' },
};

const VAT_RATE = 0.1;

// ── CRUD ──

export async function getCashReceipts(companyId: string, params?: {
  type?: 'income' | 'expense';
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  let query = db.from('cash_receipts')
    .select('*')
    .eq('company_id', companyId)
    .order('issue_date', { ascending: false });

  if (params?.type) query = query.eq('type', params.type);
  if (params?.startDate) query = query.gte('issue_date', params.startDate);
  if (params?.endDate) query = query.lte('issue_date', params.endDate);
  if (params?.status) query = query.eq('status', params.status);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as CashReceipt[];
}

export async function createCashReceipt(params: {
  companyId: string;
  type: 'income' | 'expense';
  amount: number;
  counterpartyName?: string;
  counterpartyBizno?: string;
  issueDate: string;
  approvalNumber?: string;
  identityNumber?: string;
  identityType?: 'phone' | 'bizno' | 'card';
  purpose?: 'expenditure_proof' | 'income_deduction';
  dealId?: string;
  memo?: string;
}) {
  const supplyAmount = Math.round(params.amount / (1 + VAT_RATE));
  const taxAmount = params.amount - supplyAmount;

  const { data, error } = await db.from('cash_receipts').insert({
    company_id: params.companyId,
    type: params.type,
    amount: params.amount,
    supply_amount: supplyAmount,
    tax_amount: taxAmount,
    counterparty_name: params.counterpartyName || null,
    counterparty_bizno: params.counterpartyBizno || null,
    issue_date: params.issueDate,
    approval_number: params.approvalNumber || null,
    identity_number: params.identityNumber || null,
    identity_type: params.identityType || null,
    purpose: params.purpose || (params.type === 'expense' ? 'expenditure_proof' : null),
    deal_id: params.dealId || null,
    memo: params.memo || null,
    source: 'manual',
    status: 'issued',
  }).select().single();

  if (error) throw error;
  return data as CashReceipt;
}

export async function cancelCashReceipt(receiptId: string) {
  const { error } = await db.from('cash_receipts')
    .update({ status: 'cancelled' })
    .eq('id', receiptId);
  if (error) throw error;
}

// ── 집계 ──

export interface CashReceiptSummary {
  incomeCount: number;
  incomeTotal: number;
  incomeTax: number;
  expenseCount: number;
  expenseTotal: number;
  expenseTax: number;
}

export async function getCashReceiptSummary(
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<CashReceiptSummary> {
  const { data } = await db.from('cash_receipts')
    .select('type, amount, tax_amount, status')
    .eq('company_id', companyId)
    .gte('issue_date', startDate)
    .lte('issue_date', endDate)
    .neq('status', 'void');

  const result: CashReceiptSummary = {
    incomeCount: 0, incomeTotal: 0, incomeTax: 0,
    expenseCount: 0, expenseTotal: 0, expenseTax: 0,
  };

  for (const r of (data || [])) {
    if (r.type === 'income') {
      result.incomeCount++;
      result.incomeTotal += Number(r.amount || 0);
      result.incomeTax += Number(r.tax_amount || 0);
    } else {
      result.expenseCount++;
      result.expenseTotal += Number(r.amount || 0);
      result.expenseTax += Number(r.tax_amount || 0);
    }
  }

  return result;
}

// ── 엑셀 파싱 (홈택스 현금영수증 다운로드 형식) ──

export function parseHomeTaxCashReceipts(rows: any[]): {
  type: 'income' | 'expense';
  amount: number;
  counterpartyName: string;
  issueDate: string;
  approvalNumber: string;
  purpose: 'expenditure_proof' | 'income_deduction';
}[] {
  return rows.map((r: any) => ({
    type: (r['구분'] === '매출' || r['발행구분'] === '발행' ? 'income' : 'expense') as 'income' | 'expense',
    amount: Number(r['합계금액'] || r['총금액'] || r['거래금액'] || 0),
    counterpartyName: String(r['가맹점명'] || r['거래처명'] || r['상호'] || ''),
    issueDate: String(r['거래일시'] || r['발행일'] || r['거래일'] || '').slice(0, 10),
    approvalNumber: String(r['승인번호'] || ''),
    purpose: (r['용도'] === '소득공제' ? 'income_deduction' : 'expenditure_proof') as 'expenditure_proof' | 'income_deduction',
  })).filter(r => r.amount > 0);
}

// ── Bulk import ──

export async function bulkImportCashReceipts(companyId: string, items: {
  type: 'income' | 'expense';
  amount: number;
  counterpartyName?: string;
  issueDate: string;
  approvalNumber?: string;
  purpose?: 'expenditure_proof' | 'income_deduction';
}[]) {
  const rows = items.map(item => {
    const supplyAmount = Math.round(item.amount / (1 + VAT_RATE));
    return {
      company_id: companyId,
      type: item.type,
      amount: item.amount,
      supply_amount: supplyAmount,
      tax_amount: item.amount - supplyAmount,
      counterparty_name: item.counterpartyName || null,
      issue_date: item.issueDate,
      approval_number: item.approvalNumber || null,
      purpose: item.purpose || (item.type === 'expense' ? 'expenditure_proof' : null),
      source: 'manual',
      status: 'issued',
    };
  });

  const { data, error } = await db.from('cash_receipts').insert(rows).select();
  if (error) throw error;
  return data;
}
