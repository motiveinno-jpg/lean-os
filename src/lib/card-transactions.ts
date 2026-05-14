/**
 * OwnerView Corporate Card Transaction Engine
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
  paymentDay?: number | null;
  billingDay?: number | null;
  cardType?: 'credit' | 'check' | 'debit' | 'other';
}) {
  const row: any = {
    company_id: params.companyId,
    card_name: params.cardName,
    card_number: params.cardNumber || null,
    card_company: params.cardCompany,
    holder_name: params.holderName || null,
    monthly_limit: params.monthlyLimit || 0,
    is_active: params.isActive ?? true,
    payment_day: params.paymentDay ?? null,
    billing_day: params.billingDay ?? null,
    card_type: params.cardType || 'credit',
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
  cardName?: string;  // CODEF sync 거래 필터용 (card_name 기반)
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
  if (filters?.cardName) q = q.eq('card_name', filters.cardName);
  if (filters?.status) q = q.eq('mapping_status', filters.status);
  if (filters?.dateFrom) q = q.gte('transaction_date', filters.dateFrom);
  if (filters?.dateTo) q = q.lte('transaction_date', filters.dateTo);

  const { data } = await q.limit(2000);
  return data || [];
}

// CODEF sync 거래에서 사용된 카드 목록 (distinct card_name + 통계 + 사용자 별명).
// alias 가 있으면 UI 에서 우선 표시. card_name 은 항상 원본 (필터/매칭에 사용).
export async function getDistinctCardNames(companyId: string) {
  const [{ data: txs }, { data: aliases }] = await Promise.all([
    supabase
      .from('card_transactions')
      .select('card_name, amount')
      .eq('company_id', companyId)
      .not('card_name', 'is', null)
      .limit(50000),
    (supabase as any)
      .from('card_aliases')
      .select('source_card_name, alias')
      .eq('company_id', companyId),
  ]);

  const aliasMap = new Map<string, string>();
  for (const a of (aliases || [])) {
    if (a.source_card_name && a.alias) aliasMap.set(a.source_card_name, a.alias);
  }

  const map = new Map<string, { card_name: string; alias: string | null; count: number; total: number }>();
  for (const tx of (txs || [])) {
    const name = tx.card_name || '미분류';
    const cur = map.get(name) || { card_name: name, alias: aliasMap.get(name) || null, count: 0, total: 0 };
    cur.count++;
    cur.total += Math.abs(Number(tx.amount || 0));  // 취소거래 합산 안 됨
    map.set(name, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// 카드 별명 upsert (사용자가 카드 그리드에서 별명 편집 시 호출).
export async function upsertCardAlias(params: {
  companyId: string;
  sourceCardName: string;
  alias: string;
}) {
  const trimmed = params.alias.trim();
  if (!trimmed) {
    // 빈 별명은 삭제로 간주
    return deleteCardAlias(params.companyId, params.sourceCardName);
  }
  const { error } = await (supabase as any)
    .from('card_aliases')
    .upsert(
      {
        company_id: params.companyId,
        source_card_name: params.sourceCardName,
        alias: trimmed,
      },
      { onConflict: 'company_id,source_card_name' },
    );
  if (error) throw error;
}

export async function deleteCardAlias(companyId: string, sourceCardName: string) {
  const { error } = await (supabase as any)
    .from('card_aliases')
    .delete()
    .eq('company_id', companyId)
    .eq('source_card_name', sourceCardName);
  if (error) throw error;
}

export async function getCardTransactionStats(companyId: string) {
  // 모든 거래 가져오기 (default 1000 limit 회피)
  const { data } = await supabase
    .from('card_transactions')
    .select('mapping_status, amount, is_deductible')
    .eq('company_id', companyId)
    .limit(50000);

  const items = data || [];
  // amount 음수 = 취소/환불 거래. 통계는 절댓값 기준 + 부호별 분리.
  const totalSpent = items.reduce((s, i) => s + Math.abs(Number(i.amount || 0)), 0);
  const deductible = items
    .filter(i => i.is_deductible === true)
    .reduce((s, i) => s + Math.abs(Number(i.amount || 0)), 0);
  const nonDeductible = items
    .filter(i => i.is_deductible === false)
    .reduce((s, i) => s + Math.abs(Number(i.amount || 0)), 0);
  const cancelled = items
    .filter(i => Number(i.amount || 0) < 0)
    .reduce((s, i) => s + Math.abs(Number(i.amount || 0)), 0);

  return {
    total: items.length,
    unmapped: items.filter(i => i.mapping_status === 'unmapped').length,
    autoMapped: items.filter(i => i.mapping_status === 'auto_mapped').length,
    totalSpent,
    deductible,
    nonDeductible,
    cancelled,  // 취소된 거래 합 (정보용)
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

// '무시' 또는 '매핑' 상태를 미매핑으로 되돌리기 (실수로 누른 경우)
export async function restoreCardTransaction(id: string) {
  const { error } = await supabase
    .from('card_transactions')
    .update({
      mapping_status: 'unmapped',
      deal_id: null,
      classification: null,
      mapped_at: null,
      mapped_by: null,
    })
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

// ── Toggle tax deduction ──
export async function toggleDeductible(id: string, isDeductible: boolean) {
  const { error } = await supabase
    .from('card_transactions')
    .update({ is_deductible: isDeductible })
    .eq('id', id);
  if (error) throw error;
}

// ── Card Deduction Summary by month ──
export async function getCardDeductionSummary(companyId: string, year: number) {
  const db = supabase as any;
  const { data } = await db
    .from('card_deduction_summary')
    .select('*')
    .eq('company_id', companyId);

  return (data || [])
    .filter((r: any) => new Date(r.month).getFullYear() === year)
    .map((r: any) => ({
      month: r.month,
      txCount: r.tx_count,
      totalAmount: Number(r.total_amount || 0),
      deductible: Number(r.deductible_amount || 0),
      nonDeductible: Number(r.non_deductible_amount || 0),
      estimatedVatDeduction: Number(r.estimated_vat_deduction || 0),
    }))
    .sort((a: any, b: any) => a.month.localeCompare(b.month));
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
