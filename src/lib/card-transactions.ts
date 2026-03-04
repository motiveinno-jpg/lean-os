/**
 * LeanOS Corporate Card Transaction Engine
 * 법인카드 거래내역 관리 + 자동분류
 */

import { supabase } from './supabase';

// ── Corporate Card CRUD ──

export async function getCorporateCards(companyId: string) {
  const { data } = await supabase
    .from('corporate_cards')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function upsertCorporateCard(params: {
  id?: string;
  companyId: string;
  cardName: string;
  cardNumber?: string;
  cardCompany: string;
  holderName?: string;
  monthlyLimit?: number;
  isActive?: boolean;
}) {
  const row: any = {
    company_id: params.companyId,
    card_name: params.cardName,
    card_number: params.cardNumber || null,
    card_company: params.cardCompany,
    holder_name: params.holderName || null,
    monthly_limit: params.monthlyLimit || 0,
    is_active: params.isActive ?? true,
  };
  if (params.id) row.id = params.id;

  const { error } = await supabase.from('corporate_cards').upsert(row);
  if (error) throw error;
}

export async function deleteCorporateCard(id: string) {
  const { error } = await supabase.from('corporate_cards').delete().eq('id', id);
  if (error) throw error;
}

// ── Card Transactions ──

export async function getCardTransactions(companyId: string, filters?: {
  cardId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  let q = supabase
    .from('card_transactions')
    .select('*, corporate_cards(card_name, card_company), deals(name), tax_invoices(counterparty_name, total_amount)')
    .eq('company_id', companyId)
    .order('transaction_date', { ascending: false });

  if (filters?.cardId) q = q.eq('card_id', filters.cardId);
  if (filters?.status) q = q.eq('mapping_status', filters.status);
  if (filters?.dateFrom) q = q.gte('transaction_date', filters.dateFrom);
  if (filters?.dateTo) q = q.lte('transaction_date', filters.dateTo);

  const { data } = await q.limit(500);
  return data || [];
}

export async function getCardTransactionStats(companyId: string) {
  const { data } = await supabase
    .from('card_transactions')
    .select('mapping_status, amount, is_deductible')
    .eq('company_id', companyId);

  const items = data || [];
  const totalSpent = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const deductible = items.filter(i => i.is_deductible).reduce((s, i) => s + Number(i.amount || 0), 0);
  const nonDeductible = totalSpent - deductible;

  return {
    total: items.length,
    unmapped: items.filter(i => i.mapping_status === 'unmapped').length,
    autoMapped: items.filter(i => i.mapping_status === 'auto_mapped').length,
    totalSpent,
    deductible,
    nonDeductible,
  };
}

export async function mapCardTransaction(id: string, params: {
  dealId?: string;
  classification?: string;
  category?: string;
  isFixedCost?: boolean;
  isDeductible?: boolean;
  mappedBy: string;
}) {
  const { error } = await supabase
    .from('card_transactions')
    .update({
      deal_id: params.dealId ?? null,
      classification: params.classification ?? null,
      category: params.category ?? null,
      is_fixed_cost: params.isFixedCost ?? false,
      is_deductible: params.isDeductible ?? true,
      mapping_status: 'manual_mapped',
      mapped_by: params.mappedBy,
      mapped_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function ignoreCardTransaction(id: string) {
  const { error } = await supabase
    .from('card_transactions')
    .update({ mapping_status: 'ignored' })
    .eq('id', id);
  if (error) throw error;
}

export async function uploadReceiptToCard(id: string, receiptUrl: string) {
  const { error } = await supabase
    .from('card_transactions')
    .update({ receipt_url: receiptUrl })
    .eq('id', id);
  if (error) throw error;
}

// ── Rule Learning: 수동 매핑에서 자동 룰 생성 ──

export async function learnRuleFromMapping(companyId: string, params: {
  merchantName: string;
  category?: string;
  classification?: string;
  dealId?: string;
  isFixedCost?: boolean;
}) {
  if (!params.merchantName) return;

  // Check if rule already exists for this merchant
  const { data: existing } = await supabase
    .from('bank_classification_rules')
    .select('id, learned_from_count')
    .eq('company_id', companyId)
    .eq('match_field', 'counterparty')
    .eq('match_type', 'contains')
    .eq('match_value', params.merchantName)
    .maybeSingle();

  if (existing) {
    // Increment learned_from_count
    await supabase
      .from('bank_classification_rules')
      .update({
        learned_from_count: (existing.learned_from_count || 0) + 1,
        last_learned_at: new Date().toISOString(),
        assign_category: params.category || null,
        assign_classification: params.classification || null,
        assign_deal_id: params.dealId || null,
        is_fixed_cost: params.isFixedCost || false,
      })
      .eq('id', existing.id);
  } else {
    // Create new auto-generated rule
    await supabase
      .from('bank_classification_rules')
      .insert({
        company_id: companyId,
        rule_name: `자동학습: ${params.merchantName}`,
        match_type: 'contains',
        match_field: 'counterparty',
        match_value: params.merchantName,
        assign_category: params.category || null,
        assign_classification: params.classification || null,
        assign_deal_id: params.dealId || null,
        is_fixed_cost: params.isFixedCost || false,
        auto_generated: true,
        learned_from_count: 1,
        last_learned_at: new Date().toISOString(),
        priority: 0,
      });
  }
}
