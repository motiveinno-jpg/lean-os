"use client";

// 분석 › 회계 자료 › 현금흐름표 (2026-09-22 ERP 공백 2차 ④). 원천·판정 규칙은 lib/cash-flow-statement.ts 머리 주석.
//   보기 두 갈래(조회 줄 칩) — 합계 / 월별. 줄을 누르면 그 줄에 들어간 통장 거래(근거 포함)가 팝업으로.
//   근거 없이 '기타 입금·기타 지급'에 들어간 줄은 배너로 세고, 누르면 그 목록.

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportHead } from "../_components/ReportHead";
import { Stat } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { EmptyState } from "@/components/empty-state";
import { exportToExcel } from "@/lib/excel-export";
import { fetchCashFlow, monthRange, CF_LINES, ACTIVITY_LABEL, type CashFlowData, type CfTx, type LineKey, type Activity } from "@/lib/cash-flow-statement";
import Link from "next/link";

type View = "total" | "monthly";
const won = (n: number) => (Math.round(n) === 0 ? "0" : Math.round(n).toLocaleString("ko-KR"));
const signed = (n: number) => (n < 0 ? `-${won(-n)}` : won(n));
const ACTS: Activity[] = ["op", "inv", "fin"];

export default function CashFlowPage() {
  const { role } = useUser();
  if (role === "partner") return <AccessDenied detail="현금흐름표는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  return <CashFlowInner />;
}

function CashFlowInner() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [fromM, setFromM] = useState(() => `${new Date().getFullYear()}-01`);
  const [toM, setToM] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [view, setView] = useState<View>("total");
  const [detail, setDetail] = useState<{ title: string; txs: CfTx[] } | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);
  const { from, to } = monthRange(fromM, toM);

  const { data, isLoading, error } = useQuery<CashFlowData>({
    queryKey: ["cashflow", companyId, from, to],
    queryFn: () => fetchCashFlow(companyId!, from, to),
    enabled: !!companyId && from <= to,
    staleTime: 60_000,
  });

  const agg = useMemo(() => {
    const byKey = new Map<LineKey, { total: number; count: number; byMonth: Map<string, number>; txs: CfTx[] }>();
    for (const l of CF_LINES) byKey.set(l.key, { total: 0, count: 0, byMonth: new Map(), txs: [] });
    for (const t of data?.txs || []) {
      const a = byKey.get(t.key)!; a.total += t.amount; a.count += 1; a.txs.push(t);
      a.byMonth.set(t.month, (a.byMonth.get(t.month) || 0) + t.amount);
    }
    const actNet = (act: Activity, month?: string) => CF_LINES.filter((l) => l.activity === act).reduce((s, l) => { const a = byKey.get(l.key)!; const v = month ? (a.byMonth.get(month) || 0) : a.total; return s + (l.dir === "in" ? v : -v); }, 0);
    const unbased = (data?.txs || []).filter((t) => !t.basis && t.key !== "xfer");
    return { byKey, actNet, unbased };
  }, [data]);

  const months = data?.months || [];
  const net = ACTS.reduce((s, a) => s + agg.actNet(a), 0);
  const xfer = agg.byKey.get("xfer");

  const exportXlsx = () => {
    if (!data) return;
    const rows: Record<string, unknown>[] = [];
    for (const act of ACTS) {
      for (const l of CF_LINES.filter((x) => x.activity === act)) {
        const a = agg.byKey.get(l.key)!; if (!a.count) continue;
        const r: Record<string, unknown> = { "활동": ACTIVITY_LABEL[act], "항목": l.label, "방향": l.dir === "in" ? "입금" : "출금", "건수": a.count, "합계": Math.round(a.total) };
        for (const m of months) r[m] = Math.round(a.byMonth.get(m) || 0);
        rows.push(r);
      }
      const r: Record<string, unknown> = { "활동": ACTIVITY_LABEL[act], "항목": `${ACTIVITY_LABEL[act]} 순현금`, "방향": "", "건수": "", "합계": Math.round(agg.actNet(act)) };
      for (const m of months) r[m] = Math.round(agg.actNet(act, m));
      rows.push(r);
    }
    rows.push({ "활동": "", "항목": "현금 순증감", "방향": "", "건수": "", "합계": Math.round(net) });
    rows.push({ "활동": "", "항목": "기초 현금", "방향": "", "건수": "", "합계": Math.round(data.opening) });
    rows.push({ "활동": "", "항목": "기말 현금", "방향": "", "건수": "", "합계": Math.round(data.closing) });
    exportToExcel(rows, "현금흐름표", `현금흐름표_${from}_${to}`);
  };

  const openLine = (key: LineKey, label: string, month?: string) => {
    const a = agg.byKey.get(key)!;
    const txs = month ? a.txs.filter((t) => t.month === month) : a.txs;
    setDetail({ title: `${label}${month ? ` · ${month}` : ""} — ${txs.length}건`, txs });
  };

  const cell = "cfs-num mono-number";
  const cols = view === "monthly" ? months.length + 1 : 2;

  return (
    <div>
      <ReportHead
        bar={<>
          <DateRangeField unit="month" label="조회 기간" from={fromM} to={toM} onChange={(f, t) => { setFromM(f); setToM(t); }} />
          <span className="acct-ledger-view">
            <button type="button" className={view === "total" ? "acct-ledger-view-btn acct-ledger-view-on" : "acct-ledger-view-btn"} onClick={() => setView("total")}>합계</button>
            <button type="button" className={view === "monthly" ? "acct-ledger-view-btn acct-ledger-view-on" : "acct-ledger-view-btn"} onClick={() => setView("monthly")}>월별</button>
          </span>
        </>}
        right={<>
          <button type="button" className="btn-secondary btn-sm" onClick={exportXlsx} disabled={!data}>엑셀</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>인쇄</button>
        </>}
        stats={data ? <>
          <Stat label="기초 현금" value={`₩${signed(data.opening)}`} />
          <Stat label="영업활동" tone={agg.actNet("op") >= 0 ? "plus" : "minus"} value={`₩${signed(agg.actNet("op"))}`} />
          <Stat label="투자활동" tone={agg.actNet("inv") >= 0 ? "plus" : "minus"} value={`₩${signed(agg.actNet("inv"))}`} />
          <Stat label="재무활동" tone={agg.actNet("fin") >= 0 ? "plus" : "minus"} value={`₩${signed(agg.actNet("fin"))}`} />
          <Stat label="기말 현금" value={`₩${signed(data.closing)}`} title={`통장 ${data.accountCount}개 잔액 합에서 기간 뒤 순증감을 되돌린 값`} />
        </> : undefined}
      />

      {isLoading ? (
        <div className="acct-ledger-loading">통장 거래를 활동별로 나누는 중…</div>
      ) : error ? (
        <div className="kpi-callout warning">불러오지 못했습니다: {(error as Error).message}</div>
      ) : !data ? null : data.txs.length === 0 ? (
        <EmptyState card icon="💧" title="이 기간에 통장 거래가 없습니다." desc="통장을 연결하고 거래를 수집하면 현금흐름표가 채워집니다." />
      ) : (
        <>
          <div className="cfs-basis-note kpi-callout">
            이 표는 <b>통장 거래 기준</b>입니다(손익·재무상태표는 확정 전표 기준). 계좌 간 이체 {xfer?.count || 0}건은 뺐습니다.
            {agg.unbased.length > 0 && <> 분류 근거 없이 '기타 입금·기타 지급'에 넣은 줄 <button type="button" className="acct-ledger-link cfs-link-btn" onClick={() => setDetail({ title: `근거 없는 줄 — ${agg.unbased.length}건`, txs: agg.unbased })}>{agg.unbased.length}건</button> —
              <Link href="/bank" className="acct-ledger-link"> 통장에서 거래처·분류·전표를 붙이면</Link> 다음 조회부터 제자리를 찾습니다.</>}
          </div>

          <table className="ev-table ev-lined cfs-table">
            <thead>
              <tr>
                <th className="cfs-th-name">항목</th>
                {view === "monthly" ? months.map((m) => <th key={m} className="cfs-th-num">{m}</th>) : <th className="cfs-th-num">건수</th>}
                <th className="cfs-th-num">{view === "monthly" ? "합계" : "금액"}</th>
              </tr>
            </thead>
            <tbody>
              {ACTS.map((act) => {
                const lines = CF_LINES.filter((l) => l.activity === act && agg.byKey.get(l.key)!.count > 0);
                return [
                  <tr key={`h-${act}`} className="acct-ledger-sec"><td colSpan={cols + (view === "monthly" ? 0 : 1)}>{ACTIVITY_LABEL[act]}</td></tr>,
                  ...(lines.length === 0 ? [<tr key={`e-${act}`}><td className="text-left ev-dim" colSpan={cols + (view === "monthly" ? 0 : 1)}>해당 거래 없음</td></tr>] : []),
                  ...lines.map((l) => { const a = agg.byKey.get(l.key)!; const sgn = l.dir === "in" ? 1 : -1; return (
                    <tr key={l.key} className="acct-ledger-row" onClick={() => openLine(l.key, l.label)} title="누르면 이 줄의 통장 거래를 봅니다">
                      <td className="text-left cfs-line-name">{l.dir === "in" ? "＋" : "－"} {l.label}</td>
                      {view === "monthly"
                        ? months.map((m) => <td key={m} className={cell} onClick={(e) => { e.stopPropagation(); openLine(l.key, l.label, m); }}>{a.byMonth.get(m) ? signed(sgn * a.byMonth.get(m)!) : ""}</td>)
                        : <td className={cell}>{a.count.toLocaleString("ko-KR")}</td>}
                      <td className={cell}>{signed(sgn * a.total)}</td>
                    </tr>
                  ); }),
                  <tr key={`t-${act}`} className="cfs-subtotal">
                    <td className="text-left">{ACTIVITY_LABEL[act]} 순현금</td>
                    {view === "monthly" ? months.map((m) => <td key={m} className={cell}>{signed(agg.actNet(act, m))}</td>) : <td className={cell} />}
                    <td className={cell}>{signed(agg.actNet(act))}</td>
                  </tr>,
                ];
              })}
            </tbody>
            <tfoot>
              <tr className="acct-ledger-total">
                <td className="text-left">현금 순증감</td>
                {view === "monthly" ? months.map((m) => <td key={m} className={cell}>{signed(ACTS.reduce((s, a) => s + agg.actNet(a, m), 0))}</td>) : <td className={cell} />}
                <td className={cell}>{signed(net)}</td>
              </tr>
              <tr className="cfs-balance"><td className="text-left">기초 현금 ({from})</td><td colSpan={cols - 1} /><td className={cell}>{signed(data.opening)}</td></tr>
              <tr className="cfs-balance"><td className="text-left">기말 현금 ({to})</td><td colSpan={cols - 1} /><td className={cell}>{signed(data.closing)}</td></tr>
            </tfoot>
          </table>

          <p className="acct-ledger-foot">
            통장 거래(숨긴 계좌 제외)를 활동별로 나눈 직접법 현금흐름표. 줄마다 근거(전표 계정 · 계산서 정산 · 대출 상환 기록 · 직원 이름 · 대표 이름 · 키워드 · 통장 분류 · 거래처 연결)를 남기고, 근거 없는 줄은 기타로 둡니다.
            기초·기말 현금 = 지금 통장 잔액 합에서 기간 뒤 순증감을 되돌린 값이라 계좌 간 이체가 한쪽만 수집됐으면 어긋날 수 있습니다.
          </p>
        </>
      )}

      {detail && (
        <div className="inv-modal" onClick={() => setDetail(null)}>
          <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><b>{detail.title}</b><button type="button" className="inv-modal-x" onClick={() => setDetail(null)} aria-label="닫기">✕</button></div>
            <p className="inv-modal-desc">근거 칸이 비어 있으면 통장에서 거래처·분류·전표를 붙여 주세요. 표는 최근 500건까지 보입니다.</p>
            <div className="cfs-detail-scroll">
              <table className="ev-table ev-lined cfs-detail-table">
                <thead><tr><th>일자</th><th className="text-left">계좌</th><th className="text-left">상대</th><th className="text-left">적요</th><th>금액</th><th className="text-left">근거</th></tr></thead>
                <tbody>
                  {detail.txs.slice(0, 500).map((t) => (
                    <tr key={t.id}>
                      <td className="tc mono-number">{t.date}</td>
                      <td className="text-left ev-ell ev-dim">{t.account}</td>
                      <td className="text-left ev-ell" title={t.counterparty}>{t.counterparty || "—"}</td>
                      <td className="text-left ev-ell ev-dim" title={t.description}>{t.description}</td>
                      <td className={cell}>{t.dir === "in" ? "+" : "−"}{won(t.amount)}</td>
                      <td className="text-left ev-dim">{t.basis || <span className="acct-ledger-flip">근거 없음</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
