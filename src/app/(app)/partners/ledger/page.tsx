"use client";

// 거래처 원장 + 채권·채무 대사 (AR/AP).
//   탭1 확인 큐: 규칙엔진/AI 가 제안한 입금↔송장 매칭을 확정/반려. 확정 시 트리거가 미수금 차감.
//   탭2 거래처 원장: v_partner_ar_ap 거래처별 미수/미지급 현황.
//   버튼: "홈택스 거래처 연결"(송장↔거래처), "매칭 엔진 실행"(입금↔송장 제안 생성, suggested).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

type ArApRow = {
  partner_id: string | null; type: string; invoice_count: number;
  total_billed: number; total_settled: number; outstanding: number;
};
type QueueRow = {
  id: string; bank_transaction_id: string; tax_invoice_id: string; amount: number;
  match_type: string; match_source: string; status: string; confidence: number | null; reason: string | null;
  transaction_date: string; txn_amount: number; counterparty: string | null; txn_type: string;
  issue_date: string; invoice_amount: number; counterparty_name: string | null; invoice_type: string;
};

const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;
const MATCH_LABEL: Record<string, string> = {
  one_to_one: "1:1 정확", aggregate: "합산입금", partial: "부분입금", withholding: "원천징수", manual: "수동",
};

export default function PartnerLedgerPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase as any;
  const [tab, setTab] = useState<"queue" | "ledger">("queue");

  const { data: queue = [], isLoading: qLoading } = useQuery<QueueRow[]>({
    queryKey: ["settlement-queue", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_settlement_review_queue").select("*").eq("company_id", companyId)
        .order("confidence", { ascending: false });
      return (data || []) as QueueRow[];
    },
    enabled: !!companyId,
  });

  const { data: rows = [], isLoading: lLoading } = useQuery<ArApRow[]>({
    queryKey: ["partner-ledger", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_partner_ar_ap").select("*").eq("company_id", companyId);
      return (data || []) as ArApRow[];
    },
    enabled: !!companyId,
  });

  const { data: partnerMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["partner-ledger-names", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name").eq("company_id", companyId);
      const m: Record<string, string> = {};
      for (const p of (data || []) as any[]) m[p.id] = p.name;
      return m;
    },
    enabled: !!companyId,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["settlement-queue"] });
    qc.invalidateQueries({ queryKey: ["partner-ledger"] });
  };

  const linkMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("link_invoice_partners");
      if (error) throw new Error(error.message); return data as { created: number; linked: number };
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["partner-ledger"] }); qc.invalidateQueries({ queryKey: ["partner-ledger-names"] }); qc.invalidateQueries({ queryKey: ["partners"] }); toast(`거래처 ${r?.created ?? 0}곳 등록 · 송장 ${r?.linked ?? 0}건 연결`, "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  const engineMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("generate_settlement_suggestions", { p_days: 180 });
      if (error) throw new Error(error.message); return data as { resolved: number; suggested: number };
    },
    onSuccess: (r) => { invalidateAll(); toast(`거래처 ${r?.resolved ?? 0}건 해소 · 제안 ${r?.suggested ?? 0}건 생성`, "success"); },
    onError: (e: any) => toast(e?.message || "매칭 엔진 실패", "error"),
  });

  // AI 매칭 — 규칙으로 안 풀린 입금만 Claude 로 거래처 해소+송장 매칭 (Edge). 한 번에 15건씩.
  const aiMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("settlement-ai-match", { body: { companyId, limit: 15 } });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { processed: number; resolved: number; suggested: number };
    },
    onSuccess: (r) => { invalidateAll(); toast(`AI: ${r?.processed ?? 0}건 분석 · 거래처 ${r?.resolved ?? 0}건 해소 · 제안 ${r?.suggested ?? 0}건`, "success"); },
    onError: (e: any) => toast(e?.message || "AI 매칭 실패", "error"),
  });

  const decideMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirmed" | "rejected" }) => {
      const { error } = await db.from("invoice_settlements").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => { invalidateAll(); toast(v.status === "confirmed" ? "확정 — 미수금에 반영됩니다" : "반려했습니다", v.status === "confirmed" ? "success" : "info"); },
    onError: (e: any) => toast(e?.message || "처리 실패", "error"),
  });

  const { receivables, payables, totalAr, totalAp } = useMemo(() => {
    const recv = rows.filter((r) => r.type === "sales").sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    const pay = rows.filter((r) => r.type === "purchase").sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    return { receivables: recv, payables: pay,
      totalAr: recv.reduce((s, r) => s + Number(r.outstanding || 0), 0),
      totalAp: pay.reduce((s, r) => s + Number(r.outstanding || 0), 0) };
  }, [rows]);

  const nameOf = (pid: string | null) => (pid && partnerMap[pid]) || "미지정 거래처";

  return (
    <div className="space-y-6">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">거래처 원장 · 채권 대사</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">세금계산서 ↔ 통장 입금 매칭으로 미수금 자동 관리</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/partners" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래처</Link>
          <button onClick={() => !linkMut.isPending && linkMut.mutate()} disabled={linkMut.isPending}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
            title="홈택스 송장 거래처를 사업자번호로 자동 등록·연결">
            {linkMut.isPending ? "연결 중..." : "홈택스 거래처 연결"}</button>
          <button onClick={() => !engineMut.isPending && engineMut.mutate()} disabled={engineMut.isPending}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
            title="미정산 입금과 송장을 규칙으로 매칭해 확인 큐에 제안 생성">
            {engineMut.isPending ? "매칭 중..." : "⚙️ 매칭 엔진 실행"}</button>
          <button onClick={() => !aiMut.isPending && aiMut.mutate()} disabled={aiMut.isPending}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-purple-500 text-white hover:opacity-90 disabled:opacity-50"
            title="규칙으로 안 풀린 입금을 AI(Claude)로 거래처 해소+송장 매칭 (15건씩)">
            {aiMut.isPending ? "AI 분석 중..." : "✨ AI 매칭"}</button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-[var(--border)]">
        {([["queue", `확인 큐${queue.length ? ` (${queue.length})` : ""}`], ["ledger", "거래처 원장"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === k ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
            {label}</button>
        ))}
      </div>

      {tab === "queue" && (
        <div className="space-y-2">
          {qLoading ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : queue.length === 0 ? (
            <div className="p-12 text-center glass-card">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-sm text-[var(--text)]">확인 대기 중인 매칭이 없습니다</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1">상단 “⚙️ 매칭 엔진 실행”으로 입금↔송장 제안을 생성하세요.</div>
            </div>
          ) : (
            queue.map((m) => (
              <div key={m.id} className="glass-card p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
                    <div className="text-[10px] text-emerald-500 font-semibold">입금 ({m.transaction_date})</div>
                    <div className="text-sm font-bold text-[var(--text)] mono-number">{won(m.txn_amount)}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{m.counterparty || "—"}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2">
                    <div className="text-[10px] text-[var(--text-muted)] font-semibold">송장 ({m.issue_date})</div>
                    <div className="text-sm font-bold text-[var(--text)] mono-number">{won(m.invoice_amount)}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{m.counterparty_name || "—"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 lg:flex-col lg:items-end lg:gap-1">
                  <div className="text-right">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">{MATCH_LABEL[m.match_type] || m.match_type}</span>
                    <span className="text-[10px] text-[var(--text-dim)] ml-1">{m.confidence != null ? `${Math.round(m.confidence * 100)}%` : ""}</span>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{won(m.amount)} 정산 · {m.reason || ""}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => decideMut.mutate({ id: m.id, status: "confirmed" })} disabled={decideMut.isPending}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50">확정</button>
                    <button onClick={() => decideMut.mutate({ id: m.id, status: "rejected" })} disabled={decideMut.isPending}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400">반려</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "ledger" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-card px-5 py-4"><div className="text-xs text-[var(--text-muted)]">총 미수금 (받을 돈)</div><div className="text-2xl font-bold text-emerald-500 mono-number mt-1">{won(totalAr)}</div></div>
            <div className="glass-card px-5 py-4"><div className="text-xs text-[var(--text-muted)]">총 미지급금 (줄 돈)</div><div className="text-2xl font-bold text-red-400 mono-number mt-1">{won(totalAp)}</div></div>
          </div>
          {lLoading ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : (
            <>
              {([["미수금 (매출 채권)", receivables, "text-emerald-500"], ["미지급금 (매입 채무)", payables, "text-red-400"]] as const).map(([title, data, accent]) => (
                <div key={title} className="glass-card overflow-hidden">
                  <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[var(--text)]">{title}</h2><span className="text-xs text-[var(--text-dim)]">{data.length}곳</span>
                  </div>
                  {data.length === 0 ? (
                    <div className="p-10 text-center text-sm text-[var(--text-muted)]">연결된 거래처 송장이 없습니다. “홈택스 거래처 연결”을 먼저 실행하세요.</div>
                  ) : (
                    <div className="overflow-auto max-h-[460px]"><table className="w-full min-w-[640px] text-sm">
                      <thead className="sticky top-0 bg-[var(--bg-surface)]"><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                        <th className="text-left px-5 py-2.5 font-medium">거래처</th><th className="text-right px-5 py-2.5 font-medium">송장</th>
                        <th className="text-right px-5 py-2.5 font-medium">청구액</th><th className="text-right px-5 py-2.5 font-medium">정산액</th><th className="text-right px-5 py-2.5 font-medium">잔액</th>
                      </tr></thead>
                      <tbody>{data.map((r) => (
                        <tr key={`${r.partner_id}-${r.type}`} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                          <td className="px-5 py-2.5 text-[var(--text)]">{nameOf(r.partner_id)}</td>
                          <td className="px-5 py-2.5 text-right text-[var(--text-muted)]">{r.invoice_count}</td>
                          <td className="px-5 py-2.5 text-right text-[var(--text-muted)] mono-number">{won(r.total_billed)}</td>
                          <td className="px-5 py-2.5 text-right text-[var(--text-muted)] mono-number">{won(r.total_settled)}</td>
                          <td className={`px-5 py-2.5 text-right font-semibold mono-number ${Number(r.outstanding) > 0 ? accent : "text-[var(--text-dim)]"}`}>{won(r.outstanding)}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-dim)]">※ 확정한 매칭만 미수금에서 차감됩니다. 규칙으로 안 잡힌 입금은 곧 추가될 AI 매칭/수동 연결로 처리합니다.</p>
    </div>
  );
}
