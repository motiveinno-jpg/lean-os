"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { runMatching, type MatchCandidate } from "@/lib/matching";
import { threeWayMatch, markInvoiceMatched, type ThreeWayMatchResult } from "@/lib/tax-invoice";
import { onRevenueReceived } from "@/lib/deal-pipeline";

type MainTab = "transaction" | "threeway";
type Tab = "auto" | "review" | "unmatched";

export default function MatchingPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("transaction");
  const [tab, setTab] = useState<Tab>("review");
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [running, setRunning] = useState(false);
  const [threeWayResults, setThreeWayResults] = useState<ThreeWayMatchResult[]>([]);
  const [threeWayRunning, setThreeWayRunning] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => u && setCompanyId(u.company_id));
  }, []);

  const { data: transactions = [] } = useQuery({
    queryKey: ["match-transactions", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .eq("company_id", companyId!)
        .order("transaction_date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: revenues = [] } = useQuery({
    queryKey: ["match-revenues", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("deal_revenue_schedule")
        .select("*, deals!inner(company_id)")
        .eq("deals.company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["match-costs", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("deal_cost_schedule")
        .select("*, deal_nodes!inner(deal_id, deals!inner(company_id))");
      return data || [];
    },
    enabled: !!companyId,
  });

  async function executeMatching() {
    setRunning(true);
    try {
      // Read matching tolerance from company settings
      let tolerance = 0.01;
      if (companyId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: co } = await (supabase as any).from("companies").select("tax_settings").eq("id", companyId).single();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ts = (co as any)?.tax_settings;
          if (ts?.matching_tolerance != null && Number(ts.matching_tolerance) >= 0) {
            tolerance = Number(ts.matching_tolerance) / 100;
          }
        } catch { /* use default */ }
      }
      const matchResults = runMatching(transactions, revenues, costs, { tolerance });
      setResults(matchResults);

      const autoMatches = matchResults.filter((m) => m.status === "auto" && m.schedule_id);
      for (const match of autoMatches) {
        await supabase.from("transaction_matches").insert({
          transaction_id: match.transaction_id,
          revenue_schedule_id: match.schedule_type === "revenue" ? match.schedule_id : null,
          cost_schedule_id: match.schedule_type === "cost" ? match.schedule_id : null,
          match_score: match.score,
          status: "auto",
        });

        await supabase
          .from("transactions")
          .update({ matched: true })
          .eq("id", match.transaction_id);

        if (match.schedule_type === "revenue") {
          await supabase
            .from("deal_revenue_schedule")
            .update({ status: "received", received_at: new Date().toISOString() })
            .eq("id", match.schedule_id);

          // Trigger deal completion check
          const rev = revMap.get(match.schedule_id);
          if (rev && rev.deal_id && companyId) {
            try {
              await onRevenueReceived({
                dealId: rev.deal_id,
                companyId,
                amount: Number(rev.amount || 0),
                userId: "system",
                revenueScheduleId: match.schedule_id,
              });
            } catch { /* non-blocking */ }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["match-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["match-revenues"] });
    } finally {
      setRunning(false);
    }
  }

  async function confirmMatch(match: MatchCandidate) {
    await supabase.from("transaction_matches").insert({
      transaction_id: match.transaction_id,
      revenue_schedule_id: match.schedule_type === "revenue" ? match.schedule_id : null,
      cost_schedule_id: match.schedule_type === "cost" ? match.schedule_id : null,
      match_score: match.score,
      status: "auto",
    });

    await supabase
      .from("transactions")
      .update({ matched: true })
      .eq("id", match.transaction_id);

    if (match.schedule_type === "revenue") {
      await supabase
        .from("deal_revenue_schedule")
        .update({ status: "received", received_at: new Date().toISOString() })
        .eq("id", match.schedule_id);

      // Trigger deal completion check
      const rev = revMap.get(match.schedule_id);
      if (rev && rev.deal_id && companyId) {
        try {
          await onRevenueReceived({
            dealId: rev.deal_id,
            companyId,
            amount: Number(rev.amount || 0),
            userId: "system",
            revenueScheduleId: match.schedule_id,
          });
        } catch { /* non-blocking */ }
      }
    }

    setResults((prev) =>
      prev.map((r) =>
        r.transaction_id === match.transaction_id ? { ...r, status: "auto" as const } : r
      )
    );
    queryClient.invalidateQueries({ queryKey: ["match-transactions"] });
  }

  async function rejectMatch(match: MatchCandidate) {
    setResults((prev) =>
      prev.map((r) =>
        r.transaction_id === match.transaction_id
          ? { ...r, status: "unmatched" as const }
          : r
      )
    );
  }

  // ── 3-Way Matching ──
  async function executeThreeWay() {
    if (!companyId) return;
    setThreeWayRunning(true);
    try {
      const results = await threeWayMatch(companyId);
      setThreeWayResults(results);
    } finally {
      setThreeWayRunning(false);
    }
  }

  async function handleMarkMatched(invoiceId: string) {
    await markInvoiceMatched(invoiceId);
    setThreeWayResults((prev) =>
      prev.map((r) => r.invoiceId === invoiceId ? { ...r, fullMatch: true } : r)
    );
  }

  const filtered = results.filter((r) => r.status === tab);
  const autoCount = results.filter((r) => r.status === "auto").length;
  const reviewCount = results.filter((r) => r.status === "review").length;
  const unmatchedCount = results.filter((r) => r.status === "unmatched").length;

  const txMap = new Map(transactions.map((t) => [t.id, t]));
  const revMap = new Map(revenues.map((r) => [r.id, r]));
  const costMap = new Map(costs.map((c) => [c.id, c]));

  const fullMatchCount = threeWayResults.filter(r => r.fullMatch).length;
  const partialCount = threeWayResults.filter(r => !r.fullMatch && (r.amountMatch || r.paymentMatch)).length;
  const noMatchCount = threeWayResults.filter(r => !r.amountMatch && !r.paymentMatch).length;

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">매칭 엔진</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            거래 자동 매칭 + 세금계산서 3-way 매칭
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setMainTab("transaction")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === "transaction" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          거래 매칭
        </button>
        <button onClick={() => setMainTab("threeway")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === "threeway" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          3-way 매칭
        </button>
      </div>

      {/* ═══ Transaction Matching Tab ═══ */}
      {mainTab === "transaction" && (
        <>
          <div className="flex justify-end mb-6">
            <button
              onClick={executeMatching}
              disabled={running || transactions.length === 0}
              className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              {running ? "매칭 중..." : "매칭 실행"}
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">미매칭 거래</div>
              <div className="text-lg font-bold mt-1">
                {transactions.filter((t) => !t.matched).length}건
              </div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">자동 매칭</div>
              <div className="text-lg font-bold text-green-400 mt-1">{autoCount}건</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">검토 필요</div>
              <div className="text-lg font-bold text-[var(--warning)] mt-1">{reviewCount}건</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">미매칭</div>
              <div className="text-lg font-bold text-red-400 mt-1">{unmatchedCount}건</div>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">🔗</div>
              <div className="text-lg font-bold mb-2">매칭을 실행하세요</div>
              <div className="text-sm text-[var(--text-muted)]">
                거래내역과 딜 스케줄을 비교하여 자동으로 매칭합니다.
              </div>
            </div>
          ) : (
            <>
              {/* Sub Tabs */}
              <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6">
                {([
                  { key: "auto" as Tab, label: `자동 (${autoCount})` },
                  { key: "review" as Tab, label: `검토 (${reviewCount})` },
                  { key: "unmatched" as Tab, label: `미매칭 (${unmatchedCount})` },
                ]).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      tab === t.key
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Results */}
              <div className="space-y-3">
                {filtered.length === 0 ? (
                  <div className="text-center py-10 text-sm text-[var(--text-muted)]">
                    해당 카테고리에 결과가 없습니다.
                  </div>
                ) : (
                  filtered.map((match) => {
                    const tx = txMap.get(match.transaction_id);
                    const schedule =
                      match.schedule_type === "revenue"
                        ? revMap.get(match.schedule_id)
                        : costMap.get(match.schedule_id);

                    return (
                      <div
                        key={match.transaction_id}
                        className={`bg-[var(--bg-card)] rounded-xl border p-5 ${
                          match.status === "auto"
                            ? "border-green-500/30"
                            : match.status === "review"
                            ? "border-yellow-500/30"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  tx?.type === "income"
                                    ? "bg-green-500/10 text-green-400"
                                    : "bg-red-500/10 text-red-400"
                                }`}
                              >
                                {tx?.type === "income" ? "입금" : "출금"}
                              </span>
                              <span className="text-sm font-medium">
                                ₩{Number(tx?.amount || 0).toLocaleString()}
                              </span>
                              <span className="text-xs text-[var(--text-dim)]">
                                {tx?.transaction_date || "—"}
                              </span>
                            </div>
                            <div className="text-xs text-[var(--text-muted)] mb-2">
                              {tx?.counterparty || "—"} · {tx?.description || "—"}
                            </div>

                            {schedule && (
                              <div className="bg-[var(--bg-surface)] rounded-lg p-3 mt-2">
                                <div className="text-[10px] text-[var(--text-dim)] mb-1">
                                  매칭 대상 ({match.schedule_type === "revenue" ? "수금" : "비용"})
                                </div>
                                <div className="text-sm">
                                  ₩{Number(schedule.amount || 0).toLocaleString()}
                                  <span className="text-xs text-[var(--text-muted)] ml-2">
                                    {schedule.due_date || "—"}
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-2 mt-2">
                              <span
                                className={`text-xs font-bold ${
                                  match.score >= 90
                                    ? "text-green-400"
                                    : match.score >= 70
                                    ? "text-yellow-400"
                                    : "text-red-400"
                                }`}
                              >
                                {match.score}점
                              </span>
                              {match.reasons.map((r, i) => (
                                <span key={i} className="text-[10px] text-[var(--text-dim)]">
                                  {r}
                                </span>
                              ))}
                            </div>

                            {match.schedule_type === "cost" &&
                              schedule &&
                              "approved" in schedule &&
                              !schedule.approved && (
                                <div className="mt-2 px-3 py-1.5 bg-red-500/10 rounded-lg text-xs text-red-400 font-semibold">
                                  미승인 지출 — 승인 없이 집행된 비용입니다
                                </div>
                              )}
                          </div>

                          {match.status === "review" && (
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => confirmMatch(match)}
                                className="px-3 py-1.5 bg-green-500/10 text-green-400 rounded-lg text-xs font-semibold hover:bg-green-500/20 transition"
                              >
                                확인
                              </button>
                              <button
                                onClick={() => rejectMatch(match)}
                                className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs font-semibold hover:bg-red-500/20 transition"
                              >
                                거부
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ 3-Way Matching Tab ═══ */}
      {mainTab === "threeway" && (
        <>
          <div className="flex justify-end mb-6">
            <button onClick={executeThreeWay} disabled={threeWayRunning}
              className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {threeWayRunning ? "분석 중..." : "3-way 매칭 실행"}
            </button>
          </div>

          {/* 3-Way Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">완전 매칭</div>
              <div className="text-lg font-bold text-green-400 mt-1">{fullMatchCount}건</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">계약=계산서=입금</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">부분 매칭</div>
              <div className="text-lg font-bold text-yellow-400 mt-1">{partialCount}건</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">일부 항목만 일치</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">미매칭</div>
              <div className="text-lg font-bold text-red-400 mt-1">{noMatchCount}건</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">확인 필요</div>
            </div>
          </div>

          {threeWayResults.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">🔺</div>
              <div className="text-lg font-bold mb-2">3-way 매칭을 실행하세요</div>
              <div className="text-sm text-[var(--text-muted)]">
                계약금액 ↔ 세금계산서 ↔ 입금액을 비교합니다.
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">딜</th>
                    <th className="text-right px-5 py-3 font-medium">계약금액</th>
                    <th className="text-right px-5 py-3 font-medium">세금계산서</th>
                    <th className="text-right px-5 py-3 font-medium">입금액</th>
                    <th className="text-right px-5 py-3 font-medium">차이</th>
                    <th className="text-center px-5 py-3 font-medium">계약=계산서</th>
                    <th className="text-center px-5 py-3 font-medium">계산서=입금</th>
                    <th className="text-center px-5 py-3 font-medium">3-way</th>
                    <th className="text-center px-5 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {threeWayResults.map((r) => (
                    <tr key={r.invoiceId} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                      <td className="px-5 py-3 text-sm font-medium">{r.dealName || "—"}</td>
                      <td className="px-5 py-3 text-sm text-right">₩{r.contractAmount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-right">₩{r.invoiceAmount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-right">₩{r.receivedAmount.toLocaleString()}</td>
                      <td className={`px-5 py-3 text-sm text-right font-medium ${r.gap > 0 ? "text-red-400" : r.gap < 0 ? "text-yellow-400" : "text-green-400"}`}>
                        {r.gap > 0 ? "+" : ""}{r.gap.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs ${r.amountMatch ? "text-green-400" : "text-red-400"}`}>
                          {r.amountMatch ? "O" : "X"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs ${r.paymentMatch ? "text-green-400" : "text-red-400"}`}>
                          {r.paymentMatch ? "O" : "X"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.fullMatch ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                        }`}>
                          {r.fullMatch ? "MATCH" : "GAP"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        {r.fullMatch && (
                          <button onClick={() => handleMarkMatched(r.invoiceId)}
                            className="px-2 py-1 bg-green-500/10 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/20 transition">
                            매칭확인
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
