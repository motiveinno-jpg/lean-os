"use client";

// ── 재무 › 현황 — **전표 현황** (2026-08-26 사장님 지시) ──────────────────────────────────
//   149차엔 통장·카드·미수·증빙을 한데 모은 운영 콕핏이었다. 사장님: "통장·카드는 통장·카드의 분석 쪽으로,
//   경영 요약·손익은 분석 메뉴가 따로 있으니 재무 현황은 **작성된 전표들의 현황·지표**가 적합하다."
//   → 통장·카드 판은 finance-status-panels.tsx 로 빼서 통장 › 개요, 카드 › 분석에 붙였고, 여기는 전표만 본다.
//
//   기준(무엇으로 판단하나)
//   · 전표 = journal_entries(+journal_lines). 금액 = 그 전표 차변 합(일반전표는 supply_amount 가 0이라 줄에서 센다).
//   · 상태: confirmed 확정 / rejected 반려 / 그 밖은 대기. 재무제표는 확정만 읽으므로(journal-reports) 반려·대기는 '처리할 것'.
//   · 종류: entry_kind general(일반: 입금·출금·대체) / sale_purchase(매입매출: 부가세 유형 코드로 매출·매입 구분).
//   · 출처: source manual 수동 / rule 규칙(자동). 규칙 비율이 높을수록 손이 덜 간 것.
//   · 전표 없는 증빙(계산서·카드·통장)은 전표가 '아직 없는' 상태라 여기서 센다 — 만들기는 수집·전표에서(제안은 자동, 확정은 사람).
//   규칙: 조회 화면 표준 — 상자 안 파란 밑줄 갈래, 조회 줄엔 기간만, 결과 요약 줄(Stat), 판(pnl-panel)에 그래프+표.

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
import { ColumnChart, DonutChart, BarChart, Legend, vizColor } from "@/components/charts/kit";
import { exportToExcel } from "@/lib/excel-export";
import { getAccountMap, accountById, NATURE_LABEL } from "@/lib/account-nature";
import { vatType } from "@/lib/vat-voucher";
import { dayKeys, dayLabel } from "@/components/finance-status-panels";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const wonShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${s}${Math.round(a).toLocaleString("ko-KR")}`;
};
type Tab = "all" | "general" | "sp" | "account" | "todo";
const TABS: [Tab, string][] = [["all", "종합"], ["general", "일반전표"], ["sp", "매입매출전표"], ["account", "계정과목"], ["todo", "처리할 것"]];
const monthStart = () => todayKst().slice(0, 7) + "-01";
const STATUS: Record<string, string> = { confirmed: "확정", rejected: "반려" };
const statusLabel = (s: string) => STATUS[s] || "대기";
const VT: Record<string, string> = { cash_in: "입금", cash_out: "출금", transfer: "대체" };
const SRC: Record<string, string> = { manual: "수동", rule: "규칙" };

type Line = { account_id: string; debit: number; credit: number; partner_id: string | null; partners: { name: string } | null };
type Entry = {
  id: string; entry_date: string; description: string; status: string; entry_kind: string; source: string; voucher_type: string | null;
  vat_type: string | null; supply_amount: number | null; vat_amount: number | null; voucher_no: number | null; is_approved: boolean; journal_lines: Line[];
};

export default function FinanceStatusPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => setCompanyId(u?.company_id ?? null)); }, []);
  const [tab, setTab] = useState<Tab>("all");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKst);

  const q = <T,>(key: string, fn: () => Promise<T>, extra: unknown[] = []) =>
    useQuery<T>({ queryKey: [key, companyId, ...extra], queryFn: fn, enabled: !!companyId });   // eslint-disable-line react-hooks/rules-of-hooks
  const { data: entries = [], isLoading } = q("fin-status-entries", async () => {
    const out: Entry[] = []; const PAGE = 1000;
    for (let page = 0; ; page++) {
      const { data } = await supabase.from("journal_entries")
        .select("id, entry_date, description, status, entry_kind, source, voucher_type, vat_type, supply_amount, vat_amount, voucher_no, is_approved, journal_lines(account_id, debit, credit, partner_id, partners(name))")
        .eq("company_id", companyId!).gte("entry_date", from).lte("entry_date", to).order("entry_date").range(page * PAGE, page * PAGE + PAGE - 1);
      const rows = (data || []) as unknown as Entry[]; out.push(...rows); if (rows.length < PAGE) break;
    }
    return out;
  }, [from, to]);
  const { data: acctMap } = q("fin-status-acctmap", () => getAccountMap(companyId!));
  //   전표 없는 증빙 — 건수만(head). 처리는 수집·전표에서.
  const cnt = async (b: any) => (await b).count || 0;
  const { data: unposted } = q("fin-status-unposted", async () => {
    const [ti, card, bank] = await Promise.all([
      cnt((supabase.from("tax_invoices").select("id", { count: "exact", head: true }) as any).eq("company_id", companyId!).is("journal_entry_id", null).neq("status", "void").gte("issue_date", from).lte("issue_date", to)),
      cnt((supabase.from("card_transactions").select("id", { count: "exact", head: true }) as any).eq("company_id", companyId!).is("journal_entry_id", null).gte("transaction_date", from).lte("transaction_date", to)),
      cnt((supabase.from("bank_transactions").select("id", { count: "exact", head: true }) as any).eq("company_id", companyId!).is("journal_entry_id", null).eq("mapping_status", "unmapped").gte("transaction_date", from).lte("transaction_date", to)),
    ]);
    return { ti, card, bank, total: ti + card + bank };
  }, [from, to]);

  const days = useMemo(() => dayKeys(from, to), [from, to]);
  const amountOf = (e: Entry) => e.journal_lines.reduce((n, l) => n + Number(l.debit || 0), 0);
  const acctName = (id: string) => acctMap ? (accountById(id, acctMap)?.name || "(계정 미상)") : "…";

  const S = useMemo(() => {
    const confirmed = entries.filter((e) => e.status === "confirmed"), rejected = entries.filter((e) => e.status === "rejected"), pending = entries.filter((e) => e.status !== "confirmed" && e.status !== "rejected");
    const unapproved = confirmed.filter((e) => !e.is_approved);
    const amt = (l: Entry[]) => l.reduce((n, e) => n + amountOf(e), 0);
    const perDayN = new Map<string, number>(), perDayAmt = new Map<string, number>();
    const kind = new Map<string, { n: number; amt: number }>();          // 입금/출금/대체/매출/매입
    const src = { manual: 0, rule: 0 };
    const perAcct = new Map<string, { debit: number; credit: number; n: number; nature: string }>();
    const perPartnerSale = new Map<string, number>(), perPartnerBuy = new Map<string, number>();
    const vat = new Map<string, { n: number; supply: number; tax: number }>();
    let saleSupply = 0, saleTax = 0, buySupply = 0, buyTax = 0, saleN = 0, buyN = 0;
    const gen = { cash_in: { n: 0, amt: 0 }, cash_out: { n: 0, amt: 0 }, transfer: { n: 0, amt: 0 } } as Record<string, { n: number; amt: number }>;
    const genAcct = new Map<string, Map<string, { debit: number; credit: number; n: number }>>();
    for (const e of confirmed) {
      const a = amountOf(e);
      perDayN.set(e.entry_date, (perDayN.get(e.entry_date) || 0) + 1); perDayAmt.set(e.entry_date, (perDayAmt.get(e.entry_date) || 0) + a);
      if (e.source === "rule") src.rule++; else src.manual++;
      const seen = new Set<string>();
      for (const l of e.journal_lines) {
        const info = acctMap ? accountById(l.account_id, acctMap) : null;
        const pa = perAcct.get(l.account_id) || { debit: 0, credit: 0, n: 0, nature: info?.nature || "" };
        pa.debit += Number(l.debit || 0); pa.credit += Number(l.credit || 0); if (!seen.has(l.account_id)) { pa.n++; seen.add(l.account_id); } perAcct.set(l.account_id, pa);
      }
      if (e.entry_kind === "sale_purchase") {
        const t = vatType(e.vat_type); const side = t?.side || (Number(e.vat_type) >= 50 ? "purchase" : "sale");
        const supply = Number(e.supply_amount || 0), tax = Number(e.vat_amount || 0);
        const label = side === "sale" ? "매출" : "매입"; const k = kind.get(label) || { n: 0, amt: 0 }; k.n++; k.amt += a; kind.set(label, k);
        if (side === "sale") { saleSupply += supply; saleTax += tax; saleN++; } else { buySupply += supply; buyTax += tax; buyN++; }
        const vk = t ? t.label : `${e.vat_type || "미지정"}`; const v = vat.get(vk) || { n: 0, supply: 0, tax: 0 }; v.n++; v.supply += supply; v.tax += tax; vat.set(vk, v);
        const pn = e.journal_lines.find((l) => l.partners?.name)?.partners?.name || "(거래처 없음)";
        const pm = side === "sale" ? perPartnerSale : perPartnerBuy; pm.set(pn, (pm.get(pn) || 0) + a);
      } else {
        const vt = e.voucher_type && gen[e.voucher_type] ? e.voucher_type : "transfer";
        gen[vt].n++; gen[vt].amt += a;
        const label = VT[vt]; const k = kind.get(label) || { n: 0, amt: 0 }; k.n++; k.amt += a; kind.set(label, k);
        const gm = genAcct.get(vt) || new Map(); genAcct.set(vt, gm);
        for (const l of e.journal_lines) { const g = gm.get(l.account_id) || { debit: 0, credit: 0, n: 0 }; g.debit += Number(l.debit || 0); g.credit += Number(l.credit || 0); g.n++; gm.set(l.account_id, g); }
      }
    }
    const acctRows = [...perAcct.entries()].map(([id, v]) => ({ id, name: acctName(id), ...v, total: v.debit + v.credit })).sort((a, b) => b.total - a.total);
    return { confirmed, rejected, pending, unapproved, total: amt(confirmed), perDayN, perDayAmt, kind, src, acctRows, perPartnerSale, perPartnerBuy, vat, saleSupply, saleTax, buySupply, buyTax, saleN, buyN, gen, genAcct };
  }, [entries, acctMap]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!permLoading && !(isMaster || hasPerm("/finance/status"))) {
    return <AccessDenied detail="재무 현황 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const ruleRate = S.confirmed.length ? Math.round((S.src.rule / S.confirmed.length) * 100) : 0;
  const todoN = S.rejected.length + S.pending.length + S.unapproved.length + (unposted?.total || 0);
  const stats: Record<Tab, React.ReactNode> = {
    all: (<>
      <Stat label="확정 전표" value={`${S.confirmed.length}건 · ₩${won(S.total)}`} />
      <Stat label="매출 전표" value={`${S.saleN}건 · ₩${won(S.saleSupply + S.saleTax)}`} />
      <Stat label="매입 전표" value={`${S.buyN}건 · ₩${won(S.buySupply + S.buyTax)}`} />
      <Stat label="규칙 자동" value={`${ruleRate}%`} />
      <Stat label="반려·대기" value={`${S.rejected.length + S.pending.length}건`} tone={S.rejected.length + S.pending.length ? "minus" : undefined} />
      <Stat label="전표 없는 증빙" value={unposted ? `${unposted.total}건` : "—"} tone={unposted?.total ? "minus" : undefined} />
    </>),
    general: (<>
      <Stat label="입금" value={`${S.gen.cash_in.n}건 · ₩${won(S.gen.cash_in.amt)}`} />
      <Stat label="출금" value={`${S.gen.cash_out.n}건 · ₩${won(S.gen.cash_out.amt)}`} />
      <Stat label="대체" value={`${S.gen.transfer.n}건 · ₩${won(S.gen.transfer.amt)}`} />
      <Stat label="합계" value={`${S.gen.cash_in.n + S.gen.cash_out.n + S.gen.transfer.n}건`} />
    </>),
    sp: (<>
      <Stat label="매출 공급가" value={`₩${won(S.saleSupply)}`} />
      <Stat label="매출세액" value={`₩${won(S.saleTax)}`} />
      <Stat label="매입 공급가" value={`₩${won(S.buySupply)}`} />
      <Stat label="매입세액" value={`₩${won(S.buyTax)}`} />
      <Stat label="납부 예상(매출세액−매입세액)" value={`₩${won(S.saleTax - S.buyTax)}`} tone={S.saleTax - S.buyTax > 0 ? "minus" : "plus"} />
    </>),
    account: (<>
      <Stat label="쓰인 계정" value={`${S.acctRows.length}개`} />
      <Stat label="차변 합" value={`₩${won(S.acctRows.reduce((n, r) => n + r.debit, 0))}`} />
      <Stat label="대변 합" value={`₩${won(S.acctRows.reduce((n, r) => n + r.credit, 0))}`} />
    </>),
    todo: (<>
      <Stat label="반려" value={`${S.rejected.length}건`} tone={S.rejected.length ? "minus" : undefined} />
      <Stat label="대기" value={`${S.pending.length}건`} tone={S.pending.length ? "minus" : undefined} />
      <Stat label="미승인 확정" value={`${S.unapproved.length}건`} tone={S.unapproved.length ? "minus" : undefined} />
      <Stat label="전표 없는 증빙" value={unposted ? `계산서 ${unposted.ti} · 카드 ${unposted.card} · 통장 ${unposted.bank}` : "—"} tone={unposted?.total ? "minus" : undefined} />
    </>),
  };
  const topN = (m: Map<string, number>, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value], i) => ({ label, value, color: vizColor(i) }));
  const kindData = [...S.kind.entries()].sort((a, b) => b[1].amt - a[1].amt).map(([label, v], i) => ({ label, value: v.amt, color: vizColor(i) }));
  const entryRow = (e: Entry) => (
    <tr key={e.id}><td className="mono-number tc">{e.entry_date}</td><td className="tc">{e.entry_kind === "sale_purchase" ? "매입매출" : `일반·${VT[e.voucher_type || "transfer"] || "대체"}`}</td>
      <td className="text-left">{e.description || <span className="ev-dim">—</span>}</td><td className="tr mono-number">₩{won(amountOf(e))}</td><td className="tc">{SRC[e.source] || e.source}</td><td className="tc">{statusLabel(e.status)}{e.status === "confirmed" && !e.is_approved ? " · 미승인" : ""}</td></tr>
  );

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}{k === "todo" && todoN ? <span className="inv-short-badge">{todoN}</span> : null}</button>)}
          </div>
          <QueryBar right={
            <button type="button" className="btn-secondary btn-sm" onClick={() => {
              const name = TABS.find(([k]) => k === tab)?.[1] || "현황";
              const rows: Record<string, unknown>[] =
                tab === "general" ? [...S.genAcct.entries()].flatMap(([vt, m]) => [...m.entries()].map(([id, v]) => ({ "유형": VT[vt], "계정": acctName(id), "차변": v.debit, "대변": v.credit, "줄 수": v.n })))
                : tab === "sp" ? [...S.vat.entries()].map(([k, v]) => ({ "부가세 유형": k, "건수": v.n, "공급가액": v.supply, "세액": v.tax, "합계": v.supply + v.tax }))
                : tab === "account" ? S.acctRows.map((r) => ({ "계정": r.name, "성격": NATURE_LABEL[r.nature as keyof typeof NATURE_LABEL] || "", "차변": r.debit, "대변": r.credit, "전표 수": r.n }))
                : tab === "todo" ? [...S.rejected, ...S.pending, ...S.unapproved].map((e) => ({ "일자": e.entry_date, "종류": e.entry_kind === "sale_purchase" ? "매입매출" : "일반", "적요": e.description, "금액": amountOf(e), "출처": SRC[e.source] || e.source, "상태": statusLabel(e.status) + (e.status === "confirmed" && !e.is_approved ? " · 미승인" : "") }))
                : [{ "확정 전표": S.confirmed.length, "확정 금액": S.total, "매출 전표": S.saleN, "매입 전표": S.buyN, "규칙 자동 비율": `${ruleRate}%`, "반려": S.rejected.length, "대기": S.pending.length, "전표 없는 증빙": unposted?.total ?? "" }];
              exportToExcel(rows, name, `전표현황_${name}_${from}_${to}`);
            }}>엑셀</button>
          }>
            <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            <span className="inv-hint">작성된 전표의 현황·지표 — 손익·재무상태는 <Link href="/reports/summary" className="bz-link">분석</Link>, 전표 만들기는 <Link href="/collect" className="bz-link">수집·전표</Link></span>
          </QueryBar>
          <ResultStrip>{stats[tab]}</ResultStrip>
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll inv-status">
            {isLoading ? <div className="collect-empty">불러오는 중…</div> : (
              <>
                {tab === "all" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 확정 전표 금액</h3><p>차변 합 기준 · 건수는 표시줄에</p>
                      <ColumnChart height={200} unit="원" data={days.map((k) => ({ label: dayLabel(k), value: S.perDayAmt.get(k) || 0 }))} />
                    </div>
                    <div className="pnl-panel">
                      <h3>종류별 비중</h3><p>일반(입금·출금·대체) · 매입매출(매출·매입)</p>
                      {kindData.length ? <><DonutChart unit="원" total={`₩${wonShort(S.total)}`} data={kindData} /><Legend items={kindData.map((d) => ({ name: `${d.label} ${S.kind.get(d.label)?.n || 0}건`, color: d.color }))} /></> : <div className="inv-status-empty">확정 전표가 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>많이 쓰인 계정과목</h3><p>차변+대변 합 상위 10</p>
                      {S.acctRows.length ? <BarChart unit="원" data={S.acctRows.slice(0, 10).map((r, i) => ({ label: r.name, value: r.total, color: vizColor(i) }))} /> : <div className="inv-status-empty">확정 전표가 없습니다</div>}
                    </div>
                    <div className="pnl-panel">
                      <h3>바로 처리할 것</h3><p>찾아만 두고 확정은 사람이</p>
                      <ul className="inv-status-todo">
                        {S.rejected.length > 0 && <li><button type="button" className="bz-link" onClick={() => setTab("todo")}>반려된 전표 <b>{S.rejected.length}건</b> — 고쳐서 다시 확정</button></li>}
                        {S.pending.length > 0 && <li><button type="button" className="bz-link" onClick={() => setTab("todo")}>대기 전표 <b>{S.pending.length}건</b></button></li>}
                        {S.unapproved.length > 0 && <li><button type="button" className="bz-link" onClick={() => setTab("todo")}>승인 안 된 확정 전표 <b>{S.unapproved.length}건</b></button></li>}
                        {unposted && unposted.total > 0 && <li><Link href="/collect">전표 없는 증빙 <b>{unposted.total}건</b> <span className="ev-dim">— 계산서 {unposted.ti} · 카드 {unposted.card} · 통장 {unposted.bank}</span></Link></li>}
                        {!todoN && <li className="ev-dim">지금 처리할 것이 없습니다</li>}
                      </ul>
                    </div>
                  </div>
                </>)}

                {tab === "general" && (
                  <div className="pnl-grid2">
                    {(["cash_in", "cash_out", "transfer"] as const).map((vt) => (
                      <div className="pnl-panel" key={vt}>
                        <h3>{VT[vt]} 전표</h3><p>{S.gen[vt].n}건 · ₩{won(S.gen[vt].amt)} · 계정별 차변·대변</p>
                        <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                          <thead><tr><th>계정</th><th>차변</th><th>대변</th><th>줄 수</th></tr></thead>
                          <tbody>{[...(S.genAcct.get(vt) || new Map()).entries()].sort((a, b) => (b[1].debit + b[1].credit) - (a[1].debit + a[1].credit)).slice(0, 30).map(([id, v]) => (
                            <tr key={id}><td className="text-left"><b>{acctName(id)}</b></td><td className="tr mono-number">₩{won(v.debit)}</td><td className="tr mono-number">₩{won(v.credit)}</td><td className="tr mono-number">{v.n}</td></tr>
                          ))}{!S.gen[vt].n && <tr><td colSpan={4} className="tc ev-dim">없음</td></tr>}</tbody>
                        </table></div>
                      </div>
                    ))}
                    <div className="pnl-panel">
                      <h3>출처</h3><p>규칙(자동)으로 선 전표 비율 — 높을수록 손이 덜 간 것</p>
                      <DonutChart unit="건" total={`${ruleRate}%`} data={[{ label: "규칙", value: S.src.rule, color: vizColor(0) }, { label: "수동", value: S.src.manual, color: vizColor(1) }]} />
                      <Legend items={[{ name: `규칙 ${S.src.rule}건`, color: vizColor(0) }, { name: `수동 ${S.src.manual}건`, color: vizColor(1) }]} />
                    </div>
                  </div>
                )}

                {tab === "sp" && (<>
                  <div className="pnl-panel">
                    <h3>부가세 유형별</h3><p>확정 매입매출전표 · 공급가액·세액</p>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
                      <thead><tr><th>유형</th><th>건수</th><th>공급가액</th><th>세액</th><th>합계</th></tr></thead>
                      <tbody>{[...S.vat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => (
                        <tr key={k}><td className="text-left"><b>{k}</b></td><td className="tr mono-number">{v.n}</td><td className="tr mono-number">₩{won(v.supply)}</td><td className="tr mono-number">₩{won(v.tax)}</td><td className="tr mono-number">₩{won(v.supply + v.tax)}</td></tr>
                      ))}{!S.vat.size && <tr><td colSpan={5} className="tc ev-dim">확정 매입매출전표가 없습니다</td></tr>}</tbody>
                    </table></div>
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>매출 거래처 상위</h3><p>확정 매출 전표 금액 상위 10</p>
                      {S.perPartnerSale.size ? <BarChart unit="원" data={topN(S.perPartnerSale)} /> : <div className="inv-status-empty">매출 전표가 없습니다</div>}
                    </div>
                    <div className="pnl-panel">
                      <h3>매입 거래처 상위</h3><p>확정 매입 전표 금액 상위 10</p>
                      {S.perPartnerBuy.size ? <BarChart unit="원" data={topN(S.perPartnerBuy)} /> : <div className="inv-status-empty">매입 전표가 없습니다</div>}
                    </div>
                  </div>
                </>)}

                {tab === "account" && (
                  <div className="pnl-panel">
                    <h3>계정과목별</h3><p>확정 전표의 줄을 계정별로 · 차변+대변 큰 순 · 계정을 누르면 원장</p>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
                      <thead><tr><th>계정</th><th>성격</th><th>차변</th><th>대변</th><th>전표 수</th></tr></thead>
                      <tbody>{S.acctRows.map((r) => (
                        <tr key={r.id}><td className="text-left"><Link href="/partners/ledger" className="bz-link"><b>{r.name}</b></Link></td><td className="tc">{NATURE_LABEL[r.nature as keyof typeof NATURE_LABEL] || "—"}</td>
                          <td className="tr mono-number">₩{won(r.debit)}</td><td className="tr mono-number">₩{won(r.credit)}</td><td className="tr mono-number">{r.n}</td></tr>
                      ))}{!S.acctRows.length && <tr><td colSpan={5} className="tc ev-dim">확정 전표가 없습니다</td></tr>}</tbody>
                    </table></div>
                  </div>
                )}

                {tab === "todo" && (<>
                  <div className="pnl-panel">
                    <h3>반려 · 대기 · 미승인 전표</h3><p>재무제표는 확정 전표만 읽습니다 — 여기 있는 건 아직 장부가 아닙니다. 고치기는 <Link href="/partners/reconciliation/voucher-entry" className="bz-link">일반전표</Link> · <Link href="/partners/reconciliation/sale-purchase" className="bz-link">매입매출전표</Link></p>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
                      <thead><tr><th>일자</th><th>종류</th><th>적요</th><th>금액</th><th>출처</th><th>상태</th></tr></thead>
                      <tbody>{[...S.pending, ...S.rejected, ...S.unapproved].slice(0, 200).map(entryRow)}
                        {!(S.pending.length + S.rejected.length + S.unapproved.length) && <tr><td colSpan={6} className="tc ev-dim">처리할 전표가 없습니다</td></tr>}</tbody>
                    </table></div>
                  </div>
                  <div className="pnl-panel">
                    <h3>전표 없는 증빙</h3><p>조회 기간의 증빙 중 전표가 아직 없는 것 — 만들기는 수집·전표에서</p>
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>증빙</th><th>건수</th><th></th></tr></thead>
                      <tbody>
                        <tr><td className="text-left"><b>세금계산서·계산서</b></td><td className="tr mono-number">{unposted?.ti ?? "—"}</td><td className="tc"><Link href="/collect" className="bz-link">처리</Link></td></tr>
                        <tr><td className="text-left"><b>카드 승인</b></td><td className="tr mono-number">{unposted?.card ?? "—"}</td><td className="tc"><Link href="/collect" className="bz-link">처리</Link></td></tr>
                        <tr><td className="text-left"><b>통장 거래(미매칭)</b></td><td className="tr mono-number">{unposted?.bank ?? "—"}</td><td className="tc"><Link href="/collect" className="bz-link">매칭</Link></td></tr>
                      </tbody>
                    </table>
                  </div>
                </>)}
              </>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}
