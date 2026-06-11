"use client";

// 거래처 원장 + 채권·채무 대사 (AR/AP).
//   탭1 확인 큐: 규칙엔진/AI 가 제안한 입금↔세금계산서 매칭을 확정/반려. 확정 시 트리거가 미수금 차감.
//   탭2 거래처 원장: v_partner_ar_ap 거래처별 미수/미지급 현황.
//   버튼: "홈택스 거래처 연결"(세금계산서↔거래처), "매칭 엔진 실행"(입금↔세금계산서 제안 생성, suggested).

import { useEffect, useMemo, useState } from "react";
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
  one_to_one: "1:1 정확", aggregate: "합산입금", partial: "부분입금", withholding: "원천징수", manual: "수동", adjustment: "차액 마감",
};
// 차액 마감 사유 (close_invoice_balance RPC 의 p_reason 값과 1:1)
const ADJ_REASONS: { id: string; label: string; desc: string }[] = [
  { id: "withholding_tax", label: "원천징수세", desc: "3.3% / 8.8% 등 원천세 공제분 — 기납부 세액으로 마감" },
  { id: "fee", label: "이체·결제 수수료", desc: "은행/PG 수수료 차감분" },
  { id: "rounding", label: "단수차", desc: "절사·반올림 등 소액 차이" },
  { id: "discount", label: "할인·에누리", desc: "합의된 금액 조정 (수정세금계산서 발행 권장)" },
  { id: "other", label: "기타", desc: "기타 사유로 잔액 정리" },
];
const ADJ_REASON_LABEL: Record<string, string> = Object.fromEntries(ADJ_REASONS.map((r) => [r.id, r.label]));

export default function PartnerLedgerPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase as any;
  const [tab, setTab] = useState<"queue" | "manual" | "ledger" | "confirmed">("queue");
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear()); // 원장 조회 연도(1년 단위)
  const [ledgerSearch, setLedgerSearch] = useState(""); // 거래처명 검색
  const [selected, setSelected] = useState<Set<string>>(new Set()); // 확인 큐 선택 매칭
  const [detail, setDetail] = useState<{ partnerId: string | null; type: string; focus: "all" | "prior" } | null>(null); // 거래처 상세 팝업
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

  const { data: confirmed = [] } = useQuery<QueueRow[]>({
    queryKey: ["settlement-confirmed", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_settlement_confirmed").select("*").eq("company_id", companyId)
        .order("updated_at", { ascending: false }).limit(300);
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
    qc.invalidateQueries({ queryKey: ["settlement-confirmed"] });
    qc.invalidateQueries({ queryKey: ["partner-ledger"] });
  };

  // 확정 취소/되돌리기 — status 를 'suggested' 로 원복 → trg_recalc_settlement 가 미수금 자동 원복(확인 큐로 복귀)
  //   차액 마감(adjustment) 행은 통장거래가 없어 확인 큐로 못 돌아가므로 'rejected' 로 종결 (잔액만 원복).
  const unconfirmMut = useMutation({
    mutationFn: async (m: { id: string; match_type: string }) => {
      const next = m.match_type === "adjustment" ? "rejected" : "suggested";
      const { error } = await db.from("invoice_settlements").update({ status: next }).eq("id", m.id);
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => { invalidateAll(); toast(next === "rejected" ? "차액 마감 취소 — 잔액이 원복되었습니다" : "확정 취소 — 미수금이 원복되었고 확인 큐로 되돌렸습니다", "info"); },
    onError: (e: any) => toast(e?.message || "확정 취소 실패", "error"),
  });

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

  // 일괄 확정/반려 — 고신뢰 일괄 또는 선택 건
  const bulkDecideMut = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: "confirmed" | "rejected" }) => {
      if (!ids.length) return 0;
      const { error } = await db.from("invoice_settlements").update({ status }).in("id", ids);
      if (error) throw new Error(error.message);
      return ids.length;
    },
    onSuccess: (n, v) => { invalidateAll(); setSelected(new Set()); toast(`${n}건 ${v.status === "confirmed" ? "확정 — 미수금에 반영됩니다" : "반려했습니다"}`, v.status === "confirmed" ? "success" : "info"); },
    onError: (e: any) => toast(e?.message || "일괄 처리 실패", "error"),
  });

  // 신뢰도 등급(매칭엔진 날짜기반 신뢰도 기준)
  const confTier = (c: number | null) => {
    const v = c ?? 0;
    if (v >= 0.9) return { label: "높음", cls: "bg-emerald-500/10 text-emerald-500" };
    if (v >= 0.7) return { label: "보통", cls: "bg-amber-500/10 text-amber-500" };
    return { label: "낮음", cls: "bg-red-500/10 text-red-400" };
  };
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const highConfIds = queue.filter((m) => (m.confidence ?? 0) >= 0.9).map((m) => m.id);

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
        {([["queue", `확인 큐${queue.length ? ` (${queue.length})` : ""}`], ["manual", "수동 매칭"], ["ledger", "거래처 원장"], ["confirmed", `확정 내역${confirmed.length ? ` (${confirmed.length})` : ""}`]] as const).map(([k, label]) => (
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
            <>
              <div className="glass-card p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <button onClick={() => setSelected(new Set(queue.map((m) => m.id)))} className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] font-semibold">전체 선택</button>
                  {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="px-2.5 py-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text)]">해제</button>}
                  <span className="text-[var(--text-dim)]">{selected.size > 0 ? `${selected.size}건 선택됨` : `대기 ${queue.length}건 · 높음 ${highConfIds.length}건`}</span>
                </div>
                <div className="flex items-center gap-2">
                  {selected.size > 0 ? (
                    <>
                      <button onClick={() => bulkDecideMut.mutate({ ids: [...selected], status: "confirmed" })} disabled={bulkDecideMut.isPending}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50">선택 {selected.size}건 확정</button>
                      <button onClick={() => bulkDecideMut.mutate({ ids: [...selected], status: "rejected" })} disabled={bulkDecideMut.isPending}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50">선택 반려</button>
                    </>
                  ) : highConfIds.length > 0 ? (
                    <button onClick={() => bulkDecideMut.mutate({ ids: highConfIds, status: "confirmed" })} disabled={bulkDecideMut.isPending}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50"
                      title="신뢰도 90% 이상(금액 정확·45일 이내) 매칭을 한 번에 확정합니다">고신뢰 {highConfIds.length}건 일괄 확정 (90%+)</button>
                  ) : null}
                </div>
              </div>
              {queue.map((m) => (
                <div key={m.id} className={`glass-card p-4 flex flex-col lg:flex-row lg:items-center gap-3 ${selected.has(m.id) ? "ring-1 ring-[var(--primary)]" : ""}`}>
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} className="shrink-0 self-start lg:self-center mt-1 lg:mt-0 accent-[var(--primary)] w-4 h-4" />
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
                    {m.confidence != null && (() => { const t = confTier(m.confidence); return <span className={`text-[10px] ml-1 px-1.5 py-0.5 rounded font-semibold ${t.cls}`}>{Math.round(m.confidence * 100)}% {t.label}</span>; })()}
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
              ))}
            </>
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
                <div className="p-8 text-center text-sm text-[var(--text-muted)]">매칭할 미정산 {matchInvType === "sales" ? "매출" : "매입"} 세금계산서가 없습니다.</div>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-[var(--text-muted)]">전기이월 = 선택 연도 이전 미정산 잔액 · 거래처를 클릭하면 세금계산서 상세가 열립니다</div>
            <div className="flex items-center gap-2">
              <input value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="거래처명 검색"
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] w-40" />
              <select value={ledgerYear} onChange={(e) => setLedgerYear(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] cursor-pointer">
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-card px-5 py-4"><div className="text-xs text-[var(--text-muted)]">총 미수금 (받을 돈)</div><div className="text-2xl font-bold text-emerald-500 mono-number mt-1">{won(totalAr)}</div></div>
            <div className="glass-card px-5 py-4"><div className="text-xs text-[var(--text-muted)]">총 미지급금 (줄 돈)</div><div className="text-2xl font-bold text-red-400 mono-number mt-1">{won(totalAp)}</div></div>
          </div>
          {lLoading ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : (
            <>
              {([["미수금 (매출 채권)", receivables, "text-emerald-500"], ["미지급금 (매입 채무)", payables, "text-red-400"]] as const).map(([title, data, accent]) => {
                const sq = ledgerSearch.trim().toLowerCase();
                const shown = sq ? data.filter((r) => nameOf(r.partner_id).toLowerCase().includes(sq)) : data;
                return (
                <div key={title} className="glass-card overflow-hidden">
                  <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[var(--text)]">{title}</h2><span className="text-xs text-[var(--text-dim)]">{shown.length}곳{sq && data.length !== shown.length ? ` / ${data.length}` : ""}</span>
                  </div>
                  {shown.length === 0 ? (
                    <div className="p-10 text-center text-sm text-[var(--text-muted)]">{sq ? "검색 결과가 없습니다." : "연결된 거래처 세금계산서가 없습니다. “홈택스 거래처 연결”을 먼저 실행하세요."}</div>
                  ) : (
                    <div className="overflow-auto max-h-[460px]"><table className="w-full min-w-[680px] text-sm">
                      <thead className="sticky top-0 bg-[var(--bg-surface)]"><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                        <th className="text-left px-5 py-2.5 font-medium">거래처</th>
                        <th className="text-right px-5 py-2.5 font-medium">전기이월</th>
                        <th className="text-right px-5 py-2.5 font-medium">당기 청구</th>
                        <th className="text-right px-5 py-2.5 font-medium">당기 정산</th>
                        <th className="text-right px-5 py-2.5 font-medium">잔액</th>
                      </tr></thead>
                      <tbody>{shown.map((r) => (
                        <tr key={`${r.partner_id}-${r.type}`} onClick={() => setDetail({ partnerId: r.partner_id, type: r.type, focus: "all" })}
                          className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] cursor-pointer" title="클릭하여 세금계산서 상세 보기">
                          <td className="px-5 py-2.5 text-[var(--text)]">
                            <span className="inline-flex items-center gap-1.5">{nameOf(r.partner_id)}<span className="text-[10px] text-[var(--text-dim)]">상세 ›</span></span>
                          </td>
                          <td className="px-5 py-2.5 text-right mono-number">
                            {Number(r.prior_outstanding) > 0
                              ? <button onClick={(e) => { e.stopPropagation(); setDetail({ partnerId: r.partner_id, type: r.type, focus: "prior" }); }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[11px] font-semibold hover:bg-amber-500/20 transition" title={`${ledgerYear}년 이전 미정산 (전기이월) — 클릭하여 상세`}>전기이월 {won(r.prior_outstanding)}</button>
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
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === "confirmed" && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">확정된 매칭 내역입니다. 잘못 확정한 건은 “확정 취소”로 되돌리면 미수금이 자동 원복되고 확인 큐로 돌아갑니다.</p>
          {confirmed.length === 0 ? (
            <div className="p-12 text-center glass-card text-sm text-[var(--text-muted)]">확정된 매칭이 없습니다.</div>
          ) : (
            confirmed.map((m) => (
              <div key={m.id} className="glass-card p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
                  {m.match_type === "adjustment" ? (
                    // 차액 마감 행 — 통장거래 없음. 사유 표시.
                    <div className="rounded-lg px-3 h-[68px] min-w-0 flex flex-col justify-center border bg-amber-500/5 border-amber-500/20">
                      <div className="text-[10px] font-semibold truncate text-amber-500">차액 마감 (통장거래 없음)</div>
                      <div className="text-sm font-bold text-[var(--text)] mono-number truncate">{won(m.amount)}</div>
                      <div className="text-xs text-[var(--text-muted)] truncate">{ADJ_REASON_LABEL[(m as any).adjustment_reason] || m.reason || "잔액 정리"}</div>
                    </div>
                  ) : (
                  <div className={`rounded-lg px-3 h-[68px] min-w-0 flex flex-col justify-center border ${m.txn_type === "income" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                    <div className={`text-[10px] font-semibold truncate ${m.txn_type === "income" ? "text-emerald-500" : "text-red-400"}`}>{m.txn_type === "income" ? "입금" : "출금"} · {m.transaction_date}</div>
                    <div className="text-sm font-bold text-[var(--text)] mono-number truncate">{won(m.txn_amount)}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{m.counterparty || "—"}</div>
                  </div>
                  )}
                  <div className={`rounded-lg px-3 h-[68px] min-w-0 flex flex-col justify-center border ${m.invoice_type === "sales" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                    <div className={`text-[10px] font-semibold truncate ${m.invoice_type === "sales" ? "text-emerald-500" : "text-red-400"}`}>{m.invoice_type === "sales" ? "매출세금계산서" : "매입세금계산서"} · {m.issue_date}</div>
                    <div className="text-sm font-bold text-[var(--text)] mono-number truncate">{won(m.invoice_amount)}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{m.counterparty_name || "—"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 lg:flex-col lg:items-end lg:gap-1 lg:w-[200px] lg:shrink-0">
                  <div className="text-right min-w-0 w-full">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-semibold">확정됨</span>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">{won(m.amount)} 정산 · {m.match_source === "manual" ? "수동 연결" : MATCH_LABEL[m.match_type] || m.match_type}</div>
                  </div>
                  <button onClick={() => unconfirmMut.mutate(m)} disabled={unconfirmMut.isPending}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-amber-500 hover:border-amber-500/40 disabled:opacity-50"
                    title={m.match_type === "adjustment" ? "차액 마감을 취소하고 잔액을 원복합니다" : "확정을 취소하고 미수금을 원복합니다 (확인 큐로 되돌아감)"}>{m.match_type === "adjustment" ? "마감 취소" : "확정 취소"}</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 거래처 상세 팝업 */}
      {detail && companyId && (
        <PartnerDetailModal
          companyId={companyId}
          partnerId={detail.partnerId}
          type={detail.type}
          year={ledgerYear}
          partnerName={nameOf(detail.partnerId)}
          focus={detail.focus}
          onClose={() => setDetail(null)}
        />
      )}

      <p className="text-[11px] text-[var(--text-dim)]">※ 확정한 매칭만 미수금에서 차감됩니다. 규칙으로 안 잡힌 입금은 곧 추가될 AI 매칭/수동 연결로 처리합니다.</p>
    </div>
  );
}

// ── 거래처 상세 팝업: 그 거래처의 개별 세금계산서 + 정산내역 ──
const SETTLE_STATUS: Record<string, [string, string]> = {
  settled: ["정산완료", "text-emerald-500 bg-emerald-500/10"],
  partial: ["부분정산", "text-amber-500 bg-amber-500/10"],
  open: ["미정산", "text-[var(--text-dim)] bg-[var(--bg-surface)]"],
};

function PartnerDetailModal({ companyId, partnerId, type, year, partnerName, focus, onClose }: {
  companyId: string; partnerId: string | null; type: string; year: number; partnerName: string; focus: "all" | "prior"; onClose: () => void;
}) {
  const db = supabase as any;
  const qc = useQueryClient();
  const { toast } = useToast();
  const yStart = `${year}-01-01`;
  const isSales = type === "sales";
  const accent = isSales ? "text-emerald-500" : "text-red-400";
  const [view, setView] = useState<"all" | "period" | "prior">(focus === "prior" ? "prior" : "all");
  // 차액 마감 모달 대상 (잔액 있는 세금계산서)
  const [closeTarget, setCloseTarget] = useState<any | null>(null);

  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["partner-detail-inv", companyId, partnerId, type, year],
    queryFn: async () => {
      let qb = db.from("tax_invoices")
        .select("id, issue_date, item_name, label, total_amount, supply_amount, tax_amount, settled_amount, settlement_status, nts_confirm_no")
        .eq("company_id", companyId).eq("type", type).lte("issue_date", `${year}-12-31`)
        .order("issue_date", { ascending: false }).limit(500);
      qb = partnerId ? qb.eq("partner_id", partnerId) : qb.is("partner_id", null);
      const { data } = await qb;
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const invIds = invoices.map((i) => i.id);
  const { data: settleMap = {} } = useQuery<Record<string, any[]>>({
    queryKey: ["partner-detail-settle", companyId, partnerId, type, year, invIds.length],
    queryFn: async () => {
      if (invIds.length === 0) return {};
      const { data: setts } = await db.from("invoice_settlements")
        .select("id, tax_invoice_id, amount, status, match_type, adjustment_reason, bank_transaction_id").in("tax_invoice_id", invIds);
      const btIds = [...new Set((setts || []).map((s: any) => s.bank_transaction_id).filter(Boolean))];
      const btMap: Record<string, string> = {};
      if (btIds.length) {
        const { data: bts } = await db.from("bank_transactions").select("id, transaction_date").in("id", btIds);
        for (const b of (bts || []) as any[]) btMap[b.id] = b.transaction_date;
      }
      const m: Record<string, any[]> = {};
      for (const s of (setts || []) as any[]) (m[s.tax_invoice_id] ||= []).push({ ...s, date: btMap[s.bank_transaction_id] });
      return m;
    },
    enabled: !!companyId && invIds.length > 0,
  });

  const remaining = (i: any) => Math.max(Number(i.total_amount || 0) - Number(i.settled_amount || 0), 0);
  const sum = (arr: any[], f: (i: any) => any) => arr.reduce((s, i) => s + Number(f(i) || 0), 0);
  const prior = invoices.filter((i) => i.issue_date < yStart);
  const period = invoices.filter((i) => i.issue_date >= yStart);
  const shownInv = view === "all" ? invoices : view === "prior" ? prior : period;
  const priorOut = sum(prior, remaining);
  const periodBilled = sum(period, (i) => i.total_amount);
  const periodSettled = sum(period, (i) => i.settled_amount);
  const periodOut = sum(period, remaining);
  const agingDays = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[var(--text)] truncate">{partnerName}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${isSales ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-400"}`}>{isSales ? "매출세금계산서" : "매입세금계산서"}</span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{year}년 기준 · 세금계산서 {invoices.length}건</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-lg shrink-0">✕</button>
        </div>

        {/* 요약 */}
        <div className="px-5 py-3 border-b border-[var(--border)] grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([["전기이월", priorOut, "text-amber-500"], ["당기 청구", periodBilled, "text-[var(--text)]"], ["당기 정산", periodSettled, "text-[var(--text-muted)]"], ["잔액", priorOut + periodOut, accent]] as const).map(([label, val, cls]) => (
            <div key={label} className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
              <div className="text-[10px] text-[var(--text-dim)]">{label}</div>
              <div className={`text-sm font-bold mono-number ${cls}`}>{won(val)}</div>
            </div>
          ))}
        </div>

        {/* 필터 탭 */}
        <div className="px-5 pt-2 flex gap-1.5">
          {([["all", `전체 ${invoices.length}`], ["period", `당기 ${period.length}`], ["prior", `전기이월 ${prior.length}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition ${view === k ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>{l}</button>
          ))}
        </div>

        {/* 세금계산서 목록 */}
        <div className="flex-1 overflow-auto px-5 py-2">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : invoices.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">이 거래처의 {isSales ? "매출" : "매입"}세금계산서가 없습니다.</div>
          ) : shownInv.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">{view === "prior" ? "전기이월(전년도 이전) 건이 없습니다." : "당기(올해) 발행 건이 없습니다."}</div>
          ) : (
            shownInv.map((inv) => {
              const ss = SETTLE_STATUS[inv.settlement_status as string] || SETTLE_STATUS.open;
              const isPrior = inv.issue_date < yStart;
              const setts = settleMap[inv.id] || [];
              return (
                <div key={inv.id} className="border-b border-[var(--border)]/50 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-[var(--text)]">{inv.issue_date}</span>
                        {isPrior && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold">전기이월</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ss[1]}`}>{ss[0]}</span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                        {inv.item_name || inv.label || "품목 미상"}{inv.nts_confirm_no ? ` · 승인 ${inv.nts_confirm_no}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-[var(--text)] mono-number">{won(inv.total_amount)}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">공급 {won(inv.supply_amount)} · 세액 {won(inv.tax_amount)}</div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-dim)]">
                    <span>정산 {won(inv.settled_amount)} · 잔액 <b className={remaining(inv) > 0 ? accent : "text-[var(--text-dim)]"}>{won(remaining(inv))}</b></span>
                    {remaining(inv) > 0 && (() => { const d = agingDays(inv.issue_date); return <span className={`${d > 90 ? "text-red-400 font-semibold" : "text-[var(--text-dim)]"}`}>· {d}일 경과{d > 90 ? " (장기 미정산)" : ""}</span>; })()}
                    {remaining(inv) > 0 && (
                      <button onClick={() => setCloseTarget(inv)}
                        className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/50 transition"
                        title="입금과의 차액(원천세·수수료·단수차·할인)을 사유와 함께 정리하고 이 계산서를 정산 완료 처리합니다">
                        차액 마감
                      </button>
                    )}
                  </div>
                  {setts.map((s, i) => (
                    s.match_type === "adjustment" ? (
                      <div key={i} className="ml-3 mt-1 flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                        <span>↳ 차액 마감</span>
                        <span className="mono-number text-[var(--text-muted)]">{won(s.amount)}</span>
                        <span className="px-1 rounded bg-amber-500/10 text-amber-500">{ADJ_REASON_LABEL[s.adjustment_reason] || "잔액 정리"}</span>
                        <span>{s.status === "confirmed" ? "확정" : s.status === "rejected" ? "취소됨" : s.status}</span>
                      </div>
                    ) : (
                    <div key={i} className="ml-3 mt-1 flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                      <span>↳ {s.date || "날짜미상"} 통장</span>
                      <span className="mono-number text-[var(--text-muted)]">{won(s.amount)}</span>
                      <span className="px-1 rounded bg-[var(--bg-surface)]">{MATCH_LABEL[s.match_type] || s.match_type}</span>
                      <span>{s.status === "confirmed" ? "확정" : s.status === "suggested" ? "제안(미확정)" : s.status === "rejected" ? "반려" : s.status}</span>
                    </div>
                    )
                  ))}
                </div>
              );
            })
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] text-right">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">닫기</button>
        </div>
      </div>

      {/* 차액 마감 모달 */}
      {closeTarget && (
        <CloseBalanceModal
          invoice={closeTarget}
          remaining={remaining(closeTarget)}
          onClose={() => setCloseTarget(null)}
          onDone={() => {
            setCloseTarget(null);
            qc.invalidateQueries({ queryKey: ["partner-detail-inv"] });
            qc.invalidateQueries({ queryKey: ["partner-detail-settle"] });
            qc.invalidateQueries({ queryKey: ["partner-ledger"] });
            qc.invalidateQueries({ queryKey: ["settlement-confirmed"] });
            toast("차액 마감 완료 — 잔액이 정리되었습니다", "success");
          }}
          onError={(msg) => toast(msg, "error")}
        />
      )}
    </div>
  );
}

// ── 차액 마감 모달: 잔액을 사유(원천세/수수료/단수차/할인/기타)와 함께 정리 ──
//   close_invoice_balance RPC → invoice_settlements 에 조정행(confirmed) → 트리거가 settled_amount 재계산.
//   취소는 확정 내역 탭의 "마감 취소"(status=rejected → 잔액 자동 원복).
function CloseBalanceModal({ invoice, remaining, onClose, onDone, onError }: {
  invoice: any; remaining: number; onClose: () => void; onDone: () => void; onError: (msg: string) => void;
}) {
  const db = supabase as any;
  const [reason, setReason] = useState<string>("");
  const [amount, setAmount] = useState<number>(remaining);
  const [busy, setBusy] = useState(false);
  // 원천징수 추정치 — 공급가 3.3% 가 잔액과 ±1,000원 이내면 사유 기본 선택
  const wh33 = Math.round(Number(invoice.supply_amount || 0) * 0.033);
  const looksWithholding = Math.abs(remaining - wh33) <= 1000;
  useEffect(() => {
    if (!reason) setReason(looksWithholding ? "withholding_tax" : remaining <= 1000 ? "rounding" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!reason || busy) return;
    if (!(amount > 0) || amount > remaining) { onError("금액은 0보다 크고 잔액 이하여야 합니다"); return; }
    setBusy(true);
    const { error } = await db.rpc("close_invoice_balance", { p_invoice_id: invoice.id, p_reason: reason, p_amount: amount });
    setBusy(false);
    if (error) { onError(error.message || "차액 마감 실패"); return; }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="text-sm font-bold text-[var(--text)]">차액 마감</div>
          <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
            {invoice.issue_date} 발행 · 합계 {won(invoice.total_amount)} · 잔액 <b className="text-[var(--text)]">{won(remaining)}</b>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">마감 사유</div>
            <div className="space-y-1.5">
              {ADJ_REASONS.map((r) => (
                <label key={r.id} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition ${reason === r.id ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] hover:bg-[var(--bg-surface)]"}`}>
                  <input type="radio" name="adj-reason" checked={reason === r.id} onChange={() => setReason(r.id)} className="mt-0.5 accent-[var(--primary)]" />
                  <span>
                    <span className="text-xs font-semibold text-[var(--text)]">{r.label}</span>
                    {r.id === "withholding_tax" && looksWithholding && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-semibold">잔액이 3.3%와 일치 — 추천</span>}
                    <span className="block text-[10px] text-[var(--text-dim)] mt-0.5">{r.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">마감 금액 (기본 = 잔액 전체)</div>
            <input type="number" value={amount} min={1} max={remaining}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] mono-number focus:outline-none focus:border-[var(--primary)]" />
          </div>
          {reason === "discount" && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/25 text-[11px] text-amber-600 leading-relaxed">
              ⚠️ 할인·에누리로 실제 거래금액이 계산서와 달라진 경우, 부가세 과세표준이 바뀌므로 <b>수정세금계산서 발행</b>을 권장합니다. 마감은 장부 정리일 뿐 신고 금액을 바꾸지 않습니다.
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">취소</button>
          <button onClick={submit} disabled={!reason || busy || !(amount > 0)}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "처리 중..." : `${won(amount)} 마감 확정`}
          </button>
        </div>
      </div>
    </div>
  );
}
