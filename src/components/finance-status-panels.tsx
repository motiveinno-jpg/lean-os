"use client";

// ── 통장·카드 현황 판 (2026-08-26 사장님: "통장이나 카드 부분은 원래 통장·카드의 분석 쪽으로") ──────
//   재무 › 현황(149차)에 있던 통장·카드 탭을 그 자리에서 떼어 통장 › 개요, 카드 › 분석 안으로 옮겼다.
//   재무 › 현황은 전표 현황만 남긴다. 숫자는 통장·카드 거래 표에서 그 자리에서 센다 — 집계 표 없음.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { ColumnChart, LineChart, DonutChart, BarChart, Legend, vizColor } from "@/components/charts/kit";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const wonShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${s}${Math.round(a).toLocaleString("ko-KR")}`;
};
export function dayKeys(from: string, to: string) {
  const out: string[] = []; const p = (n: number) => String(n).padStart(2, "0");
  const d = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`);
  for (let i = 0; d <= end && i < 400; i++, d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  return out;
}
export const dayLabel = (k: string) => `${parseInt(k.slice(5, 7), 10)}/${parseInt(k.slice(8, 10), 10)}`;
const topN = (m: Map<string, number>, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value], i) => ({ label, value, color: vizColor(i) }));

type BankTx = { id: string; bank_account_id: string | null; transaction_date: string; amount: number; type: string; counterparty: string | null; journal_entry_id: string | null; mapping_status: string | null };
type Acct = { id: string; bank_name: string | null; alias: string | null; account_number: string | null; balance: number; is_hidden: boolean | null };

/** 통장 › 개요 — 기간 입출금 추이·출금 상위 거래처·계좌별 표 */
export function BankStatusPanels({ companyId, from, to }: { companyId: string | null; from: string; to: string }) {
  const { data: accts = [] } = useQuery({ queryKey: ["bank-status-accts", companyId], enabled: !!companyId, queryFn: async () =>
    ((await supabase.from("bank_accounts").select("id, bank_name, alias, account_number, balance, is_hidden").eq("company_id", companyId!)).data || []) as Acct[] });
  const { data: bank = [] } = useQuery({ queryKey: ["bank-status-tx", companyId, from, to], enabled: !!companyId, queryFn: async () =>
    await fetchPaged<BankTx>("finance-status:bank", () => (supabase.from("bank_transactions").select("id, bank_account_id, transaction_date, amount, type, counterparty, journal_entry_id, mapping_status") as any)
      .eq("company_id", companyId!).gte("transaction_date", from).lte("transaction_date", to).order("transaction_date").order("id"), 50000) });
  const acctName = (a: Acct) => a.alias || `${a.bank_name || ""} ${a.account_number ? a.account_number.slice(-4) : ""}`.trim() || "계좌";
  const days = useMemo(() => dayKeys(from, to), [from, to]);
  const series = (m: Map<string, number>) => days.map((k) => ({ label: dayLabel(k), value: m.get(k) || 0 }));
  const s = useMemo(() => {
    let inflow = 0, outflow = 0, unmatched = 0;
    const inDay = new Map<string, number>(), outDay = new Map<string, number>(), perAcct = new Map<string, { in: number; out: number; n: number; last: string }>(), perCp = new Map<string, number>();
    for (const t of bank) {
      const a = Math.abs(Number(t.amount || 0)); const isIn = t.type === "income" || Number(t.amount) > 0 && t.type !== "expense";
      if (isIn) { inflow += a; inDay.set(t.transaction_date, (inDay.get(t.transaction_date) || 0) + a); }
      else { outflow += a; outDay.set(t.transaction_date, (outDay.get(t.transaction_date) || 0) + a); const k = t.counterparty || "(미상)"; perCp.set(k, (perCp.get(k) || 0) + a); }
      if (!t.journal_entry_id && (t.mapping_status || "unmapped") === "unmapped") unmatched++;
      const pa = perAcct.get(t.bank_account_id || "-") || { in: 0, out: 0, n: 0, last: "" };
      if (isIn) pa.in += a; else pa.out += a; pa.n++; if (t.transaction_date > pa.last) pa.last = t.transaction_date; perAcct.set(t.bank_account_id || "-", pa);
    }
    return { inflow, outflow, unmatched, inDay, outDay, perAcct, perCp, visible: accts.filter((a) => !a.is_hidden) };
  }, [bank, accts]);
  return (
    <div className="fin-status-panels">
      <div className="pnl-grid2">
        <div className="pnl-panel">
          <h3>일별 입금 · 출금</h3><p>{from} ~ {to} · 입금 ₩{won(s.inflow)} · 출금 ₩{won(s.outflow)}{s.unmatched ? ` · 미매칭 ${s.unmatched}건` : ""}</p>
          <LineChart height={180} unit="원" yFmt={wonShort} series={[{ name: "입금", points: series(s.inDay) }, { name: "출금", points: series(s.outDay) }]} />
          <Legend items={[{ name: "입금", color: vizColor(0) }, { name: "출금", color: vizColor(1) }]} />
        </div>
        <div className="pnl-panel">
          <h3>출금 상위 거래처</h3><p>기간 통장 출금 합 상위 10</p>
          {s.perCp.size ? <BarChart unit="원" data={topN(s.perCp)} /> : <div className="inv-status-empty">출금이 없습니다</div>}
        </div>
      </div>
      <div className="pnl-panel">
        <h3>계좌별</h3><p>잔액은 지금, 입출금은 {from} ~ {to}</p>
        <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
          <thead><tr><th>계좌</th><th>잔액</th><th>입금</th><th>출금</th><th>거래 건수</th><th>최근 거래일</th></tr></thead>
          <tbody>{s.visible.map((a) => { const r = s.perAcct.get(a.id); return (
            <tr key={a.id}><td className="text-left"><b>{acctName(a)}</b> <span className="ev-dim">{a.bank_name}</span></td>
              <td className="tr mono-number">₩{won(Number(a.balance || 0))}</td><td className="tr mono-number">₩{won(r?.in || 0)}</td><td className="tr mono-number">₩{won(r?.out || 0)}</td>
              <td className="tr mono-number">{r?.n || 0}</td><td className="mono-number tc">{r?.last || "—"}</td></tr>
          ); })}{s.visible.length === 0 && <tr><td colSpan={6} className="tc ev-dim">연결된 계좌가 없습니다</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  );
}

type CardTx = { id: string; transaction_date: string; amount: number; merchant_name: string | null; card_name: string | null; journal_entry_id: string | null };

/** 카드 › 분석 — 일별 승인·카드별 비중·가맹점 상위 */
export function CardStatusPanels({ companyId, from, to }: { companyId: string | null; from: string; to: string }) {
  const { data: cards = [] } = useQuery({ queryKey: ["card-status-tx", companyId, from, to], enabled: !!companyId, queryFn: async () =>
    await fetchPaged<CardTx>("finance-status:card", () => (supabase.from("card_transactions").select("id, transaction_date, amount, merchant_name, card_name, journal_entry_id") as any)
      .eq("company_id", companyId!).gte("transaction_date", from).lte("transaction_date", to).order("id"), 50000) });
  const days = useMemo(() => dayKeys(from, to), [from, to]);
  const s = useMemo(() => {
    let amt = 0, noVoucher = 0;
    const perCard = new Map<string, { amt: number; n: number }>(), perMerchant = new Map<string, number>(), perDay = new Map<string, number>();
    for (const c of cards) {
      const a = Math.abs(Number(c.amount || 0)); amt += a; if (!c.journal_entry_id) noVoucher++;
      const k = c.card_name || "카드"; const pc = perCard.get(k) || { amt: 0, n: 0 }; pc.amt += a; pc.n++; perCard.set(k, pc);
      const m = c.merchant_name || "(미상)"; perMerchant.set(m, (perMerchant.get(m) || 0) + a);
      perDay.set(c.transaction_date, (perDay.get(c.transaction_date) || 0) + a);
    }
    return { amt, n: cards.length, noVoucher, perCard, perMerchant, perDay };
  }, [cards]);
  return (
    <div className="fin-status-panels">
      <div className="pnl-grid2">
        <div className="pnl-panel">
          <h3>일별 승인</h3><p>{from} ~ {to} · {s.n}건 · ₩{won(s.amt)}{s.noVoucher ? ` · 전표 없음 ${s.noVoucher}건` : ""}</p>
          <ColumnChart height={180} unit="원" data={days.map((k) => ({ label: dayLabel(k), value: s.perDay.get(k) || 0 }))} />
        </div>
        <div className="pnl-panel">
          <h3>카드별 비중</h3><p>기간 승인 금액</p>
          {s.perCard.size ? <DonutChart unit="원" total={`₩${wonShort(s.amt)}`} data={[...s.perCard.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, 8).map(([k, v], i) => ({ label: k, value: v.amt, color: vizColor(i) }))} /> : <div className="inv-status-empty">승인이 없습니다</div>}
        </div>
      </div>
      <div className="pnl-panel">
        <h3>가맹점 상위</h3><p>기간 승인 합 상위 10</p>
        {s.perMerchant.size ? <BarChart unit="원" data={topN(s.perMerchant)} /> : <div className="inv-status-empty">승인이 없습니다</div>}
      </div>
    </div>
  );
}
