/**
 * Reflect Matching Engine
 * 거래내역 ↔ 수금/지출 스케줄 자동 매칭
 *
 * 스코어 기준:
 *  정확 금액 일치    = +50
 *  ±1% 허용         = +40
 *  송금인 유사도>0.8 = +25
 *  키워드 매치       = +15
 *  계좌 매치         = +10
 *
 *  >=90 → auto  / 70-89 → review / <70 → unmatched
 */

import type { Transaction, DealRevenueSchedule, DealCostSchedule } from '@/types/models';

export type MatchCandidate = {
  transaction_id: string;
  schedule_id: string;
  schedule_type: 'revenue' | 'cost';
  score: number;
  status: 'auto' | 'review' | 'unmatched';
  reasons: string[];
};

// ── String similarity (Dice coefficient) ──
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;

  const bigrams = (s: string) => {
    const set: string[] = [];
    for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2));
    return set;
  };
  const aBi = bigrams(a);
  const bBi = bigrams(b);
  if (aBi.length === 0 && bBi.length === 0) return 0;

  let matches = 0;
  const bCopy = [...bBi];
  for (const bi of aBi) {
    const idx = bCopy.indexOf(bi);
    if (idx >= 0) { matches++; bCopy.splice(idx, 1); }
  }
  return (2 * matches) / (aBi.length + bBi.length);
}

// ── Score a single transaction against a revenue schedule ──
function scoreRevenue(tx: Transaction, rev: DealRevenueSchedule): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const txAmt = Number(tx.amount) || 0;
  const revAmt = Number(rev.amount) || 0;

  // Amount matching
  if (txAmt > 0 && revAmt > 0) {
    if (txAmt === revAmt) {
      score += 50;
      reasons.push('정확 금액 일치 +50');
    } else if (Math.abs(txAmt - revAmt) / revAmt <= 0.01) {
      score += 40;
      reasons.push('±1% 금액 일치 +40');
    }
  }

  // Sender similarity
  if (tx.counterparty && rev.expected_sender) {
    const sim = similarity(tx.counterparty, rev.expected_sender);
    if (sim > 0.8) {
      score += 25;
      reasons.push(`송금인 유사도 ${(sim * 100).toFixed(0)}% +25`);
    }
  }

  // Keyword match
  if (rev.keyword_hint && tx.description) {
    const keywords = rev.keyword_hint.split(',').map(k => k.trim().toLowerCase());
    const desc = (tx.description || '').toLowerCase();
    const counterparty = (tx.counterparty || '').toLowerCase();
    if (keywords.some(k => k && (desc.includes(k) || counterparty.includes(k)))) {
      score += 15;
      reasons.push('키워드 매치 +15');
    }
  }

  // Account match
  if (rev.expected_account && tx.description) {
    const desc = (tx.description || '').toLowerCase();
    if (desc.includes(rev.expected_account.toLowerCase())) {
      score += 10;
      reasons.push('계좌 매치 +10');
    }
  }

  return { score, reasons };
}

// ── Score a single transaction against a cost schedule ──
function scoreCost(tx: Transaction, cost: DealCostSchedule): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const txAmt = Number(tx.amount) || 0;
  const costAmt = Number(cost.amount) || 0;

  // Amount matching
  if (txAmt > 0 && costAmt > 0) {
    if (txAmt === costAmt) {
      score += 50;
      reasons.push('정확 금액 일치 +50');
    } else if (Math.abs(txAmt - costAmt) / costAmt <= 0.01) {
      score += 40;
      reasons.push('±1% 금액 일치 +40');
    }
  }

  return { score, reasons };
}

// ── Run full matching ──
export function runMatching(
  transactions: Transaction[],
  revenues: DealRevenueSchedule[],
  costs: DealCostSchedule[],
): MatchCandidate[] {
  const results: MatchCandidate[] = [];

  // Only match unmatched transactions
  const unmatched = transactions.filter(t => !t.matched);

  for (const tx of unmatched) {
    let bestScore = 0;
    let bestCandidate: MatchCandidate | null = null;

    // Income transactions → match against revenue schedules
    if (tx.type === 'income') {
      const pendingRevs = revenues.filter(r => r.status === 'scheduled' || r.status === 'overdue');
      for (const rev of pendingRevs) {
        const { score, reasons } = scoreRevenue(tx, rev);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = {
            transaction_id: tx.id,
            schedule_id: rev.id,
            schedule_type: 'revenue',
            score,
            status: score >= 90 ? 'auto' : score >= 70 ? 'review' : 'unmatched',
            reasons,
          };
        }
      }
    }

    // Expense transactions → match against cost schedules
    if (tx.type === 'expense') {
      const pendingCosts = costs.filter(c => c.status === 'scheduled' || c.status === 'pending');
      for (const cost of pendingCosts) {
        const { score, reasons } = scoreCost(tx, cost);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = {
            transaction_id: tx.id,
            schedule_id: cost.id,
            schedule_type: 'cost',
            score,
            status: score >= 90 ? 'auto' : score >= 70 ? 'review' : 'unmatched',
            reasons,
          };
        }
      }
    }

    if (bestCandidate) {
      results.push(bestCandidate);
    } else {
      results.push({
        transaction_id: tx.id,
        schedule_id: '',
        schedule_type: 'revenue',
        score: 0,
        status: 'unmatched',
        reasons: ['매칭 대상 없음'],
      });
    }
  }

  return results;
}
