"use client";

// 분석 › 회계 자료 › 계정별 원장 · 합계잔액시산표 (2026-09-21 ERP 공백 2차 ①, docs/20260921_PLAN_erp_gap_audit2.md)
//
//   History — 전표 2,283건·분개 6,764줄이 쌓였는데 **계정 하나를 날짜순 차변·대변·잔액으로** 보는 화면이 없었다.
//   손익·재무상태표는 있고(요약), 거래처 원장은 외상매출금·외상매입금 두 계정만 본다. 세무사가 제일 먼저 달라는
//   자료(시산표·원장)를 엑셀 내려받기(전표·분개)로 대신하고 있었다.
//
//   기준(무엇으로 판단하나)
//   · 재무제표와 같은 원천 — **확정 전표만**(lib/journal-reports). 반려·대기 전표는 장부가 아니다.
//   · 이월: 기간 시작 전(회계연도 1/1 ~ 시작일 전날)의 확정 전표 + 회계마감 설정의 기초잔액(마감일이 기간 시작 전일 때).
//     재무상태표와 같은 규칙이라 두 화면의 잔액이 맞는다. 마감일이 기간 안에 있으면 마감일까지의 전표는 기초잔액이 대신한다(재무상태표 동일).
//   · 시산표 잔액: 차변 합 − 대변 합이 + 면 차변 잔액, − 면 대변 잔액(성격과 무관 — 부호가 뒤집힌 계정은 그대로 드러나야 한다).
//   · 원장 잔액: 자산·비용은 이월 + 차변 − 대변, 부채·자본·수익은 이월 + 대변 − 차변.
//   · 기본 기간은 **올해 1/1 ~ 오늘**(거래처 원장과 같은 예외 — 원장·시산표는 연도로 본다).
//
//   보기 두 갈래(조회 줄 '보기' 칩) — 시산표(계정 전부) / 원장(계정 하나). 시산표 줄을 누르면 그 계정 원장으로.
//   전표 번호를 누르면 거래처 원장과 같은 전표 수정 창이 열린다.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportHead } from "../_components/ReportHead";
import { Stat } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { PickList } from "@/components/pick-list";
import { EmptyState } from "@/components/empty-state";
import { fetchJournalLines, countUnposted, type JournalLine } from "@/lib/journal-reports";
import { getAccountMap, NATURE_LABEL, type AccountNature } from "@/lib/account-nature";
import { getAccountingClosing, lineDebit, lineCredit } from "@/lib/accounting-closing";
import { addDaysStr, todayKst } from "@/lib/kst";
import { exportToExcel } from "@/lib/excel-export";
import { VoucherEditModal } from "../../partners/ledger/shared";
import Link from "next/link";

type View = "tb" | "ledger";

type AcctAgg = {
  id: string; code: string | null; name: string; nature: AccountNature;
  openD: number; openC: number;   // 이월(기간 시작 전 전표 + 기초잔액)
  curD: number; curC: number;     // 당기
};

type LedgerData = {
  accounts: AcctAgg[];            // 시산표 줄(움직임이 있는 계정만), 코드순
  lines: JournalLine[];           // 당기 줄(원장용)
  pickable: { id: string; code: string | null; name: string }[]; // 계정과목표 전부(원장 피커용)
  openingApplied: boolean;        // 기초잔액이 이월에 들어갔나
  closingInside: boolean;         // 마감일이 기간 안 — 마감일까지 전표는 기초잔액이 대신
  unposted: { taxInvoice: number; card: number; bank: number; total: number };
};

const NATURE_ORDER: AccountNature[] = ["asset", "liability", "equity", "revenue", "expense"];
const isDebitNature = (n: AccountNature) => n === "asset" || n === "expense";
const fmt = (n: number) => (n ? Math.round(n).toLocaleString("ko-KR") : "");
const fmtSigned = (n: number) => (Math.round(n) === 0 ? "0" : Math.round(n).toLocaleString("ko-KR"));
const codeNum = (c: string | null) => { const n = parseInt(String(c || "").replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : 9999; };

async function fetchLedgerData(companyId: string, from: string, to: string): Promise<LedgerData> {
  const closing = await getAccountingClosing(companyId).catch(() => null);
  const closingDate = closing?.closing_date && String(closing.closing_date).slice(0, 10) < to ? String(closing.closing_date).slice(0, 10) : null;
  //   회계연도 시작(또는 마감 다음 날)부터 읽어야 이월이 선다 — 기간 시작일부터만 읽으면 이월이 0 이 된다
  const base = closingDate ? addDaysStr(closingDate, 1) : `${from.slice(0, 4)}-01-01`;
  const readFrom = base < from ? base : from;
  const [map, allLines, unposted] = await Promise.all([
    getAccountMap(companyId),
    fetchJournalLines(companyId, readFrom, to),
    countUnposted(companyId, from, to),
  ]);
  const agg = new Map<string, AcctAgg>();
  const get = (id: string, code: string | null, name: string, nature: AccountNature) => {
    let a = agg.get(id);
    if (!a) { a = { id, code, name, nature, openD: 0, openC: 0, curD: 0, curC: 0 }; agg.set(id, a); }
    return a;
  };
  const lines: JournalLine[] = [];
  for (const l of allLines) {
    if (closingDate && l.date <= closingDate) continue;     // 마감일까지는 기초잔액이 대신한다
    const a = get(l.accountId, l.code, l.name, l.nature as AccountNature);
    if (l.date < from) { a.openD += l.debit; a.openC += l.credit; }
    else { a.curD += l.debit; a.curC += l.credit; lines.push(l); }
  }
  //   기초잔액 — 재무상태표와 같은 줄(자산·부채·자본)만. 수익·비용 기초는 마감으로 닫힌 것이라 이월하지 않는다
  let openingApplied = false;
  for (const ol of (closing?.opening_lines || [])) {
    if (!closingDate) break;
    if (ol.account_type !== "asset" && ol.account_type !== "liability" && ol.account_type !== "equity") continue;
    const d = lineDebit(ol), c = lineCredit(ol);
    if (!d && !c) continue;
    const info = ol.account_id ? map.get(ol.account_id) : null;
    const a = get(ol.account_id || `opening:${ol.code || ol.name}`, info?.code ?? ol.code ?? null, info?.name ?? ol.name, (info?.nature ?? ol.account_type) as AccountNature);
    a.openD += d; a.openC += c; openingApplied = true;
  }
  const accounts = [...agg.values()]
    .filter((a) => a.openD || a.openC || a.curD || a.curC)
    .sort((x, y) => NATURE_ORDER.indexOf(x.nature) - NATURE_ORDER.indexOf(y.nature) || codeNum(x.code) - codeNum(y.code) || x.name.localeCompare(y.name, "ko"));
  const pickable = [...map.entries()].map(([id, i]) => ({ id, code: i.code, name: i.name }))
    .sort((x, y) => codeNum(x.code) - codeNum(y.code) || x.name.localeCompare(y.name, "ko"));
  return { accounts, lines, pickable, openingApplied, closingInside: !!closingDate && closingDate >= from, unposted };
}

export default function AccountLedgerPage() {
  const { role } = useUser();
  if (role === "partner") return <AccessDenied detail="계정별 원장은 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  return <AccountLedgerInner />;
}

function AccountLedgerInner() {
  const today = todayKst();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [view, setView] = useState<View>("tb");
  const [acctId, setAcctId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  const { data, isLoading, error } = useQuery<LedgerData>({
    queryKey: ["acct-ledger", companyId, from, to],
    queryFn: () => fetchLedgerData(companyId!, from, to),
    enabled: !!companyId && !!from && !!to,
    staleTime: 60_000,
  });
  const accounts = data?.accounts ?? [];

  const totals = useMemo(() => {
    let d = 0, c = 0, bd = 0, bc = 0;
    for (const a of accounts) {
      const td = a.openD + a.curD, tc = a.openC + a.curC;
      d += td; c += tc;
      const net = td - tc;
      if (net > 0) bd += net; else bc += -net;
    }
    return { d, c, bd, bc, diff: Math.round(d - c) };
  }, [accounts]);

  //   원장 — 고른 계정의 당기 줄(날짜·전표번호 순) + 이월. 월이 바뀌면 월계 줄.
  const sel = acctId ? accounts.find((a) => a.id === acctId) ?? null : null;
  const selInfo = acctId ? (sel ?? data?.pickable.find((p) => p.id === acctId) ?? null) : null;
  const ledger = useMemo(() => {
    if (!acctId || !data) return null;
    const nature = sel?.nature ?? "asset";
    const dir = (dbt: number, cdt: number) => (isDebitNature(nature) ? dbt - cdt : cdt - dbt);
    const opening = sel ? dir(sel.openD, sel.openC) : 0;
    const rows = data.lines.filter((l) => l.accountId === acctId).sort((a, b) => a.date.localeCompare(b.date) || (a.voucherNo ?? 0) - (b.voucherNo ?? 0) || a.entryId.localeCompare(b.entryId));
    const byMonth = new Map<string, JournalLine[]>();
    for (const r of rows) { const m = r.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m)!.push(r); }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const debit = rows.reduce((s, r) => s + r.debit, 0), credit = rows.reduce((s, r) => s + r.credit, 0);
    return { nature, dir, opening, months, debit, credit, ending: opening + dir(debit, credit), count: rows.length };
  }, [acctId, data, sel]);

  const selIdx = acctId ? accounts.findIndex((a) => a.id === acctId) : -1;
  const openLedger = (id: string) => { setAcctId(id); setView("ledger"); setPickOpen(false); };

  const exportTb = () => {
    if (!accounts.length) return;
    const rows = accounts.map((a) => { const td = a.openD + a.curD, tc = a.openC + a.curC, net = td - tc; return {
      "구분": NATURE_LABEL[a.nature], "계정코드": a.code || "", "계정과목": a.name,
      "차변 잔액": net > 0 ? Math.round(net) : "", "차변 합계": Math.round(td), "이월 차변": Math.round(a.openD), "당기 차변": Math.round(a.curD),
      "당기 대변": Math.round(a.curC), "이월 대변": Math.round(a.openC), "대변 합계": Math.round(tc), "대변 잔액": net < 0 ? Math.round(-net) : "" }; });
    rows.push({ "구분": "", "계정코드": "", "계정과목": "합계", "차변 잔액": Math.round(totals.bd), "차변 합계": Math.round(totals.d), "이월 차변": 0, "당기 차변": 0, "당기 대변": 0, "이월 대변": 0, "대변 합계": Math.round(totals.c), "대변 잔액": Math.round(totals.bc) } as any);
    exportToExcel(rows, "합계잔액시산표", `합계잔액시산표_${from}_${to}`);
  };
  const exportLedger = () => {
    if (!ledger || !selInfo) return;
    const rows: Record<string, unknown>[] = [{ "일자": from, "전표": "", "적요": "[전기이월]", "거래처": "", "차변": "", "대변": "", "잔액": Math.round(ledger.opening) }];
    let bal = ledger.opening;
    for (const [m, list] of ledger.months) {
      let md = 0, mc = 0;
      for (const r of list) { bal += ledger.dir(r.debit, r.credit); md += r.debit; mc += r.credit;
        rows.push({ "일자": r.date, "전표": r.voucherNo ?? "", "적요": r.memo, "거래처": r.partnerName || "", "차변": r.debit ? Math.round(r.debit) : "", "대변": r.credit ? Math.round(r.credit) : "", "잔액": Math.round(bal) }); }
      rows.push({ "일자": m, "전표": "", "적요": "[월계]", "거래처": "", "차변": Math.round(md), "대변": Math.round(mc), "잔액": "" });
    }
    rows.push({ "일자": "", "전표": "", "적요": "[합계]", "거래처": "", "차변": Math.round(ledger.debit), "대변": Math.round(ledger.credit), "잔액": Math.round(ledger.ending) });
    exportToExcel(rows, "계정별원장", `계정별원장_${selInfo.code ? selInfo.code + "_" : ""}${selInfo.name}_${from}_${to}`);
  };

  const cellR = "acct-ledger-num mono-number";   // mono-number 는 커스텀 클래스라 @apply 못 한다(2026-08 CSS 전면 장애 교훈)
  let running = ledger?.opening ?? 0;

  return (
    <div>
      <ReportHead
        bar={<>
          <DateRangeField unit="day" label="조회 기간" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          {/* 보기 칩 — 조회 줄에는 '보기'만(값 필터는 검색조건). 시산표 ↔ 원장 */}
          <span className="acct-ledger-view">
            <button type="button" className={view === "tb" ? "acct-ledger-view-btn acct-ledger-view-on" : "acct-ledger-view-btn"} onClick={() => setView("tb")}>시산표</button>
            <button type="button" className={view === "ledger" ? "acct-ledger-view-btn acct-ledger-view-on" : "acct-ledger-view-btn"} onClick={() => setView("ledger")}>계정별 원장</button>
          </span>
          {view === "ledger" && (
            <span className="acct-ledger-pick">
              <button type="button" className="ledger-nav-btn" disabled={selIdx <= 0} onClick={() => openLedger(accounts[selIdx - 1].id)} title="이전 계정 (시산표 순서)" aria-label="이전 계정">‹</button>
              <button type="button" className="ledger-nav-btn" disabled={selIdx < 0 || selIdx >= accounts.length - 1} onClick={() => openLedger(accounts[selIdx + 1].id)} title="다음 계정 (시산표 순서)" aria-label="다음 계정">›</button>
              <span className="relative inline-block">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setPickOpen((v) => !v)} title="계정 고르기 · 코드·이름으로 찾습니다">
                  {selInfo ? `${selInfo.code ? selInfo.code + " " : ""}${selInfo.name}` : "계정 고르기"} <span className="text-[var(--text-dim)]">▾</span>
                </button>
                {pickOpen && (
                  <PickList items={data?.pickable ?? []} placeholder="계정 검색 (코드·이름)" empty="계정과목이 없습니다."
                    onPick={(it) => openLedger(it.id)} onClose={() => setPickOpen(false)} />
                )}
              </span>
            </span>
          )}
        </>}
        right={<>
          <button type="button" onClick={view === "tb" ? exportTb : exportLedger} disabled={view === "tb" ? !accounts.length : !ledger} className="btn-secondary btn-sm">엑셀</button>
          <button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button>
        </>}
        stats={view === "tb" ? <>
          <Stat label="계정" value={`${accounts.length}개`} />
          <Stat label="차변 합계" value={`₩${fmtSigned(totals.d)}`} />
          <Stat label="대변 합계" value={`₩${fmtSigned(totals.c)}`} />
          <Stat label="차·대 차이" tone={totals.diff === 0 ? "plus" : "minus"} value={totals.diff === 0 ? "일치" : `₩${fmtSigned(totals.diff)}`} title="차변 합계 − 대변 합계 · 확정 전표는 차대가 맞으므로 0 이 정상. 기초잔액이 안 맞으면 여기서 드러난다" />
        </> : ledger ? <>
          <Stat label="전기이월" value={`₩${fmtSigned(ledger.opening)}`} />
          <Stat label="당기 차변" value={`₩${fmtSigned(ledger.debit)}`} />
          <Stat label="당기 대변" value={`₩${fmtSigned(ledger.credit)}`} />
          <Stat label="잔액" tone={ledger.ending >= 0 ? "plus" : "minus"} value={`₩${fmtSigned(ledger.ending)}`} />
          <Stat label="전표 줄" value={`${ledger.count}건`} />
        </> : undefined}
      />

      {isLoading ? (
        <div className="acct-ledger-loading">원장을 불러오는 중…</div>
      ) : error ? (
        <div className="kpi-callout warning">불러오지 못했습니다: {(error as Error).message}</div>
      ) : !data ? null : (
        <>
          {/* 아직 전표로 만들지 않은 자료 — 재무제표와 같은 배너. 비어 보이는 이유를 화면이 말한다 */}
          {data.unposted.total > 0 && (
            <div className="acct-ledger-unposted kpi-callout warning">
              이 기간에 아직 전표로 만들지 않은 자료 <b>{data.unposted.total.toLocaleString("ko-KR")}건</b>
              (세금계산서 {data.unposted.taxInvoice} · 카드 {data.unposted.card} · 통장 {data.unposted.bank})은 원장·시산표에 없습니다.
              {" "}<Link href="/collect" className="acct-ledger-link">수집·전표에서 만들기 →</Link>
            </div>
          )}
          {data.closingInside && (
            <div className="acct-ledger-note kpi-callout">회계마감일이 조회 기간 안에 있어 마감일까지의 전표는 기초잔액으로 대신합니다(재무상태표와 같은 규칙).</div>
          )}

          {view === "tb" ? (
            accounts.length === 0 ? (
              <EmptyState card icon="📒" title="이 기간에 확정된 전표가 없습니다." desc="수집·전표에서 전표를 확정하면 시산표가 채워집니다." />
            ) : (
              <table className="ev-table ev-lined acct-ledger-tb">
                <thead>
                  <tr>
                    <th className="acct-ledger-th-num">차변 잔액</th>
                    <th className="acct-ledger-th-num">차변 합계</th>
                    <th className="acct-ledger-th-code">코드</th>
                    <th className="acct-ledger-th-name">계정과목</th>
                    <th className="acct-ledger-th-num">대변 합계</th>
                    <th className="acct-ledger-th-num">대변 잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {NATURE_ORDER.map((nat) => {
                    const list = accounts.filter((a) => a.nature === nat);
                    if (!list.length) return null;
                    return [
                      <tr key={`h-${nat}`} className="acct-ledger-sec"><td colSpan={6}>{NATURE_LABEL[nat]}</td></tr>,
                      ...list.map((a) => {
                        const td = a.openD + a.curD, tc = a.openC + a.curC, net = td - tc;
                        const flipped = isDebitNature(a.nature) ? net < 0 : net > 0;
                        return (
                          <tr key={a.id} className="acct-ledger-row" onClick={() => openLedger(a.id)} title="누르면 이 계정의 원장을 엽니다">
                            <td className={cellR}>{net > 0 ? fmt(net) : ""}</td>
                            <td className={cellR} title={`이월 ${fmt(a.openD) || 0} + 당기 ${fmt(a.curD) || 0}`}>{fmt(td)}</td>
                            <td className="tc mono-number ev-dim">{a.code || ""}</td>
                            <td className="text-left"><span className="acct-ledger-name">{a.name}</span>{flipped && <span className="acct-ledger-flip" title="성격과 반대쪽에 잔액이 섰습니다 — 전표를 확인하세요">반대 잔액</span>}</td>
                            <td className={cellR} title={`이월 ${fmt(a.openC) || 0} + 당기 ${fmt(a.curC) || 0}`}>{fmt(tc)}</td>
                            <td className={cellR}>{net < 0 ? fmt(-net) : ""}</td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
                <tfoot>
                  <tr className="acct-ledger-total">
                    <td className={cellR}>{fmtSigned(totals.bd)}</td>
                    <td className={cellR}>{fmtSigned(totals.d)}</td>
                    <td className="tc" />
                    <td className="text-left">합계{totals.diff !== 0 && <span className="acct-ledger-flip" title="차변 합계와 대변 합계가 다릅니다 — 기초잔액 입력을 확인하세요">차·대 불일치 {fmtSigned(totals.diff)}</span>}</td>
                    <td className={cellR}>{fmtSigned(totals.c)}</td>
                    <td className={cellR}>{fmtSigned(totals.bc)}</td>
                  </tr>
                </tfoot>
              </table>
            )
          ) : !selInfo || !ledger ? (
            <EmptyState card icon="📒" title="계정을 고르세요." desc="위 '계정 고르기'에서 찾거나, 시산표 줄을 누르면 그 계정의 원장이 열립니다." />
          ) : (
            <table className="ev-table ev-lined acct-ledger-sheet">
              <thead>
                <tr>
                  <th className="acct-ledger-th-date">일자</th>
                  <th className="acct-ledger-th-vno">전표</th>
                  <th className="acct-ledger-th-memo">적요</th>
                  <th className="acct-ledger-th-partner">거래처</th>
                  <th className="acct-ledger-th-num">차변</th>
                  <th className="acct-ledger-th-num">대변</th>
                  <th className="acct-ledger-th-num">잔액</th>
                </tr>
              </thead>
              <tbody>
                <tr className="acct-ledger-carry">
                  <td className="tc mono-number">{from}</td>
                  <td />
                  <td className="text-left" colSpan={2}>[전기이월]{data.openingApplied && <span className="ev-dim"> · 기초잔액 포함</span>}</td>
                  <td className={cellR} /><td className={cellR} />
                  <td className={cellR}>{fmtSigned(ledger.opening)}</td>
                </tr>
                {ledger.months.length === 0 && (
                  <tr><td colSpan={7} className="acct-ledger-empty">이 기간에 이 계정으로 확정된 전표 줄이 없습니다.</td></tr>
                )}
                {ledger.months.map(([m, list]) => {
                  let md = 0, mc = 0;
                  const body = list.map((r, i) => {
                    running += ledger.dir(r.debit, r.credit); md += r.debit; mc += r.credit;
                    return (
                      <tr key={`${r.entryId}-${i}`}>
                        <td className="tc mono-number">{r.date}</td>
                        <td className="tc"><button type="button" className="ledger-vno" onClick={() => setEditEntryId(r.entryId)} title="전표 열기 (수정·삭제)">#{r.voucherNo ?? "전표"}</button></td>
                        <td className="text-left ev-ell" title={r.memo}>{r.memo}</td>
                        <td className="text-left ev-ell ev-dim" title={r.partnerName || ""}>{r.partnerName || ""}</td>
                        <td className={cellR}>{fmt(r.debit)}</td>
                        <td className={cellR}>{fmt(r.credit)}</td>
                        <td className={cellR}>{fmtSigned(running)}</td>
                      </tr>
                    );
                  });
                  return [
                    ...body,
                    <tr key={`m-${m}`} className="acct-ledger-month">
                      <td className="tc mono-number">{m}</td><td />
                      <td className="text-left" colSpan={2}>[월계]</td>
                      <td className={cellR}>{fmtSigned(md)}</td>
                      <td className={cellR}>{fmtSigned(mc)}</td>
                      <td className={cellR} />
                    </tr>,
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="acct-ledger-total">
                  <td /><td />
                  <td className="text-left" colSpan={2}>[합계]</td>
                  <td className={cellR}>{fmtSigned(ledger.debit)}</td>
                  <td className={cellR}>{fmtSigned(ledger.credit)}</td>
                  <td className={cellR}>{fmtSigned(ledger.ending)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          <p className="acct-ledger-foot">
            확정 전표만 읽습니다(재무제표와 같은 원천). 이월 = 회계연도 1/1부터 기간 시작 전날까지의 확정 전표{data.openingApplied ? " + 회계마감 기초잔액" : ""}.
            {view === "tb" ? " 합계에는 이월이 들어 있습니다. 잔액은 차변 합계 − 대변 합계가 + 면 차변, − 면 대변에 섭니다." : " 잔액: 자산·비용은 이월 + 차변 − 대변, 부채·자본·수익은 이월 + 대변 − 차변."}
          </p>
        </>
      )}

      {editEntryId && companyId && (
        <VoucherEditModal entryId={editEntryId} companyId={companyId} onClose={() => setEditEntryId(null)}
          onSaved={() => { setEditEntryId(null); qc.invalidateQueries({ queryKey: ["acct-ledger"] }); }} />
      )}
    </div>
  );
}
