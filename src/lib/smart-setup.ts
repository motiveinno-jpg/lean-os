import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
/**
 * OwnerView Smart Setup Engine
 * 이체내역 패턴감지 + 엑셀→고정비 자동등록 + 계약→지출결의 자동생성
 */

import { supabase } from './supabase';
import { upsertRecurringPayment } from './approval-center';

const db = supabase;

//   후보 식별 키 — **감지·중복판정·미등록 세 곳이 반드시 같은 규칙을 써야 한다.**
//   금액은 1,000원 단위로 반올림한다(통장 금액이 회차마다 몇 원씩 흔들려도 같은 건으로 묶으려고).
//   ⚠️ 이 규칙이 세 곳에서 갈리면 "등록했는데 또 뜬다 / 치웠는데 다시 뜬다"가 된다 — 실제로 그랬다(2026-08-24).
export const recurringRoundAmount = (n: unknown) => Math.round(Number(n || 0) / 1000) * 1000;
export const recurringMatchKey = (counterparty: unknown, amount: unknown) =>
  `${String(counterparty ?? '').trim()}|${recurringRoundAmount(amount)}`;

/** '정기결제 아님'으로 치운 후보 — 회사 공통(2026-08-24 사장님: "직원마다 다르게 뜸").
 *  예전엔 브라우저 localStorage 라 사람마다·PC마다 달랐다. */
export async function listRecurringDismissals(companyId: string): Promise<Set<string>> {
  if (!companyId) return new Set();
  const rows = logRead('lib/smart-setup:dismissals', await db
    .from('recurring_dismissals').select('match_key').eq('company_id', companyId));
  return new Set(((rows || []) as { match_key: string }[]).map((r) => r.match_key));
}

/** 후보를 '정기결제 아님'으로 치운다. 같은 키를 두 번 넣어도 한 줄(unique) — 조용히 무시한다. */
export async function dismissRecurringCandidate(companyId: string, matchKey: string, userId?: string | null) {
  const { error } = await db.from('recurring_dismissals')
    .upsert({ company_id: companyId, match_key: matchKey, dismissed_by: userId ?? null },
            { onConflict: 'company_id,match_key', ignoreDuplicates: true });
  if (error) throw error;
}

/** 여러 키를 한 번에 — 옛 localStorage 기록을 DB 로 옮길 때 쓴다(한 번만 돈다). */
export async function dismissRecurringCandidates(companyId: string, matchKeys: string[], userId?: string | null) {
  if (!matchKeys.length) return;
  const { error } = await db.from('recurring_dismissals')
    .upsert(matchKeys.map((k) => ({ company_id: companyId, match_key: k, dismissed_by: userId ?? null })),
            { onConflict: 'company_id,match_key', ignoreDuplicates: true });
  if (error) throw error;
}

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

  const transactions = logRead('lib/smart-setup:transactions', await db
    .from('bank_transactions')
    .select('counterparty, amount, transaction_date, description, type')
    .eq('company_id', companyId)
    .eq('type', 'expense') // 출금 = type 'expense' (DB 실제값: expense/income)
    .gte('transaction_date', kstDateStr(threeMonthsAgo))
    .order('transaction_date', { ascending: true }));

  if (!transactions?.length) return [];

  // Get existing recurring payments for dedup
  const existingRecurring = logRead('lib/smart-setup:existingRecurring', await db
    .from('recurring_payments')
    .select('name, recipient_name, amount')
    .eq('company_id', companyId)
    .eq('is_active', true));

  //   ★ 2026-08-24 사장님 지적: "등록한 건이 계속 남아있음". 원인은 **비교 대상이 어긋난 것**이었다 —
  //     등록할 때 name 에 `거래처 (분류)` 를 넣는데(아래 registerDetectedRecurring),
  //     판정은 후보의 `거래처|금액` 을 **name** 과 맞춰 봤다. 그래서 등록하는 순간 이름이 달라져
  //     `alreadyRegistered` 가 영원히 false — 후보가 사라지지 않고, 또 누르면 같은 것이 두 줄 생긴다.
  //   → 거래처가 실제로 담기는 칸(recipient_name)으로 맞춘다. 옛 방식(name=거래처)으로 등록된 줄도
  //     계속 존중하려고 name 도 같이 넣어 둔다. 금액은 감지와 같은 규칙(천원 반올림)으로 맞춘다.
  const existingSet = new Set<string>();
  for (const r of ((existingRecurring || []) as any[])) {
    if (r.recipient_name) existingSet.add(recurringMatchKey(r.recipient_name, r.amount));
    if (r.name) existingSet.add(recurringMatchKey(r.name, r.amount));
  }

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

    const alreadyRegistered = existingSet.has(recurringMatchKey(g.counterparty, g.amount));

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
