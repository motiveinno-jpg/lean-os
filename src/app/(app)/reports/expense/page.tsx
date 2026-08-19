"use client";

// 손익 현황 › 비용 — 어디로 얼마 나갔나 (2026-08-19 기획, 확정 전표 기준)
//   머리 = 기간·비교 · 검색조건(계정·거래처) · 빠른검색 · 고정/변동/인건비 칩 ‖ 엑셀·인쇄 / 비용 합계·인건비·고정비·변동비·미분류
//   본문 = ① 월별 비용 vs 비교 기간 ② 계정별 비용 표(급증 표시) ③ 거래처별 지출 표 ④ 미분류 출금 줄. 줄 클릭 = 원천 전표.
//   예전(2026-07-08) 예산 추정(정기결제·카드) 기준 화면은 버렸다 — 손익계산서와 숫자가 달랐다(추정은 자금 전망에 남는다).

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { GroupedColumnChart, Legend, vizColor } from "@/components/charts/kit";
import { downloadCsv } from "@/lib/csv-export";
import { ConditionPanel, ConditionRow, TokenField, QuickSearch, quickSearchHit, AppliedChips, ChipGroup, Stat, RowsPerPage, Pager, usePager, type AppliedChip } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { groupByAccount, groupByPartner, monthlySeries, rangeDates, rangeLabel, type JournalLine } from "@/lib/pnl-status";
import { usePnlStatus, PnlHead, BasisNote, Delta, DrillModal, won, num, cmpRangeLabel, type Drill } from "../_components/PnlStatusKit";

//   비용 성격 — 계정 이름 규칙(투명하게 화면에 적는다). 인건비 = 급여·상여·퇴직·복리후생, 고정비 = 임차·보험·감가상각·통신·리스·구독·세금과공과, 나머지 = 변동비.
type Kind = "labor" | "fixed" | "variable";
const kindOf = (name: string): Kind => /급여|상여|퇴직|복리후생|잡급|인건/.test(name) ? "labor" : /임차|보험|감가상각|통신|리스|구독|세금과공과|관리비|수도광열/.test(name) ? "fixed" : "variable";
const KIND_LABEL: Record<Kind, string> = { labor: "인건비", fixed: "고정비", variable: "변동비" };

type Cond = { accounts: string[]; partners: string[]; rows: number };
const EMPTY: Cond = { accounts: [], partners: [], rows: 50 };
type ASort = "name" | "kind" | "amount" | "share" | "prev" | "count";

export default function ExpensePage() {
  const { role } = useUser();
  const s = usePnlStatus();
  const [drill, setDrill] = useState<Drill | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const [sort, setSort] = useState<SortState<ASort>>({ key: "amount", dir: "desc" });
  const onSort = (k: ASort) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("pnl-expense-acct-colw-v1", { name: 220, kind: 90, count: 70, amount: 140, share: 70, prev: 140, delta: 90 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });

  const isCost = (l: JournalLine) => l.section === "cogs" || l.section === "opex";
  const costCur = useMemo(() => s.curLines.filter(isCost), [s.curLines]);
  const costCmp = useMemo(() => s.cmpLines.filter(isCost), [s.cmpLines]);
  const acctOpts = useMemo(() => [...new Set(costCur.map((l) => l.name))].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, label: v })), [costCur]);
  const partnerOpts = useMemo(() => [...new Set(costCur.map((l) => l.partnerName || "(거래처 없음)"))].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, label: v })), [costCur]);
  const hit = (l: JournalLine, c: Cond) => (kind === "all" || kindOf(l.name) === kind)
    && (!c.accounts.length || c.accounts.includes(l.name))
    && (!c.partners.length || c.partners.includes(l.partnerName || "(거래처 없음)"))
    && quickSearchHit(q, [l.name, l.partnerName, l.memo]);
  const linesF = useMemo(() => costCur.filter((l) => hit(l, live)), [costCur, live, q, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmpF = useMemo(() => costCmp.filter((l) => hit(l, live)), [costCmp, live, q, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = (l: JournalLine) => l.debit - l.credit;
  const total = linesF.reduce((x, l) => x + amt(l), 0), cmpTotal = cmpF.reduce((x, l) => x + amt(l), 0);
  const byKind = (ls: JournalLine[]) => ls.reduce((m, l) => { const k = kindOf(l.name); m[k] += amt(l); return m; }, { labor: 0, fixed: 0, variable: 0 } as Record<Kind, number>);
  const kindsCur = byKind(costCur), kindsCmp = byKind(costCmp);
  const byAccount = useMemo(() => groupByAccount(linesF), [linesF]);
  const cmpByAccount = useMemo(() => new Map(groupByAccount(cmpF).map((g) => [g.key, g.amount])), [cmpF]);
  const byPartner = useMemo(() => groupByPartner(linesF).slice(0, 30), [linesF]);
  const series = useMemo(() => monthlySeries(linesF, rangeDates(s.range).from, rangeDates(s.range).to), [linesF, s.range]);
  const cmpSeries = useMemo(() => s.data ? monthlySeries(cmpF, rangeDates(s.data.cmpRange).from, rangeDates(s.data.cmpRange).to) : [], [cmpF, s.data]);
  const isSpike = (cur: number, prev: number) => prev > 0 && cur >= prev * 1.5 && s.cur.opex > 0 && cur >= s.cur.opex * 0.05;

  const colVal = (g: { label: string }) => ({ name: g.label, kind: KIND_LABEL[kindOf(g.label)] });
  const rows = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    return byAccount.filter((g) => cf.hit(colVal(g))).sort((a, b) => {
      switch (sort.key) {
        case "name": return cmp(a.label, b.label) * d;
        case "kind": return cmp(KIND_LABEL[kindOf(a.label)], KIND_LABEL[kindOf(b.label)]) * d;
        case "count": return (a.count - b.count) * d;
        case "prev": return ((cmpByAccount.get(a.key) || 0) - (cmpByAccount.get(b.key) || 0)) * d;
        default: return (a.amount - b.amount) * d;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byAccount, sort, cf.key, cmpByAccount]);
  const pager = usePager(rows, live.rows, `${q}|${kind}|${JSON.stringify(live)}|${JSON.stringify(sort)}|${cf.key}`);
  const cfSpec = (k: "name" | "kind") => cf.spec(k, byAccount.map((g) => colVal(g)[k]));

  if (role === "partner") return <AccessDenied detail="비용 현황은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.accounts.map((v) => ({ group: "계정", label: v, onRemove: () => drop({ accounts: live.accounts.filter((x) => x !== v) }) })),
    ...live.partners.map((v) => ({ group: "거래처", label: v, onRemove: () => drop({ partners: live.partners.filter((x) => x !== v) }) })),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${a.k === "kind" ? "성격" : "계정"} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];
  const openDrill = (title: string, f: (l: JournalLine) => boolean) => setDrill({ title, sub: `${rangeLabel(s.range)} · 비용`, lines: linesF.filter(f) });
  const excel = [
    { label: "계정별 비용", count: rows.length, onClick: () => downloadCsv(`비용_계정별_${s.range.fromYm}_${s.range.toYm}`, ["계정", "성격", "건수", "금액", "비중%", cmpRangeLabel(s)], rows.map((g) => [g.label, KIND_LABEL[kindOf(g.label)], g.count, Math.round(g.amount), total ? Math.round((g.amount / total) * 100) : 0, Math.round(cmpByAccount.get(g.key) || 0)])) },
    { label: "거래처별 지출", count: byPartner.length, onClick: () => downloadCsv(`비용_거래처별_${s.range.fromYm}_${s.range.toYm}`, ["거래처", "건수", "금액", "주 계정"], byPartner.map((g) => [g.label, g.count, Math.round(g.amount), g.mainAccount])) },
  ];

  return (
    <>
      <PnlHead s={s} excel={excel}
        bar={<>
          <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setDraft(live); setPanelOpen(v); }} activeCount={live.accounts.length + live.partners.length}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={draft.accounts.length + draft.partners.length === 0} onClick={() => setDraft({ ...EMPTY, rows: draft.rows })}>조건 지우기</button>
              <span className="ml-auto" />
              <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="비용 계정" hint="여러 개 · 매출원가·판관비 계정"><TokenField items={acctOpts} value={draft.accounts} onChange={(v) => setDraft((c) => ({ ...c, accounts: v }))} placeholder="계정 이름 일부" /></ConditionRow>
            <ConditionRow label="거래처" hint="여러 곳"><TokenField items={partnerOpts} value={draft.partners} onChange={(v) => setDraft((c) => ({ ...c, partners: v }))} placeholder="거래처 이름 일부" /></ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="계정 · 거래처 · 적요 — 쉼표로 여러 개, Enter" />
          <ChipGroup value={kind} onChange={setKind} options={[{ value: "all", label: "전체" }, { value: "labor", label: "인건비" }, { value: "fixed", label: "고정비" }, { value: "variable", label: "변동비" }] as const} />
        </>}
        stats={<>
          <Stat label="비용 합계" value={<>{won(total)} <Delta cur={total} prev={cmpTotal} invert /></>} tone="minus" />
          <Stat label="인건비" value={<>{won(kindsCur.labor)} <Delta cur={kindsCur.labor} prev={kindsCmp.labor} invert size="xs" /></>} />
          <Stat label="고정비" value={<>{won(kindsCur.fixed)} <Delta cur={kindsCur.fixed} prev={kindsCmp.fixed} invert size="xs" /></>} />
          <Stat label="변동비" value={<>{won(kindsCur.variable)} <Delta cur={kindsCur.variable} prev={kindsCmp.variable} invert size="xs" /></>} />
          <Stat label="미분류 출금" tone={s.data && s.data.unclassified.count > 0 ? "minus" : undefined} value={s.data ? <>{won(s.data.unclassified.amount)}{s.data.unclassified.count > 0 && <small className="ml-1 text-[var(--warning)] font-semibold">{s.data.unclassified.count}건</small>}</> : "—"} />
        </>} />
      <BasisNote s={s} />
      <AppliedChips chips={chips} onClearAll={() => { setQ(""); setKind("all"); setLive(EMPTY); setDraft(EMPTY); cf.clear(); }} />

      <div className="pnl-grid2">
        <section className="pnl-panel">
          <h3>월별 비용 · {s.cmpLabel} 비교</h3>
          <p>막대를 누르면 그 달의 원천 전표</p>
          {linesF.length === 0 ? <div className="collect-empty">이 기간 비용 전표가 없습니다</div> : (<>
            <GroupedColumnChart height={190} unit="원"
              labels={series.map((m) => `${Number(m.month.slice(5))}월`)}
              series={[{ name: rangeLabel(s.range), values: series.map((m) => m.amount) }, { name: cmpRangeLabel(s), values: series.map((_, i) => cmpSeries[i]?.amount || 0) }]}
              onColumnClick={(i) => openDrill(`${series[i].month} 비용`, (l) => l.month === series[i].month)} />
            <Legend items={[{ name: rangeLabel(s.range), color: vizColor(0) }, { name: cmpRangeLabel(s), color: vizColor(1) }]} />
          </>)}
        </section>
        <section className="pnl-panel">
          <h3>거래처별 지출 <small className="font-normal text-[var(--text-dim)]">상위 30</small></h3>
          <p>어디에 돈이 나갔나 · 줄 클릭 = 원천 전표</p>
          <div className="pnl-tbl-wrap">
            <table className="ev-table ev-lined pnl-mini-table">
              <thead><tr><th className="text-left">거래처</th><th>건수</th><th>금액</th><th>비중</th><th>주 계정</th></tr></thead>
              <tbody>
                {byPartner.map((g) => (
                  <tr key={g.key} className="pnl-row-acct" onClick={() => openDrill(g.label, (l) => (l.partnerName || "(거래처 없음)") === g.key)}>
                    <td className="text-left">{g.label}</td>
                    <td className="text-center mono-number">{g.count}</td>
                    <td className="text-right mono-number">{num(g.amount)}</td>
                    <td className="text-center">{total ? `${Math.round((g.amount / total) * 100)}%` : "—"}</td>
                    <td className="text-center text-[var(--text-muted)]">{g.mainAccount}</td>
                  </tr>
                ))}
                {byPartner.length === 0 && <tr><td colSpan={5} className="text-center text-[var(--text-dim)] py-6">없음</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="pnl-panel">
        <h3>계정별 비용</h3>
        <p>비중 · {s.cmpLabel} 대비 — 급증(+50% 이상이고 판관비의 5% 이상)은 표시만, 판단은 사람이. 성격은 계정 이름 규칙(인건비/고정비/변동비)</p>
        <div className="pnl-tbl-wrap">
          <table ref={tableRef} className="ev-table ev-lined pnl-partner-table">
            <thead><tr>
              <SortableTh label="계정" sortKey="name" sort={sort} onSort={onSort} filter={cfSpec("name")} resize={thResize("name", 1)} />
              <SortableTh label="성격" sortKey="kind" sort={sort} onSort={onSort} filter={cfSpec("kind")} resize={thResize("kind", 2)} />
              <SortableTh label="건수" sortKey="count" sort={sort} onSort={onSort} resize={thResize("count", 3)} />
              <SortableTh label="금액" sortKey="amount" sort={sort} onSort={onSort} resize={thResize("amount", 4)} />
              <SortableTh label="비중" resize={thResize("share", 5)} />
              <SortableTh label={cmpRangeLabel(s) || "비교"} sortKey="prev" sort={sort} onSort={onSort} resize={thResize("prev", 6)} />
              <SortableTh label="증감" resize={thResize("delta", 7)} />
            </tr></thead>
            <tbody>
              {(pager.view as typeof rows).map((g) => {
                const prev = cmpByAccount.get(g.key) || 0;
                return (
                  <tr key={g.key} className="pnl-row-acct" onClick={() => openDrill(g.label, (l) => l.accountId === g.key)}>
                    <td className="text-left font-semibold">{g.label}{g.code && <small className="ml-1 font-normal text-[var(--text-dim)]">{g.code}</small>}</td>
                    <td className="text-center">{KIND_LABEL[kindOf(g.label)]}</td>
                    <td className="text-center mono-number">{g.count}</td>
                    <td className="text-right mono-number font-semibold">{num(g.amount)}</td>
                    <td className="text-center">{total ? `${Math.round((g.amount / total) * 100)}%` : "—"}</td>
                    <td className="text-right mono-number">{num(prev)}</td>
                    <td className="text-center"><Delta cur={g.amount} prev={prev} invert size="xs" />{isSpike(g.amount, prev) && <span className="pnl-flag ml-1">급증</span>}</td>
                  </tr>
                );
              })}
              {s.data && s.data.unclassified.count > 0 && (
                <tr className="pnl-row-unclassified">
                  <td className="text-left font-semibold text-[var(--warning)]">미분류 출금 <small className="font-normal text-[var(--text-dim)]">계정 없는 통장 출금 — 판관비에 안 들어가 있음</small></td>
                  <td className="text-center">—</td>
                  <td className="text-center mono-number">{s.data.unclassified.count}</td>
                  <td className="text-right mono-number">{num(s.data.unclassified.amount)}</td>
                  <td className="text-center">—</td><td className="text-center">—</td>
                  <td className="text-center"><Link href="/collect?tab=bank" className="text-[11px] font-semibold text-[var(--primary)]">계정 지정 →</Link></td>
                </tr>
              )}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-[var(--text-dim)] py-8">이 조건에 맞는 비용이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} pages={pager.pages} total={rows.length} size={live.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />
      </section>

      <DrillModal drill={drill} onClose={() => setDrill(null)} />
    </>
  );
}
