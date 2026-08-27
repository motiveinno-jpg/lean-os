"use client";

// ── 예산 입력 — 계정과목 × 12개월 격자 (2026-08-27 ERP 2순위 '예산 관리', 결정 70~71) ──
//   수익·비용 계정만(자산·부채 예산은 뜻이 다르다). 셀에 적고 '저장'을 누르면 account_budgets 에 upsert.
//   실적 대비는 재무 › 전표 현황 › 계정과목 탭이 보여 준다.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useModalKeys } from "@/hooks/use-modal-keys";

type Acct = { id: string; code: string; name: string; account_type: string };
export type BudgetRow = { account_id: string; month: string; amount: number };

export async function fetchBudgets(companyId: string, from: string, to: string): Promise<BudgetRow[]> {
  const data = logRead("budgets:list", await (supabase as any).from("account_budgets").select("account_id, month, amount")
    .eq("company_id", companyId).gte("month", from.slice(0, 7)).lte("month", to.slice(0, 7)).limit(5000));
  return ((data || []) as any[]).map((r) => ({ account_id: r.account_id, month: r.month, amount: Number(r.amount || 0) }));
}

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const num = (s: string) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;
const fmt = (n: number) => (n ? n.toLocaleString("ko-KR") : "");

export function BudgetEditor({ companyId, userId, year: initYear, onClose }: { companyId: string; userId: string | null; year: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  useModalKeys(true, onClose);
  const [year, setYear] = useState(initYear);
  const [side, setSide] = useState<"expense" | "revenue">("expense");
  const [q, setQ] = useState("");
  const [cells, setCells] = useState<Record<string, string>>({});   // `${account}|${month}` → 입력값
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: accounts = [] } = useQuery<Acct[]>({
    queryKey: ["budget-accounts", companyId],
    queryFn: async () => (logRead("budgets:accounts", await supabase.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId).in("account_type", ["expense", "revenue"]).order("code")) || []) as Acct[],
    staleTime: 300_000,
  });
  const { data: saved = [] } = useQuery({ queryKey: ["budgets-year", companyId, year], queryFn: () => fetchBudgets(companyId, `${year}-01-01`, `${year}-12-31`) });
  useEffect(() => {
    const m: Record<string, string> = {};
    for (const r of saved) m[`${r.account_id}|${r.month.slice(5, 7)}`] = fmt(r.amount);
    setCells(m); setDirty(new Set());
  }, [saved]);

  //   예산이 있는 계정 + 검색에 맞는 계정. 전부 보이면 90줄이라 예산 있는 것 위로
  const rows = useMemo(() => {
    const has = new Set(saved.map((r) => r.account_id));
    return accounts.filter((a) => a.account_type === side && (!q || a.name.includes(q) || a.code.includes(q)))
      .sort((a, b) => (has.has(b.id) ? 1 : 0) - (has.has(a.id) ? 1 : 0) || a.code.localeCompare(b.code));
  }, [accounts, saved, side, q]);

  const set = (k: string, v: string) => { setCells((c) => ({ ...c, [k]: v })); setDirty((d) => new Set(d).add(k)); };
  const fill = (acct: string, v: string) => { for (const m of MONTHS) set(`${acct}|${m}`, v); };
  const rowSum = (acct: string) => MONTHS.reduce((n, m) => n + num(cells[`${acct}|${m}`] || ""), 0);
  const save = async () => {
    if (!dirty.size || busy) return;
    setBusy(true);
    try {
      const ups: any[] = []; const dels: { account_id: string; month: string }[] = [];
      for (const k of dirty) {
        const [account_id, mm] = k.split("|"); const amount = num(cells[k] || "");
        if (amount) ups.push({ company_id: companyId, account_id, month: `${year}-${mm}`, amount, updated_by: userId, updated_at: new Date().toISOString() });
        else dels.push({ account_id, month: `${year}-${mm}` });
      }
      if (ups.length) { const { error } = await (supabase as any).from("account_budgets").upsert(ups, { onConflict: "company_id,account_id,month" }); if (error) throw error; }
      for (const d of dels) { await (supabase as any).from("account_budgets").delete().eq("company_id", companyId).eq("account_id", d.account_id).eq("month", d.month); }
      toast(`예산 ${ups.length}칸 저장${dels.length ? ` · ${dels.length}칸 지움` : ""}`, "success");
      qc.invalidateQueries({ queryKey: ["budgets-year"] }); qc.invalidateQueries({ queryKey: ["fin-status-budgets"] });
      setDirty(new Set());
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box bud-box" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-head"><h3>예산 입력 — 계정과목 × 월</h3><button type="button" className="inv-modal-x" onClick={onClose}>✕</button></div>
        <p className="inv-modal-desc">수익·비용 계정에 달마다 예산을 적습니다. 실적 대비는 전표 현황 › 계정과목 탭에서. 줄 맨 앞 '모든 달' 칸에 적으면 12칸에 한꺼번에 들어갑니다. 부서별 예산은 전표에 부서 칸이 생기면.</p>
        <div className="bud-bar">
          <select className="inv-input bud-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[initYear + 1, initYear, initYear - 1].map((y) => <option key={y} value={y}>{y}년</option>)}</select>
          <span className="qk-chips">
            <button type="button" className={side === "expense" ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => setSide("expense")}>비용</button>
            <button type="button" className={side === "revenue" ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => setSide("revenue")}>수익</button>
          </span>
          <input className="inv-input bud-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="계정 이름·코드" />
          <span className="doc-sums-sp" />
          <span className="ev-dim">{dirty.size ? `${dirty.size}칸 바뀜` : ""}</span>
        </div>
        <div className="stg-table-wrap bud-scroll">
          <table className="ev-table ev-lined table-inv-status-sm bud-table">
            <thead><tr><th className="bud-th-acct">계정</th><th>모든 달</th>{MONTHS.map((m) => <th key={m}>{Number(m)}월</th>)}<th>연간</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}>
                <td className="text-left bud-td-acct"><span className="ev-dim mono-number">{a.code}</span> {a.name}</td>
                <td><input className="bud-cell bud-cell-all" placeholder="→" onChange={(e) => fill(a.id, e.target.value)} onBlur={(e) => { e.target.value = ""; }} /></td>
                {MONTHS.map((m) => { const k = `${a.id}|${m}`; return <td key={m}><input className={dirty.has(k) ? "bud-cell bud-cell-dirty" : "bud-cell"} value={cells[k] || ""} onChange={(e) => set(k, e.target.value)} onBlur={(e) => set(k, fmt(num(e.target.value)))} /></td>; })}
                <td className="tr mono-number bud-sum">{fmt(rowSum(a.id)) || "—"}</td>
              </tr>
            ))}{!rows.length && <tr><td colSpan={15} className="tc ev-dim">계정이 없습니다</td></tr>}</tbody>
          </table>
        </div>
        <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button><button type="button" className="btn-primary btn-sm" disabled={!dirty.size || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button></div>
      </div>
    </div>
  );
}
