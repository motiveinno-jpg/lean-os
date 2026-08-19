"use client";

// 손익 현황 › 월별 표 — 확정 전표 기준 (2026-08-19 재편 Phase 3).
//   행 = 매출 · 매출원가 · 매출총이익 · 판관비(계정별 펼침) · 영업이익 · 영업이익률 · 영업외 · 당기순이익, 열 = 1~12월 + 누계.
//   셀 모드 = 금액 / 전월비 / 구성비(매출 대비). 셀을 누르면 그 달 그 항목의 원천 전표.
//   예전(2026-07-08)엔 경영 흐름의 FlowMatrix(통장 기준 수입·지출·부가세·잔액)를 재사용했다 — 손익과 현금이 섞여 손익계산서와 숫자가 달랐다.
//   현금 흐름 월별 표는 경영 흐름 › 월별 표(1년치)에 그대로 있다.

import { useEffect, useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ChipGroup, Stat } from "@/components/query-kit";
import { downloadCsv } from "@/lib/csv-export";
import { ExcelMenu } from "@/components/query-kit";
import { fetchJournalLines, pnlAmount, type JournalLine } from "@/lib/journal-reports";
import { ReportHead } from "../_components/ReportHead";
import { DrillModal, won, num, type Drill } from "../_components/PnlStatusKit";

type Mode = "amount" | "mom" | "share";
const YEAR_NOW = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();

export default function MonthlyDetailPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState(YEAR_NOW);
  const [mode, setMode] = useState<Mode>("amount");
  const [openOpex, setOpenOpex] = useState(true);
  const [drill, setDrill] = useState<Drill | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["pnl-monthly", companyId, year],
    queryFn: () => fetchJournalLines(companyId!, `${year}-01-01`, `${year}-12-31`),
    enabled: !!companyId, staleTime: 60_000,
  });

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`), [year]);
  //   구역별 · 계정별 월 합
  const grid = useMemo(() => {
    const sec: Record<string, number[]> = { revenue: Array(12).fill(0), cogs: Array(12).fill(0), opex: Array(12).fill(0), nonop_income: Array(12).fill(0), nonop_expense: Array(12).fill(0), tax: Array(12).fill(0) };
    const opexAcct = new Map<string, { name: string; code: string | null; v: number[] }>();
    for (const l of lines) {
      const mi = Number(l.month.slice(5)) - 1; if (mi < 0 || mi > 11) continue;
      const a = pnlAmount(l);
      if (l.section && sec[l.section]) sec[l.section][mi] += a;
      if (l.section === "opex") {
        const g = opexAcct.get(l.accountId) || { name: l.name, code: l.code, v: Array(12).fill(0) };
        g.v[mi] += a; opexAcct.set(l.accountId, g);
      }
    }
    const gross = sec.revenue.map((v, i) => v - sec.cogs[i]);
    const operating = gross.map((v, i) => v - sec.opex[i]);
    const net = operating.map((v, i) => v + sec.nonop_income[i] - sec.nonop_expense[i] - sec.tax[i]);
    const opexRows = [...opexAcct.entries()].map(([id, g]) => ({ id, ...g, total: g.v.reduce((x, y) => x + y, 0) })).sort((a, b) => b.total - a.total);
    return { sec, gross, operating, net, opexRows };
  }, [lines]);

  if (role === "partner") return <AccessDenied detail="월별 표는 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const sum = (v: number[]) => v.reduce((x, y) => x + y, 0);
  const cell = (v: number[], i: number, invert = false) => {
    if (mode === "amount") return <span className={`mono-number ${v[i] < 0 ? "text-[var(--danger)]" : ""}`}>{v[i] === 0 ? <span className="text-[var(--text-dim)]">-</span> : num(v[i])}</span>;
    if (mode === "mom") { if (i === 0 || v[i - 1] === 0) return <span className="text-[var(--text-dim)]">—</span>; const p = Math.round(((v[i] - v[i - 1]) / Math.abs(v[i - 1])) * 100); const good = invert ? p <= 0 : p >= 0; return <span className={`mono-number text-[11px] font-semibold ${p === 0 ? "text-[var(--text-dim)]" : good ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{p > 0 ? "+" : ""}{p}%</span>; }
    const rev = grid.sec.revenue[i]; if (rev <= 0) return <span className="text-[var(--text-dim)]">—</span>;
    return <span className="mono-number text-[11px]">{Math.round((v[i] / rev) * 100)}%</span>;
  };
  const totalCell = (v: number[]) => <b className={`mono-number ${sum(v) < 0 ? "text-[var(--danger)]" : ""}`}>{num(sum(v))}</b>;
  const openDrill = (label: string, mi: number, f: (l: JournalLine) => boolean) => setDrill({ title: `${label} · ${months[mi]}`, lines: lines.filter((l) => l.month === months[mi] && f(l)) });
  const Row = ({ label, v, cls = "", invert = false, f, indent = false }: { label: React.ReactNode; v: number[]; cls?: string; invert?: boolean; f?: (l: JournalLine) => boolean; indent?: boolean }) => (
    <tr className={cls}>
      <td className={`text-left pnl-mx-label ${indent ? "pl-7" : ""}`}>{label}</td>
      {months.map((m, i) => (
        <td key={m} className={`text-right ${f ? "pnl-mx-click" : ""}`} onClick={f ? () => openDrill(typeof label === "string" ? label : "항목", i, f) : undefined}>{cell(v, i, invert)}</td>
      ))}
      <td className="text-right pnl-mx-total">{mode === "amount" ? totalCell(v) : <span className="text-[var(--text-dim)]">{mode === "share" && grid.sec.revenue.reduce((x, y) => x + y, 0) > 0 ? `${Math.round((sum(v) / sum(grid.sec.revenue)) * 100)}%` : "—"}</span>}</td>
    </tr>
  );
  const rateRow = () => (
    <tr className="pnl-mx-rate">
      <td className="text-left pnl-mx-label">영업이익률</td>
      {months.map((m, i) => <td key={m} className="text-right mono-number text-[11px]">{grid.sec.revenue[i] > 0 ? `${Math.round((grid.operating[i] / grid.sec.revenue[i]) * 1000) / 10}%` : <span className="text-[var(--text-dim)]">—</span>}</td>)}
      <td className="text-right pnl-mx-total mono-number text-[11px]">{sum(grid.sec.revenue) > 0 ? `${Math.round((sum(grid.operating) / sum(grid.sec.revenue)) * 1000) / 10}%` : "—"}</td>
    </tr>
  );
  const excel = [{
    label: `${year}년 월별 표`, count: 8 + grid.opexRows.length,
    onClick: () => downloadCsv(`손익_월별표_${year}`, ["항목", ...months.map((m) => `${Number(m.slice(5))}월`), "누계"], [
      ["매출", ...grid.sec.revenue.map(Math.round), Math.round(sum(grid.sec.revenue))],
      ["매출원가", ...grid.sec.cogs.map(Math.round), Math.round(sum(grid.sec.cogs))],
      ["매출총이익", ...grid.gross.map(Math.round), Math.round(sum(grid.gross))],
      ["판관비", ...grid.sec.opex.map(Math.round), Math.round(sum(grid.sec.opex))],
      ...grid.opexRows.map((r) => [`  ${r.name}`, ...r.v.map(Math.round), Math.round(r.total)]),
      ["영업이익", ...grid.operating.map(Math.round), Math.round(sum(grid.operating))],
      ["영업외수익", ...grid.sec.nonop_income.map(Math.round), Math.round(sum(grid.sec.nonop_income))],
      ["영업외비용", ...grid.sec.nonop_expense.map(Math.round), Math.round(sum(grid.sec.nonop_expense))],
      ["당기순이익", ...grid.net.map(Math.round), Math.round(sum(grid.net))],
    ]),
  }];

  return (
    <>
      <ReportHead
        bar={<>
          <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs">
            {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <ChipGroup value={mode} onChange={setMode} options={[{ value: "amount", label: "금액" }, { value: "mom", label: "전월비" }, { value: "share", label: "매출 대비" }] as const} />
          <span className="text-[11px] text-[var(--text-dim)]">셀을 누르면 그 달 그 항목의 원천 전표 · 확정 전표 기준</span>
        </>}
        right={<><ExcelMenu items={excel} /><button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button></>}
        stats={<>
          <Stat label={`${year}년 매출`} value={won(sum(grid.sec.revenue))} />
          <Stat label="판관비" value={won(sum(grid.sec.opex))} />
          <Stat label="영업이익" tone={sum(grid.operating) >= 0 ? "plus" : "minus"} value={won(sum(grid.operating))} />
          <Stat label="당기순이익" tone={sum(grid.net) >= 0 ? "plus" : "minus"} value={won(sum(grid.net))} />
        </>}
      />
      {isLoading ? <div className="collect-empty">불러오는 중…</div> : lines.length === 0 ? (
        <div className="collect-empty">{year}년 확정 전표가 없습니다 — 수집·전표에서 전표를 만들면 여기 표가 채워집니다</div>
      ) : (
        <div className="pnl-tbl-wrap">
          <table className="ev-table ev-lined pnl-mx-table">
            <thead><tr><th className="text-left">항목</th>{months.map((m) => <th key={m}>{Number(m.slice(5))}월</th>)}<th>누계</th></tr></thead>
            <tbody>
              <Row label="매출" v={grid.sec.revenue} cls="pnl-mx-sec" f={(l) => l.section === "revenue"} />
              <Row label="매출원가" v={grid.sec.cogs} invert f={(l) => l.section === "cogs"} />
              <Row label="매출총이익" v={grid.gross} cls="pnl-mx-sub" />
              <tr className="pnl-mx-sec pnl-mx-toggle" onClick={() => setOpenOpex((v) => !v)}>
                <td className="text-left pnl-mx-label"><span className={`bs-caret ${openOpex ? "rotate-90" : ""}`}>▸</span>판매비와관리비<em className="bs-cnt">{grid.opexRows.length}</em></td>
                {months.map((m, i) => <td key={m} className="text-right pnl-mx-click" onClick={(e) => { e.stopPropagation(); openDrill("판관비", i, (l) => l.section === "opex"); }}>{cell(grid.sec.opex, i, true)}</td>)}
                <td className="text-right pnl-mx-total">{mode === "amount" ? totalCell(grid.sec.opex) : "—"}</td>
              </tr>
              {openOpex && grid.opexRows.map((r) => (
                <Fragment key={r.id}>
                  <Row label={<>{r.name}{r.code && <small className="ml-1 text-[var(--text-dim)]">{r.code}</small>}</>} v={r.v} indent invert f={(l) => l.accountId === r.id} cls="pnl-mx-acct" />
                </Fragment>
              ))}
              <Row label="영업이익" v={grid.operating} cls="pnl-mx-total-row" />
              {rateRow()}
              <Row label="영업외수익" v={grid.sec.nonop_income} f={(l) => l.section === "nonop_income"} />
              <Row label="영업외비용" v={grid.sec.nonop_expense} invert f={(l) => l.section === "nonop_expense"} />
              <Row label="법인세 등" v={grid.sec.tax} invert f={(l) => l.section === "tax"} />
              <Row label="당기순이익" v={grid.net} cls="pnl-mx-total-row" />
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-[var(--text-dim)]">현금 흐름(수입·지출·부가세·통장 잔액) 월별 표는 <a href="/reports/flow" className="text-[var(--primary)] font-semibold">경영 흐름 › 월별 표(1년치)</a>에 있습니다.</p>
      <DrillModal drill={drill} onClose={() => setDrill(null)} />
    </>
  );
}
