// 이상 거래 탐지 — Granter 의 "사기 거래 탐지" 벤치마킹
// 평소 패턴 대비 이상한 거래를 자동 감지 → 알림.
// 코드 측에서 통계 기반 (median ± 3σ, 새 가맹점, 심야 거래) 휴리스틱.

import { supabase } from "./supabase";

const db = supabase as any;

export type AnomalyType =
  | "large_amount"        // 평소 대비 큰 금액
  | "new_merchant"        // 처음 보는 거래처
  | "off_hours"           // 새벽/주말 비정상 시각
  | "duplicate_amount";   // 짧은 시간 내 동일 금액 반복

export interface Anomaly {
  id: string;             // tx id
  type: AnomalyType;
  severity: "high" | "medium" | "low";
  message: string;
  amount: number;
  date: string;
  counterparty?: string;
}

/**
 * 최근 N일 거래에서 이상 패턴 감지.
 * - 카드 거래: card_transactions
 * - 통장 거래: bank_transactions
 */
export async function detectAnomalies(companyId: string, daysBack = 7): Promise<Anomaly[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().slice(0, 10);
  const histSince = new Date();
  histSince.setDate(histSince.getDate() - 90);  // 90일 통계 기준선
  const histStr = histSince.toISOString().slice(0, 10);

  const [recentBank, recentCard, histBank] = await Promise.all([
    db.from("bank_transactions").select("id, transaction_date, amount, type, counterparty, raw_data, created_at")
      .eq("company_id", companyId)
      .gte("transaction_date", sinceStr)
      .order("transaction_date", { ascending: false })
      .limit(500),
    db.from("card_transactions").select("id, transaction_date, amount, merchant_name, transaction_time, created_at")
      .eq("company_id", companyId)
      .gte("transaction_date", sinceStr)
      .order("transaction_date", { ascending: false })
      .limit(500),
    db.from("bank_transactions").select("amount, type, counterparty")
      .eq("company_id", companyId)
      .gte("transaction_date", histStr)
      .lt("transaction_date", sinceStr)
      .limit(5000),
  ]);

  const anomalies: Anomaly[] = [];

  // 1) 통장 거래 — large_amount (출금만 검사)
  const histOutflows = (histBank.data || [])
    .filter((t: any) => t.type === "expense")
    .map((t: any) => Math.abs(Number(t.amount || 0)));
  if (histOutflows.length >= 5) {
    const sorted = [...histOutflows].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || median;
    for (const t of (recentBank.data || [])) {
      if (t.type !== "expense") continue;
      const amt = Math.abs(Number(t.amount || 0));
      if (amt > p95 * 2 && amt > 500000) {
        anomalies.push({
          id: t.id,
          type: "large_amount",
          severity: amt > p95 * 5 ? "high" : "medium",
          message: `평소 대비 큰 출금 — 90일 95퍼센타일(${(p95).toLocaleString("ko-KR")}원) 대비 ${(amt / Math.max(1, p95)).toFixed(1)}배`,
          amount: amt,
          date: t.transaction_date,
          counterparty: t.counterparty,
        });
      }
    }
  }

  // 2) 새 거래처 감지 — 90일 기록에 없는 counterparty 가 큰 금액으로 출금
  const knownCounterparties = new Set(
    (histBank.data || [])
      .map((t: any) => (t.counterparty || "").trim().toLowerCase())
      .filter(Boolean),
  );
  for (const t of (recentBank.data || [])) {
    if (t.type !== "expense") continue;
    const cp = (t.counterparty || "").trim().toLowerCase();
    if (!cp) continue;
    const amt = Math.abs(Number(t.amount || 0));
    if (!knownCounterparties.has(cp) && amt >= 200000) {
      anomalies.push({
        id: t.id,
        type: "new_merchant",
        severity: amt >= 1000000 ? "high" : "medium",
        message: `새 거래처로 출금 — 최근 90일 기록 없는 "${t.counterparty}"`,
        amount: amt,
        date: t.transaction_date,
        counterparty: t.counterparty,
      });
    }
  }

  // 3) 카드 거래 — off-hours (00:00 ~ 05:59) + 큰 금액
  for (const t of (recentCard.data || [])) {
    const time = String(t.transaction_time || "").slice(0, 5);
    if (!time) continue;
    const [hh] = time.split(":").map(Number);
    if (hh >= 0 && hh < 6) {
      const amt = Math.abs(Number(t.amount || 0));
      if (amt >= 100000) {
        anomalies.push({
          id: t.id,
          type: "off_hours",
          severity: amt >= 500000 ? "high" : "low",
          message: `심야 카드 사용 — ${time} ${t.merchant_name || "가맹점 미상"}`,
          amount: amt,
          date: t.transaction_date,
          counterparty: t.merchant_name,
        });
      }
    }
  }

  // 4) 짧은 시간 내 동일 금액 반복 (10분 이내 같은 금액 2회+)
  const cardByTime = (recentCard.data || []).map((t: any) => ({
    ...t,
    ts: new Date(`${t.transaction_date}T${(t.transaction_time || "00:00")}`).getTime(),
  })).sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < cardByTime.length - 1; i++) {
    const a = cardByTime[i];
    const b = cardByTime[i + 1];
    if (Math.abs(a.ts - b.ts) <= 10 * 60 * 1000 && Number(a.amount) === Number(b.amount) && Number(a.amount) >= 50000) {
      anomalies.push({
        id: b.id,
        type: "duplicate_amount",
        severity: "medium",
        message: `10분 내 동일 금액 ${Number(a.amount).toLocaleString("ko-KR")}원 카드 결제 2회 — 중복 결제 의심`,
        amount: Number(a.amount),
        date: b.transaction_date,
        counterparty: b.merchant_name,
      });
    }
  }

  // 중복 제거 (같은 tx id)
  const seen = new Set<string>();
  return anomalies.filter((a) => {
    const key = `${a.id}-${a.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const ANOMALY_TYPE_LABEL: Record<AnomalyType, string> = {
  large_amount: "큰 금액",
  new_merchant: "새 거래처",
  off_hours: "심야 거래",
  duplicate_amount: "중복 결제",
};
