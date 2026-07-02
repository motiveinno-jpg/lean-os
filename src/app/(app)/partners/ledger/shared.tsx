"use client";

// 거래처 원장 ↔ 거래 대사 공유 모듈 (2026-06-12 메뉴 분리 핸드오프).
//   /partners/ledger (조회: 원장) 와 /partners/reconciliation (작업: 대사) 가 공용으로 쓰는
//   타입·포맷·그리드 유틸·원장 시트·거래처 상세(차액 마감 포함).
//   색 규칙(핸드오프 §4-2): 매출처=파랑(#2563EB) / 매입처=주황(#EA580C). 빨강은 연체·마이너스 전용.

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { CellDropdown, anchorOf, type Anchor } from "@/components/cell-dropdown";

const db = supabase as any;

// ── 타입 ──
export type LedgerRow = {
  partner_id: string | null; type: string; invoice_count: number;
  prior_outstanding: number;   // 전기이월(선택연도 이전 미정산)
  period_billed: number;       // 당기 청구
  period_settled: number;      // 당기 정산
  period_outstanding: number;  // 당기 잔액
};
export type QueueRow = {
  id: string; bank_transaction_id: string; tax_invoice_id: string; amount: number;
  match_type: string; match_source: string; status: string; confidence: number | null; reason: string | null;
  transaction_date: string; txn_amount: number; counterparty: string | null; txn_type: string;
  issue_date: string; invoice_amount: number; counterparty_name: string | null; invoice_type: string;
};
export type OpenTx = { id: string; amount: number; settled_amount: number; transaction_date: string; counterparty: string | null; type: string; suggestedCount?: number; suggestedPartners?: string[] };
export type UnsettledInv = { id: string; type: string; issue_date: string; total_amount: number; settled_amount: number; counterparty_name: string | null; partner_id: string | null };

// ── 포맷 ──
export const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;
export const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString(); // 그리드: ₩ 없이 콤마만

// ── 매출/매입 확정 팔레트 (§4-2 — 빨강은 연체 전용으로 예약) ──
export const AR_AP = {
  sales: { main: "#2563EB", tintBg: "bg-blue-500/10", tintText: "text-blue-600", label: "매출처", money: "받을 돈", acct: "외상매출금", arrow: "↘" },
  purchase: { main: "#EA580C", tintBg: "bg-orange-500/10", tintText: "text-orange-600", label: "매입처", money: "줄 돈", acct: "외상매입금", arrow: "↗" },
} as const;
export const palette = (type: string) => (type === "sales" ? AR_AP.sales : AR_AP.purchase);

// ── 위하고식 그리드 공통 셀 클래스 ──
export const GRID_TH = "px-3 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide whitespace-nowrap";
export const GRID_TD = "px-3 py-2.5 whitespace-nowrap overflow-hidden text-ellipsis";

export const MATCH_LABEL: Record<string, string> = {
  one_to_one: "1:1 정확", aggregate: "합산입금", partial: "부분입금", withholding: "원천징수", manual: "수동", adjustment: "차액 마감",
};
// 차액 마감 사유 (close_invoice_balance RPC 의 p_reason 값과 1:1)
export const ADJ_REASONS: { id: string; label: string; desc: string }[] = [
  { id: "withholding_tax", label: "원천징수세", desc: "3.3% / 8.8% 등 원천세 공제분 — 기납부 세액으로 마감" },
  { id: "fee", label: "이체·결제 수수료", desc: "은행/PG 수수료 차감분" },
  { id: "rounding", label: "단수차", desc: "절사·반올림 등 소액 차이" },
  { id: "discount", label: "할인·에누리", desc: "합의된 금액 조정 (수정세금계산서 발행 권장)" },
  { id: "other", label: "기타", desc: "기타 사유로 잔액 정리" },
];
export const ADJ_REASON_LABEL: Record<string, string> = Object.fromEntries(ADJ_REASONS.map((r) => [r.id, r.label]));

// ── 엑셀식 컬럼 리사이즈 ──
//   경계선 드래그 = 너비 조절 · 경계선 더블클릭 = 내용 자동 맞춤 · localStorage 에 기억.
export function useColWidths(storageKey: string, defaults: Record<string, number>) {
  const [w, setW] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return defaults;
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; } catch { return defaults; }
  });
  const set = (k: string, px: number) => setW((prev) => {
    const next = { ...prev, [k]: Math.round(px) };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* noop */ }
    return next;
  });
  return [w, set] as const;
}

export function ResizableTh({ k, colIndex, widths, onResize, tableRef, className, children }: {
  k: string; colIndex: number; widths: Record<string, number>;
  onResize: (k: string, px: number) => void;
  tableRef: React.RefObject<HTMLTableElement | null>;
  className?: string; children: React.ReactNode;
}) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widths[k] || 100;
    const move = (ev: MouseEvent) => onResize(k, Math.max(44, startW + (ev.clientX - startX)));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  // 더블클릭 = 자동 맞춤: 이 컬럼 모든 셀의 내용 폭(scrollWidth) 최대값으로
  const autofit = () => {
    const table = tableRef.current;
    if (!table) return;
    let max = 44;
    table.querySelectorAll("tr").forEach((tr) => {
      const cell = tr.children[colIndex] as HTMLElement | undefined;
      if (cell) max = Math.max(max, cell.scrollWidth);
    });
    onResize(k, Math.min(640, max + 14));
  };
  return (
    <th className={className} style={{ width: widths[k], position: "relative" }}>
      {children}
      <span
        onMouseDown={startDrag}
        onDoubleClick={autofit}
        className="absolute top-0 -right-[3px] h-full w-[7px] cursor-col-resize select-none z-[1] hover:bg-[var(--primary)]/35 active:bg-[var(--primary)]/55 rounded"
        title="드래그: 너비 조절 · 더블클릭: 내용에 맞춤"
      />
    </th>
  );
}

// ── 위하고식 거래처원장 시트: 일자 | 적요 | 차변 | 대변 | 잔액 + 전기이월/월계/합계 행 ──
//   매출처(외상매출금): 차변=발생(세금계산서), 대변=회수(입금·차액마감). 잔액 = 이월 + 차변 - 대변.
//   매입처(외상매입금): 차변=지급(출금·차액마감), 대변=발생(세금계산서). 잔액 = 이월 + 대변 - 차변.
type SheetEntry = { date: string; desc: string; debit: number; credit: number; isAdj?: boolean; sid?: string; isVoucher?: boolean; vid?: string };

export function PartnerLedgerSheet({ companyId, partnerId, type, year, partnerName, openingFromRpc, onOpenDetail, periodStart, periodEnd }: {
  companyId: string; partnerId: string | null; type: string; year: number; partnerName: string;
  openingFromRpc: number; onOpenDetail: () => void; periodStart?: string; periodEnd?: string;
}) {
  const yStart = periodStart || `${year}-01-01`;
  const yEnd = periodEnd || `${year}-12-31`;
  const isSales = type === "sales";
  const pal = palette(type);
  const qc = useQueryClient();
  const [adjView, setAdjView] = useState<string | null>(null); // 클릭한 차액마감 정산 ID → 전표 모달
  const [editEntryId, setEditEntryId] = useState<string | null>(null); // 클릭한 수동 전표 ID → 수정 모달
  const [newOpen, setNewOpen] = useState(false); // '+ 전표 입력' 신규 모달

  // 발생: 해당 거래처 세금계산서 (연말까지 — 전기이월 산출 위해 과거 포함)
  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["ledger-sheet-inv", companyId, partnerId, type, yStart, yEnd],
    queryFn: async () => {
      let qb = db.from("tax_invoices")
        .select("id, issue_date, item_name, label, total_amount")
        .eq("company_id", companyId).eq("type", type).neq("status", "void")
        // 실제 홈택스 발행분만 — 국세청 승인번호(nts_confirm_no) 있는 건. 미발행 수동/테스트 draft 제외.
        .not("nts_confirm_no", "is", null)
        .lte("issue_date", yEnd)
        .order("issue_date", { ascending: true }).limit(2000);
      qb = partnerId ? qb.eq("partner_id", partnerId) : qb.is("partner_id", null);
      const { data } = await qb;
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  // 회수/지급: 확정 정산 (통장 거래일 기준, 차액마감은 생성일)
  const invIds = invoices.map((i) => i.id);
  const { data: settles = [] } = useQuery<any[]>({
    queryKey: ["ledger-sheet-settle", companyId, partnerId, type, yStart, yEnd, invIds.join(",")],
    queryFn: async () => {
      if (invIds.length === 0) return [];
      const { data: setts } = await db.from("invoice_settlements")
        .select("id, tax_invoice_id, amount, match_type, adjustment_reason, bank_transaction_id, created_at")
        .eq("status", "confirmed").in("tax_invoice_id", invIds);
      const btIds = [...new Set((setts || []).map((s: any) => s.bank_transaction_id).filter(Boolean))];
      const btMap: Record<string, { date: string; cp: string | null }> = {};
      if (btIds.length) {
        const { data: bts } = await db.from("bank_transactions").select("id, transaction_date, counterparty").in("id", btIds);
        for (const b of (bts || []) as any[]) btMap[b.id] = { date: b.transaction_date, cp: b.counterparty };
      }
      return ((setts || []) as any[]).map((s) => ({
        ...s,
        date: s.bank_transaction_id ? (btMap[s.bank_transaction_id]?.date || String(s.created_at).slice(0, 10)) : String(s.created_at).slice(0, 10),
        cp: s.bank_transaction_id ? btMap[s.bank_transaction_id]?.cp : null,
      }));
    },
    enabled: !!companyId && invIds.length > 0,
  });

  // 수동 전표 (직접 입력) — 이 거래처를 라인에 포함한 source='manual'·confirmed 전표.
  //   원장 그리드에 날짜순 통합되어 잔액에 반영됨(AR/AP 라인 기준). 클릭 시 수정/삭제.
  const { data: manualVouchers = [] } = useQuery<any[]>({
    queryKey: ["ledger-manual-vouchers", companyId, partnerId, yStart, yEnd],
    queryFn: async () => {
      const { data } = await db.from("journal_entries")
        .select("id, entry_date, description, voucher_no, journal_lines(debit, credit, partner_id, description, chart_of_accounts(code))")
        .eq("company_id", companyId).eq("source", "manual").eq("status", "confirmed")
        .gte("entry_date", yStart).lte("entry_date", yEnd)
        .order("entry_date", { ascending: true }).order("voucher_no", { ascending: true });
      return ((data || []) as any[]).filter((e) =>
        (e.journal_lines || []).some((l: any) => l.partner_id === partnerId),
      );
    },
    enabled: !!companyId && !!partnerId,
  });

  // 정산 자동 전표(차액 잡손익 포함) — 정산 줄을 클릭하면 이 전표를 수정(잡손실→이자·수수료 등 계정 변경).
  const settleIds = settles.map((s) => s.id);
  const { data: settlementVouchers = [] } = useQuery<any[]>({
    queryKey: ["ledger-settle-vouchers", companyId, settleIds.join(",")],
    queryFn: async () => {
      if (settleIds.length === 0) return [];
      const { data } = await db.from("journal_entries")
        .select("id, linked_settlement_id")
        .eq("company_id", companyId).eq("source", "rule").eq("status", "confirmed")
        .in("linked_settlement_id", settleIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && settleIds.length > 0,
  });
  const settleVoucherMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const v of settlementVouchers as any[]) if (v.linked_settlement_id) m[v.linked_settlement_id] = v.id;
    return m;
  }, [settlementVouchers]);

  const { opening, months, totals } = useMemo(() => {
    const occur = (inv: any): SheetEntry => ({
      date: inv.issue_date,
      desc: `세금계산서 · ${inv.item_name || inv.label || "품목 미상"}`,
      debit: isSales ? Number(inv.total_amount || 0) : 0,
      credit: isSales ? 0 : Number(inv.total_amount || 0),
    });
    const settle = (s: any): SheetEntry => {
      const vid = settleVoucherMap[s.id]; // 연결된 자동 전표(있으면 정산 줄 클릭 시 그 전표 수정)
      return {
        date: s.date,
        desc: s.match_type === "adjustment"
          ? `차액 마감 (${ADJ_REASON_LABEL[s.adjustment_reason] || "잔액 정리"})`
          : `${isSales ? "입금" : "지급"}${s.cp ? ` · ${s.cp}` : ""}`,
        debit: isSales ? 0 : Number(s.amount || 0),
        credit: isSales ? Number(s.amount || 0) : 0,
        isAdj: s.match_type === "adjustment",
        sid: s.id,
        isVoucher: !!vid,
        vid: vid || undefined,
      };
    };
    // 수동 전표(직접 입력)를 해당 거래처의 AR/AP 라인(매출처=외상매출금108, 매입처=외상매입금251) 기준으로
    //   그리드에 날짜순 통합 — 차변/대변·잔액에 반영, 적요 = 라인 적요, 클릭 = 수정/삭제 모달.
    const arApCode = isSales ? "108" : "251";
    // 한 전표에 같은 거래처·AR/AP 계정 라인이 여러 개(차변+대변)일 수 있음 — find()로 첫 줄만 잡으면
    //   반대편 줄이 누락돼 잔액이 한쪽으로 쏠림(차·대 동액 전표가 잔액 ±로 표시되던 버그). 전 라인 반영.
    const voucherEntries = (v: any): SheetEntry[] =>
      ((v.journal_lines || []) as any[])
        .filter((l) => l.partner_id === partnerId && l.chart_of_accounts?.code === arApCode)
        .map((l) => ({ date: String(v.entry_date), desc: l.description || v.description || "전표", debit: Number(l.debit || 0), credit: Number(l.credit || 0), isVoucher: true, vid: v.id }));
    const voucherRows = manualVouchers.flatMap(voucherEntries);

    const all: SheetEntry[] = [...invoices.map(occur), ...settles.map(settle), ...voucherRows];
    const before = all.filter((e) => e.date < yStart);
    const within = all.filter((e) => e.date >= yStart).sort((a, b) => a.date.localeCompare(b.date) || (b.debit + b.credit) - (a.debit + a.credit));
    const dir = (e: SheetEntry) => (isSales ? e.debit - e.credit : e.credit - e.debit);
    const opening = before.reduce((s, e) => s + dir(e), 0);

    const byMonth = new Map<string, SheetEntry[]>();
    for (const e of within) {
      const m = e.date.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(e);
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const totals = {
      debit: within.reduce((s, e) => s + e.debit, 0),
      credit: within.reduce((s, e) => s + e.credit, 0),
      ending: opening + within.reduce((s, e) => s + dir(e), 0),
    };
    return { opening, months, totals };
  }, [invoices, settles, manualVouchers, settleVoucherMap, isSales, yStart, partnerId]);

  void openingFromRpc; // RPC 이월값은 참고용 — 시트는 자체 합산(원장 행과 1원 단위 일치 보장)

  const num = (n: number) => (n ? Math.round(n).toLocaleString() : "");
  const cellR = "px-3 py-2.5 text-right mono-number";

  const downloadCsv = () => {
    const rows: string[][] = [["일자", "적요", "차변", "대변", "잔액"]];
    let bal = opening;
    rows.push([yStart, "[전기이월]", "", "", String(Math.round(opening))]);
    for (const [m, entries] of months) {
      let md = 0, mc = 0;
      for (const e of entries) {
        bal += isSales ? e.debit - e.credit : e.credit - e.debit;
        md += e.debit; mc += e.credit;
        rows.push([e.date, e.desc, e.debit ? String(Math.round(e.debit)) : "", e.credit ? String(Math.round(e.credit)) : "", String(Math.round(bal))]);
      }
      rows.push([`${m}`, "[월계]", String(Math.round(md)), String(Math.round(mc)), ""]);
    }
    rows.push(["", "[합계]", String(Math.round(totals.debit)), String(Math.round(totals.credit)), String(Math.round(totals.ending))]);
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `거래처원장_${partnerName}_${yStart}_${yEnd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  let running = opening;
  let cumDebit = 0;  // 누계(차변) — 기간 시작부터 누적
  let cumCredit = 0; // 누계(대변)

  return (
    <div className="glass-card overflow-hidden">
      {/* 시트 헤더 */}
      <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-[var(--text)] truncate">{partnerName}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${pal.tintBg} ${pal.tintText}`}>{pal.acct}</span>
          <span className="text-[11px] text-[var(--text-dim)] shrink-0">{yStart} ~ {yEnd}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setNewOpen(true)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--primary)] text-white hover:opacity-90">+ 전표 입력</button>
          <button onClick={downloadCsv} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">엑셀</button>
          <button onClick={onOpenDetail} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/50">상세 · 차액 마감</button>
        </div>
      </div>

      {/* 원장 그리드 */}
      <div className="overflow-auto max-h-[560px]">
        <table className="w-full min-w-[640px] text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="px-3 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-left w-[92px]">일자</th>
              <th className="px-3 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-left">적요</th>
              <th className="px-3 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-right w-[120px]">차변{isSales ? " (발생)" : " (지급)"}</th>
              <th className="px-3 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-right w-[120px]">대변{isSales ? " (회수)" : " (발생)"}</th>
              <th className="px-3 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-right w-[130px]">잔액</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="p-10 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
            ) : (
              <>
                <tr className="bg-[var(--bg-surface)]/70 border-b border-[var(--border)]/60 font-semibold">
                  <td className="px-3 py-1.5 text-[var(--text-dim)]">{yStart}</td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)]">[전기이월]</td>
                  <td className={cellR} /><td className={cellR} />
                  <td className={`${cellR} ${opening !== 0 ? "text-amber-500" : "text-[var(--text-dim)]"}`}>{Math.round(opening).toLocaleString()}</td>
                </tr>
                {months.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-[var(--text-muted)]">선택 기간에 거래가 없습니다.</td></tr>
                )}
                {months.map(([m, entries]) => {
                  const md = entries.reduce((s, e) => s + e.debit, 0);
                  const mc = entries.reduce((s, e) => s + e.credit, 0);
                  cumDebit += md;
                  cumCredit += mc;
                  return (
                    <Fragment key={m}>
                      {entries.map((e, i) => {
                        running += isSales ? e.debit - e.credit : e.credit - e.debit;
                        return (
                          <tr key={`${m}-${i}`} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50">
                            <td className="px-3 py-1.5 text-[var(--text-muted)] mono-number">{e.date}</td>
                            <td className={`px-3 py-1.5 truncate max-w-[260px] ${e.isAdj ? "text-amber-500" : "text-[var(--text)]"}`}>
                              {e.isAdj && e.sid ? (
                                <button onClick={() => setAdjView(e.sid!)}
                                  className="underline decoration-dotted underline-offset-2 hover:text-amber-400 text-left"
                                  title="클릭하면 차액 마감 전표(분개)를 확인하고 삭제할 수 있습니다">{e.desc}</button>
                              ) : e.isVoucher && e.vid ? (
                                <button onClick={() => setEditEntryId(e.vid!)}
                                  className="text-[var(--primary)] underline decoration-dotted underline-offset-2 hover:opacity-80 text-left"
                                  title="수동 전표 — 클릭하면 수정/삭제(일자 변경 포함)">{e.desc}</button>
                              ) : e.desc}
                            </td>
                            <td className={`${cellR} ${e.debit ? "text-[var(--text)]" : ""}`}>{num(e.debit)}</td>
                            <td className={`${cellR} ${e.credit ? "text-[var(--text)]" : ""}`}>{num(e.credit)}</td>
                            <td className={`${cellR} font-semibold ${running > 0 ? pal.tintText : running < 0 ? "text-red-500" : "text-[var(--text-dim)]"}`}>{Math.round(running).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                      {/* 월계 — 연한 초록 */}
                      <tr className="bg-emerald-500/10 border-b border-[var(--border)]/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                        <td className="px-3 py-1.5">{Number(m.slice(5, 7))}월</td>
                        <td className="px-3 py-1.5">[월 계]</td>
                        <td className={cellR}>{num(md)}</td>
                        <td className={cellR}>{num(mc)}</td>
                        <td className={cellR} />
                      </tr>
                      {/* 누계 — 진한 초록 (월계와 색상 구분) */}
                      <tr className="bg-emerald-500/20 border-b border-[var(--border)]/60 text-emerald-800 dark:text-emerald-200 font-bold">
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5">[누 계]</td>
                        <td className={cellR}>{num(cumDebit)}</td>
                        <td className={cellR}>{num(cumCredit)}</td>
                        <td className={cellR} />
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="bg-[var(--bg-surface)] border-t-2 border-[var(--border)] font-bold text-[var(--text)]">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">[합계]</td>
                  <td className={cellR}>{num(totals.debit)}</td>
                  <td className={cellR}>{num(totals.credit)}</td>
                  <td className={`${cellR} ${totals.ending > 0 ? pal.tintText : totals.ending < 0 ? "text-red-500" : ""}`}>{Math.round(totals.ending).toLocaleString()}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-dim)]">
        발생 = 세금계산서(부가세 포함) · {isSales ? "회수" : "지급"} = 통장 매칭 + 차액 마감 · <span className="text-[var(--primary)]">파란 글씨</span> = 수동 전표(클릭 시 수정·삭제, 일자 변경 포함) · 상단 “+ 전표 입력”으로 신규 작성
      </div>

      {editEntryId && (
        <VoucherEditModal
          entryId={editEntryId}
          companyId={companyId}
          onClose={() => setEditEntryId(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["ledger-manual-vouchers"] });
            qc.invalidateQueries({ queryKey: ["ledger-voucher-partners"] });
            qc.invalidateQueries({ queryKey: ["vouchers-of-day"] });
          }}
        />
      )}
      {newOpen && (
        <VoucherEditModal
          companyId={companyId}
          newFor={{ partnerId, partnerName, type }}
          onClose={() => setNewOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["ledger-manual-vouchers"] });
            qc.invalidateQueries({ queryKey: ["ledger-voucher-partners"] });
            qc.invalidateQueries({ queryKey: ["vouchers-of-day"] });
          }}
        />
      )}
      {adjView && <AdjVoucherModal settlementId={adjView} type={type} partnerName={partnerName} onClose={() => setAdjView(null)} />}
    </div>
  );
}

// ── 수동 전표 수정 팝업: 거래처 원장 '수동 전표' 행(파란 글씨) 클릭 → 전표 전체 편집 ──
//   진입 대상 = source='manual' status='confirmed' 전표뿐(목록에서 그것만 노출).
//   저장 = update_manual_voucher(p_entry_id, p_description, p_lines) — DB 가 source<>'manual'·불균형·
//   마감을 거부(프론트+DB 이중검증) + 변경 전 값 journal_entry_audits 보존. 마감월이면 읽기전용.
type ELine = { key: number; account: { id: string; code: string; name: string } | null; partner: { id: string; name: string } | null; asset?: { kind: "bank" | "card"; id: string; name: string } | null; memo: string; debit: string; credit: string };
const AR_AP_ACCT_CODES = new Set(["108", "251"]);
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 일자 입력 — 년(4자)·월(2자)·일(2자) 세그먼트. 칸이 차면 자동으로 다음 칸 이동.
//   네이티브 <input type=date> 는 년도를 6자리(최대 275760년)까지 기다려 키보드 흐름이 끊김 →
//   년 4자 입력 시 바로 월로 이동. 월/일은 첫 자리가 범위를 넘으면(월>1·일>3) 한 자리에서도 이동(네이티브 감각).
function DateSegInput({ value, onChange, onMouseDown }: {
  value: string; onChange: (v: string) => void; onMouseDown?: (e: ReactMouseEvent) => void;
}) {
  const parse = (v: string): [string, string, string] =>
    (/^\d{4}-\d{2}-\d{2}$/.test(v) ? (v.split("-") as [string, string, string]) : ["", "", ""]);
  const [seg, setSeg] = useState<[string, string, string]>(() => parse(value));
  const lastEmit = useRef<string>(value);
  // 외부에서 value 가 바뀐 경우에만 세그먼트 재동기화. 우리가 emit 한 값은 무시 —
  //   한 자리만 쳐도 commit 이 "01" 로 0패딩한 값을 되돌려 넣어 둘째 자리 입력을 막던 버그 해결.
  useEffect(() => {
    if (value !== lastEmit.current) { setSeg(parse(value)); lastEmit.current = value; }
  }, [value]);
  const yRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const dRef = useRef<HTMLInputElement>(null);

  const commit = (s: [string, string, string]) => {
    if (s[0].length === 4 && s[1] && s[2]) {
      const mi = Math.min(12, Math.max(1, Number(s[1])));
      const di = Math.min(31, Math.max(1, Number(s[2])));
      const out = `${s[0]}-${String(mi).padStart(2, "0")}-${String(di).padStart(2, "0")}`;
      lastEmit.current = out;
      onChange(out);
    }
  };
  const set = (i: 0 | 1 | 2, raw: string, max: number, next: RefObject<HTMLInputElement | null> | null, smartMax?: number) => {
    const v = raw.replace(/\D/g, "").slice(0, max);
    const ns: [string, string, string] = [...seg]; ns[i] = v; setSeg(ns); commit(ns);
    const advance = v.length >= max || (smartMax !== undefined && v.length === 1 && Number(v) > smartMax);
    if (advance) next?.current?.focus();
  };
  const back = (i: 1 | 2, prev: RefObject<HTMLInputElement | null>) => (e: { key: string }) => {
    if (e.key === "Backspace" && !seg[i]) prev.current?.focus();
  };
  const inp = "bg-transparent text-center text-[11px] text-[var(--text)] focus:outline-none mono-number";
  return (
    <span onMouseDown={onMouseDown}
      className="inline-flex items-center gap-0.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded px-1.5 py-0.5">
      <input ref={yRef} value={seg[0]} inputMode="numeric" placeholder="YYYY" aria-label="년"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => set(0, e.target.value, 4, mRef)} className={`${inp} w-[34px]`} />
      <span className="text-[var(--text-dim)]">-</span>
      <input ref={mRef} value={seg[1]} inputMode="numeric" placeholder="MM" aria-label="월"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => set(1, e.target.value, 2, dRef, 1)} onKeyDown={back(1, yRef)} className={`${inp} w-[20px]`} />
      <span className="text-[var(--text-dim)]">-</span>
      <input ref={dRef} value={seg[2]} inputMode="numeric" placeholder="DD" aria-label="일"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => set(2, e.target.value, 2, null, 3)} onKeyDown={back(2, mRef)} className={`${inp} w-[20px]`} />
    </span>
  );
}

// entryId 있으면 수정, newFor 면 신규 입력(거래처원장 '+ 전표 입력'). 그리드·차대검증·포털·드래그를 공유.
//   신규 저장 = save_manual_voucher, 수정 저장 = update_manual_voucher (둘 다 DB 이중검증).
export function VoucherEditModal({ entryId, companyId, onClose, onSaved, newFor }: {
  entryId?: string; companyId: string; onClose: () => void; onSaved: () => void;
  newFor?: { partnerId: string | null; partnerName: string; type: string };
}) {
  const isNew = !entryId;
  const { toast } = useToast();
  const keyRef = useRef(1);
  const [lines, setLines] = useState<ELine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [entryDate, setEntryDate] = useState(isNew ? todayKst() : "");
  const [voucherNo, setVoucherNo] = useState<number | null>(null);
  const [dealId, setDealId] = useState<string | null>(null); // 프로젝트 태그 → journal_entries.deal_id (직접원가 집계)
  const [subDealId, setSubDealId] = useState<string | null>(null); // 세부 프로젝트 태그 → journal_entries.sub_deal_id (세부 실적원가)
  const [picker, setPicker] = useState<{ kind: "acct" | "pt"; key: number; q: string; anchor: Anchor; idx?: number } | null>(null);
  // glass-card(backdrop-filter)가 fixed 컨테이닝 블록이 되어 팝업이 카드 안에 갇히는 문제 →
  //   document.body 로 포털해 화면 전체에 렌더.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 헤더 잡고 드래그 이동 (정중앙 기준 오프셋)
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      setDrag({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  const startDrag = (e: React.MouseEvent) => { dragRef.current = { sx: e.clientX, sy: e.clientY, ox: drag.x, oy: drag.y }; };

  // 음수 허용(맨 앞 '-'만) — 수정분개용. 저장 시 음수 차변→대변/음수 대변→차변 정규화(DB check debit·credit>=0).
  const numOnly = (s: string | number) => { const n = Number(String(s).replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "")); return Number.isFinite(n) ? n : 0; };
  const comma = (s: string) => {
    const neg = String(s).trim().startsWith("-");
    const n = Math.abs(numOnly(s));
    if (!n) return neg ? "-" : ""; // '-'만 입력한 중간 상태 유지
    return (neg ? "-" : "") + n.toLocaleString("ko-KR");
  };

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["voucher-accounts", companyId],
    queryFn: async () => { const { data } = await db.from("chart_of_accounts").select("id, code, name").eq("company_id", companyId).order("code"); return (data || []) as any[]; },
    enabled: !!companyId, staleTime: 300_000,
  });
  const { data: partners = [] } = useQuery<any[]>({
    queryKey: ["voucher-partners", companyId],
    queryFn: async () => { const { data } = await db.from("partners").select("id, name, business_number").eq("company_id", companyId).order("name"); return (data || []) as any[]; },
    enabled: !!companyId, staleTime: 300_000,
  });
  // 자산관리에 등록한 통장/카드 — 거래처 피커에서 함께 선택 가능
  const { data: bankAccts = [] } = useQuery<any[]>({
    queryKey: ["voucher-bank-accounts", companyId],
    queryFn: async () => { const { data } = await db.from("bank_accounts").select("id, alias, bank_name").eq("company_id", companyId).order("alias"); return (data || []) as any[]; },
    enabled: !!companyId, staleTime: 300_000,
  });
  const { data: cards = [] } = useQuery<any[]>({
    queryKey: ["voucher-cards", companyId],
    queryFn: async () => { const { data } = await db.from("corporate_cards").select("id, card_name").eq("company_id", companyId).order("card_name"); return (data || []) as any[]; },
    enabled: !!companyId, staleTime: 300_000,
  });
  // 프로젝트(deal) — 전표를 프로젝트 직접원가로 귀속(선택)
  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["voucher-deals", companyId],
    queryFn: async () => { const { data } = await db.from("deals").select("id, name").eq("company_id", companyId).is("archived_at", null).order("name"); return (data || []) as any[]; },
    enabled: !!companyId, staleTime: 300_000,
  });
  // 세부 프로젝트 — 선택한 프로젝트의 sub_deals (세부 귀속 시 실적원가가 v_sub_deal_pnl 에 집계)
  const { data: subDeals = [] } = useQuery<any[]>({
    queryKey: ["voucher-sub-deals", dealId],
    queryFn: async () => { const { data } = await db.from("sub_deals").select("id, name, type").eq("parent_deal_id", dealId).order("created_at"); return (data || []) as any[]; },
    enabled: !!dealId, staleTime: 300_000,
  });

  // 전표 로드 (수정 모드만 — 헤더 + 전 라인) + 마감 여부
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const { data: e } = await db.from("journal_entries")
        .select("id, entry_date, description, voucher_no, source, status, deal_id, sub_deal_id, journal_lines(account_id, debit, credit, description, partner_id, bank_account_id, card_id, chart_of_accounts(id, code, name), partners(id, name), bank_accounts(id, alias, bank_name), corporate_cards(id, card_name))")
        .eq("id", entryId).maybeSingle();
      if (cancelled || !e) { if (!cancelled) setLoaded(true); return; }
      setEntryDate(e.entry_date); setVoucherNo(e.voucher_no ?? null); setDealId(e.deal_id ?? null); setSubDealId(e.sub_deal_id ?? null);
      const ls: ELine[] = (e.journal_lines || []).map((l: any) => ({
        key: keyRef.current++,
        account: l.chart_of_accounts ? { id: l.chart_of_accounts.id, code: l.chart_of_accounts.code, name: l.chart_of_accounts.name } : null,
        partner: l.partners ? { id: l.partners.id, name: l.partners.name } : null,
        asset: l.bank_accounts
          ? { kind: "bank" as const, id: l.bank_accounts.id, name: l.bank_accounts.alias || l.bank_accounts.bank_name }
          : l.corporate_cards
          ? { kind: "card" as const, id: l.corporate_cards.id, name: l.corporate_cards.card_name }
          : null,
        memo: l.description || "",
        debit: Number(l.debit) > 0 ? Number(l.debit).toLocaleString() : "",
        credit: Number(l.credit) > 0 ? Number(l.credit).toLocaleString() : "",
      }));
      setLines(ls.length ? ls : [{ key: keyRef.current++, account: null, partner: null, memo: "", debit: "", credit: "" }]);
      if (cancelled) return;
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [entryId, companyId]);

  // 신규: 거래처 + AR/AP 계정 프리필 (accounts 로딩 후 1회). sales→(차)외상매출금/(대)매출, purchase→(차)매입/(대)외상매입금
  useEffect(() => {
    if (!isNew || loaded || accounts.length === 0) return;
    const find = (code: string) => (accounts as any[]).find((a) => a.code === code) || null;
    const partner = newFor?.partnerId ? { id: newFor.partnerId, name: newFor.partnerName } : null;
    const pre = newFor?.type === "purchase"
      ? [{ account: find("501"), partner: null }, { account: find("251"), partner }]
      : [{ account: find("108"), partner }, { account: find("401"), partner: null }];
    setLines(pre.map((p) => ({ key: keyRef.current++, account: p.account, partner: p.partner, memo: "", debit: "", credit: "" })));
    setLoaded(true);
  }, [isNew, loaded, accounts, newFor]);

  // 선택 일자의 마감 여부 (신규·수정 공통 — 일자 변경 시 재검사)
  useEffect(() => {
    if (!entryDate) return;
    let cancelled = false;
    (async () => {
      const { data: cc } = await db.from("closing_checklists").select("status").eq("company_id", companyId).eq("month", entryDate.slice(0, 7)).maybeSingle();
      if (!cancelled) setLocked(cc?.status === "locked");
    })();
    return () => { cancelled = true; };
  }, [entryDate, companyId]);

  const setLine = (key: number, patch: Partial<ELine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { key: keyRef.current++, account: null, partner: null, memo: "", debit: "", credit: "" }]);
  const removeLine = (key: number) => setLines((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.key !== key)));

  const filled = lines.filter((l) => numOnly(l.debit) !== 0 || numOnly(l.credit) !== 0);
  // 합계는 정규화 기준(음수 차변=대변 취급) — 저장값·차대일치 표시와 동일
  const norm = (l: ELine) => { let d = numOnly(l.debit), c = numOnly(l.credit); if (d < 0) { c += -d; d = 0; } if (c < 0) { d += -c; c = 0; } return { d, c }; };
  const totalD = filled.reduce((s, l) => s + norm(l).d, 0);
  const totalC = filled.reduce((s, l) => s + norm(l).c, 0);
  const diff = totalD - totalC;
  const missingAcct = filled.some((l) => !l.account);
  const canSave = !busy && !locked && filled.length >= 2 && totalD > 0 && diff === 0 && !missingAcct;

  // 거래처원장 적요 = AR/AP 라인 적요(없으면 첫 라인). 상단 전표적요란 폐지 → 라인 적요로 일원화.
  const headerDesc = () => (filled.find((l) => l.account && AR_AP_ACCT_CODES.has(l.account.code))?.memo) || filled[0]?.memo || "";

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = filled.map((l) => { const { d, c } = norm(l); return { account_id: l.account!.id, debit: d, credit: c, memo: l.memo, partner_id: l.partner?.id ?? "", bank_account_id: l.asset?.kind === "bank" ? l.asset.id : "", card_id: l.asset?.kind === "card" ? l.asset.id : "" }; });
      const res = isNew
        ? await db.rpc("save_manual_voucher", { p_entry_date: entryDate, p_voucher_type: "transfer", p_description: headerDesc(), p_lines: payload })
        : await db.rpc("update_manual_voucher", { p_entry_id: entryId, p_entry_date: entryDate, p_description: headerDesc(), p_lines: payload });
      if (res.error) throw new Error(res.error.message);
      // 프로젝트 태그 (직접원가 귀속) — 신규는 반환 id, 수정은 entryId
      const savedId = isNew ? (res.data as string) : entryId;
      if (savedId) {
        const { error: tagErr } = await db.rpc("set_voucher_deal", { p_entry_id: savedId, p_deal_id: dealId || null, p_sub_deal_id: dealId ? (subDealId || null) : null });
        if (tagErr) throw new Error(tagErr.message);
      }
      toast(isNew ? "전표 입력됨" : "전표 수정됨", "success");
      onSaved();
      onClose();
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(
        m.includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간입니다"
          : m.includes("NOT_MANUAL") ? "수동 전표만 수정할 수 있습니다 (수집/자동 전표 불가)"
          : m.includes("UNBALANCED") ? "차변·대변 합계가 일치하지 않습니다"
          : m.includes("NEED_TWO_LINES") ? "차변·대변을 2줄 이상 입력하세요"
          : m.includes("INVALID_ACCOUNT") ? "계정과목이 올바르지 않습니다"
          : m.includes("FORBIDDEN") ? "권한이 없습니다"
          : m.includes("INVALID_SUB_DEAL") ? "매출·매입 항목이 선택한 프로젝트에 속하지 않습니다"
          : m.includes("INVALID_DEAL") ? "프로젝트가 올바르지 않습니다"
          : m.includes("does not exist") ? "전표 DB가 아직 적용되지 않았습니다"
          : m || (isNew ? "전표 입력 실패" : "수정 실패"),
        "error",
      );
    } finally { setBusy(false); }
  };

  // 전표 삭제 — voucher_reject(status=rejected, 이력 보존). 수정 모드에서만.
  const del = async () => {
    if (busy || isNew || !entryId) return;
    if (!confirm("이 전표를 삭제할까요?\n거래처 원장에서 사라지고, 변경 이력은 보존됩니다.")) return;
    setBusy(true);
    try {
      const { error } = await db.rpc("voucher_reject", { p_entry_id: entryId });
      if (error) throw new Error(error.message);
      toast("전표 삭제됨", "info");
      onSaved();
      onClose();
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(m.includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간 — 삭제 불가" : m || "삭제 실패", "error");
    } finally { setBusy(false); }
  };

  const acctMatches = (q: string) => { const t = q.trim().toLowerCase(); return (t ? accounts.filter((a) => a.code.includes(t) || a.name.toLowerCase().includes(t)) : accounts).slice(0, 12); };
  const ptMatches = (q: string) => { const t = q.trim().toLowerCase(); if (!t) return partners.slice(0, 30); const tn = t.replace(/-/g, ""); return partners.filter((p) => p.name.toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)).slice(0, 200); };
  const assetItems = [
    ...bankAccts.map((b: any) => ({ kind: "bank" as const, id: b.id, name: b.alias || b.bank_name })),
    ...cards.map((c: any) => ({ kind: "card" as const, id: c.id, name: c.card_name })),
  ].filter((a) => a.name);
  const assetMatches = (q: string) => { const t = q.trim().toLowerCase(); return (t ? assetItems.filter((a) => a.name.toLowerCase().includes(t)) : assetItems).slice(0, 12); };
  const IN = "w-full bg-transparent text-xs text-[var(--text)] focus:outline-none px-1.5 py-1.5 disabled:opacity-60";

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-[calc(100vw-2rem)] max-w-3xl max-h-[calc(100vh-3rem)] overflow-y-auto flex flex-col shadow-2xl fixed left-1/2 top-1/2"
        style={{ transform: `translate(calc(-50% + ${drag.x}px), calc(-50% + ${drag.y}px))` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div onMouseDown={startDrag} className="sticky top-0 z-10 bg-[var(--bg-card)] rounded-t-2xl px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3 cursor-move select-none">
          <div>
            <div className="text-base font-bold text-[var(--text)]">{isNew ? "신규 전표 입력" : <>전표 수정 {voucherNo != null && <span className="text-[var(--text-dim)] mono-number">#{voucherNo}</span>}</>}</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>일자</span>
              <DateSegInput value={entryDate} onMouseDown={(e) => e.stopPropagation()} onChange={setEntryDate} />
              <span className="ml-0.5">· 프로젝트</span>
              <select value={dealId ?? ""} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { setDealId(e.target.value || null); setSubDealId(null); }} disabled={locked}
                title="이 전표를 프로젝트 직접원가로 귀속(비용계정 라인만 집계)"
                className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text)] max-w-[150px] disabled:opacity-60">
                <option value="">미지정</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {dealId && subDeals.length > 0 && (
                <select value={subDealId ?? ""} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => setSubDealId(e.target.value || null)} disabled={locked}
                  title="매출·매입 항목에 귀속(항목별 실적원가로 집계)"
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text)] max-w-[150px] disabled:opacity-60">
                  <option value="">항목 미지정</option>
                  {subDeals.map((s) => <option key={s.id} value={s.id}>{s.type === "sales" ? "[매출] " : s.type === "purchase" ? "[매입] " : ""}{s.name}</option>)}
                </select>
              )}
              {newFor?.partnerName && <span>· {newFor.partnerName}</span>}
              <span className="opacity-60">· 제목 잡고 이동</span>
            </div>
          </div>
          <button onClick={onClose} onMouseDown={(e) => e.stopPropagation()} className="text-[var(--text-dim)] hover:text-[var(--text)] text-lg shrink-0 cursor-pointer">✕</button>
        </div>

        {!loaded ? (
          <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : (
          <>
            {locked && <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/25 text-[11px] text-amber-600 font-semibold">🔒 마감(잠금)된 회계기간 — 읽기 전용 (일자를 미마감 월로 바꾸면 편집 가능)</div>}
            <div className="px-5 pt-3 text-[10px] text-[var(--text-dim)]">적요는 아래 각 줄에 입력하세요 — 거래처 원장에 그대로 표시됩니다.</div>
            <div className="px-5 py-3 pt-2">
              <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="px-2 py-2.5 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-left min-w-[150px]">계정과목</th>
                    <th className="px-2 py-2.5 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-left min-w-[110px]">거래처·통장/카드</th>
                    <th className="px-2 py-2.5 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-left">적요</th>
                    <th className="px-2 py-2.5 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-right w-[110px]">차변</th>
                    <th className="px-2 py-2.5 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-right w-[110px]">대변</th>
                    <th className="w-7" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const arApWarn = l.account && AR_AP_ACCT_CODES.has(l.account.code) && !l.partner;
                    return (
                      <tr key={l.key} className="border-b border-[var(--border)]/40">
                        <td className="p-0 relative">
                          <input value={picker?.kind === "acct" && picker.key === l.key ? picker.q : (l.account ? `${l.account.name} (${l.account.code})` : "")}
                            disabled={locked}
                            onChange={(e) => setPicker({ kind: "acct", key: l.key, q: e.target.value, anchor: anchorOf(e.currentTarget) })}
                            onFocus={(e) => setPicker({ kind: "acct", key: l.key, q: "", anchor: anchorOf(e.currentTarget) })}
                            onBlur={() => setTimeout(() => setPicker((p) => (p?.key === l.key && p.kind === "acct" ? null : p)), 150)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              const q = picker?.kind === "acct" && picker.key === l.key ? picker.q : "";
                              const first = acctMatches(q)[0];
                              if (first) { e.preventDefault(); setLine(l.key, { account: first }); setPicker(null); }
                            }}
                            placeholder="계정 검색" className={IN} />
                          {picker?.kind === "acct" && picker.key === l.key && (
                            <CellDropdown anchor={picker.anchor} width={224} maxHeight={196}>
                              {acctMatches(picker.q).map((a, i) => (
                                <button key={a.id} onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { account: a }); setPicker(null); }}
                                  className={`w-full flex justify-between px-2 py-1 rounded text-[11px] text-[var(--text)] ${i === 0 ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"}`}><span>{a.name}{i === 0 && <span className="ml-1 text-[9px] text-[var(--primary)]">↵</span>}</span><span className="text-[var(--text-dim)] mono-number">{a.code}</span></button>
                              ))}
                              {acctMatches(picker.q).length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">검색 결과 없음</div>}
                            </CellDropdown>
                          )}
                        </td>
                        <td className="p-0 relative">
                          <div className="flex items-center">
                            <input value={picker?.kind === "pt" && picker.key === l.key ? picker.q : (l.asset?.name || l.partner?.name || "")}
                              disabled={locked}
                              onChange={(e) => setPicker({ kind: "pt", key: l.key, q: e.target.value, anchor: anchorOf(e.currentTarget) })}
                              onFocus={(e) => setPicker({ kind: "pt", key: l.key, q: "", anchor: anchorOf(e.currentTarget) })}
                              onBlur={() => setTimeout(() => setPicker((p) => (p?.key === l.key && p.kind === "pt" ? null : p)), 150)}
                              onKeyDown={(e) => {
                                if (!(picker?.kind === "pt" && picker.key === l.key)) return;
                                const pts = ptMatches(picker.q); const assets = assetMatches(picker.q);
                                const total = pts.length + assets.length;
                                if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setPicker((p) => p ? { ...p, idx: Math.min((p.idx ?? 0) + 1, Math.max(total - 1, 0)) } : p); }
                                else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setPicker((p) => p ? { ...p, idx: Math.max((p.idx ?? 0) - 1, 0) } : p); }
                                else if (e.key === "Enter") {
                                  const k = picker.idx ?? 0;
                                  if (k < pts.length) { const p = pts[k]; if (p) { e.preventDefault(); e.stopPropagation(); setLine(l.key, { partner: p, asset: null }); setPicker(null); } }
                                  else { const a = assets[k - pts.length]; if (a) { e.preventDefault(); e.stopPropagation(); setLine(l.key, { asset: { kind: a.kind, id: a.id, name: a.name }, partner: null }); setPicker(null); } }
                                }
                                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPicker(null); }
                              }}
                              placeholder="—" className={IN} />
                            {l.asset && <span className="pr-1 text-[8px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] shrink-0">{l.asset.kind === "bank" ? "통장" : "카드"}</span>}
                            {arApWarn && !l.asset && <span className="pr-1 text-amber-500 text-[10px] font-bold shrink-0" title="채권/채무 계정은 거래처 지정을 권장합니다">⚠</span>}
                          </div>
                          {picker?.kind === "pt" && picker.key === l.key && (
                            <CellDropdown anchor={picker.anchor} width={224} maxHeight={196}>
                              {(() => {
                                const pts = ptMatches(picker.q); const assets = assetMatches(picker.q);
                                const act = picker.idx ?? 0;
                                return (<>
                              {pts.length > 0 && <div className="px-2 pt-0.5 pb-0.5 text-[10px] font-semibold text-[var(--text-dim)]">거래처</div>}
                              {pts.map((p, i) => {
                                const active = i === act;
                                return (
                                <button key={`p-${p.id}`}
                                  ref={active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined}
                                  onMouseEnter={() => setPicker((pp) => (pp ? { ...pp, idx: i } : pp))}
                                  onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { partner: p, asset: null }); setPicker(null); }}
                                  className={`w-full px-2 py-1 rounded text-[11px] text-left text-[var(--text)] truncate ${active ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"}`}>{p.name}{active && <span className="ml-1 text-[9px] text-[var(--primary)]">↵</span>}</button>
                                );
                              })}
                              {assets.length > 0 && <div className="px-2 pt-1.5 pb-0.5 mt-1 text-[10px] font-semibold text-[var(--text-dim)] border-t border-[var(--border)]/40">내 통장·카드</div>}
                              {assets.map((a, j) => {
                                const active = (pts.length + j) === act;
                                return (
                                <button key={`${a.kind}-${a.id}`}
                                  ref={active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined}
                                  onMouseEnter={() => setPicker((pp) => (pp ? { ...pp, idx: pts.length + j } : pp))}
                                  onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { asset: { kind: a.kind, id: a.id, name: a.name }, partner: null }); setPicker(null); }}
                                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-[11px] text-left text-[var(--text)] ${active ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"}`}>
                                  <span className="truncate">{a.name}</span>
                                  <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">{a.kind === "bank" ? "통장" : "카드"}</span>
                                </button>
                                );
                              })}
                              {pts.length === 0 && assets.length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">검색 결과 없음</div>}
                              </>);
                              })()}
                              {(l.partner || l.asset) && <button onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { partner: null, asset: null }); setPicker(null); }} className="w-full px-2 py-1 mt-1 rounded text-[11px] text-[var(--text-dim)] text-left hover:bg-[var(--bg-surface)] border-t border-[var(--border)]/40">지우기</button>}
                            </CellDropdown>
                          )}
                        </td>
                        <td className="p-0">
                          <input value={l.memo} disabled={locked} onChange={(e) => setLine(l.key, { memo: e.target.value })} placeholder="적요" className={IN} />
                        </td>
                        <td className="p-0">
                          <input inputMode="numeric" value={l.debit} disabled={locked}
                            onChange={(e) => setLine(l.key, { debit: comma(e.target.value), credit: numOnly(e.target.value) !== 0 ? "" : l.credit })}
                            placeholder="0" className={`${IN} text-right mono-number`} />
                        </td>
                        <td className="p-0">
                          <input inputMode="numeric" value={l.credit} disabled={locked}
                            onChange={(e) => setLine(l.key, { credit: comma(e.target.value), debit: numOnly(e.target.value) !== 0 ? "" : l.debit })}
                            placeholder="0" className={`${IN} text-right mono-number`} />
                        </td>
                        <td className="text-center">
                          {!locked && <button onClick={() => removeLine(l.key)} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs" title="행 삭제">✕</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)] font-bold">
                    <td colSpan={3} className="px-2 py-2 text-right text-[var(--text-muted)]">합계</td>
                    <td className="px-2 py-2 text-right mono-number text-[var(--text)]">{totalD.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right mono-number text-[var(--text)]">{totalC.toLocaleString()}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              {!locked && <button onClick={addLine} className="mt-2 text-[12px] text-[var(--text-dim)] hover:text-[var(--primary)] font-semibold">+ 행 추가</button>}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold">
                {totalD === 0 ? <span className="text-[var(--text-dim)] font-semibold">금액을 입력하세요</span>
                  : diff === 0 ? <span className="text-emerald-500">✅ 차대일치</span>
                  : <span className="text-red-500">⚠️ 차액 {won(Math.abs(diff))} — 저장 불가</span>}
                {missingAcct && <span className="text-amber-500 ml-2">· 계정과목 미지정</span>}
              </span>
              <div className="flex items-center gap-2">
                {!isNew && !locked && <button onClick={del} disabled={busy} className="px-3 py-2 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg disabled:opacity-50">삭제</button>}
                <button onClick={onClose} className="px-3 py-2 text-xs text-[var(--text-muted)]">취소</button>
                <button onClick={save} disabled={!canSave} className="px-5 py-2 text-xs font-bold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40">{busy ? "저장 중..." : isNew ? "전표 저장" : "수정 저장"}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── 차액 마감 전표 팝업: 원장/상세의 "차액 마감(단수차)" 클릭 → 분개(전표) 확인 + 삭제(잔액 원복) ──
//   실제 전표(journal_entries, 거래 매칭 > AI 전표에서 생성)가 있으면 그 분개를, 없으면 예상 분개를 표시.
//   삭제 = 정산 status→rejected (트리거가 잔액 자동 원복) + 연결 전표도 voucher_reject 로 함께 반려.
const ADJ_ACCT: Record<string, string> = { withholding_tax: "선납세금(136)", fee: "지급수수료(831)", rounding: "잡손실(980)", discount: "잡손실(980)", other: "잡손실(980)" };

export function AdjVoucherModal({ settlementId, type, partnerName, onClose }: {
  settlementId: string; type: string; partnerName: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isSales = type === "sales";
  const [deleting, setDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // glass-card 안 fixed 갇힘 회피 → document.body 포털

  const { data: s, isLoading } = useQuery<any>({
    queryKey: ["adj-settlement", settlementId],
    queryFn: async () => {
      const { data } = await db.from("invoice_settlements")
        .select("id, amount, adjustment_reason, reason, status, created_at, tax_invoices(issue_date, item_name, label, total_amount, counterparty_name)")
        .eq("id", settlementId).maybeSingle();
      return data;
    },
  });
  // 연결된 실제 전표 (AI 전표에서 초안 생성/승인된 경우)
  const { data: voucher } = useQuery<any>({
    queryKey: ["adj-voucher", settlementId],
    queryFn: async () => {
      const { data } = await db.from("journal_entries")
        .select("id, voucher_no, entry_date, status, source, journal_lines(debit, credit, chart_of_accounts(code, name))")
        .eq("linked_settlement_id", settlementId).neq("status", "rejected").limit(1);
      return (data || [])[0] || null;
    },
  });

  const reasonLabel = s ? (ADJ_REASON_LABEL[s.adjustment_reason] || "잔액 정리") : "";
  const amount = Number(s?.amount || 0);
  // 예상 분개 (전표 미생성 시): 매출처 = (차)사유계정/(대)외상매출금, 매입처 = (차)외상매입금/(대)잡이익
  const estLines = s ? (isSales
    ? [{ side: "차", acct: ADJ_ACCT[s.adjustment_reason] || "잡손실(980)" }, { side: "대", acct: "외상매출금(108)" }]
    : [{ side: "차", acct: "외상매입금(251)" }, { side: "대", acct: "잡이익(901)" }]) : [];

  const handleDelete = async () => {
    if (!s || deleting) return;
    if (!confirm(`이 차액 마감(${reasonLabel} ${won(amount)})을 삭제할까요?\n계산서 잔액이 원복되고, 연결된 전표도 함께 반려됩니다.`)) return;
    setDeleting(true);
    try {
      // 1) 연결 전표 먼저 반려 (마감월이면 서버가 차단 → 정산도 건드리지 않음)
      if (voucher) {
        const { error } = await db.rpc("voucher_reject", { p_entry_id: voucher.id });
        if (error) throw new Error(String(error.message).includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간의 전표라 삭제할 수 없습니다" : error.message);
      }
      // 2) 정산 반려 → trg_recalc_settlement 가 settled_amount 원복
      const { error: e2 } = await db.from("invoice_settlements").update({ status: "rejected" }).eq("id", s.id);
      if (e2) throw new Error(e2.message);
      ["ledger-sheet-settle", "ledger-sheet-inv", "partner-ledger", "partner-detail-inv", "partner-detail-settle", "settlement-confirmed", "voucher-drafts", "vouchers-of-day"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast("차액 마감 삭제 — 계산서 잔액이 원복되었습니다", "info");
      onClose();
    } catch (e: any) {
      toast(e?.message || "삭제 실패", "error");
    } finally {
      setDeleting(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">차액 마감 전표</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{partnerName} · <span className="text-amber-500 font-semibold">{reasonLabel}</span></div>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-lg shrink-0">✕</button>
        </div>

        {isLoading || !s ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">{isLoading ? "불러오는 중..." : "정산 내역을 찾을 수 없습니다."}</div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {/* 마감 정보 */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                <div className="caption">마감 금액</div>
                <div className="font-bold mono-number text-amber-500">{won(amount)}</div>
              </div>
              <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                <div className="caption">처리일</div>
                <div className="font-bold mono-number text-[var(--text)]">{String(s.created_at).slice(0, 10)}</div>
              </div>
            </div>
            {s.tax_invoices && (
              <div className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                연결 계산서: {s.tax_invoices.issue_date} · {s.tax_invoices.item_name || s.tax_invoices.label || "품목 미상"} · {won(s.tax_invoices.total_amount)}
              </div>
            )}
            {s.reason && <div className="text-[11px] text-[var(--text-dim)]">메모: {s.reason}</div>}

            {/* 분개 — 실제 전표 or 예상 */}
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              <div className="px-3 py-2 bg-[var(--bg-surface)] flex items-center gap-2 text-[11px] font-semibold">
                {voucher ? (
                  <>
                    <span className="text-[var(--text)]">전표 {voucher.voucher_no ? `#${voucher.voucher_no}` : ""} · {voucher.entry_date}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${voucher.status === "confirmed" ? "bg-emerald-500/10 text-emerald-500" : "bg-purple-500/10 text-purple-500"}`}>
                      {voucher.status === "confirmed" ? "승인됨" : "초안 (미승인)"}</span>
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">예상 분개 <span className="font-normal text-[var(--text-dim)]">— 전표 미생성 (거래 매칭 &gt; AI 전표에서 생성 가능)</span></span>
                )}
              </div>
              <div className="px-3 py-2 space-y-1">
                {voucher ? (voucher.journal_lines || []).map((l: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-7 text-right font-semibold ${Number(l.debit) > 0 ? "text-blue-500" : "text-orange-500"}`}>{Number(l.debit) > 0 ? "(차)" : "(대)"}</span>
                    <span className="text-[var(--text)]">{l.chart_of_accounts?.name || "?"} <span className="text-[var(--text-dim)] mono-number">({l.chart_of_accounts?.code || "—"})</span></span>
                    <span className="ml-auto mono-number text-[var(--text-muted)]">{Number(Number(l.debit) > 0 ? l.debit : l.credit).toLocaleString()}</span>
                  </div>
                )) : estLines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-7 text-right font-semibold ${l.side === "차" ? "text-blue-500" : "text-orange-500"}`}>({l.side})</span>
                    <span className="text-[var(--text)]">{l.acct}</span>
                    <span className="ml-auto mono-number text-[var(--text-muted)]">{Math.round(amount).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="caption">삭제하면 계산서 잔액이 원복됩니다 (이력은 보존)</span>
              <button onClick={handleDelete} disabled={deleting || s.status !== "confirmed"}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                title={s.status !== "confirmed" ? "이미 취소된 마감입니다" : "차액 마감을 삭제하고 잔액을 원복합니다"}>
                {deleting ? "삭제 중..." : s.status !== "confirmed" ? "이미 취소됨" : "차액 마감 삭제"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── 거래처 상세 팝업: 그 거래처의 개별 세금계산서 + 정산내역 + 차액 마감 ──
const SETTLE_STATUS: Record<string, [string, string]> = {
  settled: ["정산완료", "text-emerald-500 bg-emerald-500/10"],
  partial: ["부분정산", "text-amber-500 bg-amber-500/10"],
  open: ["미정산", "text-[var(--text-dim)] bg-[var(--bg-surface)]"],
};

export function PartnerDetailModal({ companyId, partnerId, type, year, partnerName, focus, onClose }: {
  companyId: string; partnerId: string | null; type: string; year: number; partnerName: string; focus: "all" | "prior"; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const yStart = `${year}-01-01`;
  const isSales = type === "sales";
  const pal = palette(type);
  const accent = pal.tintText;
  const [view, setView] = useState<"all" | "period" | "prior">(focus === "prior" ? "prior" : "all");
  const [closeTarget, setCloseTarget] = useState<any | null>(null);
  const [adjView, setAdjView] = useState<string | null>(null); // 차액마감 행 클릭 → 전표 모달

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
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${pal.tintBg} ${pal.tintText}`}>{pal.label}</span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{year}년 기준 · 세금계산서 {invoices.length}건</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-lg shrink-0">✕</button>
        </div>

        {/* 요약 */}
        <div className="px-5 py-3 border-b border-[var(--border)] grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([["전기이월", priorOut, "text-amber-500"], ["당기 청구", periodBilled, "text-[var(--text)]"], ["당기 정산", periodSettled, "text-[var(--text-muted)]"], ["잔액", priorOut + periodOut, accent]] as const).map(([label, val, cls]) => (
            <div key={label} className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
              <div className="caption">{label}</div>
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
                      <div className="caption">공급 {won(inv.supply_amount)} · 세액 {won(inv.tax_amount)}</div>
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
                      <button key={i} onClick={() => setAdjView(s.id)}
                        className="ml-3 mt-1 flex items-center gap-2 text-[10px] text-[var(--text-dim)] hover:text-amber-400 group"
                        title="클릭하면 차액 마감 전표(분개)를 확인하고 삭제할 수 있습니다">
                        <span className="underline decoration-dotted underline-offset-2 group-hover:text-amber-400">↳ 차액 마감</span>
                        <span className="mono-number text-[var(--text-muted)]">{won(s.amount)}</span>
                        <span className="px-1 rounded bg-amber-500/10 text-amber-500">{ADJ_REASON_LABEL[s.adjustment_reason] || "잔액 정리"}</span>
                        <span>{s.status === "confirmed" ? "확정" : s.status === "rejected" ? "취소됨" : s.status}</span>
                      </button>
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
            qc.invalidateQueries({ queryKey: ["ledger-sheet-inv"] });
            qc.invalidateQueries({ queryKey: ["ledger-sheet-settle"] });
            toast("차액 마감 완료 — 잔액이 정리되었습니다", "success");
          }}
          onError={(msg) => toast(msg, "error")}
        />
      )}
      {adjView && <AdjVoucherModal settlementId={adjView} type={type} partnerName={partnerName} onClose={() => setAdjView(null)} />}
    </div>
  );
}

// ── 차액 마감 모달: 잔액을 사유(원천세/수수료/단수차/할인/기타)와 함께 정리 ──
//   close_invoice_balance RPC → invoice_settlements 에 조정행(confirmed) → 트리거가 settled_amount 재계산.
//   취소는 거래 대사 확정 내역의 "마감 취소"(status=rejected → 잔액 자동 원복).
function CloseBalanceModal({ invoice, remaining, onClose, onDone, onError }: {
  invoice: any; remaining: number; onClose: () => void; onDone: () => void; onError: (msg: string) => void;
}) {
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
