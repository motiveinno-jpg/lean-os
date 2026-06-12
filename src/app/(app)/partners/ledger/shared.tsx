"use client";

// 거래처 원장 ↔ 거래 대사 공유 모듈 (2026-06-12 메뉴 분리 핸드오프).
//   /partners/ledger (조회: 원장) 와 /partners/reconciliation (작업: 대사) 가 공용으로 쓰는
//   타입·포맷·그리드 유틸·원장 시트·거래처 상세(차액 마감 포함).
//   색 규칙(핸드오프 §4-2): 매출처=파랑(#2563EB) / 매입처=주황(#EA580C). 빨강은 연체·마이너스 전용.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

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
export type OpenTx = { id: string; amount: number; settled_amount: number; transaction_date: string; counterparty: string | null; type: string; suggestedCount?: number };
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
export const GRID_TH = "px-3 py-2 font-semibold whitespace-nowrap border-l border-[var(--border)]/60 first:border-l-0";
export const GRID_TD = "px-3 py-1.5 border-l border-[var(--border)]/60 first:border-l-0 whitespace-nowrap overflow-hidden text-ellipsis";

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
type SheetEntry = { date: string; desc: string; debit: number; credit: number; isAdj?: boolean };

export function PartnerLedgerSheet({ companyId, partnerId, type, year, partnerName, openingFromRpc, onOpenDetail }: {
  companyId: string; partnerId: string | null; type: string; year: number; partnerName: string;
  openingFromRpc: number; onOpenDetail: () => void;
}) {
  const yStart = `${year}-01-01`;
  const isSales = type === "sales";
  const pal = palette(type);

  // 발생: 해당 거래처 세금계산서 (연말까지 — 전기이월 산출 위해 과거 포함)
  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["ledger-sheet-inv", companyId, partnerId, type, year],
    queryFn: async () => {
      let qb = db.from("tax_invoices")
        .select("id, issue_date, item_name, label, total_amount")
        .eq("company_id", companyId).eq("type", type).neq("status", "void")
        .lte("issue_date", `${year}-12-31`)
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
    queryKey: ["ledger-sheet-settle", companyId, partnerId, type, year, invIds.length],
    queryFn: async () => {
      if (invIds.length === 0) return [];
      const { data: setts } = await db.from("invoice_settlements")
        .select("tax_invoice_id, amount, match_type, adjustment_reason, bank_transaction_id, created_at")
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

  const { opening, months, totals } = useMemo(() => {
    const occur = (inv: any): SheetEntry => ({
      date: inv.issue_date,
      desc: `세금계산서 · ${inv.item_name || inv.label || "품목 미상"}`,
      debit: isSales ? Number(inv.total_amount || 0) : 0,
      credit: isSales ? 0 : Number(inv.total_amount || 0),
    });
    const settle = (s: any): SheetEntry => ({
      date: s.date,
      desc: s.match_type === "adjustment"
        ? `차액 마감 (${ADJ_REASON_LABEL[s.adjustment_reason] || "잔액 정리"})`
        : `${isSales ? "입금" : "지급"}${s.cp ? ` · ${s.cp}` : ""}`,
      debit: isSales ? 0 : Number(s.amount || 0),
      credit: isSales ? Number(s.amount || 0) : 0,
      isAdj: s.match_type === "adjustment",
    });

    const all: SheetEntry[] = [...invoices.map(occur), ...settles.map(settle)];
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
  }, [invoices, settles, isSales, yStart]);

  void openingFromRpc; // RPC 이월값은 참고용 — 시트는 자체 합산(원장 행과 1원 단위 일치 보장)

  const num = (n: number) => (n ? Math.round(n).toLocaleString() : "");
  const cellR = "px-3 py-1.5 text-right mono-number border-l border-[var(--border)]/60";

  const downloadCsv = () => {
    const rows: string[][] = [["일자", "적요", "차변", "대변", "잔액"]];
    let bal = opening;
    rows.push([`${year}-01-01`, "[전기이월]", "", "", String(Math.round(opening))]);
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
    a.download = `거래처원장_${partnerName}_${year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  let running = opening;

  return (
    <div className="glass-card overflow-hidden">
      {/* 시트 헤더 */}
      <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-[var(--text)] truncate">{partnerName}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${pal.tintBg} ${pal.tintText}`}>{pal.acct}</span>
          <span className="text-[11px] text-[var(--text-dim)] shrink-0">{year}-01-01 ~ {year}-12-31</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={downloadCsv} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">엑셀</button>
          <button onClick={onOpenDetail} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/50">상세 · 차액 마감</button>
        </div>
      </div>

      {/* 원장 그리드 */}
      <div className="overflow-auto max-h-[560px]">
        <table className="w-full min-w-[640px] text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="px-3 py-2 text-left font-semibold w-[92px]">일자</th>
              <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60">적요</th>
              <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]">차변{isSales ? " (발생)" : " (지급)"}</th>
              <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]">대변{isSales ? " (회수)" : " (발생)"}</th>
              <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[130px]">잔액</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="p-10 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
            ) : (
              <>
                <tr className="bg-[var(--bg-surface)]/70 border-b border-[var(--border)]/60 font-semibold">
                  <td className="px-3 py-1.5 text-[var(--text-dim)]">{year}-01-01</td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)] border-l border-[var(--border)]/60">[전기이월]</td>
                  <td className={cellR} /><td className={cellR} />
                  <td className={`${cellR} ${opening !== 0 ? "text-amber-500" : "text-[var(--text-dim)]"}`}>{Math.round(opening).toLocaleString()}</td>
                </tr>
                {months.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-[var(--text-muted)]">당기({year}년) 거래가 없습니다.</td></tr>
                )}
                {months.map(([m, entries]) => {
                  const md = entries.reduce((s, e) => s + e.debit, 0);
                  const mc = entries.reduce((s, e) => s + e.credit, 0);
                  return (
                    <Fragment key={m}>
                      {entries.map((e, i) => {
                        running += isSales ? e.debit - e.credit : e.credit - e.debit;
                        return (
                          <tr key={`${m}-${i}`} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50">
                            <td className="px-3 py-1.5 text-[var(--text-muted)] mono-number">{e.date}</td>
                            <td className={`px-3 py-1.5 border-l border-[var(--border)]/60 truncate max-w-[260px] ${e.isAdj ? "text-amber-500" : "text-[var(--text)]"}`}>{e.desc}</td>
                            <td className={`${cellR} ${e.debit ? "text-[var(--text)]" : ""}`}>{num(e.debit)}</td>
                            <td className={`${cellR} ${e.credit ? "text-[var(--text)]" : ""}`}>{num(e.credit)}</td>
                            <td className={`${cellR} font-semibold ${running > 0 ? pal.tintText : running < 0 ? "text-red-500" : "text-[var(--text-dim)]"}`}>{Math.round(running).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-[var(--bg-surface)]/70 border-b border-[var(--border)]/60 text-[var(--text-muted)] font-semibold">
                        <td className="px-3 py-1.5">{Number(m.slice(5, 7))}월</td>
                        <td className="px-3 py-1.5 border-l border-[var(--border)]/60">[월계]</td>
                        <td className={cellR}>{num(md)}</td>
                        <td className={cellR}>{num(mc)}</td>
                        <td className={cellR} />
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="bg-[var(--bg-surface)] border-t-2 border-[var(--border)] font-bold text-[var(--text)]">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 border-l border-[var(--border)]/60">[합계]</td>
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
        차변/대변은 확정된 매칭만 반영됩니다 · 발생 = 세금계산서(부가세 포함) · {isSales ? "회수" : "지급"} = 통장 매칭 + 차액 마감 · 미확정 제안은 매칭허브에서 처리하세요
      </div>
    </div>
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
            qc.invalidateQueries({ queryKey: ["ledger-sheet-inv"] });
            qc.invalidateQueries({ queryKey: ["ledger-sheet-settle"] });
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
