import { supabase } from './supabase';

// ── Auto-Discovery Engine ──
// 거래 내역에서 반복 결제 패턴을 감지하여 SaaS/구독 서비스를 자동 발견

export interface DiscoveredPattern {
  name: string;
  suggestedType: string;
  estimatedMonthlyCost: number;
  patternDescription: string;
  sourceTransactionIds: string[];
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

export async function analyzeTransactionPatterns(companyId: string): Promise<DiscoveredPattern[]> {
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'expense')
    .order('transaction_date', { ascending: false });

  if (!transactions || transactions.length === 0) return [];

  // Group by counterparty
  const grouped = new Map<string, typeof transactions>();
  for (const tx of transactions) {
    const key = (tx.counterparty || '').toLowerCase().trim();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(tx);
  }

  const patterns: DiscoveredPattern[] = [];

  for (const [counterparty, txs] of grouped) {
    if (txs.length < 2) continue;

    // Check for recurring pattern (similar amounts, regular intervals)
    const amounts = txs.map(t => Math.abs(Number(t.amount || 0)));
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + Math.pow(a - avgAmount, 2), 0) / amounts.length;
    const cv = avgAmount > 0 ? Math.sqrt(variance) / avgAmount : 999;

    // Low coefficient of variation = consistent amounts = likely subscription
    if (cv < 0.3 && avgAmount > 0) {
      const suggestedType = detectServiceType(counterparty);
      const displayName = txs[0].counterparty || counterparty;

      patterns.push({
        name: displayName,
        suggestedType,
        estimatedMonthlyCost: Math.round(avgAmount),
        patternDescription: `${txs.length}회 반복 결제, 평균 ₩${Math.round(avgAmount).toLocaleString()}/회`,
        sourceTransactionIds: txs.map(t => t.id),
      });
    }
  }

  return patterns.sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);
}

function detectServiceType(counterparty: string): string {
  const lower = counterparty.toLowerCase();
  for (const [keyword, type] of Object.entries(KNOWN_SAAS)) {
    if (lower.includes(keyword)) return type;
  }
  return 'subscription';
}

export async function saveDiscoveryResults(companyId: string, patterns: DiscoveredPattern[]) {
  const inserts = patterns.map(p => ({
    company_id: companyId,
    name: p.name,
    suggested_type: p.suggestedType,
    estimated_monthly_cost: p.estimatedMonthlyCost,
    pattern_description: p.patternDescription,
    source_transaction_ids: p.sourceTransactionIds,
    status: 'pending',
  }));

  if (inserts.length === 0) return [];

  const { data, error } = await supabase
    .from('auto_discovery_results')
    .insert(inserts)
    .select();

  if (error) throw error;
  return data || [];
}

export async function acceptDiscovery(discoveryId: string, companyId: string) {
  // Get discovery result
  const { data: discovery } = await supabase
    .from('auto_discovery_results')
    .select('*')
    .eq('id', discoveryId)
    .single();

  if (!discovery) throw new Error('Discovery not found');

  // Create vault account from discovery
  const { data: account, error: accountError } = await supabase
    .from('vault_accounts')
    .insert({
      company_id: companyId,
      service_name: discovery.name,
      monthly_cost: discovery.estimated_monthly_cost,
      status: 'active',
      source: 'auto_discovery',
    })
    .select()
    .single();

  if (accountError) throw accountError;

  // Update discovery as accepted
  await supabase
    .from('auto_discovery_results')
    .update({
      status: 'accepted',
      vault_account_id: account.id,
    })
    .eq('id', discoveryId);

  return account;
}

export async function dismissDiscovery(discoveryId: string) {
  const { error } = await supabase
    .from('auto_discovery_results')
    .update({ status: 'dismissed' })
    .eq('id', discoveryId);
  if (error) throw error;
}
