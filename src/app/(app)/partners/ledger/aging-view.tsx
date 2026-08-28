"use client";

// ── 채권·채무 연령표 — 거래처 × 경과 구간 (2026-08-27 ERP 공백 ① — 사장님 "추천 순서대로 진행")
//
//   History: 원장 요약 줄에 매출 미수 경과 칩(0–30/31–60/61–90/90+)이 있었지만(2026-08-19) 합계뿐이라
//   "어느 거래처가 얼마나 오래 밀렸나"는 거래처를 하나씩 눌러야 알 수 있었고, 매입처(줄 돈)는 아예 없었다.
//   ERP 의 첫 화면은 이 표다 — 거래처별 구간 금액 · 최장 경과 · 마지막 정산 · 독촉 기록.
//
//   결정 50 — 기준: **전표처리된 세금계산서의 미정산 잔액**(total − settled), 경과일 = 오늘 − 발행일. 원장 칩과 같은 기준.
//             원장 총액(전표·이월 포함)과 다를 수 있어 머리에 적는다.
//   결정 51 — 매입처도 같은 표(줄 돈). 구간·색은 같고 말만 미지급.
//   결정 52 — 독촉 기록은 partners.notes 에 `[YYYY-MM-DD 독촉] …` 줄로 쌓는다(표 신설 없이). 마지막 줄을 표에 보인다.
//             발송은 하지 않는다 — 문구는 사람이 복사해 보낸다(제안은 자동, 확정은 사람).
//   결정 53 — 자동으로 못 푸는 것: 계산서 없이 전표로만 잡힌 채권(이월·수기)은 여기 안 나온다 → 원장 보기로.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { kstDateStr, todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { SortableTh, nextSort, type SortState } from "@/components/sortable-th";
import { quickSearchHit } from "@/components/query-kit";
import { won } from "./shared";
import { fetchPartnerCredit, creditReason } from "@/lib/partner-credit";

export const AGE_BUCKETS = [
  { label: "0–30일", min: 0, max: 30 }, { label: "31–60일", min: 31, max: 60 },
  { label: "61–90일", min: 61, max: 90 }, { label: "90일+", min: 91, max: Infinity },
];
export type AgingRow = {
  partnerId: string | null; name: string; code: number | null;
  buckets: number[]; total: number; count: number; oldestDays: number; oldestDate: string | null;
  lastSettle: string | null; lastNote: string | null;
};
type SortKey = "name" | "b0" | "b1" | "b2" | "b3" | "total" | "oldest" | "last";

/** 연령표 데이터 — 원장 화면이 같이 쓴다(요약 줄 수치·엑셀) */
export function useAging(companyId: string | null, type: "sales" | "purchase") {
  return useQuery<AgingRow[]>({
    queryKey: ["ledger-aging-rows", companyId, type],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 730);
      const [inv, settles, notes] = await Promise.all([
        fetchPaged<any>("aging:inv", () => supabase.from("tax_invoices")
          .select("id, total_amount, supply_amount, settled_amount, issue_date, status, partner_id")
          .eq("company_id", companyId ?? "").eq("type", type).neq("status", "void")
          .not("journal_entry_id", "is", null).gte("issue_date", kstDateStr(since))
          .order("issue_date", { ascending: false }).order("id"), 50000),
        //   마지막 정산 — 확정된 정산의 통장 거래일(없으면 정산 확정일)
        fetchPaged<any>("aging:settles", () => (supabase as any).from("invoice_settlements")
          .select("created_at, id, tax_invoices!inner(partner_id, type), bank_transactions(transaction_date)")
          .eq("company_id", companyId ?? "").eq("status", "confirmed").eq("tax_invoices.type", type)
          .order("created_at", { ascending: false }).order("id"), 50000),
        fetchPaged<any>("aging:notes", () => supabase.from("partners").select("id, notes").eq("company_id", companyId ?? "").not("notes", "is", null).order("id"), 50000),
      ]);
      const today = todayKst();
      const todayMs = new Date(today).getTime();
      const map = new Map<string, AgingRow>();
      for (const r of (inv || []) as any[]) {
        if (r.status === "draft") continue;
        const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
        if (bal <= 1) continue;
        const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
        const bi = Math.max(0, AGE_BUCKETS.findIndex((x) => days >= x.min && days <= x.max));
        const pk = r.partner_id || "none";
        let row = map.get(pk);
        if (!row) {
          row = { partnerId: r.partner_id || null, name: "", code: null,
            buckets: [0, 0, 0, 0], total: 0, count: 0, oldestDays: -1, oldestDate: null, lastSettle: null, lastNote: null };
          map.set(pk, row);
        }
        row.buckets[bi] += bal; row.total += bal; row.count += 1;
        if (days > row.oldestDays) { row.oldestDays = days; row.oldestDate = String(r.issue_date).slice(0, 10); }
      }
      for (const s of (settles || []) as any[]) {
        const pk = s.tax_invoices?.partner_id || "none";
        const row = map.get(pk); if (!row || row.lastSettle) continue;
        row.lastSettle = s.bank_transactions?.transaction_date || String(s.created_at).slice(0, 10);
      }
      for (const p of (notes || []) as any[]) {
        const row = map.get(p.id); if (!row) continue;
        const lines = String(p.notes || "").split("\n").filter((l) => /^\[\d{4}-\d{2}-\d{2} 독촉\]/.test(l));
        if (lines.length) row.lastNote = lines[lines.length - 1];
      }
      return [...map.values()];
    },
  });
}

export function AgingView({ type, rows: rawRows, loading, q, onOpen, partnerMap, partnerCodeMap, companyId }: {
  type: "sales" | "purchase"; rows: AgingRow[]; loading: boolean; q: string; partnerMap: Record<string, string>; partnerCodeMap: Record<string, number>; companyId?: string | null;
  onOpen: (partnerId: string | null) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  //   신용 등급(매출처만) — 결정 78~80
  const { data: creditMap } = useQuery({ queryKey: ["partner-credit", companyId], queryFn: () => fetchPartnerCredit(companyId!), enabled: !!companyId && type === "sales", staleTime: 60_000 });
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "total", dir: "desc" });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k, k === "name" ? "asc" : "desc"));
  const [noteFor, setNoteFor] = useState<AgingRow | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const isAR = type === "sales";
  const rows = useMemo(() => rawRows.map((r) => ({ ...r, name: (r.partnerId && partnerMap[r.partnerId]) || "미지정 거래처", code: r.partnerId ? partnerCodeMap[r.partnerId] ?? null : null })), [rawRows, partnerMap, partnerCodeMap]);

  const shown = useMemo(() => {
    const list = rows.filter((r) => quickSearchHit(q, [r.name, r.code != null ? String(r.code) : ""], [r.total]));
    const v = (r: AgingRow): number | string => sort.key === "name" ? r.name : sort.key === "total" ? r.total : sort.key === "oldest" ? r.oldestDays
      : sort.key === "last" ? (r.lastSettle || "") : r.buckets[Number(sort.key.slice(1))];
    return list.sort((a, b) => { const x = v(a), y = v(b); const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ko"); return sort.dir === "asc" ? c : -c; });
  }, [rows, q, sort]);
  const sums = AGE_BUCKETS.map((_, i) => shown.reduce((n, r) => n + r.buckets[i], 0));
  const total = shown.reduce((n, r) => n + r.total, 0);

  /** 독촉 문구 — 복사해서 사람이 보낸다 */
  const dunningText = (r: AgingRow) => `${r.name} 담당자님, ${isAR ? "미수금" : "미지급금"} ${won(r.total)}(${r.count}건, 가장 오래된 계산서 ${r.oldestDate ?? "-"})의 ${isAR ? "입금" : "지급"} 일정을 확인 부탁드립니다.`;
  const copyDunning = async (r: AgingRow) => {
    try { await navigator.clipboard.writeText(dunningText(r)); toast("문구를 복사했습니다 — 카톡·문자·메일에 붙여 보내세요", "success"); }
    catch { toast("복사하지 못했습니다", "error"); }
  };
  const saveNote = async () => {
    if (!noteFor?.partnerId || !noteText.trim() || busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.from("partners").select("notes").eq("id", noteFor.partnerId).maybeSingle();
      const prev = String((data as any)?.notes || "").trim();
      const line = `[${todayKst()} 독촉] ${noteText.trim().replace(/\n/g, " ")}`;
      const { error } = await supabase.from("partners").update({ notes: prev ? `${prev}\n${line}` : line } as never).eq("id", noteFor.partnerId);
      if (error) throw error;
      toast("독촉 기록을 남겼습니다", "success"); setNoteFor(null); setNoteText("");
      qc.invalidateQueries({ queryKey: ["ledger-aging-rows"] });
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="collect-empty">연령표를 만드는 중…</div>;
  if (rows.length === 0) return <div className="collect-empty">{isAR ? "미정산 매출 계산서" : "미정산 매입 계산서"}가 없습니다 — 계산서 없이 전표로만 잡힌 잔액은 <b>원장</b> 보기에서 봅니다.</div>;
  return (
    <div className="aging-wrap">
      <p className="inv-hint aging-hint">전표처리된 세금계산서의 미정산 잔액을 발행일 경과로 나눴습니다 — 원장 총액(전표·이월 포함)과는 다를 수 있습니다. 줄을 누르면 그 거래처의 계산서·정산 내역이 열립니다.</p>
      <div className="ev-scroll aging-scroll">
        <table className="ev-table ev-lined aging-table">
          <thead>
            <tr>
              <SortableTh label={isAR ? "매출처" : "매입처"} sortKey="name" sort={sort} onSort={onSort} />
              {AGE_BUCKETS.map((b, i) => <SortableTh key={b.label} label={b.label} sortKey={`b${i}` as SortKey} sort={sort} onSort={onSort} />)}
              <SortableTh label={isAR ? "미수 합계" : "미지급 합계"} sortKey="total" sort={sort} onSort={onSort} />
              <SortableTh label="최장 경과" sortKey="oldest" sort={sort} onSort={onSort} />
              <SortableTh label="마지막 정산" sortKey="last" sort={sort} onSort={onSort} />
              {isAR && <th title="입금 지연 이력 등급 — 마우스를 올리면 근거">신용</th>}
              <th>독촉 기록</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.partnerId ?? "none"} className="aging-row" onClick={() => onOpen(r.partnerId)}>
                <td className="text-left"><span className="ev-dim mono-number">{r.code != null ? String(r.code).padStart(4, "0") : ""}</span> <b>{r.name}</b> <span className="ev-dim">{r.count}건</span></td>
                {r.buckets.map((v, i) => <td key={i} className={`tr mono-number ${v > 0 ? `aging-b${i}` : "ev-dim"}`}>{v > 0 ? won(v) : "—"}</td>)}
                <td className="tr mono-number aging-total">{won(r.total)}</td>
                <td className={`tr mono-number ${r.oldestDays > 90 ? "aging-b3" : ""}`} title={r.oldestDate || undefined}>{r.oldestDays}일</td>
                <td className="tc mono-number">{r.lastSettle || <span className="ev-dim">없음</span>}</td>
                {isAR && <td className="tc">{(() => { const c = r.partnerId ? creditMap?.get(r.partnerId) : undefined; return <span className={`cr-badge ${c?.grade ? `cr-${c.grade}` : "cr-none"}`} title={creditReason(c)}>{c?.grade || "—"}</span>; })()}</td>}
                <td className="text-left aging-note" title={r.lastNote || undefined}>{r.lastNote ? r.lastNote.replace(/^\[(\d{4}-\d{2}-\d{2}) 독촉\]\s*/, "$1 · ") : <span className="ev-dim">—</span>}</td>
                <td className="tc" onClick={(e) => e.stopPropagation()}>
                  <span className="bl-row-acts">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => copyDunning(r)} title="독촉 문구 복사 — 발송은 직접">문구</button>
                    <button type="button" className="btn-secondary btn-sm" disabled={!r.partnerId} onClick={() => { setNoteFor(r); setNoteText(""); }} title={r.partnerId ? "언제 무엇을 했는지 남긴다" : "미지정 거래처는 기록할 수 없습니다"}>기록</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="aging-foot">
              <td className="text-left"><b>합계 {shown.length}곳</b></td>
              {sums.map((v, i) => <td key={i} className="tr mono-number">{won(v)}</td>)}
              <td className="tr mono-number aging-total">{won(total)}</td>
              <td colSpan={isAR ? 5 : 4}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {noteFor && (
        <div className="inv-modal" onClick={() => setNoteFor(null)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>독촉 기록 — {noteFor.name}</h3><button type="button" className="inv-modal-x" onClick={() => setNoteFor(null)}>✕</button></div>
            <p className="inv-modal-desc">{isAR ? "미수" : "미지급"} {won(noteFor.total)} · {noteFor.count}건 · 최장 {noteFor.oldestDays}일. 오늘 날짜로 거래처 메모에 한 줄 남습니다(거래처 상세 메모에서도 보입니다). 발송은 하지 않습니다.</p>
            <textarea className="inv-input aging-note-input" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="예: 담당자 김OO 통화, 9/5 입금 약속" autoFocus />
            <div className="inv-modal-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={() => copyDunning(noteFor)}>독촉 문구 복사</button>
              <span className="doc-sums-sp" />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setNoteFor(null)}>닫기</button>
              <button type="button" className="btn-primary btn-sm" disabled={busy || !noteText.trim()} onClick={saveNote}>기록 남기기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
