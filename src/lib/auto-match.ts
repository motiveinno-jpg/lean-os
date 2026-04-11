// src/lib/auto-match.ts
// 입금/출금 거래내역 → 수입/지출 예정표 자동 매칭 엔진
//
// 서버와 Edge Function 양쪽에서 재사용할 수 있도록 순수 함수로 구성.
// Supabase 클라이언트를 인자로 받아서 환경 독립적이다.
//
// 호출 흐름:
//   1. codef-sync 가 transactions 테이블에 신규 거래 적재
//   2. auto-match-payments Edge Function 이 matchCompanyTransactions() 호출
//   3. 점수 기반으로 EXACT(자동확정) / REVIEW(CEO 승인대기) 분류
//   4. EXACT: deal_revenue_schedule.status='received', transactions.matched=true
//   5. REVIEW: ai_pending_actions 에 등록 후 텔레그램 알림

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Supa = SupabaseClient<Database>;

// ── Match scoring ────────────────────────────────────────────

export interface MatchableTransaction {
  id: string;
  company_id: string;
  transaction_date: string | null;
  amount: number;
  type: string | null; // 'income' | 'expense'
  counterparty: string | null;
  description: string | null;
}

export interface MatchableRevenueSchedule {
  id: string;
  deal_id: string | null;
  amount: number;
  due_date: string | null;
  status: string | null;
  expected_sender: string | null;
  expected_account: string | null;
  keyword_hint: string | null;
  label: string | null;
}

export interface MatchableCostSchedule {
  id: string;
  deal_node_id: string | null;
  vendor_id: string | null;
  amount: number;
  due_date: string | null;
  status: string | null;
  company_id: string | null;
}

export type MatchConfidence = 'exact' | 'review' | 'low';

export interface MatchResult {
  transactionId: string;
  scheduleId: string;
  scheduleKind: 'revenue' | 'cost';
  score: number;
  confidence: MatchConfidence;
  reasons: string[];
}

/**
 * 거래 1건과 수입예정 1건 사이의 매칭 점수 (0-100)
 *
 * 배점:
 *   금액 일치          40점 (완전 일치) / 30점 (1% 이내 오차)
 *   송금자명 일치      30점 (공백 제거 후 부분 포함)
 *   키워드 힌트 일치   15점 (description 에 keyword_hint 포함)
 *   날짜 근접          15점 (±3일) / 10점 (±7일) / 5점 (±30일)
 */
export function scoreRevenueMatch(
  tx: MatchableTransaction,
  schedule: MatchableRevenueSchedule,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 금액
  const txAmount = Number(tx.amount);
  const schAmount = Number(schedule.amount);
  if (schAmount > 0) {
    const diff = Math.abs(txAmount - schAmount);
    const ratio = diff / schAmount;
    if (diff < 1) {
      score += 40;
      reasons.push('금액 정확히 일치');
    } else if (ratio < 0.01) {
      score += 30;
      reasons.push('금액 1% 이내 오차');
    }
  }

  // 송금자명
  if (schedule.expected_sender && tx.counterparty) {
    const sender = normalizeName(schedule.expected_sender);
    const counter = normalizeName(tx.counterparty);
    if (sender && counter) {
      if (sender === counter) {
        score += 30;
        reasons.push(`송금자 '${tx.counterparty}' 일치`);
      } else if (counter.includes(sender) || sender.includes(counter)) {
        score += 25;
        reasons.push(`송금자 '${tx.counterparty}' 부분 일치`);
      }
    }
  }

  // 키워드 힌트
  if (schedule.keyword_hint && tx.description) {
    if (tx.description.includes(schedule.keyword_hint)) {
      score += 15;
      reasons.push(`메모에 키워드 '${schedule.keyword_hint}' 포함`);
    }
  }

  // 날짜 근접도
  if (schedule.due_date && tx.transaction_date) {
    const dayDiff = Math.abs(
      (new Date(tx.transaction_date).getTime() -
        new Date(schedule.due_date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (dayDiff <= 3) {
      score += 15;
      reasons.push('예정일 ±3일');
    } else if (dayDiff <= 7) {
      score += 10;
      reasons.push('예정일 ±1주');
    } else if (dayDiff <= 30) {
      score += 5;
      reasons.push('예정일 ±1개월');
    }
  }

  return { score, reasons };
}

/**
 * 거래 1건과 지출예정 1건 사이의 매칭 점수 (간소화)
 *
 * 지출은 `vendor_id → partners.account_number` 경로로 매칭. 배점:
 *   금액 일치    50점
 *   날짜 근접    30점
 *   거래처 일치  20점 (호출자가 partner 이름을 주입)
 */
export function scoreCostMatch(
  tx: MatchableTransaction,
  schedule: MatchableCostSchedule,
  partnerName?: string | null,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const txAmount = Number(tx.amount);
  const schAmount = Number(schedule.amount);
  if (schAmount > 0) {
    const diff = Math.abs(txAmount - schAmount);
    if (diff < 1) {
      score += 50;
      reasons.push('금액 정확히 일치');
    } else if (diff / schAmount < 0.01) {
      score += 40;
      reasons.push('금액 1% 이내 오차');
    }
  }

  if (schedule.due_date && tx.transaction_date) {
    const dayDiff = Math.abs(
      (new Date(tx.transaction_date).getTime() -
        new Date(schedule.due_date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (dayDiff <= 3) {
      score += 30;
      reasons.push('지급일 ±3일');
    } else if (dayDiff <= 7) {
      score += 20;
      reasons.push('지급일 ±1주');
    } else if (dayDiff <= 30) {
      score += 10;
      reasons.push('지급일 ±1개월');
    }
  }

  if (partnerName && tx.counterparty) {
    const a = normalizeName(partnerName);
    const b = normalizeName(tx.counterparty);
    if (a && b && (a === b || a.includes(b) || b.includes(a))) {
      score += 20;
      reasons.push(`거래처 '${tx.counterparty}' 일치`);
    }
  }

  return { score, reasons };
}

export function classifyScore(score: number): MatchConfidence {
  if (score >= 85) return 'exact';
  if (score >= 60) return 'review';
  return 'low';
}

function normalizeName(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[(){}\[\]주식회사㈜\(주\)]/g, '')
    .toLowerCase();
}

// ── Database I/O ─────────────────────────────────────────────

/**
 * 특정 회사의 미매칭 거래들을 불러와서 예정표와 매칭.
 * 이미 transaction_matches 에 status='confirmed' 인 건은 제외.
 *
 * @returns 매칭 시도 결과 요약
 */
export async function matchCompanyTransactions(
  supabase: Supa,
  companyId: string,
  opts: { lookbackDays?: number; dryRun?: boolean } = {},
): Promise<{
  scanned: number;
  exactMatched: number;
  sentForReview: number;
  lowScore: number;
}> {
  const lookback = opts.lookbackDays ?? 60;
  const since = new Date();
  since.setDate(since.getDate() - lookback);
  const sinceStr = since.toISOString().slice(0, 10);

  // 1. 미매칭 수입 거래 로드
  const { data: incomeTxs, error: txErr } = await supabase
    .from('transactions')
    .select('id, company_id, transaction_date, amount, type, counterparty, description')
    .eq('company_id', companyId)
    .eq('type', 'income')
    .eq('matched', false)
    .gte('transaction_date', sinceStr)
    .order('transaction_date', { ascending: false })
    .limit(500);

  if (txErr) throw txErr;

  // 2. 오픈 수입예정 로드 (received_at IS NULL)
  const { data: revenueSchedules, error: rsErr } = await supabase
    .from('deal_revenue_schedule')
    .select(
      'id, deal_id, amount, due_date, status, expected_sender, expected_account, keyword_hint, label, deals!inner(company_id)',
    )
    .eq('deals.company_id' as never, companyId)
    .is('received_at', null)
    .limit(500);

  if (rsErr) throw rsErr;

  let exactMatched = 0;
  let sentForReview = 0;
  let lowScore = 0;

  for (const tx of incomeTxs || []) {
    const candidates: MatchResult[] = [];

    for (const sch of (revenueSchedules as unknown as MatchableRevenueSchedule[]) || []) {
      const { score, reasons } = scoreRevenueMatch(tx as MatchableTransaction, sch);
      if (score >= 60) {
        candidates.push({
          transactionId: tx.id,
          scheduleId: sch.id,
          scheduleKind: 'revenue',
          score,
          confidence: classifyScore(score),
          reasons,
        });
      }
    }

    if (candidates.length === 0) {
      lowScore++;
      continue;
    }

    // 최고 점수 선택. 동점이면 먼저 나온 것.
    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];
    const ambiguous =
      candidates.length > 1 && candidates[1].score >= winner.score - 5;

    if (winner.confidence === 'exact' && !ambiguous) {
      if (!opts.dryRun) {
        await applyExactMatch(supabase, tx as MatchableTransaction, winner);
      }
      exactMatched++;
    } else {
      if (!opts.dryRun) {
        await queueForReview(
          supabase,
          tx as MatchableTransaction,
          candidates.slice(0, 3),
        );
      }
      sentForReview++;
    }
  }

  return {
    scanned: incomeTxs?.length ?? 0,
    exactMatched,
    sentForReview,
    lowScore,
  };
}

/**
 * EXACT 매칭 적용: 3개 테이블 동시 업데이트.
 *   - transaction_matches 에 confirmed 로 insert
 *   - deal_revenue_schedule.received_at = 거래일
 *   - transactions.matched = true
 */
async function applyExactMatch(
  supabase: Supa,
  tx: MatchableTransaction,
  result: MatchResult,
): Promise<void> {
  // insert match record
  await supabase.from('transaction_matches').insert({
    transaction_id: tx.id,
    revenue_schedule_id:
      result.scheduleKind === 'revenue' ? result.scheduleId : null,
    cost_schedule_id:
      result.scheduleKind === 'cost' ? result.scheduleId : null,
    match_score: result.score,
    status: 'confirmed',
  } as never);

  // mark revenue schedule as received
  if (result.scheduleKind === 'revenue') {
    await supabase
      .from('deal_revenue_schedule')
      .update({
        status: 'received',
        received_at: tx.transaction_date
          ? new Date(tx.transaction_date).toISOString()
          : new Date().toISOString(),
      } as never)
      .eq('id', result.scheduleId);
  }

  // mark transaction as matched
  await supabase
    .from('transactions')
    .update({ matched: true } as never)
    .eq('id', tx.id);
}

/**
 * REVIEW 큐에 등록: ai_pending_actions 에 insert.
 * UI 에서 승인/거절 가능하게 후보 리스트를 payload 에 저장.
 */
async function queueForReview(
  supabase: Supa,
  tx: MatchableTransaction,
  candidates: MatchResult[],
): Promise<void> {
  const top = candidates[0];
  const summary =
    tx.amount.toLocaleString('ko-KR') +
    '원 입금 — ' +
    (tx.counterparty || '송금자불명') +
    ' (매칭 후보 ' +
    candidates.length +
    '건, 최고 ' +
    top.score +
    '점)';

  await supabase.from('ai_pending_actions').insert({
    company_id: tx.company_id,
    action_type: 'match_payment',
    entity_type: 'transaction',
    entity_id: tx.id,
    description: summary,
    payload: {
      transaction: {
        id: tx.id,
        amount: tx.amount,
        counterparty: tx.counterparty,
        date: tx.transaction_date,
        description: tx.description,
      },
      candidates: candidates.map((c) => ({
        scheduleId: c.scheduleId,
        scheduleKind: c.scheduleKind,
        score: c.score,
        reasons: c.reasons,
      })),
    },
    status: 'pending',
  } as never);
}

/**
 * 리뷰 큐에서 특정 후보 승인 → EXACT 매칭 적용
 */
export async function approveMatchFromReview(
  supabase: Supa,
  actionId: string,
  chosenCandidateIdx: number,
  approverId: string,
): Promise<void> {
  const { data: action } = await supabase
    .from('ai_pending_actions')
    .select('*')
    .eq('id', actionId)
    .single();

  if (!action) throw new Error('Review action not found');
  const payload = action.payload as unknown as {
    transaction: MatchableTransaction;
    candidates: Array<{
      scheduleId: string;
      scheduleKind: 'revenue' | 'cost';
      score: number;
      reasons: string[];
    }>;
  };

  const chosen = payload.candidates[chosenCandidateIdx];
  if (!chosen) throw new Error('Candidate index out of range');

  await applyExactMatch(supabase, payload.transaction, {
    transactionId: payload.transaction.id,
    scheduleId: chosen.scheduleId,
    scheduleKind: chosen.scheduleKind,
    score: chosen.score,
    confidence: 'exact',
    reasons: chosen.reasons,
  });

  await supabase
    .from('ai_pending_actions')
    .update({
      status: 'approved',
      approved_by: approverId,
      decided_at: new Date().toISOString(),
    } as never)
    .eq('id', actionId);
}

export async function rejectMatchFromReview(
  supabase: Supa,
  actionId: string,
  approverId: string,
): Promise<void> {
  await supabase
    .from('ai_pending_actions')
    .update({
      status: 'rejected',
      approved_by: approverId,
      decided_at: new Date().toISOString(),
    } as never)
    .eq('id', actionId);
}
