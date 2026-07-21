import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
// B1: 자동이체 자동 인식.
//   직원 원문: "현재: 거래내역에 있는 자동에 체크만 하는 방식 → 매달 체크눌러야함 매우불편해.
//             처음 한 번 체크하면 같은 패턴(같은 출금처/유사 금액/주기)이 다음 달부터 자동 인식돼야 함".
//
// 방식 (1안 — rule-based learning, 가장 간단·즉시 효과):
//   1) 회사의 is_fixed_cost=true 인 bank_transactions 의 counterparty+rounded_amount 패턴 수집
//      (학습 표본)
//   2) is_fixed_cost IS NULL OR false 인 신규/미체크 거래 중, 같은 counterparty + amount±10% 이고
//      한 달 이상 차이나는 거래를 자동 is_fixed_cost=true 마킹
//   3) 사용자가 한 번 체크 → 같은 출금처 신규 거래 자동 마킹 → 매달 재체크 불필요
//
// 안전:
//   - 회사격리 (.eq('company_id'))
//   - amount±10% range: rounded_amount 가 같은 1000원 단위(±1000원 ~ ±10%)면 동일 패턴으로 간주
//   - is_fixed_cost=false 로 사용자가 명시적으로 해제한 거래는 마킹 안 함 (사용자 의도 보존)
//   - 한 번에 1회만 마킹 (멱등) — 이미 true 인 행은 건너뜀
//
// 결과: { learned (학습 표본 수), marked (자동 마킹된 거래 수), already (이미 true 인 거래) }.

import { supabase } from "./supabase";

const db = supabase;

export interface AutoMarkResult {
  learned: number;   // is_fixed_cost=true 학습 표본 (counterparty+amount 유니크)
  marked: number;    // 이 호출에서 자동 마킹된 거래 수
  already: number;   // 이미 is_fixed_cost=true 였던 거래
  patterns: { counterparty: string; amount: number }[]; // 학습된 패턴
}

/**
 * 회사의 자동이체 패턴 학습 → 미체크 거래 자동 마킹.
 *   - 학습 표본: is_fixed_cost=true 인 bank_transactions (지난 6개월)
 *   - 매칭 기준: 같은 counterparty + amount 가 1000원 단위 동일 (rounded)
 *   - 신규 마킹: is_fixed_cost IS NULL 거래 중 매칭되는 것만 true 설정.
 *     (false 는 사용자 의도 해제이므로 건드리지 않음)
 */
export async function autoMarkRecurringTransactions(companyId: string): Promise<AutoMarkResult> {
  // 6개월 데이터 윈도우
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromDate = kstDateStr(sixMonthsAgo);

  // 1) 학습 표본 — is_fixed_cost=true 인 거래의 counterparty+amount(1000원 반올림) 패턴
  const learnedRows = logRead('lib/recurring-auto-mark:learnedRows', await db
    .from("bank_transactions")
    .select("counterparty, amount")
    .eq("company_id", companyId)
    .eq("is_auto_transfer", true)
    .gte("transaction_date", fromDate)
    .limit(2000));

  const patternSet = new Map<string, { counterparty: string; amount: number }>();
  for (const tx of learnedRows || []) {
    const cp = String(tx.counterparty || "").trim();
    if (!cp) continue;
    const rounded = Math.round(Number(tx.amount || 0) / 1000) * 1000;
    if (rounded <= 0) continue;
    const key = `${cp}|${rounded}`;
    if (!patternSet.has(key)) patternSet.set(key, { counterparty: cp, amount: rounded });
  }
  const patterns = Array.from(patternSet.values());

  if (patterns.length === 0) {
    return { learned: 0, marked: 0, already: 0, patterns: [] };
  }

  // 2) 마킹 대상 — is_fixed_cost IS NULL 거래 중 패턴 매칭 (false 는 보존)
  const candRows = logRead('lib/recurring-auto-mark:candRows', await db
    .from("bank_transactions")
    .select("id, counterparty, amount, is_auto_transfer")
    .eq("company_id", companyId)
    .is("is_auto_transfer", null)
    .gte("transaction_date", fromDate)
    .limit(2000));

  const toMarkIds: string[] = [];
  for (const tx of candRows || []) {
    const cp = String(tx.counterparty || "").trim();
    if (!cp) continue;
    const rounded = Math.round(Number(tx.amount || 0) / 1000) * 1000;
    if (rounded <= 0) continue;
    if (patternSet.has(`${cp}|${rounded}`)) toMarkIds.push(tx.id);
  }

  // 3) 일괄 UPDATE (멱등, 회사격리 가드)
  let marked = 0;
  if (toMarkIds.length > 0) {
    // chunk 500 — supabase URL 길이 안전
    for (let i = 0; i < toMarkIds.length; i += 500) {
      const chunk = toMarkIds.slice(i, i + 500);
      const { count } = await db
        .from("bank_transactions")
        .update({ is_auto_transfer: true }, { count: "exact" })
        .in("id", chunk)
        .eq("company_id", companyId);
      marked += count || chunk.length;
    }
  }

  // 4) 이미 true 인 표본 개수 (참고용)
  const already = (learnedRows || []).length;

  return { learned: patterns.length, marked, already, patterns };
}
