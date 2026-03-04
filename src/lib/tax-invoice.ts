/**
 * LeanOS Tax Invoice Engine
 * 세금계산서 생성 + 3-way matching (계약 ↔ 세금계산서 ↔ 입금)
 */

import { supabase } from './supabase';
import type { TaxInvoice } from '@/types/database';

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

    const amountMatch = contractAmount > 0 && Math.abs(contractAmount - invoiceAmount) / contractAmount <= 0.01;
    const paymentMatch = invoiceAmount > 0 && Math.abs(invoiceAmount - receivedAmount) / invoiceAmount <= 0.01;
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
