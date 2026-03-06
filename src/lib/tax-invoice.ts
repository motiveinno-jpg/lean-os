/**
 * Reflect Tax Invoice Engine
 * 세금계산서 생성 + 3-way matching (계약 ↔ 세금계산서 ↔ 입금)
 */

import { supabase } from './supabase';
import type { TaxInvoice } from '@/types/models';

// ── Tax invoice types ──
export const INVOICE_TYPES = [
  { value: 'sales', label: '매출 (발행)' },
  { value: 'purchase', label: '매입 (수취)' },
] as const;

export const INVOICE_STATUS = {
  draft: { label: '작성중', bg: 'bg-gray-500/10', text: 'text-gray-400' },
  issued: { label: '발행', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  received: { label: '수취', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  matched: { label: '매칭완료', bg: 'bg-green-500/10', text: 'text-green-400' },
  void: { label: '무효', bg: 'bg-red-500/10', text: 'text-red-400' },
} as const;

// ── Create tax invoice ──
export async function createTaxInvoice(params: {
  companyId: string;
  dealId?: string;
  type: 'sales' | 'purchase';
  counterpartyName: string;
  counterpartyBizno?: string;
  supplyAmount: number;
  issueDate: string;
}): Promise<TaxInvoice | null> {
  const taxAmount = Math.round(params.supplyAmount * 0.1);
  const totalAmount = params.supplyAmount + taxAmount;

  const { data, error } = await supabase
    .from('tax_invoices')
    .insert({
      company_id: params.companyId,
      deal_id: params.dealId || null,
      type: params.type,
      counterparty_name: params.counterpartyName,
      counterparty_bizno: params.counterpartyBizno || null,
      supply_amount: params.supplyAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      issue_date: params.issueDate,
      status: params.type === 'sales' ? 'issued' : 'received',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── 3-Way Match Result ──
export interface ThreeWayMatchResult {
  invoiceId: string;
  dealId: string | null;
  dealName: string | null;
  invoiceAmount: number;
  contractAmount: number;
  receivedAmount: number;
  amountMatch: boolean;      // 계약금액 = 세금계산서
  paymentMatch: boolean;     // 세금계산서 = 입금액
  fullMatch: boolean;        // 3-way 모두 일치
  gap: number;               // 차이
}

// ── 3-Way Matching: 계약 ↔ 세금계산서 ↔ 입금 ──
export async function threeWayMatch(companyId: string): Promise<ThreeWayMatchResult[]> {
  // Read matching tolerance from company settings (default 1%)
  let tolerance = 0.01;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: company } = await (supabase as any)
      .from('companies')
      .select('tax_settings')
      .eq('id', companyId)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ts = (company as any)?.tax_settings;
    if (ts?.matching_tolerance != null && ts.matching_tolerance >= 0 && ts.matching_tolerance <= 100) {
      tolerance = ts.matching_tolerance / 100;
    }
  } catch { /* use default */ }

  // Fetch all sales invoices
  const { data: invoices } = await supabase
    .from('tax_invoices')
    .select('*, deals(*)')
    .eq('company_id', companyId)
    .eq('type', 'sales')
    .neq('status', 'void');

  if (!invoices) return [];

  // Fetch received revenue
  const { data: revenues } = await supabase
    .from('deal_revenue_schedule')
    .select('*, deals!inner(company_id)')
    .eq('deals.company_id', companyId)
    .eq('status', 'received');

  const receivedByDeal = new Map<string, number>();
  (revenues || []).forEach((r: any) => {
    const dealId = r.deal_id;
    receivedByDeal.set(dealId, (receivedByDeal.get(dealId) || 0) + Number(r.amount || 0));
  });

  return invoices.map((inv: any) => {
    const deal = inv.deals;
    const contractAmount = Number(deal?.contract_total || 0);
    const invoiceAmount = Number(inv.total_amount || 0);
    const receivedAmount = receivedByDeal.get(inv.deal_id) || 0;

    const amountMatch = contractAmount > 0 && Math.abs(contractAmount - invoiceAmount) / contractAmount <= tolerance;
    const paymentMatch = invoiceAmount > 0 && Math.abs(invoiceAmount - receivedAmount) / invoiceAmount <= tolerance;
    const fullMatch = amountMatch && paymentMatch;

    return {
      invoiceId: inv.id,
      dealId: inv.deal_id,
      dealName: deal?.name || null,
      invoiceAmount,
      contractAmount,
      receivedAmount,
      amountMatch,
      paymentMatch,
      fullMatch,
      gap: invoiceAmount - receivedAmount,
    };
  });
}

// ── Mark invoice as matched ──
export async function markInvoiceMatched(invoiceId: string) {
  const { error } = await supabase
    .from('tax_invoices')
    .update({ status: 'matched' })
    .eq('id', invoiceId);
  if (error) throw error;
}

// ── Period Aggregation (월/분기/연간) ──
export type PeriodType = 'monthly' | 'quarterly' | 'annual';

export interface PeriodSummary {
  period: string; // "2026-01", "2026-Q1", "2026"
  salesCount: number;
  purchaseCount: number;
  salesSupply: number;
  salesTax: number;
  salesTotal: number;
  purchaseSupply: number;
  purchaseTax: number;
  purchaseTotal: number;
  vatPayable: number; // 매출세액 - 매입세액
}

export async function getTaxInvoiceSummary(
  companyId: string,
  year: number,
  periodType: PeriodType = 'monthly'
): Promise<PeriodSummary[]> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { data: invoices } = await supabase
    .from('tax_invoices')
    .select('type, supply_amount, tax_amount, total_amount, issue_date')
    .eq('company_id', companyId)
    .neq('status', 'void')
    .gte('issue_date', startDate)
    .lte('issue_date', endDate);

  if (!invoices || invoices.length === 0) return [];

  const buckets = new Map<string, PeriodSummary>();

  const getPeriodKey = (dateStr: string): string => {
    const d = new Date(dateStr);
    const m = d.getMonth() + 1;
    if (periodType === 'annual') return `${year}`;
    if (periodType === 'quarterly') {
      const q = Math.ceil(m / 3);
      return `${year}-Q${q}`;
    }
    return `${year}-${String(m).padStart(2, '0')}`;
  };

  invoices.forEach((inv: any) => {
    const key = getPeriodKey(inv.issue_date);
    if (!buckets.has(key)) {
      buckets.set(key, {
        period: key,
        salesCount: 0, purchaseCount: 0,
        salesSupply: 0, salesTax: 0, salesTotal: 0,
        purchaseSupply: 0, purchaseTax: 0, purchaseTotal: 0,
        vatPayable: 0,
      });
    }
    const b = buckets.get(key)!;
    const supply = Number(inv.supply_amount || 0);
    const tax = Number(inv.tax_amount || 0);
    const total = Number(inv.total_amount || 0);

    if (inv.type === 'sales') {
      b.salesCount++;
      b.salesSupply += supply;
      b.salesTax += tax;
      b.salesTotal += total;
    } else {
      b.purchaseCount++;
      b.purchaseSupply += supply;
      b.purchaseTax += tax;
      b.purchaseTotal += total;
    }
  });

  // Calculate VAT payable for each period
  buckets.forEach(b => {
    b.vatPayable = b.salesTax - b.purchaseTax;
  });

  return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period));
}

// ── VAT Preview (분기별 부가세 예측) ──
export interface VATPreview {
  quarter: string;
  salesTax: number;
  purchaseTax: number;
  cardDeduction: number;
  netVAT: number;
  dueDate: string;
}

export async function getVATPreview(companyId: string, year: number): Promise<VATPreview[]> {
  const db = supabase as any;

  // Get tax invoice summary by quarter
  const quarterly = await getTaxInvoiceSummary(companyId, year, 'quarterly');

  // Get card deduction data
  const { data: cardData } = await db
    .from('card_deduction_summary')
    .select('*')
    .eq('company_id', companyId);

  // Map card deductions to quarters
  const cardByQuarter = new Map<string, number>();
  (cardData || []).forEach((c: any) => {
    const d = new Date(c.month);
    if (d.getFullYear() !== year) return;
    const q = Math.ceil((d.getMonth() + 1) / 3);
    const key = `${year}-Q${q}`;
    cardByQuarter.set(key, (cardByQuarter.get(key) || 0) + Number(c.estimated_vat_deduction || 0));
  });

  const dueDates: Record<string, string> = {
    [`${year}-Q1`]: `${year}-04-25`,
    [`${year}-Q2`]: `${year}-07-25`,
    [`${year}-Q3`]: `${year}-10-25`,
    [`${year}-Q4`]: `${year + 1}-01-25`,
  };

  const quarters = [`${year}-Q1`, `${year}-Q2`, `${year}-Q3`, `${year}-Q4`];

  return quarters.map(q => {
    const data = quarterly.find(s => s.period === q);
    const salesTax = data?.salesTax || 0;
    const purchaseTax = data?.purchaseTax || 0;
    const cardDeduction = cardByQuarter.get(q) || 0;
    return {
      quarter: q,
      salesTax,
      purchaseTax,
      cardDeduction,
      netVAT: salesTax - purchaseTax - cardDeduction,
      dueDate: dueDates[q] || '',
    };
  });
}

// ── HomeTax Excel Import Parser ──
export function parseHomeTaxExcel(rows: any[]) {
  return rows.map((r: any) => ({
    type: (r['구분'] === '매출' || r['유형'] === '발행' ? 'sales' : 'purchase') as 'sales' | 'purchase',
    counterpartyName: String(r['거래처명'] || r['상호'] || ''),
    counterpartyBizno: String(r['사업자번호'] || r['사업자등록번호'] || ''),
    supplyAmount: Number(r['공급가액'] || r['공급가'] || 0),
    taxAmount: Number(r['세액'] || r['부가세'] || 0),
    totalAmount: Number(r['합계금액'] || r['합계'] || 0),
    issueDate: String(r['발행일'] || r['작성일자'] || ''),
  })).filter(r => r.counterpartyName && r.supplyAmount > 0);
}

// ── Bulk import tax invoices ──
export async function bulkImportTaxInvoices(companyId: string, items: {
  type: 'sales' | 'purchase';
  counterpartyName: string;
  counterpartyBizno?: string;
  supplyAmount: number;
  taxAmount?: number;
  totalAmount?: number;
  issueDate: string;
}[]) {
  const rows = items.map(item => ({
    company_id: companyId,
    type: item.type,
    counterparty_name: item.counterpartyName,
    counterparty_bizno: item.counterpartyBizno || null,
    supply_amount: item.supplyAmount,
    tax_amount: item.taxAmount || Math.round(item.supplyAmount * 0.1),
    total_amount: item.totalAmount || Math.round(item.supplyAmount * 1.1),
    issue_date: item.issueDate,
    status: item.type === 'sales' ? 'issued' : 'received',
  }));

  const { data, error } = await supabase
    .from('tax_invoices')
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}
