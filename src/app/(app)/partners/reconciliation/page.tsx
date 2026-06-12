"use client";

// 거래 대사 — 입금·계산서 자동 매칭 (2026-06-12 메뉴 분리: 구 거래처원장의 작업 화면).
//   탭1 확인 큐: 규칙엔진/AI 제안 매칭을 확정/반려. 확정 시 트리거가 미수금 차감 + 자동 차액마감.
//   탭2 수동 매칭: 못 잡은 입출금을 직접 세금계산서에 연결.
//   탭3 확정 내역: 확정 취소(원복) / 차액마감 취소.
//   조회(거래처별 잔액)는 /partners/ledger (거래처 원장).

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import {
  type QueueRow, type OpenTx, type UnsettledInv,
  won, fmt, GRID_TH, GRID_TD, MATCH_LABEL, ADJ_REASON_LABEL,
  useColWidths, ResizableTh,
} from "../ledger/shared";

export default function ReconciliationPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase as any;
  const [tab, setTab] = useState<"queue" | "manual" | "confirmed">("queue");
  const [selected, setSelected] = useState<Set<string>>(new Set()); // 확인 큐 선택 매칭
  const [matchTx, setMatchTx] = useState<OpenTx | null>(null); // 수동 매칭 대상 입금
  const [invSearch, setInvSearch] = useState("");
  const [manualSearch, setManualSearch] = useState(""); // 수동 매칭 탭 거래처(입금자) 검색
  // 확인 큐 — 엑셀식 컬럼 너비 (드래그/더블클릭 자동맞춤, localStorage 기억)
  const queueTableRef = useRef<HTMLTableElement | null>(null);
  const [queueW, setQueueW] = useColWidths("ledger-queue-colw", {
    sel: 36, tdate: 92, ttype: 56, cp: 170, tamt: 110, idate: 92, icp: 170, iamt: 110, amt: 110, mtype: 80, conf: 92, act: 120,
  });
  // 매칭 엔진 기간 — 기본 최근 100일. 최대 6개월(서버 클램프). 여러 기간 반복해도 기존 매칭 누적.
  const dStr = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10); };
  const [engStart, setEngStart] = useState(dStr(100));
  const [engEnd, setEngEnd] = useState(dStr(0));

  // 확인 큐 — 미처리(suggested/needs_review)만. 뷰가 이미 필터하지만(2026-06-12 prod 정의 검증)
  //   방어적으로 클라이언트에서도 포함 목록 필터(핸드오프 §6: 부정 조건 금지, 뷰 오염 시에도 화면 안전).
  //   refetchInterval 30s: 전역 refetchOnWindowFocus OFF 라 타 세션 확정 건이 남는 것 방지.
  const QUEUE_STATUSES = ["suggested", "needs_review"];
  const { data: queue = [], isLoading: qLoading } = useQuery<QueueRow[]>({
    queryKey: ["settlement-queue", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_settlement_review_queue").select("*").eq("company_id", companyId)
        .order("confidence", { ascending: false });
      return ((data || []) as QueueRow[]).filter((m) => QUEUE_STATUSES.includes(m.status));
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
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

  // 별칭 학습(대사 핸드오프 TASK A): 사람이 매칭을 확정하면 입금자명→거래처를 partner_aliases 에
  //   학습 — 다음 규칙 엔진 실행부터 같은 입금자명이 즉시 해소된다. 실패는 비치명(무시),
  //   중복(unique lower(alias))은 행 단위 insert 로 조용히 스킵.
  const learnAliases = async (pairs: { counterparty: string | null; tax_invoice_id: string }[]) => {
    try {
      const items = pairs.filter((p) => p.counterparty && p.counterparty.trim().length >= 2);
      if (!items.length || !companyId) return;
      const invIds = [...new Set(items.map((p) => p.tax_invoice_id))];
      const { data: invs } = await db.from("tax_invoices").select("id, partner_id").in("id", invIds);
      const pidByInv = new Map<string, string | null>(((invs || []) as any[]).map((i) => [i.id, i.partner_id]));
      const seen = new Set<string>();
      for (const p of items) {
        const partnerId = pidByInv.get(p.tax_invoice_id);
        const alias = p.counterparty!.trim();
        const key = alias.toLowerCase();
        if (!partnerId || seen.has(key)) continue;
        seen.add(key);
        await db.from("partner_aliases")
          .insert({ company_id: companyId, partner_id: partnerId, alias, source: "manual", confidence: 1 })
          .then(() => {}, () => {}); // 중복 unique 충돌은 학습 완료 상태 — 무시
      }
    } catch { /* 학습 실패 비치명 */ }
  };

  // 확정/반려 — 낙관적 제거(핸드오프 §4-B): 클릭 즉시 큐에서 사라지고, 실패 시 롤백.
  //   탭 카운트("확인 N건")는 queue.length 파생이라 자동 동기화. 데이터는 status 변경뿐(삭제 아님).
  const decideMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirmed" | "rejected"; counterparty?: string | null; tax_invoice_id?: string }) => {
      const { error } = await db.from("invoice_settlements").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["settlement-queue", companyId] });
      const prev = qc.getQueryData<QueueRow[]>(["settlement-queue", companyId]);
      qc.setQueryData<QueueRow[]>(["settlement-queue", companyId], (old) => (old || []).filter((m) => m.id !== id));
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settlement-queue", companyId], ctx.prev); // 롤백
      toast(e?.message || "처리 실패", "error");
    },
    onSuccess: (_d, v) => {
      if (v.status === "confirmed" && v.tax_invoice_id) learnAliases([{ counterparty: v.counterparty ?? null, tax_invoice_id: v.tax_invoice_id }]);
      toast(v.status === "confirmed" ? "확정 — 미수금에 반영됩니다" : "반려했습니다", v.status === "confirmed" ? "success" : "info");
    },
    onSettled: () => invalidateAll(),
  });

  // 일괄 확정/반려 — 고신뢰 일괄 또는 선택 건 (동일하게 낙관적 제거)
  const bulkDecideMut = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: "confirmed" | "rejected" }) => {
      if (!ids.length) return 0;
      const { error } = await db.from("invoice_settlements").update({ status }).in("id", ids);
      if (error) throw new Error(error.message);
      return ids.length;
    },
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: ["settlement-queue", companyId] });
      const prev = qc.getQueryData<QueueRow[]>(["settlement-queue", companyId]);
      const idSet = new Set(ids);
      const affected = (prev || []).filter((m) => idSet.has(m.id)); // 별칭 학습용 스냅샷
      qc.setQueryData<QueueRow[]>(["settlement-queue", companyId], (old) => (old || []).filter((m) => !idSet.has(m.id)));
      return { prev, affected };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settlement-queue", companyId], ctx.prev); // 롤백
      toast(e?.message || "일괄 처리 실패", "error");
    },
    onSuccess: (n, v, ctx) => {
      if (v.status === "confirmed" && ctx?.affected?.length) {
        learnAliases(ctx.affected.map((m) => ({ counterparty: m.counterparty, tax_invoice_id: m.tax_invoice_id })));
      }
      setSelected(new Set());
      toast(`${n}건 ${v.status === "confirmed" ? "확정 — 미수금에 반영됩니다" : "반려했습니다"}`, v.status === "confirmed" ? "success" : "info");
    },
    onSettled: () => invalidateAll(),
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
  //   확인 큐 제안(suggested)만 걸린 거래도 open 이라 여기 포함됨 — 제안 건수를 함께 보여 이중 처리 방지.
  //   상단 매칭 기간(engStart~engEnd)을 그대로 적용 + limit 2000.
  const { data: openTx = [] } = useQuery<OpenTx[]>({
    queryKey: ["manual-open-tx", companyId, tab, engStart, engEnd],
    queryFn: async () => {
      const { data } = await db.from("bank_transactions")
        .select("id, amount, settled_amount, transaction_date, counterparty, type, invoice_settlements(status)")
        .eq("company_id", companyId).in("settlement_status", ["open", "partial"]).in("type", ["income", "expense"])
        .gte("transaction_date", engStart).lte("transaction_date", engEnd)
        .gt("amount", 0).order("transaction_date", { ascending: false }).limit(2000);
      return ((data || []) as any[]).map((t) => ({
        ...t,
        suggestedCount: ((t.invoice_settlements || []) as { status: string }[]).filter((s) => s.status === "suggested" || s.status === "needs_review").length,
      })) as OpenTx[];
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

  // 수동 연결 — match_source='manual', status='confirmed' (즉시 미수금 차감).
  //   같은 (거래, 계산서) 쌍에 기존 행(엔진 제안/반려 이력)이 있으면 unique 충돌 대신 그 행을 확정으로 승격.
  const manualMut = useMutation({
    mutationFn: async ({ tx, inv, amount }: { tx: OpenTx; inv: UnsettledInv; amount: number }) => {
      const { data: existing } = await db.from("invoice_settlements")
        .select("id, status").eq("bank_transaction_id", tx.id).eq("tax_invoice_id", inv.id).maybeSingle();
      if (existing) {
        const { error } = await db.from("invoice_settlements")
          .update({ amount, match_type: "manual", match_source: "manual", status: "confirmed", confidence: 1, reason: "수동 연결" })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await db.from("invoice_settlements").insert({
        company_id: companyId, bank_transaction_id: tx.id, tax_invoice_id: inv.id,
        amount, match_type: "manual", match_source: "manual", status: "confirmed", confidence: 1, reason: "수동 연결",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      learnAliases([{ counterparty: v.tx.counterparty, tax_invoice_id: v.inv.id }]); // 수동 연결도 별칭 학습
      invalidateAll(); qc.invalidateQueries({ queryKey: ["manual-open-tx"] }); qc.invalidateQueries({ queryKey: ["manual-unsettled-inv"] }); setMatchTx(null); setInvSearch(""); toast("연결 완료 — 미수금에 반영됩니다", "success");
    },
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

  return (
    <div className="space-y-6">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">매칭허브</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">입금·계산서 자동 매칭 — 확정한 매칭만 거래처 원장 잔액에 반영됩니다</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/partners/ledger" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래처 원장</Link>
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
        {([["queue", `확인 큐${queue.length ? ` (${queue.length})` : ""}`], ["manual", "수동 매칭"], ["confirmed", `확정 내역${confirmed.length ? ` (${confirmed.length})` : ""}`]] as const).map(([k, label]) => (
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
              {/* 위하고식 그리드: 통장거래 | 세금계산서 | 정산액 | 유형 | 신뢰도 | 처리 */}
              <div className="glass-card overflow-hidden">
                <div className="overflow-auto max-h-[600px]">
                  <table ref={queueTableRef} className="w-full min-w-[1020px] text-xs border-collapse" style={{ tableLayout: "fixed" }}>
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                        <th className="px-2 py-2 text-center" style={{ width: queueW.sel }}>
                          <input type="checkbox" checked={selected.size === queue.length && queue.length > 0}
                            onChange={(e) => setSelected(e.target.checked ? new Set(queue.map((m) => m.id)) : new Set())}
                            className="accent-[var(--primary)] w-3.5 h-3.5 align-middle cursor-pointer" />
                        </th>
                        <ResizableTh k="tdate" colIndex={1} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-left`}>거래일자</ResizableTh>
                        <ResizableTh k="ttype" colIndex={2} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-center`}>구분</ResizableTh>
                        <ResizableTh k="cp" colIndex={3} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-left`}>입금자/거래처</ResizableTh>
                        <ResizableTh k="tamt" colIndex={4} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-right`}>거래금액</ResizableTh>
                        <ResizableTh k="idate" colIndex={5} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-left`}>발행일자</ResizableTh>
                        <ResizableTh k="icp" colIndex={6} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-left`}>계산서 거래처</ResizableTh>
                        <ResizableTh k="iamt" colIndex={7} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-right`}>계산서 금액</ResizableTh>
                        <ResizableTh k="amt" colIndex={8} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-right`}>정산액</ResizableTh>
                        <ResizableTh k="mtype" colIndex={9} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-center`}>유형</ResizableTh>
                        <ResizableTh k="conf" colIndex={10} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-center`}>신뢰도</ResizableTh>
                        <ResizableTh k="act" colIndex={11} widths={queueW} onResize={setQueueW} tableRef={queueTableRef} className={`${GRID_TH} text-center`}>처리</ResizableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.map((m) => (
                        <tr key={m.id} title={m.reason || ""}
                          className={`border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50 ${selected.has(m.id) ? "bg-[var(--primary)]/5" : ""}`}>
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} className="accent-[var(--primary)] w-3.5 h-3.5 align-middle cursor-pointer" />
                          </td>
                          <td className={`${GRID_TD} text-[var(--text-muted)] mono-number`}>{m.transaction_date}</td>
                          <td className={`${GRID_TD} text-center`}>
                            <span className={`font-semibold ${m.txn_type === "income" ? "text-emerald-500" : "text-red-400"}`}>{m.txn_type === "income" ? "입금" : "출금"}</span>
                          </td>
                          <td className={`${GRID_TD} text-[var(--text)]`} title={m.counterparty || ""}>{m.counterparty || "—"}</td>
                          <td className={`${GRID_TD} text-right mono-number text-[var(--text)]`}>{fmt(m.txn_amount)}</td>
                          <td className={`${GRID_TD} text-[var(--text-muted)] mono-number`}>{m.issue_date}</td>
                          <td className={`${GRID_TD} text-[var(--text)]`} title={m.counterparty_name || ""}>{m.counterparty_name || "—"}</td>
                          <td className={`${GRID_TD} text-right mono-number text-[var(--text)]`}>{fmt(m.invoice_amount)}</td>
                          <td className={`${GRID_TD} text-right mono-number font-semibold text-[var(--text)]`}>{fmt(m.amount)}</td>
                          <td className={`${GRID_TD} text-center`}>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold whitespace-nowrap">{MATCH_LABEL[m.match_type] || m.match_type}</span>
                          </td>
                          <td className={`${GRID_TD} text-center`}>
                            {m.confidence != null ? (() => { const t = confTier(m.confidence); return <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${t.cls}`}>{Math.round(m.confidence * 100)}% {t.label}</span>; })() : "—"}
                          </td>
                          <td className={`${GRID_TD} text-center whitespace-nowrap`}>
                            <button onClick={() => decideMut.mutate({ id: m.id, status: "confirmed", counterparty: m.counterparty, tax_invoice_id: m.tax_invoice_id })} disabled={decideMut.isPending}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50">확정</button>
                            <button onClick={() => decideMut.mutate({ id: m.id, status: "rejected" })} disabled={decideMut.isPending}
                              className="ml-1 px-2 py-1 text-[11px] font-semibold rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400">반려</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "manual" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-muted)]">
              규칙·AI 가 못 잡은 입금을 직접 세금계산서에 연결합니다. 연결 즉시 확정되어 미수금에 반영됩니다.
              <span className="ml-2 text-[var(--text-dim)]">기간 {engStart} ~ {engEnd} (상단에서 변경) · {openTx.filter((t) => !manualSearch.trim() || (t.counterparty || "").toLowerCase().includes(manualSearch.trim().toLowerCase())).length}건</span>
            </p>
            <input value={manualSearch} onChange={(e) => setManualSearch(e.target.value)} placeholder="거래처(입금자) 검색"
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] w-44" />
          </div>
          {openTx.length === 0 ? (
            <div className="p-12 text-center glass-card text-sm text-[var(--text-muted)]">이 기간({engStart} ~ {engEnd})에 미정산 입출금이 없습니다. 상단에서 기간을 조정해 보세요.</div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full min-w-[680px] text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className={`${GRID_TH} text-left w-[92px]`}>거래일자</th>
                      <th className={`${GRID_TH} text-center w-[52px]`}>구분</th>
                      <th className={`${GRID_TH} text-left`}>거래처(입금자)</th>
                      <th className={`${GRID_TH} text-right w-[120px]`}>거래금액</th>
                      <th className={`${GRID_TH} text-right w-[120px]`}>기정산</th>
                      <th className={`${GRID_TH} text-right w-[120px]`}>잔여</th>
                      <th className={`${GRID_TH} text-center w-[130px]`}>처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTx.filter((t) => !manualSearch.trim() || (t.counterparty || "").toLowerCase().includes(manualSearch.trim().toLowerCase())).map((t) => (
                      <tr key={t.id} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50">
                        <td className={`${GRID_TD} text-[var(--text-muted)] mono-number`}>{t.transaction_date}</td>
                        <td className={`${GRID_TD} text-center`}>
                          <span className={`font-semibold ${t.type === "income" ? "text-emerald-500" : "text-red-400"}`}>{t.type === "income" ? "입금" : "출금"}</span>
                        </td>
                        <td className={`${GRID_TD} text-[var(--text)] max-w-[220px]`}>
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{t.counterparty || "—"}</span>
                            {(t.suggestedCount ?? 0) > 0 && (
                              <button onClick={() => setTab("queue")}
                                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold hover:bg-amber-500/20 transition"
                                title="이 거래에 자동 매칭 제안이 확인 큐에 대기 중입니다 — 클릭하면 확인 큐로 이동. 여기서 직접 연결하면 그 제안과 별개로 확정됩니다.">
                                제안 {t.suggestedCount}건
                              </button>
                            )}
                          </span>
                        </td>
                        <td className={`${GRID_TD} text-right mono-number text-[var(--text)]`}>{fmt(t.amount)}</td>
                        <td className={`${GRID_TD} text-right mono-number text-[var(--text-muted)]`}>{fmt(t.settled_amount)}</td>
                        <td className={`${GRID_TD} text-right mono-number font-semibold text-[var(--text)]`}>{fmt(txRemaining(t))}</td>
                        <td className={`${GRID_TD} text-center`}>
                          <button onClick={() => { setMatchTx(t); setInvSearch(""); }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                            세금계산서 연결
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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

      {tab === "confirmed" && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">확정된 매칭 내역입니다. 잘못 확정한 건은 “확정 취소”로 되돌리면 미수금이 자동 원복되고 확인 큐로 돌아갑니다.</p>
          {confirmed.length === 0 ? (
            <div className="p-12 text-center glass-card text-sm text-[var(--text-muted)]">확정된 매칭이 없습니다.</div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full min-w-[1020px] text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className={`${GRID_TH} text-left w-[88px]`}>거래일자</th>
                      <th className={`${GRID_TH} text-center w-[64px]`}>구분</th>
                      <th className={`${GRID_TH} text-left`}>입금자/사유</th>
                      <th className={`${GRID_TH} text-right w-[110px]`}>거래금액</th>
                      <th className={`${GRID_TH} text-left w-[88px]`}>발행일자</th>
                      <th className={`${GRID_TH} text-left`}>계산서 거래처</th>
                      <th className={`${GRID_TH} text-right w-[110px]`}>계산서 금액</th>
                      <th className={`${GRID_TH} text-right w-[110px]`}>정산액</th>
                      <th className={`${GRID_TH} text-center w-[80px]`}>유형</th>
                      <th className={`${GRID_TH} text-center w-[96px]`}>처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmed.map((m) => {
                      const isAdj = m.match_type === "adjustment";
                      return (
                        <tr key={m.id} className={`border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50 ${isAdj ? "bg-amber-500/5" : ""}`}>
                          <td className={`${GRID_TD} text-[var(--text-muted)] mono-number`}>{isAdj ? "—" : m.transaction_date}</td>
                          <td className={`${GRID_TD} text-center`}>
                            {isAdj ? (
                              <span className="font-semibold text-amber-500">차액마감</span>
                            ) : (
                              <span className={`font-semibold ${m.txn_type === "income" ? "text-emerald-500" : "text-red-400"}`}>{m.txn_type === "income" ? "입금" : "출금"}</span>
                            )}
                          </td>
                          <td className={`${GRID_TD} truncate max-w-[160px] ${isAdj ? "text-amber-500" : "text-[var(--text)]"}`}>
                            {isAdj ? (ADJ_REASON_LABEL[(m as any).adjustment_reason] || m.reason || "잔액 정리") : (m.counterparty || "—")}
                          </td>
                          <td className={`${GRID_TD} text-right mono-number text-[var(--text)]`}>{isAdj ? "—" : fmt(m.txn_amount)}</td>
                          <td className={`${GRID_TD} text-[var(--text-muted)] mono-number`}>{m.issue_date}</td>
                          <td className={`${GRID_TD} text-[var(--text)] truncate max-w-[160px]`}>{m.counterparty_name || "—"}</td>
                          <td className={`${GRID_TD} text-right mono-number text-[var(--text)]`}>{fmt(m.invoice_amount)}</td>
                          <td className={`${GRID_TD} text-right mono-number font-semibold text-[var(--text)]`}>{fmt(m.amount)}</td>
                          <td className={`${GRID_TD} text-center`}>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${isAdj ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"}`}>
                              {m.match_source === "manual" && !isAdj ? "수동 연결" : MATCH_LABEL[m.match_type] || m.match_type}
                            </span>
                          </td>
                          <td className={`${GRID_TD} text-center`}>
                            <button onClick={() => unconfirmMut.mutate(m)} disabled={unconfirmMut.isPending}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-amber-500 hover:border-amber-500/40 disabled:opacity-50"
                              title={isAdj ? "차액 마감을 취소하고 잔액을 원복합니다" : "확정을 취소하고 미수금을 원복합니다 (확인 큐로 되돌아감)"}>{isAdj ? "마감 취소" : "확정 취소"}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-dim)]">※ 확정한 매칭만 미수금에서 차감됩니다. 거래처별 잔액은 <Link href="/partners/ledger" className="text-[var(--primary)] hover:underline">거래처 원장</Link>에서 확인하세요.</p>
    </div>
  );
}
