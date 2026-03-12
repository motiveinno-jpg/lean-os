/**
 * OwnerView Smart Setup Engine
 * 이체내역 패턴감지 + 엑셀→고정비 자동등록 + 계약→지출결의 자동생성
 */

import { supabase } from './supabase';
import { upsertRecurringPayment } from './approval-center';

const db = supabase as any;

// ── Types ──

export interface DetectedRecurring {
  counterparty: string;
  amount: number;
  occurrences: number;
  months: string[];
  confidence: 'high' | 'medium' | 'low';
  suggestedCategory: string;
  suggestedName: string;
  alreadyRegistered: boolean;
}

export interface SetupResult {
  registered: number;
  needsReview: number;
  skipped: number;
  items: DetectedRecurring[];
}

export interface ParsedExcelItem {
  name: string;
  amount: number;
  category?: string;
  recipientName?: string;
  recipientAccount?: string;
  recipientBank?: string;
  memo?: string;
}

// ── Category keyword matching ──

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  rent: ['임차', '임대', '월세', '관리비', '건물', '오피스', '사무실', '스파크플러스', '위워크', '패스트파이브'],
  insurance: ['보험', '4대보험', '국민연금', '건강보험', '고용보험', '산재보험'],
  salary: ['급여', '인건비', '월급', '상여', '보너스'],
  utility: ['전기', '수도', '가스', '통신', 'KT', 'SKT', 'LG', '인터넷', '전화'],
  subscription: ['구독', 'SaaS', '클라우드', 'AWS', 'GCP', 'Azure', 'Slack', 'Notion', 'Figma'],
  tax: ['세금', '부가세', '법인세', '원천세', '지방세'],
  accounting: ['세무', '회계', '기장', '세무사'],
  marketing: ['광고', '마케팅', 'Google', 'Facebook', 'Meta', '네이버', '카카오'],
  logistics: ['택배', '배송', '물류', '운송'],
};

function guessCategory(counterparty: string, description?: string): string {
  const text = `${counterparty} ${description || ''}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
      return category;
    }
  }
  return 'other';
}

const CATEGORY_LABELS: Record<string, string> = {
  rent: '임차료',
  insurance: '보험',
  salary: '급여',
  utility: '공과금',
  subscription: '구독/SaaS',
  tax: '세금',
  accounting: '세무/회계',
  marketing: '마케팅',
  logistics: '물류',
  other: '기타',
};

// ══════════════════════════════════════════
// 1. 이체내역에서 반복 패턴 감지
// ══════════════════════════════════════════

export async function detectRecurringFromBankTx(companyId: string): Promise<DetectedRecurring[]> {
  // Get last 3 months of outgoing bank transactions
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data: transactions } = await db
    .from('bank_transactions')
    .select('counterparty, amount, transaction_date, description, type')
    .eq('company_id', companyId)
    .eq('type', 'withdrawal')
    .gte('transaction_date', threeMonthsAgo.toISOString().split('T')[0])
    .order('transaction_date', { ascending: true });

  if (!transactions?.length) return [];

  // Get existing recurring payments for dedup
  const { data: existingRecurring } = await db
    .from('recurring_payments')
    .select('name, amount')
    .eq('company_id', companyId)
    .eq('is_active', true);

  const existingSet = new Set(
    (existingRecurring || []).map((r: any) => `${r.name}|${r.amount}`)
  );

  // Group by counterparty + amount (rounded to nearest 1000)
  const groups = new Map<string, { counterparty: string; amount: number; months: Set<string>; descriptions: string[] }>();

  for (const tx of transactions) {
    const cp = String(tx.counterparty || '').trim();
    if (!cp) continue;
    const amount = Math.round(Number(tx.amount || 0) / 1000) * 1000; // Round to nearest 1000
    if (amount <= 0) continue;

    const key = `${cp}|${amount}`;
    const month = String(tx.transaction_date || '').substring(0, 7);

    if (!groups.has(key)) {
      groups.set(key, { counterparty: cp, amount, months: new Set(), descriptions: [] });
    }
    const g = groups.get(key)!;
    g.months.add(month);
    if (tx.description) g.descriptions.push(tx.description);
  }

  // Filter: at least 2 months = recurring candidate
  const results: DetectedRecurring[] = [];

  for (const [, g] of groups) {
    if (g.months.size < 2) continue;

    const category = guessCategory(g.counterparty, g.descriptions[0]);
    const confidence: 'high' | 'medium' | 'low' =
      g.months.size >= 3 ? 'high' : g.months.size === 2 ? 'medium' : 'low';

    const alreadyRegistered = existingSet.has(`${g.counterparty}|${g.amount}`);

    results.push({
      counterparty: g.counterparty,
      amount: g.amount,
      occurrences: g.months.size,
      months: Array.from(g.months).sort(),
      confidence,
      suggestedCategory: category,
      suggestedName: `${g.counterparty} (${CATEGORY_LABELS[category] || '기타'})`,
      alreadyRegistered,
    });
  }

  // Sort by confidence (high first), then amount (desc)
  results.sort((a, b) => {
    const conf = { high: 3, medium: 2, low: 1 };
    if (conf[a.confidence] !== conf[b.confidence]) return conf[b.confidence] - conf[a.confidence];
    return b.amount - a.amount;
  });

  return results;
}

// ══════════════════════════════════════════
// 2. 감지된 패턴 → 고정비 자동등록
// ══════════════════════════════════════════

export async function registerDetectedRecurring(
  companyId: string,
  items: DetectedRecurring[]
): Promise<SetupResult> {
  let registered = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.alreadyRegistered) {
      skipped++;
      continue;
    }

    await upsertRecurringPayment({
      companyId,
      name: item.suggestedName,
      amount: item.amount,
      category: item.suggestedCategory,
      recipientName: item.counterparty,
    });

    registered++;
  }

  return {
    registered,
    needsReview: items.filter(i => i.confidence === 'low').length,
    skipped,
    items,
  };
}

// ══════════════════════════════════════════
// 3. 엑셀 파일 → recurring_payments 자동등록
// ══════════════════════════════════════════

export async function setupRecurringFromExcel(
  companyId: string,
  parsed: ParsedExcelItem[]
): Promise<SetupResult> {
  if (!parsed?.length) return { registered: 0, needsReview: 0, skipped: 0, items: [] };

  // Get existing recurring
  const { data: existing } = await db
    .from('recurring_payments')
    .select('name, amount')
    .eq('company_id', companyId);

  const existingSet = new Set(
    (existing || []).map((r: any) => `${r.name}|${r.amount}`)
  );

  let registered = 0;
  let skipped = 0;
  const items: DetectedRecurring[] = [];

  for (const item of parsed) {
    const amount = Number(item.amount || 0);
    if (amount <= 0) {
      skipped++;
      continue;
    }

    const alreadyRegistered = existingSet.has(`${item.name}|${amount}`);
    const category = item.category || guessCategory(item.name, item.memo);

    items.push({
      counterparty: item.recipientName || item.name,
      amount,
      occurrences: 1,
      months: [],
      confidence: 'medium',
      suggestedCategory: category,
      suggestedName: item.name,
      alreadyRegistered,
    });

    if (alreadyRegistered) {
      skipped++;
      continue;
    }

    await upsertRecurringPayment({
      companyId,
      name: item.name,
      amount,
      category,
      recipientName: item.recipientName,
      recipientAccount: item.recipientAccount,
      recipientBank: item.recipientBank,
    });

    registered++;
  }

  return { registered, needsReview: 0, skipped, items };
}

// ══════════════════════════════════════════
// 4. 계약서 데이터 → 지출일정 자동생성
// ══════════════════════════════════════════

export async function setupExpenseFromContract(
  companyId: string,
  dealId: string
): Promise<{ created: number; totalAmount: number }> {
  // Get deal info
  const { data: deal } = await db
    .from('deals')
    .select('id, name, contract_total, amount')
    .eq('id', dealId)
    .single();

  if (!deal) return { created: 0, totalAmount: 0 };

  const totalAmount = Number(deal.contract_total || deal.amount || 0);
  if (totalAmount <= 0) return { created: 0, totalAmount: 0 };

  // Check if cost schedule already exists
  const { data: existing } = await db
    .from('deal_cost_schedule')
    .select('id')
    .eq('deal_id', dealId);

  if (existing?.length) return { created: 0, totalAmount };

  // Create single cost schedule entry (can be split by user later)
  await db.from('deal_cost_schedule').insert({
    company_id: companyId,
    deal_id: dealId,
    label: `${deal.name} 계약금`,
    amount: totalAmount,
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: 'scheduled',
    approved: false,
  });

  return { created: 1, totalAmount };
}
