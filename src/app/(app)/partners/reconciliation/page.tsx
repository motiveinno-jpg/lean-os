"use client";

// 거래 대사 — 입금·계산서 자동 매칭 (2026-06-12 메뉴 분리: 구 거래처원장의 작업 화면).
//   탭1 확인 큐: 규칙엔진/AI 제안 매칭을 확정/반려. 확정 시 트리거가 미수금 차감 + 자동 차액마감.
//   탭2 수동 매칭: 못 잡은 입출금을 직접 세금계산서에 연결.
//   탭3 확정 내역: 확정 취소(원복) / 차액마감 취소.
//   조회(거래처별 잔액)는 /partners/ledger (거래처 원장).

import { useMemo, useRef, useState, useEffect } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import {
  type QueueRow, type OpenTx, type UnsettledInv,
  won, fmt, GRID_TH, GRID_TD, MATCH_LABEL, ADJ_REASON_LABEL,
  useColWidths, ResizableTh,
} from "../ledger/shared";
import { STAGE_LABEL } from "@/lib/project-rules";

export default function ReconciliationPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const matchCd = useSyncCooldown(companyId, "match");
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase as any;
  const [tab, setTab] = useState<"queue" | "manual" | "confirmed">("queue");
  const [selected, setSelected] = useState<Set<string>>(new Set()); // 확인 큐 선택 매칭
  const [matchTx, setMatchTx] = useState<OpenTx | null>(null); // 수동 매칭 대상 입금
  const [invSearch, setInvSearch] = useState("");
  const [matchDocType, setMatchDocType] = useState<"invoice" | "cash" | "card" | "voucher">("invoice"); // 수동매칭 연결 대상 종류
  const [newAcct, setNewAcct] = useState<{ code: string; name: string; type: string } | null>(null); // 직접입력용 커스텀 계정 추가 폼
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set()); // 카드 다대일 선택
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
  const { data: queueRaw = [], isLoading: qLoading } = useQuery<QueueRow[]>({
    queryKey: ["settlement-queue", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_settlement_review_queue").select("*").eq("company_id", companyId)
        .order("confidence", { ascending: false });
      return ((data || []) as QueueRow[]).filter((m) => QUEUE_STATUSES.includes(m.status));
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });
  // 이미 정산완료된 세금계산서에 대한 stale 추천 제외 — generate_settlement_suggestions 가
  //   확정 이후에도 같은 송장에 새 제안을 만들 수 있어, 완납 송장의 추천이 큐에 다시 뜨던 문제 방어.
  const queueInvIds = useMemo(
    () => [...new Set((queueRaw as QueueRow[]).map((m) => m.tax_invoice_id).filter(Boolean))],
    [queueRaw],
  );
  const { data: settledInvSet } = useQuery<Set<string>>({
    queryKey: ["queue-settled-inv", companyId, queueInvIds.join(",")],
    queryFn: async () => {
      if (!queueInvIds.length) return new Set<string>();
      const { data } = await db.from("tax_invoices")
        .select("id, total_amount, settled_amount, settlement_status")
        .in("id", queueInvIds);
      const s = new Set<string>();
      for (const i of ((data || []) as any[])) {
        const total = Math.abs(Number(i.total_amount || 0));
        const settled = Math.abs(Number(i.settled_amount || 0));
        if (i.settlement_status === "settled" || (total > 0 && settled >= total - 1)) s.add(i.id);
      }
      return s;
    },
    enabled: !!companyId && queueInvIds.length > 0,
  });

  // 큐도 상단 기간(engStart~engEnd)으로 필터 — 거래일(통장)과 계산서 발행일이 "둘 다" 기간 내여야 표시.
  //   이전엔 거래일만 봐서, 기간 내 입금이 기간 밖(예: 2025년) 계산서에 매칭된 제안이 계속 떴음.
  //   날짜 없는 값(차액 마감 등)은 해당 날짜 기준으로는 숨기지 않는다.
  const queue = useMemo(() => {
    const inPeriod = (d?: string | null) => !d || (d >= engStart && d <= engEnd);
    return (queueRaw as QueueRow[]).filter((m) =>
      inPeriod(m.transaction_date) && inPeriod(m.issue_date) && !settledInvSet?.has(m.tax_invoice_id));
  }, [queueRaw, engStart, engEnd, settledInvSet]);

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

  // AI 전표 탭은 '거래 정리'(확인 큐)에 통합됨 — 정산 확정 시 DB 트리거(post_settlement_voucher)가
  //   분개 전표를 자동 기장하고, 확정 취소 시 void_settlement_voucher 가 자동 무효화한다.
  //   (마이그 20260616190000). 별도 전표 검토 탭/수기 승인 흐름 제거.

  // 확정 취소/되돌리기 — status 를 'suggested' 로 원복 → trg_recalc_settlement 가 미수금 자동 원복(확인 큐로 복귀)
  //   차액 마감(adjustment) 행은 통장거래가 없어 확인 큐로 못 돌아가므로 'rejected' 로 종결 (잔액만 원복).
  const unconfirmMut = useMutation({
    mutationFn: async (m: { id: string; match_type: string }) => {
      const next = m.match_type === "adjustment" ? "rejected" : "suggested";
      const { error } = await db.from("invoice_settlements").update({ status: next }).eq("id", m.id);
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => { invalidateAll(); toast(next === "rejected" ? "차액 마감 취소 — 잔액·전표가 원복되었습니다" : "확정 취소 — 미수금·전표가 원복되었고 거래 정리로 되돌렸습니다", "info"); },
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

  // AI 매칭 — 규칙으로 안 풀린 입금을 Claude 로 매칭. 클릭 1회로 끝까지 자동 반복(50건씩, 더 없을 때까지).
  const [aiProgress, setAiProgress] = useState<{ total: number; processed: number; suggested: number } | null>(null);
  const aiMut = useMutation({
    mutationFn: async () => {
      // 진행률 분모 — 아직 AI 시도 안 한 미정산 건수
      const { count: total } = await db.from("bank_transactions").select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("settlement_status", "open").in("type", ["income", "expense"])
        .is("ai_attempted_at", null).gt("amount", 0);
      let totalProcessed = 0, totalResolved = 0, totalSuggested = 0;
      setAiProgress({ total: total ?? 0, processed: 0, suggested: 0 });
      for (let round = 0; round < 100; round++) { // 안전 상한 100*30=3000건
        const { data, error } = await supabase.functions.invoke("settlement-ai-match", { body: { companyId, limit: 50 } });
        if (error) throw new Error(error.message);
        if ((data as any)?.error) throw new Error((data as any).error);
        const r = data as { processed: number; resolved: number; suggested: number; remaining?: number };
        totalProcessed += r.processed || 0;
        totalResolved += r.resolved || 0;
        totalSuggested += r.suggested || 0;
        setAiProgress({ total: total ?? totalProcessed, processed: totalProcessed, suggested: totalSuggested });
        qc.invalidateQueries({ queryKey: ["settlement-queue"] }); // 라운드마다 큐 실시간 반영
        if ((r.processed || 0) === 0) break; // 더 처리할 입금 없음 → 종료
      }
      return { processed: totalProcessed, resolved: totalResolved, suggested: totalSuggested };
    },
    onSuccess: (r) => { invalidateAll(); setAiProgress(null); toast(`AI 매칭 완료 — ${r.processed}건 분석 · 제안 ${r.suggested}건 생성`, "success"); },
    onError: (e: any) => { setAiProgress(null); toast(e?.message || "AI 매칭 실패", "error"); },
  });
  // 대기 중 재미용 회전 메시지
  const AI_MSGS = ["통장 입금을 살펴보는 중...", "거래처를 찾아내는 중 🔎", "금액을 맞춰보는 중 🧮", "세금계산서와 연결하는 중 🔗", "패턴을 학습하는 중 🧠", "조금만 더요! 💪"];
  const [aiMsgIdx, setAiMsgIdx] = useState(0);
  useEffect(() => {
    if (!aiMut.isPending) { setAiMsgIdx(0); return; }
    const t = setInterval(() => setAiMsgIdx((i) => (i + 1) % AI_MSGS.length), 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMut.isPending]);

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
  // DB 가드(중복 매칭 차단) 에러코드 → 안내 문구
  const settlementErrMsg = (raw: any): string => {
    const m = String(raw?.message || raw || "");
    if (m.includes("BANK_TX_OVERMATCH")) return "이미 다른 세금계산서에 확정된 통장거래입니다 — 한 입출금은 중복 매칭할 수 없습니다";
    if (m.includes("INVOICE_OVERSETTLE")) return "이미 정산이 완료된 세금계산서입니다 — 중복 확정할 수 없습니다";
    return m || "처리 실패";
  };

  // 확정 후 프로젝트 연결 제안 — 계산서상 거래처(partner_id)와 같은 거래처를 가진 프로젝트가 있으면
  //   팝업으로 보여주고, 선택 시 tax_invoices.deal_id 를 연결(= 프로젝트 운영 > 비용 구성에 집계).
  const [linkPrompt, setLinkPrompt] = useState<null | { taxInvoiceId: string; counterparty: string; deals: { id: string; name: string; stage: string }[] }>(null);
  const [linkSelected, setLinkSelected] = useState<string>("");
  const maybePromptProjectLink = async (taxInvoiceId?: string, counterparty?: string | null) => {
    try {
      if (!taxInvoiceId || !companyId) return;
      // 비용 구성은 매입(purchase) 계산서만 집계 — 매입 계산서일 때만 연결 제안
      const { data: inv } = await db.from("tax_invoices").select("id, partner_id, deal_id, counterparty_name, type").eq("id", taxInvoiceId).maybeSingle();
      if (!inv || inv.type !== "purchase" || !inv.partner_id) return;
      const { data: deals } = await db.from("deals")
        .select("id, name, stage").eq("company_id", companyId).eq("partner_id", inv.partner_id)
        .order("created_at", { ascending: false });
      if (!deals || deals.length === 0) return;
      const preset = inv.deal_id && (deals as any[]).some((d) => d.id === inv.deal_id) ? inv.deal_id : deals.length === 1 ? deals[0].id : "";
      setLinkSelected(preset);
      setLinkPrompt({ taxInvoiceId, counterparty: inv.counterparty_name || counterparty || "거래처", deals: deals as any[] });
    } catch { /* 연결 제안 실패는 확정 자체에 영향 없음 — 무시 */ }
  };
  const linkProjectMut = useMutation({
    mutationFn: async ({ taxInvoiceId, dealId }: { taxInvoiceId: string; dealId: string }) => {
      const { error } = await db.from("tax_invoices").update({ deal_id: dealId }).eq("id", taxInvoiceId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast("프로젝트 비용 구성에 연결했습니다", "success"); setLinkPrompt(null); setLinkSelected(""); },
    onError: (e: any) => toast(e?.message || "프로젝트 연결 실패", "error"),
  });

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
      toast(settlementErrMsg(e), "error");
    },
    onSuccess: (_d, v) => {
      if (v.status === "confirmed" && v.tax_invoice_id) {
        learnAliases([{ counterparty: v.counterparty ?? null, tax_invoice_id: v.tax_invoice_id }]);
        maybePromptProjectLink(v.tax_invoice_id, v.counterparty ?? null);
      }
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
      toast(settlementErrMsg(e), "error");
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
  //   확인 큐 제안(suggested)만 걸린 거래도 open 이라 여기 포함됨 — 제안 건수·상대 계산서 거래처를 함께 표시.
  //   (통장 입금자명 ≠ 계산서 거래처인 케이스에서 "추천에 뜬 거래를 수동매칭에서 못 찾는" 문제 해결 — 검색도 양쪽 매칭)
  //   상단 매칭 기간(engStart~engEnd)을 그대로 적용 + limit 2000.
  const { data: openTx = [] } = useQuery<OpenTx[]>({
    queryKey: ["manual-open-tx", companyId, tab, engStart, engEnd],
    queryFn: async () => {
      const { data } = await db.from("bank_transactions")
        .select("id, amount, settled_amount, transaction_date, counterparty, type, invoice_settlements(status, tax_invoices(counterparty_name))")
        .eq("company_id", companyId).in("settlement_status", ["open", "partial"]).in("type", ["income", "expense"])
        .gte("transaction_date", engStart).lte("transaction_date", engEnd)
        .gt("amount", 0).order("transaction_date", { ascending: false }).limit(2000);
      return ((data || []) as any[]).map((t) => {
        const pending = ((t.invoice_settlements || []) as { status: string; tax_invoices?: { counterparty_name: string | null } | null }[])
          .filter((s) => s.status === "suggested" || s.status === "needs_review");
        return {
          ...t,
          suggestedCount: pending.length,
          suggestedPartners: [...new Set(pending.map((s) => s.tax_invoices?.counterparty_name).filter(Boolean))] as string[],
        };
      }) as OpenTx[];
    },
    enabled: !!companyId && tab === "manual",
  });

  // 수동 매칭 검색 — 통장 입금자명 + 추천(제안) 계산서 거래처 양쪽 매칭
  const manualTxMatch = (t: OpenTx) => {
    const q = manualSearch.trim().toLowerCase();
    if (!q) return true;
    if ((t.counterparty || "").toLowerCase().includes(q)) return true;
    return (t.suggestedPartners || []).some((n) => n.toLowerCase().includes(q));
  };

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

  // 현금영수증(미연결) — 통장거래에 마킹 연결 후보
  const { data: cashReceipts = [] } = useQuery<any[]>({
    queryKey: ["manual-cash", companyId, tab],
    queryFn: async () => {
      const { data } = await db.from("cash_receipts")
        .select("id, type, issue_date, amount, counterparty_name, approval_number")
        .eq("company_id", companyId).is("bank_transaction_id", null)
        .order("issue_date", { ascending: false }).limit(2000);
      return (data || []) as any[];
    },
    enabled: !!companyId && tab === "manual",
  });
  // 카드사용 내역 — 통장거래(카드대금)에 마킹 연결 후보
  const { data: cardTxns = [] } = useQuery<any[]>({
    queryKey: ["manual-card", companyId, tab],
    queryFn: async () => {
      const { data } = await db.from("card_transactions")
        .select("id, transaction_date, amount, merchant_name, card_name, approval_number")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false }).limit(1000);
      return (data || []) as any[];
    },
    enabled: !!companyId && tab === "manual",
  });
  // 직접입력(전표) — 계정과목 마스터 (증빙 없는 거래를 계정으로 바로 기장)
  const { data: coaAccounts = [] } = useQuery<any[]>({
    queryKey: ["recon-coa", companyId],
    queryFn: async () => {
      const { data } = await db.from("chart_of_accounts").select("id, code, name, account_type, is_system").eq("company_id", companyId).order("code");
      return (data || []) as any[];
    },
    enabled: !!companyId && tab === "manual",
  });

  // 현금영수증 연결 — cash_receipts.bank_transaction_id 세팅 + 통장거래 settled 마킹
  const cashLinkMut = useMutation({
    mutationFn: async ({ tx, receipt }: { tx: OpenTx; receipt: any }) => {
      const { error: e1 } = await db.from("cash_receipts").update({ bank_transaction_id: tx.id }).eq("id", receipt.id);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await db.from("bank_transactions").update({ settlement_status: "settled", settled_amount: tx.amount }).eq("id", tx.id);
      if (e2) throw new Error(e2.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["manual-open-tx"] }); qc.invalidateQueries({ queryKey: ["manual-cash"] }); setMatchTx(null); setInvSearch(""); toast("현금영수증 연결 완료", "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });
  // 카드사용 연결 — bank_transactions.card_transaction_id 세팅 + settled 마킹
  // 카드 다대일 — 선택한 카드내역들을 이 통장거래(카드대금)에 연결
  const cardMultiLinkMut = useMutation({
    mutationFn: async ({ tx, cardIds }: { tx: OpenTx; cardIds: string[] }) => {
      if (cardIds.length === 0) return;
      const { error: e1 } = await db.from("card_transactions").update({ bank_transaction_id: tx.id }).in("id", cardIds);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await db.from("bank_transactions").update({ settlement_status: "settled", settled_amount: tx.amount }).eq("id", tx.id);
      if (e2) throw new Error(e2.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["manual-open-tx"] }); qc.invalidateQueries({ queryKey: ["manual-card"] }); setMatchTx(null); setInvSearch(""); setSelectedCardIds(new Set()); toast("카드사용 연결 완료", "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  // 직접입력(전표) — 증빙 없는 거래를 계정과목으로 바로 분개 기장(post_bank_voucher) + 정산완료 마킹.
  //   예: 사무실 임차보증금(자산) 등 증빙 없이 자산·비용으로 처리해야 하는 입출금.
  const voucherMut = useMutation({
    mutationFn: async ({ tx, accountId }: { tx: OpenTx; accountId: string }) => {
      const { error } = await db.rpc("post_bank_voucher", { p_bank_tx_id: tx.id, p_account_id: accountId, p_remember: false });
      if (error) throw new Error(error.message);
      // 증빙 매칭이 아니라 전표로 정리 — 미정산 목록에서 제외
      await db.from("bank_transactions").update({ settlement_status: "settled", settled_amount: tx.amount }).eq("id", tx.id);
    },
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["manual-open-tx"] }); setMatchTx(null); setInvSearch(""); toast("전표 처리 완료 — 거래가 정리되었습니다", "success"); },
    onError: (e: any) => toast(e?.message || "전표 처리 실패", "error"),
  });
  // 직접입력용 커스텀 계정과목 추가 (is_system=false, 회사스코프 RLS)
  const addAcctMut = useMutation({
    mutationFn: async (a: { code: string; name: string; type: string }) => {
      const { error } = await db.from("chart_of_accounts").insert({ company_id: companyId, code: a.code.trim(), name: a.name.trim(), account_type: a.type, is_system: false });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recon-coa"] }); setNewAcct(null); toast("계정과목 추가됨", "success"); },
    onError: (e: any) => toast(e?.message || "계정 추가 실패 (코드 중복 등)", "error"),
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
  const coaFiltered = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    if (!q) return coaAccounts as any[];
    return (coaAccounts as any[]).filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q));
  }, [coaAccounts, invSearch]);
  const filteredInv = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, "");
    return unsettledInv
      .filter((i) => i.type === matchInvType && invRemaining(i) > 0)
      .filter((i) => {
        if (!q) return true;
        if ((i.counterparty_name || "").toLowerCase().includes(q)) return true; // 거래처명
        if (qDigits) { // 금액(잔액·총액, 콤마/원 무시)
          const amt = String(Math.round(invRemaining(i)));
          const tot = String(Math.round(Number(i.total_amount || 0)));
          if (amt.includes(qDigits) || tot.includes(qDigits)) return true;
        }
        return false;
      })
      .slice(0, 100);
  }, [unsettledInv, invSearch, matchInvType]);

  // 거래처명 + 금액 공통 검색 (현금영수증·카드 목록용)
  const matchSearch = (name: string | null | undefined, amount: number) => {
    const q = invSearch.trim().toLowerCase();
    if (!q) return true;
    if ((name || "").toLowerCase().includes(q)) return true;
    const qd = q.replace(/[^0-9]/g, "");
    return !!qd && String(Math.round(amount || 0)).includes(qd);
  };
  const filteredCash = useMemo(
    () => cashReceipts.filter((c) => matchSearch(c.counterparty_name, Number(c.amount))).slice(0, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cashReceipts, invSearch],
  );
  const filteredCard = useMemo(
    () => cardTxns.filter((c) => matchSearch(c.merchant_name, Number(c.amount))).slice(0, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardTxns, invSearch],
  );
  const cardSelectedSum = (cardTxns as any[]).filter((c) => selectedCardIds.has(c.id)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const toggleCard = (id: string) => setSelectedCardIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-6">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">Reconciliation</p>
          <h1 className="text-2xl font-extrabold text-[var(--text)] mt-0.5">거래 매칭</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">입금·계산서 자동 매칭 — 확정한 매칭만 거래처 원장 잔액에 반영됩니다</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/partners/ledger" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래처 원장</Link>
          <button onClick={() => !linkMut.isPending && linkMut.mutate()} disabled={linkMut.isPending}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
            title="홈택스 세금계산서 거래처를 사업자번호로 자동 등록·연결">
            {linkMut.isPending ? "연결 중..." : "홈택스 거래처 연결"}</button>
          <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 py-1">
            <DateField value={engStart} max={engEnd} onChange={(e) => setEngStart(e.target.value)}
              className="bg-transparent text-[11px] text-[var(--text)] outline-none" />
            <span className="caption">~</span>
            <DateField value={engEnd} min={engStart} max={dStr(0)} onChange={(e) => setEngEnd(e.target.value)}
              className="bg-transparent text-[11px] text-[var(--text)] outline-none" />
          </span>
          <button onClick={() => !engineMut.isPending && engineMut.mutate()} disabled={engineMut.isPending || !engStart || !engEnd || engStart > engEnd}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
            title="선택 기간(최대 6개월)의 미정산 입금과 세금계산서를 규칙으로 매칭. 여러 기간 반복해도 기존 매칭은 유지·누적됩니다.">
            {engineMut.isPending ? "매칭 중..." : "⚙️ 이 기간 매칭"}</button>
          <button onClick={() => matchCd.run(() => { if (!aiMut.isPending) aiMut.mutate(); })} disabled={aiMut.isPending || matchCd.disabled}
            className={`px-4 py-2 text-xs font-semibold rounded-lg bg-purple-500 text-white hover:opacity-90 disabled:opacity-50 ${matchCd.disabled ? "!opacity-40 cursor-not-allowed" : ""}`}
            title={matchCd.disabled ? `30분 쿨타임 — ${matchCd.label}` : "규칙으로 안 풀린 입금을 AI(Claude)로 한 번에 끝까지 매칭(자동 반복). 시간이 걸릴 수 있습니다."}>
            {aiMut.isPending ? (aiProgress ? `AI 분석 중... ${aiProgress.processed}건 (제안 ${aiProgress.suggested})` : "AI 분석 중...") : matchCd.disabled ? `⏳ ${matchCd.label}` : "✨ AI 전체 매칭"}</button>
        </div>
      </div>

      {/* AI 전체 매칭 진행 오버레이 — 실시간 진행률 + 애니메이션 */}
      {aiMut.isPending && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-sm p-7 text-center">
            <div className="relative mx-auto mb-3 w-16 h-16 flex items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping" />
              <span className="relative text-5xl animate-bounce">🤖</span>
            </div>
            <div className="text-base font-bold">AI가 거래를 매칭하고 있어요</div>
            <div className="text-xs text-[var(--text-muted)] mt-1 mb-4 h-4 transition-all">{AI_MSGS[aiMsgIdx]}</div>
            {(() => {
              const total = aiProgress?.total ?? 0;
              const processed = aiProgress?.processed ?? 0;
              const suggested = aiProgress?.suggested ?? 0;
              const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
              return (
                <>
                  <div className="h-3 rounded-full bg-[var(--bg-surface)] overflow-hidden mb-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 transition-all duration-700 ease-out relative" style={{ width: `${Math.max(pct, 3)}%` }}>
                      <span className="absolute inset-0 bg-white/25 animate-pulse" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="text-[var(--text-muted)] mono-number">{processed}{total ? ` / ${total}` : ""}건 분석</span>
                    <span className="font-bold text-purple-500 mono-number">{pct}%</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-purple-500/10 text-purple-500 text-sm font-bold">
                    <span className="animate-pulse">✨</span> 매칭 제안 <span className="mono-number">{suggested}</span>건
                  </div>
                </>
              );
            })()}
            <div className="text-[10px] text-[var(--text-dim)] mt-5 leading-relaxed">이 창을 닫지 마세요 · 완료까지 잠시 기다려 주세요<br />이미 찾은 제안은 거래 정리에 바로 쌓입니다</div>
          </div>
        </div>
      )}

      <div className="tab-bar">
        {([["queue", `거래 정리${queue.length ? ` (${queue.length})` : ""}`], ["manual", "수동 매칭"], ["confirmed", `정리 내역${confirmed.length ? ` (${confirmed.length})` : ""}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`tab-item ${tab === k ? "tab-item-active" : ""}`}>
            {label}</button>
        ))}
      </div>

      {tab === "queue" && (
        <div className="space-y-3">
          {qLoading ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : queue.length === 0 ? (
            <div className="py-14 px-6 text-center glass-card">
              <div className="text-4xl mb-3">✅</div>
              <div className="text-sm font-semibold text-[var(--text)]">이 기간({engStart} ~ {engEnd})에 확인 대기 중인 매칭이 없습니다</div>
              {queueRaw.length > queue.length && (
                <div className="text-[12px] text-[var(--primary)] mt-1.5 font-semibold">이 기간 밖에 미확정 제안 {queueRaw.length - queue.length}건이 있습니다 — 상단에서 기간을 넓혀 보세요.</div>
              )}
              <div className="text-[11px] text-[var(--text-dim)] mt-1 leading-relaxed">
                대기 매칭은 <b>자동 제안</b>만 표시됩니다(상단 기간의 거래일만 노출). 상단에서 기간을 고르고 <b>“⚙️ 이 기간 매칭”</b>(규칙: 입금자명↔거래처)으로 제안을 생성하세요.<br />
                입금자명이 거래처와 다른 건(자사명·개인명 등)은 <b>“✨ AI 매칭”</b>을 누르면 AI가 금액·일자·정황으로 추천합니다(30건씩, 여러 번 눌러 누적).
              </div>
            </div>
          ) : (
            <>
              <div className="glass-card p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <button onClick={() => setSelected(new Set(queue.map((m) => m.id)))} className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] font-semibold">전체 선택</button>
                  {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="px-2.5 py-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text)]">해제</button>}
                  <span className="text-[var(--text-dim)]">{selected.size > 0 ? `${selected.size}건 선택됨` : `이 기간 대기 ${queue.length}건 · 높음 ${highConfIds.length}건${queueRaw.length > queue.length ? ` · 기간 밖 ${queueRaw.length - queue.length}건` : ""}`}</span>
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
              <p className="text-[11px] text-[var(--text-dim)] px-1">확정하면 정산(미수금·미지급 차감)과 <b className="text-[var(--text-muted)]">분개 전표가 함께 장부에 자동 기록</b>됩니다 · 정리 내역에서 되돌리면 정산·전표 둘 다 원복</p>
              {/* 위하고식 그리드: 통장거래 | 세금계산서 | 정산액(+자동분개) | 유형 | 신뢰도 | 처리 */}
              <div className="glass-card overflow-hidden">
                <div className="overflow-auto max-h-[600px]">
                  <table ref={queueTableRef} className="w-full min-w-[1020px] text-xs border-collapse" style={{ tableLayout: "fixed" }}>
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[var(--bg-surface)]/50 border-b border-[var(--border)]">
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
                          <td className={`${GRID_TD} text-right`}>
                            <div className="mono-number font-semibold text-[var(--text)]">{fmt(m.amount)}</div>
                            <div className="text-[9px] text-[var(--text-dim)] font-normal truncate leading-tight"
                              title={`확정 시 자동 기장: ${m.txn_type === "income" ? "(차)보통예금 (대)외상매출금" : "(차)외상매입금 (대)보통예금"}`}>
                              {m.txn_type === "income" ? "차)보통예금·대)외상매출금" : "차)외상매입금·대)보통예금"}
                            </div>
                          </td>
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-muted)]">
              규칙·AI 가 못 잡은 입출금을 세금계산서·현금영수증·카드사용에 직접 연결합니다. 세금계산서는 연결 즉시 미수금에 반영됩니다.
              <span className="ml-2 text-[var(--text-dim)]">기간 {engStart} ~ {engEnd} (상단에서 변경) · {openTx.filter(manualTxMatch).length}건</span>
            </p>
            <input value={manualSearch} onChange={(e) => setManualSearch(e.target.value)} placeholder="입금자·추천 계산서 거래처 검색"
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] w-44" />
          </div>
          {openTx.length === 0 ? (
            <div className="py-14 px-6 text-center glass-card">
              <div className="text-4xl mb-3">🔗</div>
              <div className="text-sm font-semibold text-[var(--text)]">이 기간({engStart} ~ {engEnd})에 미정산 입출금이 없습니다. 상단에서 기간을 조정해 보세요.</div>
              <div className="text-xs text-[var(--text-muted)] mt-1.5">규칙·AI가 못 잡은 입출금이 있으면 여기서 직접 연결할 수 있습니다</div>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full min-w-[680px] text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--bg-surface)]/50 border-b border-[var(--border)]">
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
                    {openTx.filter(manualTxMatch).map((t) => (
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
                                className="shrink-0 max-w-[160px] truncate text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold hover:bg-amber-500/20 transition"
                                title={`이 거래에 자동 매칭 제안이 거래 정리 탭에 대기 중입니다${(t.suggestedPartners?.length ?? 0) > 0 ? ` (추천 계산서: ${t.suggestedPartners!.join(", ")})` : ""} — 클릭하면 이동. 여기서 직접 연결하면 그 제안과 별개로 확정됩니다.`}>
                                제안 {t.suggestedCount}건{(t.suggestedPartners?.length ?? 0) > 0 ? ` · ${t.suggestedPartners![0]}${t.suggestedPartners!.length > 1 ? ` 외 ${t.suggestedPartners!.length - 1}` : ""}` : ""}
                              </button>
                            )}
                          </span>
                        </td>
                        <td className={`${GRID_TD} text-right mono-number text-[var(--text)]`}>{fmt(t.amount)}</td>
                        <td className={`${GRID_TD} text-right mono-number text-[var(--text-muted)]`}>{fmt(t.settled_amount)}</td>
                        <td className={`${GRID_TD} text-right mono-number font-semibold text-[var(--text)]`}>{fmt(txRemaining(t))}</td>
                        <td className={`${GRID_TD} text-center`}>
                          <button onClick={() => { setMatchTx(t); setInvSearch(""); setMatchDocType("invoice"); setSelectedCardIds(new Set()); }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                            연결
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
              <div className="text-sm font-bold text-[var(--text)]">거래 연결</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{matchTx.counterparty || "—"} · {matchTx.transaction_date} · 잔여 {won(txRemaining(matchTx))}</div>
            </div>
            <div className="px-5 pt-3 flex gap-1.5">
              {([["invoice", "세금계산서"], ["cash", "현금영수증"], ["card", "카드사용"], ["voucher", "직접입력"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setMatchDocType(k)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${matchDocType === k ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <input value={invSearch} onChange={(e) => setInvSearch(e.target.value)} placeholder={matchDocType === "voucher" ? "계정과목명 또는 코드로 검색" : "거래처명 또는 금액으로 검색"}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" />
            </div>
            <div className="flex-1 overflow-auto p-2">
              {matchDocType === "invoice" && (
                filteredInv.length === 0 ? (
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
                })
              )}
              {matchDocType === "cash" && (
                filteredCash.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[var(--text-muted)]">연결할 미연결 현금영수증이 없습니다.</div>
                ) : filteredCash.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)]">
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--text)] truncate">{c.counterparty_name || "현금영수증"}</div>
                      <div className="text-[11px] text-[var(--text-dim)]">{c.issue_date} · {won(Number(c.amount))}{c.approval_number ? ` · ${c.approval_number}` : ""}</div>
                    </div>
                    <button onClick={() => cashLinkMut.mutate({ tx: matchTx, receipt: c })} disabled={cashLinkMut.isPending}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">연결</button>
                  </div>
                ))
              )}
              {matchDocType === "card" && (
                <>
                  <p className="px-1 pb-1 text-[11px] text-[var(--text-dim)]">카드대금(이 출금)에 해당하는 카드내역을 여러 건 선택해 한 번에 연결합니다.</p>
                  {filteredCard.length === 0 ? (
                    <div className="p-8 text-center text-sm text-[var(--text-muted)]">연결할 카드사용 내역이 없습니다.</div>
                  ) : filteredCard.map((c) => {
                    const checked = selectedCardIds.has(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)] cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => toggleCard(c.id)} className="accent-[var(--primary)] w-4 h-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[var(--text)] truncate">{c.merchant_name || "카드사용"}</div>
                          <div className="text-[11px] text-[var(--text-dim)]">{c.transaction_date} · {won(Number(c.amount))}{c.card_name ? ` · ${c.card_name}` : ""}</div>
                        </div>
                      </label>
                    );
                  })}
                </>
              )}
              {matchDocType === "voucher" && (
                <div className="space-y-1">
                  <p className="px-1 pb-1 text-[11px] text-[var(--text-dim)]">증빙(세금계산서·현금영수증·카드)이 없는 거래를 계정과목으로 바로 전표처리합니다 (예: 임차보증금 → 자산). 처리하면 이 거래가 정리됩니다.</p>
                  {coaFiltered.length === 0 ? (
                    <div className="p-6 text-center text-sm text-[var(--text-muted)]">{(coaAccounts as any[]).length === 0 ? "계정과목 마스터가 없습니다. 아래에서 추가하세요." : "검색 결과가 없습니다."}</div>
                  ) : coaFiltered.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)]">
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--text)] truncate">{a.name}{!a.is_system && <span className="text-[10px] text-[var(--primary)] ml-1">· 내 계정</span>}</div>
                        <div className="text-[11px] text-[var(--text-dim)] mono-number">{a.code} · {a.account_type}</div>
                      </div>
                      <button onClick={() => voucherMut.mutate({ tx: matchTx, accountId: a.id })} disabled={voucherMut.isPending}
                        className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">전표처리</button>
                    </div>
                  ))}
                  {newAcct ? (
                    <div className="mt-1.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] space-y-2">
                      <div className="text-[11px] font-semibold text-[var(--text-muted)]">새 계정과목 직접 추가</div>
                      <div className="flex gap-1.5">
                        <input value={newAcct.code} onChange={(e) => setNewAcct({ ...newAcct, code: e.target.value })} placeholder="코드(예:176)" className="w-24 px-2 py-1.5 text-xs rounded bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)]" />
                        <input value={newAcct.name} onChange={(e) => setNewAcct({ ...newAcct, name: e.target.value })} placeholder="계정명(예:임차보증금)" className="flex-1 px-2 py-1.5 text-xs rounded bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)]" />
                      </div>
                      <div className="flex gap-1.5">
                        <select value={newAcct.type} onChange={(e) => setNewAcct({ ...newAcct, type: e.target.value })} className="px-2 py-1.5 text-xs rounded bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)]">
                          {([["asset", "자산"], ["liability", "부채"], ["equity", "자본"], ["revenue", "수익"], ["expense", "비용"]] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button onClick={() => addAcctMut.mutate(newAcct)} disabled={addAcctMut.isPending || !newAcct.code.trim() || !newAcct.name.trim()} className="px-3 py-1.5 text-xs font-semibold rounded bg-[var(--primary)] text-white disabled:opacity-50">추가</button>
                        <button onClick={() => setNewAcct(null)} className="px-2 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setNewAcct({ code: "", name: "", type: "asset" })} className="mt-1.5 w-full px-3 py-2 text-xs font-semibold rounded-lg border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]">+ 직접 계정과목 추가 (기본 계정 외)</button>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--text-muted)]">
                {matchDocType === "card" && selectedCardIds.size > 0
                  ? `선택 ${selectedCardIds.size}건 · 합계 ${won(cardSelectedSum)} / 출금 ${won(txRemaining(matchTx))}`
                  : ""}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {matchDocType === "card" && (
                  <button onClick={() => cardMultiLinkMut.mutate({ tx: matchTx, cardIds: [...selectedCardIds] })}
                    disabled={cardMultiLinkMut.isPending || selectedCardIds.size === 0}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                    선택 {selectedCardIds.size}건 연결
                  </button>
                )}
                <button onClick={() => setMatchTx(null)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "confirmed" && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">확정된 매칭 내역입니다. 잘못 확정한 건은 “확정 취소”로 되돌리면 미수금과 <b>분개 전표가 함께 원복</b>되고 거래 정리로 돌아갑니다.</p>
          {confirmed.length === 0 ? (
            <div className="py-14 px-6 text-center glass-card">
              <div className="text-4xl mb-3">📂</div>
              <div className="text-sm font-semibold text-[var(--text)]">확정된 매칭이 없습니다.</div>
              <div className="text-xs text-[var(--text-muted)] mt-1.5">거래 정리 탭에서 매칭을 확정하면 여기에 내역이 쌓입니다</div>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full min-w-[1020px] text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--bg-surface)]/50 border-b border-[var(--border)]">
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
                              title={isAdj ? "차액 마감을 취소하고 잔액·전표를 원복합니다" : "확정을 취소하고 미수금·분개 전표를 원복합니다 (거래 정리로 되돌아감)"}>{isAdj ? "마감 취소" : "확정 취소"}</button>
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

      <p className="text-[11px] text-[var(--text-dim)]">※ 확정하면 미수금/미지급 차감과 분개 전표 기장이 함께 처리됩니다. 거래처별 잔액은 <Link href="/partners/ledger" className="text-[var(--primary)] hover:underline">거래처 원장</Link>에서 확인하세요.</p>

      {/* 확정 후 프로젝트 연결 제안 — 같은 거래처 프로젝트가 있으면 비용 구성에 연결 */}
      {linkPrompt && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4" onClick={() => setLinkPrompt(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-[var(--text)]">프로젝트 비용에 연결</h3>
              <button onClick={() => setLinkPrompt(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              <b className="text-[var(--text)]">{linkPrompt.counterparty}</b> 거래처가 포함된 프로젝트가 {linkPrompt.deals.length}개 있습니다.
              연결할 프로젝트를 선택하면 이 매입 계산서가 해당 <b className="text-[var(--text)]">프로젝트 운영 &gt; 비용 구성</b>에 집계됩니다.
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {linkPrompt.deals.map((d) => (
                <label key={d.id} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition ${linkSelected === d.id ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] hover:bg-[var(--bg-surface)]"}`}>
                  <input type="radio" name="link-deal" checked={linkSelected === d.id} onChange={() => setLinkSelected(d.id)} className="accent-[var(--primary)]" />
                  <span className="text-sm text-[var(--text)] flex-1 truncate">{d.name || "(이름 없음)"}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] whitespace-nowrap">{STAGE_LABEL[d.stage as keyof typeof STAGE_LABEL] || d.stage || "—"}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2.5 mt-5">
              <button onClick={() => setLinkPrompt(null)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">연결 안 함</button>
              <button onClick={() => linkSelected && linkProjectMut.mutate({ taxInvoiceId: linkPrompt.taxInvoiceId, dealId: linkSelected })}
                disabled={!linkSelected || linkProjectMut.isPending}
                className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{linkProjectMut.isPending ? "연결 중..." : "확인"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
