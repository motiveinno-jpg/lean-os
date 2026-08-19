"use client";

// 손익 현황 › 매출 — 어디서 얼마 벌었나 (2026-08-19 기획, 확정 전표 기준)
//   머리 = 기간·비교 · 검색조건(거래처·계정) · 빠른검색 ‖ 엑셀·인쇄 / 매출 합계·거래처 수·건수·평균·미수금
//   본문 = ① 월별 매출 vs 비교 기간 ② 거래처별 매출 표 ③ 계정별 매출 표 ④ 미수금 표. 줄 클릭 = 원천 전표.
//   예전(2026-07-08) 세금계산서 공급가액 기준 화면은 버렸다 — 손익계산서와 숫자가 달랐다.

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { GroupedColumnChart, Legend, vizColor } from "@/components/charts/kit";
import { downloadCsv } from "@/lib/csv-export";
import { ConditionPanel, ConditionRow, TokenField, QuickSearch, quickSearchHit, AppliedChips, Stat, RowsPerPage, Pager, usePager, type AppliedChip } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { groupByAccount, groupByPartner, monthlySeries, fetchReceivables, rangeDates, rangeLabel, type JournalLine } from "@/lib/pnl-status";
import { usePnlStatus, PnlHead, BasisNote, Delta, DrillModal, won, num, cmpRangeLabel, type Drill } from "../_components/PnlStatusKit";

type Cond = { partners: string[]; accounts: string[]; rows: number };
const EMPTY: Cond = { partners: [], accounts: [], rows: 50 };
type PSort = "name" | "count" | "amount" | "share" | "prev" | "last";

export default function RevenuePage() {
  const { role } = useUser();
  const s = usePnlStatus();
  const [drill, setDrill] = useState<Drill | null>(null);
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const [sort, setSort] = useState<SortState<PSort>>({ key: "amount", dir: "desc" });
  const onSort = (k: PSort) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("pnl-revenue-partner-colw-v1", { name: 220, count: 70, amount: 140, share: 70, prev: 140, delta: 80, ar: 130, last: 110 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const { data: ar } = useQuery({ queryKey: ["pnl-status-ar", s.companyId], queryFn: () => fetchReceivables(s.companyId!), enabled: !!s.companyId, staleTime: 60_000 });

  const revCur = useMemo(() => s.curLines.filter((l) => l.section === "revenue"), [s.curLines]);
  const revCmp = useMemo(() => s.cmpLines.filter((l) => l.section === "revenue"), [s.cmpLines]);
  const partnerOpts = useMemo(() => [...new Set(revCur.map((l) => l.partnerName || "(거래처 없음)"))].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, label: v })), [revCur]);
  const acctOpts = useMemo(() => [...new Set(revCur.map((l) => l.name))].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, label: v })), [revCur]);
  const hit = (l: JournalLine, c: Cond) => (!c.partners.length || c.partners.includes(l.partnerName || "(거래처 없음)"))
    && (!c.accounts.length || c.accounts.includes(l.name))
    && quickSearchHit(q, [l.partnerName, l.name, l.memo]);
  const linesF = useMemo(() => revCur.filter((l) => hit(l, live)), [revCur, live, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmpF = useMemo(() => revCmp.filter((l) => hit(l, live)), [revCmp, live, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = linesF.reduce((x, l) => x + (l.credit - l.debit), 0);
  const cmpTotal = cmpF.reduce((x, l) => x + (l.credit - l.debit), 0);
  const byPartner = useMemo(() => groupByPartner(linesF), [linesF]);
  const cmpByPartner = useMemo(() => new Map(groupByPartner(cmpF).map((g) => [g.key, g.amount])), [cmpF]);
  const arByPartner = useMemo(() => { const m = new Map<string, number>(); (ar?.rows || []).forEach((r) => m.set(r.name, (m.get(r.name) || 0) + r.amount)); return m; }, [ar]);
  const byAccount = useMemo(() => groupByAccount(linesF), [linesF]);
  const cmpByAccount = useMemo(() => new Map(groupByAccount(cmpF).map((g) => [g.key, g.amount])), [cmpF]);
  const series = useMemo(() => monthlySeries(linesF, rangeDates(s.range).from, rangeDates(s.range).to), [linesF, s.range]);
  const cmpSeries = useMemo(() => s.data ? monthlySeries(cmpF, rangeDates(s.data.cmpRange).from, rangeDates(s.data.cmpRange).to) : [], [cmpF, s.data]);

  const colVal = (g: { label: string; mainAccount?: string }) => ({ name: g.label });
  const rows = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    return byPartner.filter((g) => cf.hit(colVal(g))).sort((a, b) => {
      switch (sort.key) {
        case "name": return cmp(a.label, b.label) * d;
        case "count": return (a.count - b.count) * d;
        case "prev": return ((cmpByPartner.get(a.key) || 0) - (cmpByPartner.get(b.key) || 0)) * d;
        case "last": return cmp(a.lastDate, b.lastDate) * d;
        default: return (a.amount - b.amount) * d;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byPartner, sort, cf.key, cmpByPartner]);
  const pager = usePager(rows, live.rows, `${q}|${JSON.stringify(live)}|${JSON.stringify(sort)}|${cf.key}`);
  const cfSpec = (k: "name") => cf.spec(k, byPartner.map((g) => colVal(g)[k]));

  if (role === "partner") return <AccessDenied detail="매출 현황은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.partners.map((v) => ({ group: "거래처", label: v, onRemove: () => drop({ partners: live.partners.filter((x) => x !== v) }) })),
    ...live.accounts.map((v) => ({ group: "계정", label: v, onRemove: () => drop({ accounts: live.accounts.filter((x) => x !== v) }) })),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `거래처 ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];
  const condCount = live.partners.length + live.accounts.length;
  const openDrill = (title: string, f: (l: JournalLine) => boolean) => setDrill({ title, sub: `${rangeLabel(s.range)} · 매출`, lines: linesF.filter(f) });
  const excel = [
    { label: "거래처별 매출", count: rows.length, onClick: () => downloadCsv(`매출_거래처별_${s.range.fromYm}_${s.range.toYm}`, ["거래처", "건수", "금액", "비중%", cmpRangeLabel(s), "미수금", "최근 거래"], rows.map((g) => [g.label, g.count, Math.round(g.amount), total ? Math.round((g.amount / total) * 100) : 0, Math.round(cmpByPartner.get(g.key) || 0), Math.round(arByPartner.get(g.label) || 0), g.lastDate])) },
    { label: "계정별 매출", count: byAccount.length, onClick: () => downloadCsv(`매출_계정별_${s.range.fromYm}_${s.range.toYm}`, ["계정", "금액", "비중%", cmpRangeLabel(s)], byAccount.map((g) => [g.label, Math.round(g.amount), total ? Math.round((g.amount / total) * 100) : 0, Math.round(cmpByAccount.get(g.key) || 0)])) },
  ];

  return (
    <>
      <PnlHead s={s} excel={excel}
        bar={<>
          <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setDraft(live); setPanelOpen(v); }} activeCount={condCount}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={draft.partners.length + draft.accounts.length === 0} onClick={() => setDraft({ ...EMPTY, rows: draft.rows })}>조건 지우기</button>
              <span className="ml-auto" />
              <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="거래처" hint="여러 곳"><TokenField items={partnerOpts} value={draft.partners} onChange={(v) => setDraft((c) => ({ ...c, partners: v }))} placeholder="거래처 이름 일부" /></ConditionRow>
            <ConditionRow label="매출 계정" hint="여러 개 · 계정과목표의 매출 계정"><TokenField items={acctOpts} value={draft.accounts} onChange={(v) => setDraft((c) => ({ ...c, accounts: v }))} placeholder="계정 이름 일부" /></ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="거래처 · 계정 · 적요 — 쉼표로 여러 개, Enter" />
        </>}
        stats={<>
          <Stat label="매출 합계" value={<>{won(total)} <Delta cur={total} prev={cmpTotal} /></>} />
          <Stat label="거래처" value={`${byPartner.length}곳`} />
          <Stat label="건수" value={`${linesF.length.toLocaleString()}건`} />
          <Stat label="건당 평균" value={linesF.length ? won(total / linesF.length) : "—"} />
          <Stat label="미수금" tone={ar && ar.over30 > 0 ? "minus" : undefined} value={ar ? <>{won(ar.total)}{ar.over30 > 0 && <small className="ml-1 text-[var(--danger)] font-semibold">30일+ {won(ar.over30)}</small>}</> : "—"} />
        </>} />
      <BasisNote s={s} />
      <AppliedChips chips={chips} onClearAll={() => { setQ(""); setLive(EMPTY); setDraft(EMPTY); cf.clear(); }} />

      <div className="pnl-grid2">
        <section className="pnl-panel">
          <h3>월별 매출 · {s.cmpLabel} 비교</h3>
          <p>막대를 누르면 그 달의 원천 전표</p>
          {series.length === 0 || linesF.length === 0 ? <div className="collect-empty">이 기간 매출 전표가 없습니다</div> : (<>
            <GroupedColumnChart height={190} unit="원"
              labels={series.map((m) => `${Number(m.month.slice(5))}월`)}
              series={[{ name: rangeLabel(s.range), values: series.map((m) => m.amount) }, { name: cmpRangeLabel(s), values: series.map((_, i) => cmpSeries[i]?.amount || 0) }]}
              onColumnClick={(i) => openDrill(`${series[i].month} 매출`, (l) => l.month === series[i].month)} />
            <Legend items={[{ name: rangeLabel(s.range), color: vizColor(0) }, { name: cmpRangeLabel(s), color: vizColor(1) }]} />
          </>)}
        </section>
        <section className="pnl-panel">
          <h3>계정별 매출</h3>
          <p>계정과목표의 매출 계정 — 회사가 계정을 늘리면 자동으로 늘어난다 · 줄 클릭 = 원천 전표</p>
          <div className="pnl-tbl-wrap">
            <table className="ev-table ev-lined pnl-mini-table">
              <thead><tr><th className="text-left">계정</th><th>금액</th><th>비중</th><th>{cmpRangeLabel(s)}</th><th>증감</th></tr></thead>
              <tbody>
                {byAccount.map((g) => (
                  <tr key={g.key} className="pnl-row-acct" onClick={() => openDrill(g.label, (l) => l.accountId === g.key)}>
                    <td className="text-left">{g.label}{g.code && <small className="ml-1 text-[var(--text-dim)]">{g.code}</small>}</td>
                    <td className="text-right mono-number">{num(g.amount)}</td>
                    <td className="text-center">{total ? `${Math.round((g.amount / total) * 100)}%` : "—"}</td>
                    <td className="text-right mono-number">{num(cmpByAccount.get(g.key) || 0)}</td>
                    <td className="text-center"><Delta cur={g.amount} prev={cmpByAccount.get(g.key) || 0} size="xs" /></td>
                  </tr>
                ))}
                {byAccount.length === 0 && <tr><td colSpan={5} className="text-center text-[var(--text-dim)] py-6">없음</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="pnl-panel">
        <h3>거래처별 매출</h3>
        <p>정렬 ▼ · ≡ 필터 · 너비 조절 · 쪽 — 줄 클릭 = 그 거래처 전표. 미수금은 매출 세금계산서 중 아직 안 들어온 것(발행 기준)</p>
        <div className="pnl-tbl-wrap">
          <table ref={tableRef} className="ev-table ev-lined pnl-partner-table">
            <thead><tr>
              <SortableTh label="거래처" sortKey="name" sort={sort} onSort={onSort} filter={cfSpec("name")} resize={thResize("name", 1)} />
              <SortableTh label="건수" sortKey="count" sort={sort} onSort={onSort} resize={thResize("count", 2)} />
              <SortableTh label="금액" sortKey="amount" sort={sort} onSort={onSort} resize={thResize("amount", 3)} />
              <SortableTh label="비중" resize={thResize("share", 4)} />
              <SortableTh label={cmpRangeLabel(s) || "비교"} sortKey="prev" sort={sort} onSort={onSort} resize={thResize("prev", 5)} />
              <SortableTh label="증감" resize={thResize("delta", 6)} />
              <SortableTh label="미수금" resize={thResize("ar", 7)} />
              <SortableTh label="최근 거래" sortKey="last" sort={sort} onSort={onSort} resize={thResize("last", 8)} />
            </tr></thead>
            <tbody>
              {(pager.view as typeof rows).map((g) => {
                const prev = cmpByPartner.get(g.key) || 0; const arv = arByPartner.get(g.label) || 0;
                return (
                  <tr key={g.key} className="pnl-row-acct" onClick={() => openDrill(g.label, (l) => (l.partnerName || "(거래처 없음)") === g.key)}>
                    <td className="text-left font-semibold">{g.label}<small className="ml-1 font-normal text-[var(--text-dim)]">{g.mainAccount}</small></td>
                    <td className="text-center mono-number">{g.count}</td>
                    <td className="text-right mono-number font-semibold">{num(g.amount)}</td>
                    <td className="text-center">{total ? `${Math.round((g.amount / total) * 100)}%` : "—"}</td>
                    <td className="text-right mono-number">{num(prev)}</td>
                    <td className="text-center"><Delta cur={g.amount} prev={prev} size="xs" /></td>
                    <td className="text-right mono-number">{arv ? <span className="text-[var(--danger)]">{num(arv)}</span> : "—"}</td>
                    <td className="text-center mono-number">{g.lastDate}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center text-[var(--text-dim)] py-8">이 조건에 맞는 매출이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} pages={pager.pages} total={rows.length} size={live.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />
      </section>

      {ar && ar.rows.length > 0 && (
        <section className="pnl-panel">
          <h3>미수금 <small className="font-normal text-[var(--text-dim)]">아직 안 들어온 매출 세금계산서 · 발행일 기준 경과일</small></h3>
          <div className="pnl-tbl-wrap">
            <table className="ev-table ev-lined pnl-mini-table">
              <thead><tr><th className="text-left">거래처</th><th>금액</th><th>발행일</th><th>경과</th></tr></thead>
              <tbody>
                {[...ar.rows].sort((a, b) => b.days - a.days).slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="text-left">{r.name}</td>
                    <td className="text-right mono-number">{num(r.amount)}</td>
                    <td className="text-center mono-number">{r.issueDate}</td>
                    <td className="text-center">{r.days > 30 ? <span className="pnl-flag">{r.days}일</span> : `${r.days}일`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <DrillModal drill={drill} onClose={() => setDrill(null)} />
    </>
  );
}
