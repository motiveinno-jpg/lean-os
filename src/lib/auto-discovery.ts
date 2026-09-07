import { logRead } from "@/lib/log-read";
import { supabase } from './supabase';
import { fetchPaged } from "@/lib/fetch-paged";
import { kstDateStr } from "@/lib/kst";
import { cardTxToLite, type BankTxLite } from "./recurring-match";
import { detectRecurringCandidates, type RecurringCandidate } from "./recurring-suggest";

// ── 반복 결제 찾기 ──
//   통장 출금·카드 결제에서 "매달 비슷한 날 비슷한 금액" 을 찾아 정기 지출 등록을 권한다.
//   2026-09-07: 종전엔 `transactions`(0건짜리 옛 표)를 읽어 한 번도 결과가 없었다. 이제 실제 자료
//   (bank_transactions·card_transactions 최근 6개월)를 읽고, 판정은 lib/recurring-suggest 순수 함수가 한다.
//   통장·카드 개요의 추천과 파일보관함 › 자동 탐지가 같은 결과를 본다.

export interface DiscoveredPattern {
  name: string;
  suggestedType: string;
  estimatedMonthlyCost: number;
  patternDescription: string;
  sourceTransactionIds: string[];
  source: "bank" | "card";
  dayOfMonth: number;
  patternKey: string;
}

const KNOWN_SAAS: Record<string, string> = {
  'aws': 'cloud',
  'amazon web services': 'cloud',
  'google cloud': 'cloud',
  'microsoft azure': 'cloud',
  'vercel': 'cloud',
  'supabase': 'cloud',
  'github': 'dev_tool',
  'gitlab': 'dev_tool',
  'figma': 'design',
  'notion': 'productivity',
  'slack': 'communication',
  'zoom': 'communication',
  'adobe': 'design',
  'canva': 'design',
  'openai': 'ai',
  'anthropic': 'ai',
  'naver cloud': 'cloud',
  '카페24': 'ecommerce',
  'cafe24': 'ecommerce',
  '가비아': 'hosting',
  'gabia': 'hosting',
  '토스페이먼츠': 'payment',
  'stripe': 'payment',
};

function detectServiceType(counterparty: string): string {
  const lower = counterparty.toLowerCase();
  for (const [keyword, type] of Object.entries(KNOWN_SAAS)) {
    if (lower.includes(keyword)) return type;
  }
  return 'subscription';
}

/** 최근 n 개월의 통장 출금 + 카드 결제를 매칭용 모양으로 */
export async function loadExpenseHistory(companyId: string, months = 6): Promise<BankTxLite[]> {
  const from = new Date(); from.setMonth(from.getMonth() - months); from.setDate(1);
  const fromDate = kstDateStr(from);
  const [bank, card] = await Promise.all([
    fetchPaged<any>('lib/auto-discovery:bank', () => supabase
      .from('bank_transactions')
      .select('id, transaction_date, type, amount, counterparty, description, is_auto_transfer, bank_accounts(alias, bank_name)')
      .eq('company_id', companyId).eq('type', 'expense').gte('transaction_date', fromDate)
      .order('transaction_date', { ascending: false }).order('id'), 20000),
    fetchPaged<any>('lib/auto-discovery:card', () => supabase
      .from('card_transactions')
      .select('id, transaction_date, amount, merchant_name, memo, category, card_name, is_fixed_cost')
      .eq('company_id', companyId).gte('transaction_date', fromDate).gt('amount', 0)
      .order('transaction_date', { ascending: false }).order('id'), 20000),
  ]);
  const bankTx: BankTxLite[] = (bank || []).map((r: any) => ({ ...r, source: 'bank' as const, sourceLabel: r.bank_accounts?.alias || r.bank_accounts?.bank_name || null }));
  const cardTx: BankTxLite[] = (card || []).map(cardTxToLite);
  return [...bankTx, ...cardTx];
}

function toPattern(c: RecurringCandidate): DiscoveredPattern {
  return {
    name: c.counterparty,
    suggestedType: detectServiceType(c.counterparty),
    estimatedMonthlyCost: c.amount,
    patternDescription: `${c.count}회 반복 · 매월 ${c.dayOfMonth}일쯤 · ${c.source === 'card' ? '카드 결제' : '통장 출금'} · 마지막 ${c.lastDate}`,
    sourceTransactionIds: c.txIds,
    source: c.source,
    dayOfMonth: c.dayOfMonth,
    patternKey: c.key,
  };
}

/** 지금 자료 기준 후보 — 활성 정기 지출과 맞는 것·직접 표시한 것은 이미 빠져 있다 */
export async function analyzeTransactionPatterns(companyId: string): Promise<DiscoveredPattern[]> {
  const [history, recurring, employees] = await Promise.all([
    loadExpenseHistory(companyId, 6),
    (async () => logRead('lib/auto-discovery:recurring', await supabase.from('recurring_payments').select('id, name, recipient_name, amount, category, is_active').eq('company_id', companyId)) || [])(),
    (async () => logRead('lib/auto-discovery:employees', await supabase.from('employees').select('name').eq('company_id', companyId)) || [])(),
  ]);
  //   급여 이체는 정기 지출이 아니다 — 직원 이름과 같은 거래처는 후보에서 뺀다
  const excludeNames = (employees as any[]).map((e) => String(e.name || '')).filter(Boolean);
  return detectRecurringCandidates(history, recurring as any[], { excludeNames }).map(toPattern);
}

/** 이미 무시했거나 받아들인 후보의 키 — 다시 권하지 않는다 */
export async function loadHandledPatternKeys(companyId: string): Promise<Set<string>> {
  const rows = logRead('lib/auto-discovery:handled', await supabase
    .from('auto_discovery_results').select('pattern_key, status').eq('company_id', companyId).in('status', ['dismissed', 'accepted']));
  return new Set((rows || []).map((r: any) => String(r.pattern_key || '')).filter(Boolean));
}

/** 통장·카드 개요가 쓰는 추천 목록 — 후보에서 이미 처리한 것을 뺀 것 */
export async function listRecurringSuggestions(companyId: string): Promise<DiscoveredPattern[]> {
  const [patterns, handled] = await Promise.all([analyzeTransactionPatterns(companyId), loadHandledPatternKeys(companyId)]);
  return patterns.filter((p) => !handled.has(p.patternKey));
}

/** 파일보관함 › 자동 탐지가 쓰는 저장 — 같은 후보는 한 번만 남긴다(대기·수락·무시 어느 상태든) */
export async function saveDiscoveryResults(companyId: string, patterns: DiscoveredPattern[]) {
  const existing = logRead('lib/auto-discovery:existing', await supabase
    .from('auto_discovery_results').select('pattern_key').eq('company_id', companyId));
  const have = new Set((existing || []).map((r: any) => String(r.pattern_key || '')));
  const inserts = patterns.filter((p) => !have.has(p.patternKey)).map(p => ({
    company_id: companyId,
    name: p.name,
    suggested_type: p.suggestedType,
    estimated_monthly_cost: p.estimatedMonthlyCost,
    pattern_description: p.patternDescription,
    source_transaction_ids: p.sourceTransactionIds,
    source: p.source,
    day_of_month: p.dayOfMonth,
    pattern_key: p.patternKey,
    status: 'pending',
  }));

  if (inserts.length === 0) return [];

  const { data, error } = await supabase
    .from('auto_discovery_results')
    .insert(inserts as never)
    .select();

  if (error) throw error;
  return data || [];
}

const CATEGORY_BY_TYPE: Record<string, string> = {
  cloud: 'SaaS/클라우드',
  dev_tool: 'SaaS/개발도구',
  design: 'SaaS/디자인',
  productivity: 'SaaS/생산성',
  communication: 'SaaS/커뮤니케이션',
  ai: 'SaaS/AI',
  ecommerce: 'SaaS/이커머스',
  hosting: 'SaaS/호스팅',
  payment: 'SaaS/결제',
  subscription: 'other',
};


/** 근거가 된 줄들에 표시 — 사람이 켠 것과 같은 뜻(통장 is_auto_transfer · 카드 is_fixed_cost) */
async function markSourceTx(companyId: string, source: "bank" | "card", ids: string[]) {
  if (ids.length === 0) return;
  if (source === 'card') {
    const { error } = await supabase.from('card_transactions').update({ is_fixed_cost: true }).in('id', ids).eq('company_id', companyId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('bank_transactions').update({ is_auto_transfer: true }).in('id', ids).eq('company_id', companyId);
    if (error) throw error;
  }
}

/** 후보 하나를 정기 지출로 등록하고, 그 결제 줄들에 표시를 남긴다(다음 달부터 개요에서 나감/예정으로 보인다) */
export async function acceptRecurringSuggestion(companyId: string, p: DiscoveredPattern) {
  const category = CATEGORY_BY_TYPE[p.suggestedType] || 'other';
  const { error: rpErr } = await supabase
    .from('recurring_payments')
    .insert({
      company_id: companyId,
      name: p.name,
      recipient_name: p.name,
      amount: p.estimatedMonthlyCost,
      category,
      frequency: 'monthly',
      day_of_month: p.dayOfMonth,
      is_active: true,
    });
  if (rpErr) throw rpErr;
  await markSourceTx(companyId, p.source, p.sourceTransactionIds);
  //   처리 기록 — 같은 후보를 다시 권하지 않는다
  await supabase.from('auto_discovery_results').insert({
    company_id: companyId, name: p.name, suggested_type: p.suggestedType, estimated_monthly_cost: p.estimatedMonthlyCost,
    pattern_description: p.patternDescription, source_transaction_ids: p.sourceTransactionIds,
    source: p.source, day_of_month: p.dayOfMonth, pattern_key: p.patternKey, status: 'accepted',
  } as never);
}

/** "무시" — 이 후보는 다시 권하지 않는다 */
export async function dismissRecurringSuggestion(companyId: string, p: DiscoveredPattern) {
  const { error } = await supabase.from('auto_discovery_results').insert({
    company_id: companyId, name: p.name, suggested_type: p.suggestedType, estimated_monthly_cost: p.estimatedMonthlyCost,
    pattern_description: p.patternDescription, source_transaction_ids: p.sourceTransactionIds,
    source: p.source, day_of_month: p.dayOfMonth, pattern_key: p.patternKey, status: 'dismissed',
  } as never);
  if (error) throw error;
}

/** 파일보관함 › 자동 탐지의 '수락' — 저장된 대기 행을 받아들인다. 구독형(카드 SaaS)은 구독 목록(vault_accounts)에도 올린다. */
export async function acceptDiscovery(discoveryId: string, companyId: string) {
  const discovery = logRead('lib/auto-discovery:discovery', await supabase
    .from('auto_discovery_results')
    .select('*')
    .eq('id', discoveryId)
    .single());

  if (!discovery) throw new Error('Discovery not found');

  //   source·day_of_month·pattern_key 는 20260907150000 에서 더한 칸 — 생성 타입(src/types/database.ts)을 다시 뽑기 전까지 캐스팅
  const d = discovery as any;
  const p: DiscoveredPattern = {
    name: d.name,
    suggestedType: d.suggested_type || 'subscription',
    estimatedMonthlyCost: Number(d.estimated_monthly_cost || 0),
    patternDescription: d.pattern_description || '',
    sourceTransactionIds: d.source_transaction_ids || [],
    source: d.source === 'card' ? 'card' : 'bank',
    dayOfMonth: Number(d.day_of_month || 0) || new Date().getDate(),
    patternKey: d.pattern_key || `${d.source || 'bank'}|${String(d.name || '').toLowerCase()}`,
  };

  //   정기 지출 + 근거 줄 표시
  const category = CATEGORY_BY_TYPE[p.suggestedType] || 'other';
  if (p.estimatedMonthlyCost > 0) {
    const { error: rpErr } = await supabase.from('recurring_payments').insert({
      company_id: companyId, name: p.name, recipient_name: p.name, amount: p.estimatedMonthlyCost, category,
      frequency: 'monthly', day_of_month: p.dayOfMonth, is_active: true,
    });
    if (rpErr) throw rpErr;
  }
  await markSourceTx(companyId, p.source, p.sourceTransactionIds);

  //   구독 목록은 카드로 결제되는 SaaS 성격일 때만 — 월세·보험 같은 통장 자동이체는 '구독' 이 아니다
  let accountId: string | null = null;
  if (p.source === 'card' && p.suggestedType !== 'subscription') {
    const { data: account, error: accountError } = await supabase
      .from('vault_accounts')
      .insert({ company_id: companyId, service_name: p.name, monthly_cost: p.estimatedMonthlyCost, status: 'active', source: 'auto_discovery' })
      .select()
      .single();
    if (accountError) throw accountError;
    accountId = account?.id ?? null;
  }

  await supabase
    .from('auto_discovery_results')
    .update({ status: 'accepted', vault_account_id: accountId } as never)
    .eq('id', discoveryId);

  return accountId;
}

export async function dismissDiscovery(discoveryId: string) {
  const { error } = await supabase
    .from('auto_discovery_results')
    .update({ status: 'dismissed' })
    .eq('id', discoveryId);
  if (error) throw error;
}
