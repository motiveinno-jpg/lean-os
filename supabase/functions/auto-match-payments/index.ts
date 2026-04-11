// supabase/functions/auto-match-payments/index.ts
// 입금 자동 매칭 Edge Function
//
// 두 가지 호출 방식을 지원:
//   1. 유저 트리거 (JWT): POST { companyId? } — 본인 회사만 실행
//   2. 크론 트리거 (Supabase Scheduled Function): 전체 회사 순회
//
// 동작:
//   - 회사별로 최근 60일 미매칭 수입 거래를 예정표와 매칭
//   - EXACT(85+점): 자동 확정
//   - REVIEW(60-84점): ai_pending_actions 큐에 등록
//   - LOW(<60점): 무시
//
// 이 함수는 src/lib/auto-match.ts 의 로직을 그대로 옮긴 것이다.
// Deno 런타임이라 ESM import 로 supabase-js 를 직접 쓴다.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Types ───────────────────────────────────────────────────

interface MatchableTransaction {
  id: string;
  company_id: string;
  transaction_date: string | null;
  amount: number;
  type: string | null;
  counterparty: string | null;
  description: string | null;
}

interface MatchableRevenueSchedule {
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

type MatchConfidence = "exact" | "review" | "low";

interface MatchResult {
  transactionId: string;
  scheduleId: string;
  scheduleKind: "revenue" | "cost";
  score: number;
  confidence: MatchConfidence;
  reasons: string[];
}

// ── Scoring ─────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[(){}\[\]주식회사㈜]/g, "")
    .toLowerCase();
}

function scoreRevenueMatch(
  tx: MatchableTransaction,
  sch: MatchableRevenueSchedule,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const txAmount = Number(tx.amount);
  const schAmount = Number(sch.amount);
  if (schAmount > 0) {
    const diff = Math.abs(txAmount - schAmount);
    if (diff < 1) {
      score += 40;
      reasons.push("금액 정확히 일치");
    } else if (diff / schAmount < 0.01) {
      score += 30;
      reasons.push("금액 1% 이내 오차");
    }
  }

  if (sch.expected_sender && tx.counterparty) {
    const sender = normalizeName(sch.expected_sender);
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

  if (sch.keyword_hint && tx.description && tx.description.includes(sch.keyword_hint)) {
    score += 15;
    reasons.push(`메모에 키워드 '${sch.keyword_hint}' 포함`);
  }

  if (sch.due_date && tx.transaction_date) {
    const dayDiff = Math.abs(
      (new Date(tx.transaction_date).getTime() -
        new Date(sch.due_date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (dayDiff <= 3) {
      score += 15;
      reasons.push("예정일 ±3일");
    } else if (dayDiff <= 7) {
      score += 10;
      reasons.push("예정일 ±1주");
    } else if (dayDiff <= 30) {
      score += 5;
      reasons.push("예정일 ±1개월");
    }
  }

  return { score, reasons };
}

function classifyScore(score: number): MatchConfidence {
  if (score >= 85) return "exact";
  if (score >= 60) return "review";
  return "low";
}

// ── Core matching ───────────────────────────────────────────

async function matchCompanyTransactions(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{
  scanned: number;
  exactMatched: number;
  sentForReview: number;
  lowScore: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: incomeTxs } = await supabase
    .from("transactions")
    .select("id, company_id, transaction_date, amount, type, counterparty, description")
    .eq("company_id", companyId)
    .eq("type", "income")
    .eq("matched", false)
    .gte("transaction_date", sinceStr)
    .order("transaction_date", { ascending: false })
    .limit(500);

  const { data: revenueSchedules } = await supabase
    .from("deal_revenue_schedule")
    .select(
      "id, deal_id, amount, due_date, status, expected_sender, expected_account, keyword_hint, label, deals!inner(company_id)",
    )
    .eq("deals.company_id", companyId)
    .is("received_at", null)
    .limit(500);

  let exactMatched = 0;
  let sentForReview = 0;
  let lowScore = 0;

  for (const tx of (incomeTxs as MatchableTransaction[]) || []) {
    const candidates: MatchResult[] = [];

    for (const sch of (revenueSchedules as unknown as MatchableRevenueSchedule[]) || []) {
      const { score, reasons } = scoreRevenueMatch(tx, sch);
      if (score >= 60) {
        candidates.push({
          transactionId: tx.id,
          scheduleId: sch.id,
          scheduleKind: "revenue",
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

    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];
    const ambiguous =
      candidates.length > 1 && candidates[1].score >= winner.score - 5;

    if (winner.confidence === "exact" && !ambiguous) {
      await supabase.from("transaction_matches").insert({
        transaction_id: tx.id,
        revenue_schedule_id: winner.scheduleId,
        match_score: winner.score,
        status: "confirmed",
      });
      await supabase
        .from("deal_revenue_schedule")
        .update({
          status: "received",
          received_at: tx.transaction_date
            ? new Date(tx.transaction_date).toISOString()
            : new Date().toISOString(),
        })
        .eq("id", winner.scheduleId);
      await supabase
        .from("transactions")
        .update({ matched: true })
        .eq("id", tx.id);
      exactMatched++;
    } else {
      const top = candidates[0];
      const summary =
        Number(tx.amount).toLocaleString("ko-KR") +
        "원 입금 — " +
        (tx.counterparty || "송금자불명") +
        ` (후보 ${candidates.length}건, 최고 ${top.score}점)`;

      await supabase.from("ai_pending_actions").insert({
        company_id: tx.company_id,
        action_type: "match_payment",
        entity_type: "transaction",
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
          candidates: candidates.slice(0, 3).map((c) => ({
            scheduleId: c.scheduleId,
            scheduleKind: c.scheduleKind,
            score: c.score,
            reasons: c.reasons,
          })),
        },
        status: "pending",
      });
      sentForReview++;
    }
  }

  return {
    scanned: (incomeTxs || []).length,
    exactMatched,
    sentForReview,
    lowScore,
  };
}

// ── HTTP handler ────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 모드 판별: 크론(서비스 키만) vs 유저(JWT)
  const authHeader = req.headers.get("Authorization");
  const cronHeader = req.headers.get("x-cron-key");
  const isCron = cronHeader && cronHeader === Deno.env.get("CRON_SECRET");

  let targetCompanyIds: string[] = [];

  if (isCron) {
    // 모든 활성 회사 순회
    const { data: companies } = await supabase
      .from("companies")
      .select("id");
    targetCompanyIds = (companies || []).map((c: { id: string }) => c.id);
  } else {
    // 유저 트리거: JWT 검증 후 본인 회사만
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const { data: profile } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", userData.user.id)
      .single();
    if (!profile?.company_id) {
      return jsonResponse({ error: "Company not found" }, 403);
    }
    targetCompanyIds = [profile.company_id];
  }

  // 실행
  const results: Record<string, unknown> = {};
  let totalExact = 0;
  let totalReview = 0;

  for (const cid of targetCompanyIds) {
    try {
      const r = await matchCompanyTransactions(supabase, cid);
      results[cid] = r;
      totalExact += r.exactMatched;
      totalReview += r.sentForReview;

      // 로그
      await supabase.from("sync_logs").insert({
        company_id: cid,
        sync_type: "auto_match_payments",
        status: "success",
        details: r,
      });
    } catch (err) {
      console.error(`auto-match failed for ${cid}:`, err);
      results[cid] = { error: (err as Error).message };
      await supabase.from("sync_logs").insert({
        company_id: cid,
        sync_type: "auto_match_payments",
        status: "error",
        details: { error: (err as Error).message },
      });
    }
  }

  return jsonResponse(
    {
      success: true,
      companies: targetCompanyIds.length,
      totalExact,
      totalReview,
      results,
    },
    200,
  );
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
