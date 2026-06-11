"use client";

// 거래처 원장 + 채권·채무 대사 (AR/AP).
//   탭1 확인 큐: 규칙엔진/AI 가 제안한 입금↔세금계산서 매칭을 확정/반려. 확정 시 트리거가 미수금 차감.
//   탭2 거래처 원장: v_partner_ar_ap 거래처별 미수/미지급 현황.
//   버튼: "홈택스 거래처 연결"(세금계산서↔거래처), "매칭 엔진 실행"(입금↔세금계산서 제안 생성, suggested).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

type LedgerRow = {
  partner_id: string | null; type: string; invoice_count: number;
  prior_outstanding: number;   // 전기이월(선택연도 이전 미정산)
  period_billed: number;       // 당기 청구
  period_settled: number;      // 당기 정산
  period_outstanding: number;  // 당기 잔액
};
type QueueRow = {
  id: string; bank_transaction_id: string; tax_invoice_id: string; amount: number;
  match_type: string; match_source: string; status: string; confidence: number | null; reason: string | null;
  transaction_date: string; txn_amount: number; counterparty: string | null; txn_type: string;
  issue_date: string; invoice_amount: number; counterparty_name: string | null; invoice_type: string;
};
type OpenTx = { id: string; amount: number; settled_amount: number; transaction_date: string; counterparty: string | null; type: string };
type UnsettledInv = { id: string; type: string; issue_date: string; total_amount: number; settled_amount: number; counterparty_name: string | null; partner_id: string | null };

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
  const [tab, setTab] = useState<"queue" | "manual" | "ledger">("queue");
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear()); // 원장 조회 연도(1년 단위)
  const [matchTx, setMatchTx] = useState<OpenTx | null>(null); // 수동 매칭 대상 입금
  const [invSearch, setInvSearch] = useState("");
  // 매칭 엔진 기간 — 기본 최근 100일. 최대 6개월(서버 클램프). 여러 기간 반복해도 기존 매칭 누적.
  const dStr = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10); };
  const [engStart, setEngStart] = useState(dStr(100));
  const [engEnd, setEngEnd] = useState(dStr(0));

  const { data: queue = [], isLoading: qLoading } = useQuery<QueueRow[]>({
    queryKey: ["settlement-queue", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_settlement_review_queue").select("*").eq("company_id", companyId)
        .order("confidence", { ascending: false });
      return (data || []) as QueueRow[];
    },
    enabled: !!companyId,
  });

  const { data: rows = [], isLoading: lLoading } = useQuery<LedgerRow[]>({
    queryKey: ["partner-ledger", companyId, ledgerYear],
    queryFn: async () => {
      const { data } = await db.rpc("get_partner_ledger_by_year", { p_year: ledgerYear });
      return (data || []) as LedgerRow[];
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
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["partner-ledger"] }); qc.invalidateQueries({ queryKey: ["partner-ledger-names"] }); qc.invalidateQueries({ queryKey: ["partners"] }); toast(`거래처 ${r?.created ?? 0}곳 등록 · 세금계산서 ${r?.linked ?? 0}건 연결`, "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  const engineMut = useMutation({
    mutationFn: async () => {
      // 기간 지정형 — 호출당 최대 6개월(서버 클램프). 커넥션 장기 보유로 인한 504 방지.
      const { data, error } = await db.rpc("generate_settlement_suggestions", { p_start: engStart, p_end: engEnd });
      if (error) throw new Error(error.message); return data as { resolved: number; suggested: number };
    },
    onSuccess: (r) => { invalidateAll(); toast(`거래처 ${r?.resolved ?? 0}건 해소 · 제안 ${r?.suggested ?? 0}건 생성`, "success"); },
    onError: (e: any) => toast(e?.message || "매칭 엔진 실패", "error"),
  });

  // AI 매칭 — 규칙으로 안 풀린 입금만 Claude 로 거래처 해소+세금계산서 매칭 (Edge). 한 번에 15건씩.
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

  // 수동 매칭 — 미정산 입출금 목록 (확정 안 된 건). settlement_status open/partial.
  const { data: openTx = [] } = useQuery<OpenTx[]>({
    queryKey: ["manual-open-tx", companyId, tab],
    queryFn: async () => {
      const { data } = await db.from("bank_transactions")
        .select("id, amount, settled_amount, transaction_date, counterparty, type")
        .eq("company_id", companyId).in("settlement_status", ["open", "partial"]).in("type", ["income", "expense"])
        .gt("amount", 0).order("transaction_date", { ascending: false }).limit(300);
      return (data || []) as OpenTx[];
    },
    enabled: !!companyId && tab === "manual",
  });

  // 미정산 세금계산서 (수동 매칭 후보)
  const { data: unsettledInv = [] } = useQuery<UnsettledInv[]>({
    queryKey: ["manual-unsettled-inv", companyId, tab],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices")
        .select("id, type, issue_date, total_amount, settled_amount, counterparty_name, partner_id")
        .eq("company_id", companyId).neq("settlement_status", "settled")
        .order("issue_date", { ascending: false }).limit(2000);
      return (data || []) as UnsettledInv[];
    },
    enabled: !!companyId && tab === "manual",
  });

  // 수동 연결 — match_source='manual', status='confirmed' (즉시 미수금 차감)
  const manualMut = useMutation({
    mutationFn: async ({ tx, inv, amount }: { tx: OpenTx; inv: UnsettledInv; amount: number }) => {
      const { error } = await db.from("invoice_settlements").insert({
        company_id: companyId, bank_transaction_id: tx.id, tax_invoice_id: inv.id,
        amount, match_type: "manual", match_source: "manual", status: "confirmed", confidence: 1, reason: "수동 연결",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["manual-open-tx"] }); qc.invalidateQueries({ queryKey: ["manual-unsettled-inv"] }); setMatchTx(null); setInvSearch(""); toast("연결 완료 — 미수금에 반영됩니다", "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  const txRemaining = (t: OpenTx) => Number(t.amount || 0) - Number(t.settled_amount || 0);
  const invRemaining = (i: UnsettledInv) => Number(i.total_amount || 0) - Number(i.settled_amount || 0);
  const matchInvType = matchTx?.type === "income" ? "sales" : "purchase";
  const filteredInv = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return unsettledInv
      .filter((i) => i.type === matchInvType && invRemaining(i) > 0)
      .filter((i) => !q || (i.counterparty_name || "").toLowerCase().includes(q))
      .slice(0, 100);
  }, [unsettledInv, invSearch, matchInvType]);

  // 잔액 = 전기이월 + 당기 잔액
  const ledgerOut = (r: LedgerRow) => Number(r.prior_outstanding || 0) + Number(r.period_outstanding || 0);
  const { receivables, payables, totalAr, totalAp } = useMemo(() => {
    const has = (r: LedgerRow) => ledgerOut(r) > 0 || Number(r.period_billed || 0) > 0;
    const recv = rows.filter((r) => r.type === "sales" && has(r)).sort((a, b) => ledgerOut(b) - ledgerOut(a));
    const pay = rows.filter((r) => r.type === "purchase" && has(r)).sort((a, b) => ledgerOut(b) - ledgerOut(a));
    return { receivables: recv, payables: pay,
      totalAr: recv.reduce((s, r) => s + ledgerOut(r), 0),
      totalAp: pay.reduce((s, r) => s + ledgerOut(r), 0) };
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
            title="홈택스 세금계산서 거래처를 사업자번호로 자동 등록·연결">
            {linkMut.isPending ? "연결 중..." : "홈택스 거래처 연결"}</button>
          <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 py-1">
            <input type="date" value={engStart} max={engEnd} onChange={(e) => setEngStart(e.target.value)}
              className="bg-transparent text-[11px] text-[var(--text)] outline-none" />
            <span className="text-[10px] text-[var(--text-dim)]">~</span>
            <input type="date" value={engEnd} min={engStart} max={dStr(0)} onChange={(e) => setEngEnd(e.target.value)}
              className="bg-transparent text-[11px] text-[var(--text)] outline-none" />
          </span>
          <button onClick={() => !engineMut.isPending && engineMut.mutate()} disabled={engineMut.isPending || !engStart || !engEnd || engStart > engEnd}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
            title="선택 기간(최대 6개월)의 미정산 입금과 세금계산서를 규칙으로 매칭. 여러 기간 반복해도 기존 매칭은 유지·누적됩니다.">
            {engineMut.isPending ? "매칭 중..." : "⚙️ 이 기간 매칭"}</button>
          <button onClick={() => !aiMut.isPending && aiMut.mutate()} disabled={aiMut.isPending}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-purple-500 text-white hover:opacity-90 disabled:opacity-50"
            title="규칙으로 안 풀린 입금을 AI(Claude)로 거래처 해소+세금계산서 매칭 (15건씩)">
            {aiMut.isPending ? "AI 분석 중..." : "✨ AI 매칭"}</button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-[var(--border)]">
        {([["queue", `확인 큐${queue.length ? ` (${queue.length})` : ""}`], ["manual", "수동 매칭"], ["ledger", "거래처 원장"]] as const).map(([k, label]) => (
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
              <div className="text-[11px] text-[var(--text-dim)] mt-1">상단에서 기간(최대 6개월)을 고르고 “⚙️ 이 기간 매칭”으로 제안을 생성하세요. 기간을 바꿔 여러 번 돌려도 누적됩니다.</div>
            </div>
          ) : (
            queue.map((m) => (
              <div key={m.id} className="glass-card p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
                  <div className={`rounded-lg px-3 h-[68px] min-w-0 flex flex-col justify-center border ${m.txn_type === "income" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                    <div className={`text-[10px] font-semibold truncate ${m.txn_type === "income" ? "text-emerald-500" : "text-red-400"}`}>{m.txn_type === "income" ? "입금" : "출금"} · {m.transaction_date}</div>
                    <div className="text-sm font-bold text-[var(--text)] mono-number truncate">{won(m.txn_amount)}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{m.counterparty || "—"}</div>
                  </div>
                  <div className={`rounded-lg px-3 h-[68px] min-w-0 flex flex-col justify-center border ${m.invoice_type === "sales" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                    <div className={`text-[10px] font-semibold truncate ${m.invoice_type === "sales" ? "text-emerald-500" : "text-red-400"}`}>{m.invoice_type === "sales" ? "매출세금계산서" : "매입세금계산서"} · {m.issue_date}</div>
                    <div className="text-sm font-bold text-[var(--text)] mono-number truncate">{won(m.invoice_amount)}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{m.counterparty_name || "—"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 lg:flex-col lg:items-end lg:gap-1 lg:w-[200px] lg:shrink-0">
                  <div className="text-right min-w-0 w-full">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">{MATCH_LABEL[m.match_type] || m.match_type}</span>
                    <span className="text-[10px] text-[var(--text-dim)] ml-1">{m.confidence != null ? `${Math.round(m.confidence * 100)}%` : ""}</span>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">{won(m.amount)} 정산 · {m.reason || ""}</div>
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

      {tab === "manual" && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">규칙·AI 가 못 잡은 입금을 직접 세금계산서에 연결합니다. 연결 즉시 확정되어 미수금에 반영됩니다.</p>
          {openTx.length === 0 ? (
            <div className="p-12 text-center glass-card text-sm text-[var(--text-muted)]">미정산 입출금이 없습니다.</div>
          ) : (
            openTx.map((t) => (
              <div key={t.id} className="glass-card p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)] truncate">{t.counterparty || "—"}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${t.type === "income" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-400"}`}>{t.type === "income" ? "입금" : "출금"}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-dim)]">{t.transaction_date} · 잔여 {won(txRemaining(t))}</div>
                </div>
                <button onClick={() => { setMatchTx(t); setInvSearch(""); }}
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                  세금계산서 연결
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 수동 매칭 모달 */}
      {matchTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMatchTx(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">세금계산서에 연결</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{matchTx.counterparty || "—"} · {matchTx.transaction_date} · 잔여 {won(txRemaining(matchTx))}</div>
            </div>
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <input value={invSearch} onChange={(e) => setInvSearch(e.target.value)} placeholder="거래처명으로 세금계산서 검색"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" />
            </div>
            <div className="flex-1 overflow-auto p-2">
              {filteredInv.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--text-muted)]">매칭할 미정산 {matchInvType === "sales" ? "매출" : "매입"} 세금계산서이 없습니다.</div>
              ) : filteredInv.map((inv) => {
                const amt = Math.min(txRemaining(matchTx), invRemaining(inv));
                return (
                  <div key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)]">
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--text)] truncate">{inv.counterparty_name || "—"}</div>
                      <div className="text-[11px] text-[var(--text-dim)]">{inv.issue_date} · 잔액 {won(invRemaining(inv))}</div>
                    </div>
                    <button onClick={() => manualMut.mutate({ tx: matchTx, inv, amount: amt })} disabled={manualMut.isPending || amt <= 0}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                      {won(amt)} 연결
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] text-right">
              <button onClick={() => setMatchTx(null)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">닫기</button>
            </div>
          </div>
        </div>
      )}

      {tab === "ledger" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--text-muted)]">조회 연도 · 전기이월 = 선택 연도 이전 미정산 잔액</div>
            <select value={ledgerYear} onChange={(e) => setLedgerYear(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] cursor-pointer">
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
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
                    <div className="p-10 text-center text-sm text-[var(--text-muted)]">연결된 거래처 세금계산서이 없습니다. “홈택스 거래처 연결”을 먼저 실행하세요.</div>
                  ) : (
                    <div className="overflow-auto max-h-[460px]"><table className="w-full min-w-[680px] text-sm">
                      <thead className="sticky top-0 bg-[var(--bg-surface)]"><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                        <th className="text-left px-5 py-2.5 font-medium">거래처</th>
                        <th className="text-right px-5 py-2.5 font-medium">전기이월</th>
                        <th className="text-right px-5 py-2.5 font-medium">당기 청구</th>
                        <th className="text-right px-5 py-2.5 font-medium">당기 정산</th>
                        <th className="text-right px-5 py-2.5 font-medium">잔액</th>
                      </tr></thead>
                      <tbody>{data.map((r) => (
                        <tr key={`${r.partner_id}-${r.type}`} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                          <td className="px-5 py-2.5 text-[var(--text)]">{nameOf(r.partner_id)}</td>
                          <td className="px-5 py-2.5 text-right mono-number">
                            {Number(r.prior_outstanding) > 0
                              ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[11px] font-semibold" title={`${ledgerYear}년 이전 미정산 (전기이월)`}>전기이월 {won(r.prior_outstanding)}</span>
                              : <span className="text-[var(--text-dim)]">—</span>}
                          </td>
                          <td className="px-5 py-2.5 text-right text-[var(--text-muted)] mono-number">{won(r.period_billed)}</td>
                          <td className="px-5 py-2.5 text-right text-[var(--text-muted)] mono-number">{won(r.period_settled)}</td>
                          <td className={`px-5 py-2.5 text-right font-semibold mono-number ${ledgerOut(r) > 0 ? accent : "text-[var(--text-dim)]"}`}>{won(ledgerOut(r))}</td>
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
