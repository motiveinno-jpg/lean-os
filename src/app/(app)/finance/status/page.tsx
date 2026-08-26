"use client";

// ── 재무 › 현황 — 운영 콕핏 (2026-08-26 사장님 지시: "재고의 현황처럼 재무에도") ──────
//   분석(경영 요약·손익·자금 전망)은 기간·추이를 본다. 여기는 **오늘 돈이 어디에 어떻게 있고, 처리할 게 뭔가** 만 본다 — 겹치지 않게.
//   숫자는 경영 요약과 같은 함수(fetchBizSummary)와 통장·카드·계산서·원장 표에서 그 자리에서 센다. 집계 표를 따로 두지 않는다.
//   규칙: 조회 화면 표준 — 상자 안 파란 밑줄 갈래, 조회 줄엔 기간만, 결과 요약 줄(Stat), 판(pnl-panel)에 그래프(차트 키트)+표.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { ColumnChart, LineChart, DonutChart, BarChart, Legend, vizColor } from "@/components/charts/kit";
import { exportToExcel } from "@/lib/excel-export";
import { fetchBizSummary, type Todo } from "@/lib/biz-summary";
import { fetchReceivables } from "@/lib/pnl-status";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const wonShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${s}${Math.round(a).toLocaleString("ko-KR")}`;
};
type Tab = "all" | "bank" | "card" | "arap" | "docs";
const TABS: [Tab, string][] = [["all", "종합"], ["bank", "통장"], ["card", "카드"], ["arap", "미수·미지급"], ["docs", "증빙·전표"]];
const monthStart = () => todayKst().slice(0, 7) + "-01";
function dayKeys(from: string, to: string) {
  const out: string[] = []; const p = (n: number) => String(n).padStart(2, "0");
  const d = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`);
  for (let i = 0; d <= end && i < 400; i++, d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  return out;
}
const dayLabel = (k: string) => `${parseInt(k.slice(5, 7), 10)}/${parseInt(k.slice(8, 10), 10)}`;

type BankTx = { id: string; bank_account_id: string | null; transaction_date: string; amount: number; type: string; counterparty: string | null; journal_entry_id: string | null; mapping_status: string | null; balance_after: number | null };
type CardTx = { id: string; transaction_date: string; amount: number; merchant_name: string | null; card_name: string | null; journal_entry_id: string | null };
type Inv = { id: string; type: string; total_amount: number; status: string; journal_entry_id: string | null; counterparty_name: string | null; issue_date: string };
type Acct = { id: string; bank_name: string | null; alias: string | null; account_number: string | null; balance: number; is_hidden: boolean | null };
type Recur = { id: string; name: string; amount: number; next_due_date: string | null; is_active: boolean };
type Ledger = { partner_id: string; type: string; prior_outstanding: number; period_billed: number; period_settled: number; period_outstanding: number; invoice_count: number };

export default function FinanceStatusPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);
  const [tab, setTab] = useState<Tab>("all");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKst);
  const today = todayKst();
  const month = from.slice(0, 7);

  const q = <T,>(key: string, fn: () => Promise<T>, extra: unknown[] = []) =>
    useQuery<T>({ queryKey: [key, companyId, ...extra], queryFn: fn, enabled: !!companyId });   // eslint-disable-line react-hooks/rules-of-hooks
  const { data: biz, isLoading: bizLoading } = q("fin-status-biz", () => fetchBizSummary(companyId!, month, userId || undefined), [month]);
  const { data: accts = [] } = q("fin-status-accts", async () => ((await supabase.from("bank_accounts").select("id, bank_name, alias, account_number, balance, is_hidden").eq("company_id", companyId!)).data || []) as Acct[]);
  const { data: bank = [] } = q("fin-status-bank", async () => ((await (supabase.from("bank_transactions").select("id, bank_account_id, transaction_date, amount, type, counterparty, journal_entry_id, mapping_status, balance_after") as any)
    .eq("company_id", companyId!).gte("transaction_date", from).lte("transaction_date", to).order("transaction_date").limit(5000)).data || []) as BankTx[], [from, to]);
  const { data: cards = [] } = q("fin-status-card", async () => ((await (supabase.from("card_transactions").select("id, transaction_date, amount, merchant_name, card_name, journal_entry_id") as any)
    .eq("company_id", companyId!).gte("transaction_date", from).lte("transaction_date", to).limit(5000)).data || []) as CardTx[], [from, to]);
  const { data: invs = [] } = q("fin-status-inv", async () => ((await (supabase.from("tax_invoices").select("id, type, total_amount, status, journal_entry_id, counterparty_name, issue_date") as any)
    .eq("company_id", companyId!).gte("issue_date", from).lte("issue_date", to).limit(5000)).data || []) as Inv[], [from, to]);
  const { data: receiptCount = 0 } = q("fin-status-receipts", async () => (await supabase.from("cash_receipts").select("id", { count: "exact", head: true }).eq("company_id", companyId!).gte("issue_date", from).lte("issue_date", to)).count || 0, [from, to]);
  const { data: recurring = [] } = q("fin-status-recur", async () => ((await supabase.from("recurring_payments").select("id, name, amount, next_due_date, is_active").eq("company_id", companyId!).eq("is_active", true)).data || []) as Recur[]);
  const { data: ledger = [] } = q("fin-status-ledger", async () => ((await supabase.rpc("get_partner_ledger_by_year", { p_year: Number(from.slice(0, 4)) })).data || []) as Ledger[], [from.slice(0, 4)]);
  //   원장 미수 잔액이 비어 있는 회사(정산 입력을 안 쓰는 곳)를 위해 — 세금계산서 상태 기준 미수를 보조로 둔다(경영 요약의 '30일 넘은 미수'와 같은 셈)
  const { data: recv } = q("fin-status-recv", () => fetchReceivables(companyId!));
  const { data: partners = [] } = q("fin-status-partners", async () => ((await supabase.from("partners").select("id, name").eq("company_id", companyId!).limit(2000)).data || []) as { id: string; name: string }[]);

  const partnerName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);
  const acctName = (a: Acct) => a.alias || `${a.bank_name || ""} ${a.account_number ? a.account_number.slice(-4) : ""}`.trim() || "계좌";
  const days = useMemo(() => dayKeys(from, to), [from, to]);
  const series = (m: Map<string, number>) => days.map((k) => ({ label: dayLabel(k), value: m.get(k) || 0 }));

  // ── 통장 ──
  const bankS = useMemo(() => {
    let inflow = 0, outflow = 0, unmatched = 0, unmatchedAmt = 0;
    const inDay = new Map<string, number>(), outDay = new Map<string, number>(), perAcct = new Map<string, { in: number; out: number; n: number; last: string }>(), perCp = new Map<string, number>();
    for (const t of bank) {
      const a = Math.abs(Number(t.amount || 0)); const isIn = t.type === "income" || Number(t.amount) > 0 && t.type !== "expense";
      if (isIn) { inflow += a; inDay.set(t.transaction_date, (inDay.get(t.transaction_date) || 0) + a); }
      else { outflow += a; outDay.set(t.transaction_date, (outDay.get(t.transaction_date) || 0) + a); const k = t.counterparty || "(미상)"; perCp.set(k, (perCp.get(k) || 0) + a); }
      if (!t.journal_entry_id && (t.mapping_status || "unmapped") === "unmapped") { unmatched++; unmatchedAmt += a; }
      const pa = perAcct.get(t.bank_account_id || "-") || { in: 0, out: 0, n: 0, last: "" };
      if (isIn) pa.in += a; else pa.out += a; pa.n++; if (t.transaction_date > pa.last) pa.last = t.transaction_date; perAcct.set(t.bank_account_id || "-", pa);
    }
    const visible = accts.filter((a) => !a.is_hidden);
    const balance = visible.reduce((n, a) => n + Number(a.balance || 0), 0);
    return { inflow, outflow, unmatched, unmatchedAmt, inDay, outDay, perAcct, perCp, balance, visible };
  }, [bank, accts]);
  // ── 카드 ──
  const cardS = useMemo(() => {
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
  // ── 미수·미지급 ──
  const arap = useMemo(() => {
    const out = (r: Ledger) => Number(r.prior_outstanding || 0) + Number(r.period_outstanding || 0);
    const rows = ledger.map((r) => ({ ...r, outstanding: out(r), name: partnerName.get(r.partner_id) || "(거래처 미상)" })).filter((r) => r.outstanding > 0);
    const ar = rows.filter((r) => r.type === "sales").sort((a, b) => b.outstanding - a.outstanding);
    //   보조: 계산서 상태 기준 미수(거래처별 합·최장 경과일)
    const byName = new Map<string, { amount: number; days: number; n: number }>();
    for (const r of recv?.rows || []) { const c = byName.get(r.name) || { amount: 0, days: 0, n: 0 }; c.amount += r.amount; c.days = Math.max(c.days, r.days); c.n++; byName.set(r.name, c); }
    const arInv = [...byName.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
    return { ar, ap: rows.filter((r) => r.type === "purchase").sort((a, b) => b.outstanding - a.outstanding), arInv, arInvTotal: recv?.total || 0 };
  }, [ledger, partnerName, recv]);
  // ── 증빙·전표 ──
  const docS = useMemo(() => {
    const sales = invs.filter((i) => i.type === "sales" && i.status !== "void"), purchase = invs.filter((i) => i.type === "purchase" && i.status !== "void");
    const sum = (l: Inv[]) => l.reduce((n, i) => n + Number(i.total_amount || 0), 0);
    return {
      sales: { n: sales.length, amt: sum(sales), noVoucher: sales.filter((i) => !i.journal_entry_id).length },
      purchase: { n: purchase.length, amt: sum(purchase), noVoucher: purchase.filter((i) => !i.journal_entry_id).length },
      cardNoVoucher: cardS.noVoucher, bankUnmatched: bankS.unmatched, receipts: receiptCount,
      recurringDue: recurring.filter((r) => r.next_due_date && r.next_due_date >= today).sort((a, b) => (a.next_due_date! < b.next_due_date! ? -1 : 1)),
    };
  }, [invs, cardS.noVoucher, bankS.unmatched, receiptCount, recurring, today]);

  if (!permLoading && !(isMaster || hasPerm("/finance/status"))) {
    return <AccessDenied detail="재무 현황 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const todos: Todo[] = biz?.todos || [];
  const stats: Record<Tab, React.ReactNode> = {
    all: (<>
      <Stat label="통장 잔액" value={`₩${won(bankS.balance)}`} />
      <Stat label="기간 입금" value={`₩${won(bankS.inflow)}`} />
      <Stat label="기간 출금" value={`₩${won(bankS.outflow)}`} />
      <Stat label="카드 승인" value={`₩${won(cardS.amt)}`} />
      <Stat label={biz && biz.arap.ar > 0 ? "받을 돈" : "받을 돈(계산서 기준)"} value={biz ? `₩${won(biz.arap.ar > 0 ? biz.arap.ar : arap.arInvTotal)}` : "—"} />
      <Stat label="30일 내 낼 돈" value={biz ? `₩${won(biz.arap.due30)}` : "—"} tone={biz && biz.arap.due30 > bankS.balance ? "minus" : undefined} />
      <Stat label="전표 없는 증빙" value={biz ? `${biz.pnl.unposted.total}건` : "—"} tone={biz?.pnl.unposted.total ? "minus" : undefined} />
      <Stat label="미매칭 통장" value={`${bankS.unmatched}건`} tone={bankS.unmatched ? "minus" : undefined} />
    </>),
    bank: (<>
      <Stat label="계좌" value={`${bankS.visible.length}개`} />
      <Stat label="잔액 합" value={`₩${won(bankS.balance)}`} />
      <Stat label="입금" value={`₩${won(bankS.inflow)}`} />
      <Stat label="출금" value={`₩${won(bankS.outflow)}`} />
      <Stat label="순증감" value={`₩${won(bankS.inflow - bankS.outflow)}`} tone={bankS.inflow - bankS.outflow < 0 ? "minus" : "plus"} />
      <Stat label="미매칭" value={`${bankS.unmatched}건 · ₩${won(bankS.unmatchedAmt)}`} tone={bankS.unmatched ? "minus" : undefined} />
    </>),
    card: (<>
      <Stat label="승인" value={`₩${won(cardS.amt)}`} />
      <Stat label="건수" value={`${cardS.n}건`} />
      <Stat label="카드" value={`${cardS.perCard.size}장`} />
      <Stat label="전표 없음" value={`${cardS.noVoucher}건`} tone={cardS.noVoucher ? "minus" : undefined} />
    </>),
    arap: (<>
      <Stat label={biz && biz.arap.ar > 0 ? "받을 돈(원장)" : "받을 돈(계산서 기준)"} value={biz ? `₩${won(biz.arap.ar > 0 ? biz.arap.ar : arap.arInvTotal)}` : "—"} />
      <Stat label="낼 돈(미지급)" value={biz ? `₩${won(biz.arap.ap)}` : "—"} />
      <Stat label="30일 넘은 미수" value={biz ? `₩${won(biz.arap.over30)} · ${biz.arap.over30Partners}곳` : "—"} tone={biz?.arap.over30 ? "minus" : undefined} />
      <Stat label="30일 내 낼 돈" value={biz ? `₩${won(biz.arap.due30)}` : "—"} />
    </>),
    docs: (<>
      <Stat label="매출 계산서" value={`${docS.sales.n}건 · ₩${won(docS.sales.amt)}`} />
      <Stat label="매입 계산서" value={`${docS.purchase.n}건 · ₩${won(docS.purchase.amt)}`} />
      <Stat label="현금영수증" value={`${docS.receipts}건`} />
      <Stat label="전표 없는 증빙" value={`계산서 ${docS.sales.noVoucher + docS.purchase.noVoucher} · 카드 ${docS.cardNoVoucher} · 통장 ${docS.bankUnmatched}`} tone={docS.sales.noVoucher + docS.purchase.noVoucher + docS.cardNoVoucher + docS.bankUnmatched ? "minus" : undefined} />
    </>),
  };
  const topN = (m: Map<string, number>, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value], i) => ({ label, value, color: vizColor(i) }));

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}</button>)}
          </div>
          <QueryBar right={
            <button type="button" className="btn-secondary btn-sm" onClick={() => {
              const name = TABS.find(([k]) => k === tab)?.[1] || "현황";
              const rows: Record<string, unknown>[] =
                tab === "bank" ? bankS.visible.map((a) => { const s = bankS.perAcct.get(a.id); return { "계좌": acctName(a), "잔액": Number(a.balance || 0), "입금": s?.in || 0, "출금": s?.out || 0, "거래 건수": s?.n || 0, "최근 거래일": s?.last || "" }; })
                : tab === "card" ? [...cardS.perCard.entries()].map(([k, v]) => ({ "카드": k, "승인": v.amt, "건수": v.n }))
                : tab === "arap" ? [...arap.ar.map((r) => ({ "구분": "미수", "거래처": r.name, "잔액": r.outstanding, "건수": r.invoice_count })), ...arap.ap.map((r) => ({ "구분": "미지급", "거래처": r.name, "잔액": r.outstanding, "건수": r.invoice_count }))]
                : tab === "docs" ? docS.recurringDue.map((r) => ({ "정기 지출": r.name, "금액": r.amount, "다음 지급일": r.next_due_date }))
                : [{ "통장 잔액": bankS.balance, "기간 입금": bankS.inflow, "기간 출금": bankS.outflow, "카드 승인": cardS.amt, "받을 돈": biz?.arap.ar ?? "", "30일 내 낼 돈": biz?.arap.due30 ?? "", "전표 없는 증빙": biz?.pnl.unposted.total ?? "", "미매칭 통장": bankS.unmatched }];
              exportToExcel(rows, name, `재무현황_${name}_${from}_${to}`);
            }}>엑셀</button>
          }>
            <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            <span className="inv-hint">오늘의 돈과 처리할 것 — 추이·손익은 <Link href="/reports/summary" className="bz-link">분석 › 경영 요약</Link></span>
          </QueryBar>
          <ResultStrip>{stats[tab]}</ResultStrip>
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll inv-status">
            {bizLoading && !biz ? <div className="collect-empty">불러오는 중…</div> : (
              <>
                {tab === "all" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 입금 · 출금</h3><p>통장 거래 기준</p>
                      <LineChart height={200} unit="원" yFmt={wonShort} series={[{ name: "입금", points: series(bankS.inDay) }, { name: "출금", points: series(bankS.outDay) }]} />
                      <Legend items={[{ name: "입금", color: vizColor(0) }, { name: "출금", color: vizColor(1) }]} />
                    </div>
                    <div className="pnl-panel">
                      <h3>계좌별 잔액</h3><p>숨긴 계좌 제외 · 합계 ₩{won(bankS.balance)}</p>
                      {bankS.visible.length ? <BarChart unit="원" data={bankS.visible.sort((a, b) => Number(b.balance) - Number(a.balance)).map((a, i) => ({ label: acctName(a), value: Math.max(0, Number(a.balance || 0)), color: vizColor(i) }))} /> : <div className="inv-status-empty">연결된 계좌가 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>바로 처리할 것</h3><p>경영 요약과 같은 규칙 — 찾아만 두고 확인은 사람이</p>
                      <ul className="inv-status-todo">
                        {bankS.unmatched > 0 && <li><Link href="/collect">미매칭 통장 거래 <b>{bankS.unmatched}건</b> · ₩{won(bankS.unmatchedAmt)} — 수집·전표에서 매칭</Link></li>}
                        {todos.map((t) => <li key={t.key}><Link href={t.href || "/reports/summary"}>{t.text}{t.amount ? <> · <b>₩{won(t.amount)}</b></> : null}{t.sub ? <span className="ev-dim"> — {t.sub}</span> : null}</Link></li>)}
                        {docS.recurringDue.slice(0, 3).map((r) => <li key={r.id}><Link href="/payments">정기 지출 <b>{r.name}</b> ₩{won(r.amount)} — {r.next_due_date}</Link></li>)}
                        {!bankS.unmatched && !todos.length && !docS.recurringDue.length && <li className="ev-dim">지금 처리할 것이 없습니다</li>}
                      </ul>
                    </div>
                    <div className="pnl-panel">
                      <h3>출금 상위 거래처</h3><p>기간 통장 출금 합 상위 10</p>
                      {bankS.perCp.size ? <BarChart unit="원" data={topN(bankS.perCp)} /> : <div className="inv-status-empty">출금이 없습니다</div>}
                    </div>
                  </div>
                </>)}

                {tab === "bank" && (<>
                  <div className="pnl-panel">
                    <h3>일별 입금 · 출금</h3><p>통장 거래 기준</p>
                    <LineChart height={180} unit="원" yFmt={wonShort} series={[{ name: "입금", points: series(bankS.inDay) }, { name: "출금", points: series(bankS.outDay) }]} />
                    <Legend items={[{ name: "입금", color: vizColor(0) }, { name: "출금", color: vizColor(1) }]} />
                  </div>
                  <div className="pnl-panel">
                    <h3>계좌별</h3><p>잔액은 지금, 입출금은 조회 기간</p>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
                      <thead><tr><th>계좌</th><th>잔액</th><th>입금</th><th>출금</th><th>거래 건수</th><th>최근 거래일</th></tr></thead>
                      <tbody>{bankS.visible.map((a) => { const s = bankS.perAcct.get(a.id); return (
                        <tr key={a.id}><td className="text-left"><b>{acctName(a)}</b> <span className="ev-dim">{a.bank_name}</span></td>
                          <td className="tr mono-number">₩{won(Number(a.balance || 0))}</td><td className="tr mono-number">₩{won(s?.in || 0)}</td><td className="tr mono-number">₩{won(s?.out || 0)}</td>
                          <td className="tr mono-number">{s?.n || 0}</td><td className="mono-number tc">{s?.last || "—"}</td></tr>
                      ); })}{bankS.visible.length === 0 && <tr><td colSpan={6} className="tc ev-dim">연결된 계좌가 없습니다 — 재무 › 통장에서 연결</td></tr>}</tbody>
                    </table></div>
                  </div>
                </>)}

                {tab === "card" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 승인</h3><p>카드 승인 합</p>
                      <ColumnChart height={180} unit="원" data={series(cardS.perDay)} />
                    </div>
                    <div className="pnl-panel">
                      <h3>카드별 비중</h3><p>기간 승인 금액</p>
                      {cardS.perCard.size ? <DonutChart unit="원" total={`₩${wonShort(cardS.amt)}`} data={[...cardS.perCard.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, 8).map(([k, v], i) => ({ label: k, value: v.amt, color: vizColor(i) }))} /> : <div className="inv-status-empty">승인이 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-panel">
                    <h3>가맹점 상위</h3><p>기간 승인 합 상위 10</p>
                    {cardS.perMerchant.size ? <BarChart unit="원" data={topN(cardS.perMerchant)} /> : <div className="inv-status-empty">승인이 없습니다</div>}
                  </div>
                </>)}

                {tab === "arap" && (
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>받을 돈 — 거래처별</h3><p>{arap.ar.length ? "원장 미수 잔액(전년 이월 + 올해) · 큰 순" : "원장에 정산 기록이 없어 세금계산서 상태(미결) 기준 · 30일 넘은 줄은 붉게"}</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>거래처</th><th>미수 잔액</th><th>건수</th></tr></thead>
                        <tbody>{arap.ar.slice(0, 50).map((r) => <tr key={r.partner_id}><td className="text-left"><Link href="/partners/ledger" className="bz-link"><b>{r.name}</b></Link></td><td className="tr mono-number">₩{won(r.outstanding)}</td><td className="tr mono-number">{r.invoice_count}</td></tr>)}
                          {arap.ar.length === 0 && arap.arInv.slice(0, 50).map((r) => <tr key={r.name} className={r.days > 30 ? "inv-row-fix" : undefined}><td className="text-left"><Link href="/partners/ledger" className="bz-link"><b>{r.name}</b></Link> <span className="ev-dim">최장 {r.days}일</span></td><td className="tr mono-number">₩{won(r.amount)}</td><td className="tr mono-number">{r.n}</td></tr>)}
                          {arap.ar.length === 0 && arap.arInv.length === 0 && <tr><td colSpan={3} className="tc ev-dim">미수 잔액이 없습니다</td></tr>}</tbody>
                      </table></div>
                    </div>
                    <div className="pnl-panel">
                      <h3>낼 돈 — 거래처별</h3><p>원장 미지급 잔액 · 큰 순</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>거래처</th><th>미지급 잔액</th><th>건수</th></tr></thead>
                        <tbody>{arap.ap.slice(0, 50).map((r) => <tr key={r.partner_id}><td className="text-left"><Link href="/partners/ledger" className="bz-link"><b>{r.name}</b></Link></td><td className="tr mono-number">₩{won(r.outstanding)}</td><td className="tr mono-number">{r.invoice_count}</td></tr>)}
                          {arap.ap.length === 0 && <tr><td colSpan={3} className="tc ev-dim">미지급 잔액이 없습니다</td></tr>}</tbody>
                      </table></div>
                    </div>
                  </div>
                )}

                {tab === "docs" && (
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>증빙 처리 현황</h3><p>기간 증빙 — 전표가 선 것과 안 선 것</p>
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>증빙</th><th>건수</th><th>금액</th><th>전표 없음</th><th></th></tr></thead>
                        <tbody>
                          <tr><td className="text-left"><b>매출 세금계산서</b></td><td className="tr mono-number">{docS.sales.n}</td><td className="tr mono-number">₩{won(docS.sales.amt)}</td><td className="tr mono-number">{docS.sales.noVoucher}</td><td className="tc"><Link href="/collect" className="bz-link">처리</Link></td></tr>
                          <tr><td className="text-left"><b>매입 세금계산서</b></td><td className="tr mono-number">{docS.purchase.n}</td><td className="tr mono-number">₩{won(docS.purchase.amt)}</td><td className="tr mono-number">{docS.purchase.noVoucher}</td><td className="tc"><Link href="/collect" className="bz-link">처리</Link></td></tr>
                          <tr><td className="text-left"><b>카드 승인</b></td><td className="tr mono-number">{cardS.n}</td><td className="tr mono-number">₩{won(cardS.amt)}</td><td className="tr mono-number">{cardS.noVoucher}</td><td className="tc"><Link href="/collect" className="bz-link">처리</Link></td></tr>
                          <tr><td className="text-left"><b>통장 거래</b></td><td className="tr mono-number">{bank.length}</td><td className="tr mono-number">₩{won(bankS.inflow + bankS.outflow)}</td><td className="tr mono-number">{bankS.unmatched}</td><td className="tc"><Link href="/collect" className="bz-link">매칭</Link></td></tr>
                          <tr><td className="text-left"><b>현금영수증</b></td><td className="tr mono-number">{docS.receipts}</td><td className="tr mono-number">—</td><td className="tr mono-number">—</td><td className="tc"><Link href="/cash-receipts" className="bz-link">보기</Link></td></tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="pnl-panel">
                      <h3>정기 지출 예정</h3><p>다음 지급일 순 · 합계 ₩{won(docS.recurringDue.reduce((n, r) => n + Number(r.amount || 0), 0))}</p>
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>항목</th><th>금액</th><th>다음 지급일</th></tr></thead>
                        <tbody>{docS.recurringDue.map((r) => <tr key={r.id}><td className="text-left"><b>{r.name}</b></td><td className="tr mono-number">₩{won(r.amount)}</td><td className="mono-number tc">{r.next_due_date}</td></tr>)}
                          {docS.recurringDue.length === 0 && <tr><td colSpan={3} className="tc ev-dim">예정된 정기 지출이 없습니다</td></tr>}</tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}
