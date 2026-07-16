import { logRead } from "@/lib/log-read";
/**
 * OwnerView Corporate Card Transaction Engine
 * 법인카드 거래내역 관리 + 자동분류
 */

import { supabase } from './supabase';
import { fetchPaged } from './fetch-paged';

// ── Corporate Card CRUD ──

export async function getCorporateCards(companyId: string) {
  const data = logRead('lib/card-transactions:data', await supabase
    .from('corporate_cards')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false }));
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

  // onConflict (company_id, card_name) — 같은 회사·카드명 으로 중복 row 생성 방지.
  // id 있으면 PK match update, 없으면 (company_id, card_name) match update or insert.
  const { error } = await supabase
    .from('corporate_cards')
    .upsert(row, { onConflict: 'company_id,card_name' });
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
  const buildQ = () => {
    let q = supabase
      .from('card_transactions')
      .select('*, corporate_cards(card_name, card_company), deals(name), tax_invoices(counterparty_name, total_amount)')
      .eq('company_id', companyId)
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: false });

    if (filters?.cardId) q = q.eq('card_id', filters.cardId);
    if (filters?.cardName) q = q.eq('card_name', filters.cardName);
    if (filters?.status) q = q.eq('mapping_status', filters.status);
    if (filters?.dateFrom) q = q.gte('transaction_date', filters.dateFrom);
    if (filters?.dateTo) q = q.lte('transaction_date', filters.dateTo);
    return q;
  };
  // 기존 .limit(2000) 의도 유지 — 서버 max_rows=1000 절단을 페이징으로 복원 (prod 카드거래 2900+행)
  return fetchPaged('getCardTransactions', buildQ, 2000);
}

// CODEF sync 거래에서 사용된 카드 목록 (distinct card_name + 통계 + 사용자 별명).
// alias 가 있으면 UI 에서 우선 표시. card_name 은 항상 원본 (필터/매칭에 사용).
export async function getDistinctCardNames(companyId: string) {
  const [txs, { data: aliases }] = await Promise.all([
    // 기존 .limit(50000) 의도 — 서버 max_rows=1000 이 카드별 count/total 을 절단하던 것 페이징으로 복원
    fetchPaged('getDistinctCardNames', () => supabase
      .from('card_transactions')
      .select('card_name, amount')
      .eq('company_id', companyId)
      .not('card_name', 'is', null)
      .order('id', { ascending: true }), 50000),
    supabase
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

// ── 카드사별 사용액 집계 (granter 스타일 카드 개요) ──
// 기간 내 card_transactions 를 카드별로 합산하고 카드사(card_company)별로 묶는다.
// 등록 카드(corporate_cards)는 메타(card_company·type·번호) 사용, CODEF-only 카드는 card_name 에서 카드사·끝4자리 추론.

const CARD_COMPANY_PATTERNS: { label: string; re: RegExp }[] = [
  { label: '국민카드', re: /국민|kb/i },
  { label: '현대카드', re: /현대|hyundai/i },
  { label: '삼성카드', re: /삼성|samsung/i },
  { label: '신한카드', re: /신한|shinhan/i },
  { label: 'BC카드', re: /비씨|bc/i },
  { label: '롯데카드', re: /롯데|lotte/i },
  { label: '하나카드', re: /하나|hana/i },
  { label: '우리카드', re: /우리|woori/i },
  { label: '농협카드', re: /농협|nh\b/i },
  { label: '카카오뱅크', re: /카카오|kakao/i },
  { label: '토스', re: /토스|toss/i },
  { label: '씨티카드', re: /씨티|citi/i },
];

export function inferCardCompany(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (!n) return '기타';
  for (const p of CARD_COMPANY_PATTERNS) if (p.re.test(n)) return p.label;
  return '기타';
}

function extractLast4(cardName: string | null, cardNumber: string | null): string | null {
  const fromNum = (cardNumber || '').replace(/\D/g, '');
  if (fromNum.length >= 4) return fromNum.slice(-4);
  const m = (cardName || '').match(/(\d{4})\s*\)?\s*$/);
  return m ? m[1] : null;
}

export interface CardSpendCard {
  key: string;            // card_id ?? card_name
  cardId: string | null;
  cardName: string;       // 원본 카드명 (필터/식별용)
  displayName: string;    // 사용자 별명(card_aliases) 우선, 없으면 원본
  last4: string | null;
  cardType: string | null;
  company: string;
  spend: number;          // 기간 내 순지출(취소 반영). 양수 = 지출
  count: number;
  registered: boolean;
}
export interface CardSpendGroup { company: string; cards: CardSpendCard[]; total: number; count: number }

export async function getCardSpendByCompany(
  companyId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<{ groups: CardSpendGroup[]; total: number }> {
  const cards = await getCorporateCards(companyId);
  // 등록카드 메타: card_name → {company, type, number}, id → 동일
  const byName = new Map<string, any>();
  const byId = new Map<string, any>();
  for (const c of cards as any[]) {
    if (c.card_name) byName.set(c.card_name, c);
    if (c.id) byId.set(c.id, c);
  }

  // 사용자 별명(card_aliases) — 하단 카드별 사용액 그리드에서 설정한 이름을 상단 개요에도 반영.
  const aliasMap = new Map<string, string>();
  const aliases = logRead('lib/card-transactions:aliases', await supabase
    .from('card_aliases')
    .select('source_card_name, alias')
    .eq('company_id', companyId));
  for (const a of (aliases || [])) {
    if (a.source_card_name && a.alias) aliasMap.set(a.source_card_name, a.alias);
  }
  const displayOf = (rawName: string) => aliasMap.get(rawName) || rawName;

  // 카드별 사용액 합산 — 서버 max_rows=1000 절단 방지 페이징 (.limit(50000) 은 서버가 1000으로 하향했었음)
  const txs = await fetchPaged('getCardSpendSummary', () => {
    let q = supabase
      .from('card_transactions')
      .select('card_id, card_name, amount')
      .eq('company_id', companyId)
      .order('id', { ascending: true });
    if (dateFrom) q = q.gte('transaction_date', dateFrom);
    if (dateTo) q = q.lte('transaction_date', dateTo);
    return q;
  }, 50000);

  const map = new Map<string, CardSpendCard>();
  // 등록 카드는 거래가 없어도 0원으로 노출
  for (const c of cards as any[]) {
    const key = c.id as string;
    const rawName = c.card_name || '카드';
    map.set(key, {
      key,
      cardId: c.id,
      cardName: rawName,
      displayName: displayOf(rawName),
      last4: extractLast4(c.card_name, c.card_number),
      cardType: c.card_type || null,
      company: c.card_company || inferCardCompany(c.card_name),
      spend: 0,
      count: 0,
      registered: true,
    });
  }

  for (const tx of (txs || []) as any[]) {
    const reg = tx.card_id ? byId.get(tx.card_id) : (tx.card_name ? byName.get(tx.card_name) : null);
    const key = (tx.card_id as string) || (reg?.id as string) || (tx.card_name as string) || '미분류';
    let item = map.get(key);
    if (!item) {
      const rawName = reg?.card_name || tx.card_name || '카드 미지정';
      item = {
        key,
        cardId: tx.card_id || reg?.id || null,
        cardName: rawName,
        displayName: displayOf(rawName),
        last4: extractLast4(reg?.card_name || tx.card_name, reg?.card_number || null),
        cardType: reg?.card_type || null,
        company: reg?.card_company || inferCardCompany(tx.card_name),
        spend: 0,
        count: 0,
        registered: !!reg,
      };
      map.set(key, item);
    }
    item.spend += Number(tx.amount || 0);
    item.count += 1;
  }

  // 카드사별 그룹화
  const groupMap = new Map<string, CardSpendGroup>();
  for (const card of map.values()) {
    const g = groupMap.get(card.company) || { company: card.company, cards: [], total: 0, count: 0 };
    g.cards.push(card);
    g.total += card.spend;
    g.count += 1;
    groupMap.set(card.company, g);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => b.total - a.total);
  const total = groups.reduce((s, g) => s + g.total, 0);
  return { groups, total };
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
  const { error } = await supabase
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
  const { error } = await supabase
    .from('card_aliases')
    .delete()
    .eq('company_id', companyId)
    .eq('source_card_name', sourceCardName);
  if (error) throw error;
}

export async function getCardTransactionStats(companyId: string) {
  // 모든 거래 가져오기 — .limit(50000) 도 서버 max_rows=1000 이 하향하므로 페이징이 유일한 회피
  const items = await fetchPaged('getCardTransactionStats', () => supabase
    .from('card_transactions')
    .select('mapping_status, amount, is_deductible')
    .eq('company_id', companyId)
    .order('id', { ascending: true }), 50000);
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
  const db = supabase;
  const data = logRead('lib/card-transactions:data', await db
    .from('card_deduction_summary')
    .select('*')
    .eq('company_id', companyId));

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
  const existing = logRead('lib/card-transactions:existing', await supabase
    .from('bank_classification_rules')
    .select('id, learned_from_count')
    .eq('company_id', companyId)
    .eq('match_field', 'counterparty')
    .eq('match_type', 'contains')
    .eq('match_value', params.merchantName)
    .maybeSingle());

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
