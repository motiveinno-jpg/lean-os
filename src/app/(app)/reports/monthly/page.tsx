"use client";

// 손익 현황 › 월별 표 — 확정 전표 기준 (2026-08-19 재편 Phase 3 → 같은 날 '보기 설정' 재편, docs/20260819_PLAN_monthly_matrix_view.md)
//   조회 줄 = [연도 · 보기 설정 ▾] ‖ 내 조건 · 엑셀 · 인쇄. 보기 옵션(표시값·함께 보기·열 묶음·방향·행 구성·강조·누계)은
//   전부 '보기 설정' 한 버튼 안 — 검색조건과 같은 문법(고르고 → 적용, 걸린 설정 칩, ★ 내 조건). 셀 하나에 금액 + 작은 글씨 비교값.
//   예전엔 금액/전월비/매출 대비 칩 3개가 조회 줄에 나열돼 있었다(사장님: 한 버튼으로).
//   현금 흐름 월별 표는 경영 흐름 › 월별 표(1년치)에 그대로 있다.

import { useEffect, useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ConditionPanel, ConditionRow, ChipGroup, Stat, ExcelMenu, AppliedChips, SavedTabs, ConditionSave, useSavedQueries, type AppliedChip } from "@/components/query-kit";
import { downloadCsv } from "@/lib/csv-export";
import { fetchJournalLines, pnlAmount, type JournalLine } from "@/lib/journal-reports";
import { ReportHead } from "../_components/ReportHead";
import { DrillModal, won, num, type Drill } from "../_components/PnlStatusKit";

const YEAR_NOW = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();

// ── 보기 설정 ────────────────────────────────────────────────────────────
type Val = "amount" | "mom" | "yoy" | "share";
type Sub = "none" | "mom" | "yoy" | "yoyAmt";
type Col = "month" | "quarter" | "half";
type Dir = "wide" | "tall";
type Rows = "summary" | "opex" | "all";
type View = { val: Val; sub: Sub; col: Col; dir: Dir; rows: Rows; hl: string[]; cum: boolean };
const DEFAULT_VIEW: View = { val: "amount", sub: "mom", col: "month", dir: "wide", rows: "opex", hl: ["minmax", "heat"], cum: true };
const VAL_LABEL: Record<Val, string> = { amount: "금액", mom: "전월비 %", yoy: "전년동월 %", share: "매출 대비 %" };
const SUB_LABEL: Record<Sub, string> = { none: "없음", mom: "전월비 %", yoy: "전년동월 %", yoyAmt: "전년 금액" };
const COL_LABEL: Record<Col, string> = { month: "월 (12)", quarter: "분기 (4)", half: "반기 (2)" };
const DIR_LABEL: Record<Dir, string> = { wide: "가로 (항목↓ 월→)", tall: "세로 (월↓ 항목→)" };
const ROWS_LABEL: Record<Rows, string> = { summary: "요약 4줄", opex: "판관비 계정 펼침", all: "전 계정 펼침" };
const HL_LABEL: Record<string, string> = { minmax: "최고·최저 달", heat: "전월비 히트맵", hidezero: "0인 달 숨김" };
//   기본과 다른 항목 수 = 버튼 배지
const viewCount = (v: View) => (v.val !== DEFAULT_VIEW.val ? 1 : 0) + (v.sub !== DEFAULT_VIEW.sub ? 1 : 0) + (v.col !== DEFAULT_VIEW.col ? 1 : 0) + (v.dir !== DEFAULT_VIEW.dir ? 1 : 0) + (v.rows !== DEFAULT_VIEW.rows ? 1 : 0) + ([...v.hl].sort().join() !== [...DEFAULT_VIEW.hl].sort().join() ? 1 : 0) + (v.cum !== DEFAULT_VIEW.cum ? 1 : 0);

// ── 표 자료 — 항목(행 후보) × 12개월 ─────────────────────────────────────
type Item = { key: string; label: string; code?: string | null; kind: "sec" | "sub" | "acct" | "total" | "rate"; invert: boolean; v: number[]; prevV: number[]; f?: (l: JournalLine) => boolean; indent?: boolean; parent?: string };

export default function MonthlyDetailPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState(YEAR_NOW);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [draft, setDraft] = useState<View>(DEFAULT_VIEW);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openSec, setOpenSec] = useState<Set<string>>(new Set(["opex"]));
  const [drill, setDrill] = useState<Drill | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  //   올해 + 전년(전년동월 비교용) 줄
  const { data, isLoading } = useQuery({
    queryKey: ["pnl-monthly", companyId, year],
    queryFn: async () => {
      const [cur, prev] = await Promise.all([
        fetchJournalLines(companyId!, `${year}-01-01`, `${year}-12-31`),
        fetchJournalLines(companyId!, `${year - 1}-01-01`, `${year - 1}-12-31`),
      ]);
      return { cur, prev };
    },
    enabled: !!companyId, staleTime: 60_000,
  });
  const lines = useMemo(() => data?.cur || [], [data]);
  const prevLines = useMemo(() => data?.prev || [], [data]);

  //   내 조건(보기 설정 저장) — 사용자 값
  const saved = useSavedQueries("pnl-monthly", companyId);
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def?.params?.view) { const v = { ...DEFAULT_VIEW, ...(saved.def.params.view as Partial<View>) }; setView(v); setDraft(v); }
  }, [saved.isFetched, saved.def, defDone]);

  const items = useMemo<Item[]>(() => {
    const z = () => Array(12).fill(0) as number[];
    const secSum = (ls: JournalLine[]) => { const m: Record<string, number[]> = { revenue: z(), cogs: z(), opex: z(), nonop_income: z(), nonop_expense: z(), tax: z() }; for (const l of ls) { const mi = Number(l.month.slice(5)) - 1; if (l.section && m[l.section] && mi >= 0 && mi < 12) m[l.section][mi] += pnlAmount(l); } return m; };
    const acctSum = (ls: JournalLine[]) => { const m = new Map<string, { name: string; code: string | null; section: string; v: number[] }>(); for (const l of ls) { const mi = Number(l.month.slice(5)) - 1; if (mi < 0 || mi > 11 || !l.section) continue; const g = m.get(l.accountId) || { name: l.name, code: l.code, section: l.section, v: z() }; g.v[mi] += pnlAmount(l); m.set(l.accountId, g); } return m; };
    const cs = secSum(lines), ps = secSum(prevLines), ca = acctSum(lines), pa = acctSum(prevLines);
    const minus = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
    const gross = minus(cs.revenue, cs.cogs), pGross = minus(ps.revenue, ps.cogs);
    const op = minus(gross, cs.opex), pOp = minus(pGross, ps.opex);
    const net = op.map((v, i) => v + cs.nonop_income[i] - cs.nonop_expense[i] - cs.tax[i]);
    const pNet = pOp.map((v, i) => v + ps.nonop_income[i] - ps.nonop_expense[i] - ps.tax[i]);
    const acctRows = (section: string, invert: boolean, parent: string): Item[] => [...ca.entries()].filter(([, g]) => g.section === section)
      .map(([id, g]) => ({ key: id, label: g.name, code: g.code, kind: "acct" as const, invert, v: g.v, prevV: pa.get(id)?.v || z(), f: (l: JournalLine) => l.accountId === id, indent: true, parent }))
      .sort((a, b) => b.v.reduce((x, y) => x + y, 0) - a.v.reduce((x, y) => x + y, 0));
    const secRow = (key: string, label: string, invert: boolean, v: number[], prevV: number[], f: (l: JournalLine) => boolean): Item => ({ key, label, kind: "sec", invert, v, prevV, f });
    const out: Item[] = [];
    out.push(secRow("revenue", "매출", false, cs.revenue, ps.revenue, (l) => l.section === "revenue"));
    if (view.rows === "all") out.push(...acctRows("revenue", false, "revenue"));
    out.push(secRow("cogs", "매출원가", true, cs.cogs, ps.cogs, (l) => l.section === "cogs"));
    if (view.rows === "all") out.push(...acctRows("cogs", true, "cogs"));
    if (view.rows !== "summary") out.push({ key: "gross", label: "매출총이익", kind: "sub", invert: false, v: gross, prevV: pGross });
    out.push(secRow("opex", "판매비와관리비", true, cs.opex, ps.opex, (l) => l.section === "opex"));
    if (view.rows !== "summary") out.push(...acctRows("opex", true, "opex"));
    out.push({ key: "op", label: "영업이익", kind: "total", invert: false, v: op, prevV: pOp });
    out.push({ key: "rate", label: "영업이익률", kind: "rate", invert: false, v: op.map((v, i) => (cs.revenue[i] > 0 ? (v / cs.revenue[i]) * 100 : NaN)), prevV: pOp.map((v, i) => (ps.revenue[i] > 0 ? (v / ps.revenue[i]) * 100 : NaN)) });
    if (view.rows !== "summary") {
      out.push(secRow("nonop_income", "영업외수익", false, cs.nonop_income, ps.nonop_income, (l) => l.section === "nonop_income"));
      out.push(secRow("nonop_expense", "영업외비용", true, cs.nonop_expense, ps.nonop_expense, (l) => l.section === "nonop_expense"));
      out.push(secRow("tax", "법인세 등", true, cs.tax, ps.tax, (l) => l.section === "tax"));
      out.push({ key: "net", label: "당기순이익", kind: "total", invert: false, v: net, prevV: pNet });
    }
    return out;
  }, [lines, prevLines, view.rows]);

  if (role === "partner") return <AccessDenied detail="월별 표는 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  // ── 열(기간) 묶음 ──
  const groups: { label: string; months: number[] }[] = view.col === "month" ? Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}월`, months: [i] }))
    : view.col === "quarter" ? [0, 1, 2, 3].map((q) => ({ label: `${q + 1}분기`, months: [q * 3, q * 3 + 1, q * 3 + 2] }))
    : [0, 1].map((h) => ({ label: h === 0 ? "상반기" : "하반기", months: Array.from({ length: 6 }, (_, i) => h * 6 + i) }));
  const gsum = (v: number[], g: number[]) => g.reduce((s, i) => s + (Number.isNaN(v[i]) ? 0 : v[i]), 0);
  const revItem = items.find((it) => it.key === "revenue")!;
  const anyNonZero = (gi: number) => items.some((it) => it.kind !== "rate" && gsum(it.v, groups[gi].months) !== 0);
  const shownGroups = groups.map((g, i) => ({ ...g, i })).filter((g) => !view.hl.includes("hidezero") || anyNonZero(g.i));
  const valueOf = (it: Item, gi: number) => (it.kind === "rate" ? (gsum(revItem.v, groups[gi].months) > 0 ? (gsum(items.find((x) => x.key === "op")!.v, groups[gi].months) / gsum(revItem.v, groups[gi].months)) * 100 : NaN) : gsum(it.v, groups[gi].months));
  const prevValueOf = (it: Item, gi: number) => (it.kind === "rate" ? NaN : gsum(it.prevV, groups[gi].months));
  //   비교값은 이번 값이 0(아직 전표 없는 달·미래 달)이면 안 낸다 — "▼100%"가 앞으로의 달마다 찍히면 잡음
  const momOf = (it: Item, gi: number) => { if (gi === 0) return null; const p = valueOf(it, gi - 1), c = valueOf(it, gi); if (!p || !c || Number.isNaN(p) || Number.isNaN(c)) return null; return Math.round(((c - p) / Math.abs(p)) * 100); };
  const yoyOf = (it: Item, gi: number) => { const p = prevValueOf(it, gi), c = valueOf(it, gi); if (!p || !c || Number.isNaN(p) || Number.isNaN(c)) return null; return Math.round(((c - p) / Math.abs(p)) * 100); };
  const shareOf = (it: Item, gi: number) => { const r = gsum(revItem.v, groups[gi].months); const c = valueOf(it, gi); return r > 0 && !Number.isNaN(c) ? Math.round((c / r) * 100) : null; };
  const pctTxt = (p: number | null, invert: boolean, small = false) => p === null ? <span className="text-[var(--text-dim)]">—</span> : <span className={`mono-number ${small ? "" : "font-semibold"} ${p === 0 ? "text-[var(--text-dim)]" : (invert ? p <= 0 : p >= 0) ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{p > 0 ? "▲" : p < 0 ? "▼" : ""}{Math.abs(p)}%</span>;
  const heatCls = (it: Item, gi: number) => { if (!view.hl.includes("heat") || it.kind === "rate") return ""; const p = momOf(it, gi); if (p === null || p === 0) return ""; const good = it.invert ? p < 0 : p > 0; const strong = Math.abs(p) >= 30; return good ? (strong ? "pnl-hm2" : "pnl-hm1") : (strong ? "pnl-hn2" : "pnl-hn1"); };
  const extreme = (it: Item) => { if (!view.hl.includes("minmax") || !(it.key === "revenue" || it.key === "op")) return { max: -1, min: -1 }; const vals = shownGroups.map((g) => valueOf(it, g.i)); if (!vals.some((v) => v !== 0)) return { max: -1, min: -1 }; let max = 0, min = -1; vals.forEach((v, i) => { if (v > vals[max]) max = i; /* 값이 0인 달(자료 없음)은 최저에서 제외 — 데이터 없는 1월이 '최저 달'로 빨갛게 표시되던 문제 (2026-09-03) */ if (v !== 0 && (min < 0 || v < vals[min])) min = i; }); return { max: shownGroups[max].i, min: min < 0 ? -1 : shownGroups[min].i }; };
  const cellMain = (it: Item, gi: number) => {
    if (it.kind === "rate") { const c = valueOf(it, gi); return Number.isNaN(c) ? <span className="text-[var(--text-dim)]">—</span> : Math.abs(c) > 999 ? <span className="mono-number text-[11px] text-[var(--text-dim)]" title="매출이 너무 작아 비율이 뜻이 없습니다">{c < 0 ? "<-999" : ">999"}%</span> : <span className="mono-number text-[11px]">{Math.round(c * 10) / 10}%</span>; }
    if (view.val === "mom") return pctTxt(momOf(it, gi), it.invert);
    if (view.val === "yoy") return pctTxt(yoyOf(it, gi), it.invert);
    if (view.val === "share") { const p = shareOf(it, gi); return p === null ? <span className="text-[var(--text-dim)]">—</span> : <span className="mono-number">{p}%</span>; }
    const c = valueOf(it, gi); return c === 0 ? <span className="text-[var(--text-dim)]">-</span> : <span className={`mono-number ${c < 0 ? "text-[var(--danger)]" : ""}`}>{num(c)}</span>;
  };
  const cellSub = (it: Item, gi: number) => {
    if (view.sub === "none" || it.kind === "rate") return null;
    if (view.sub === "yoyAmt") { const p = prevValueOf(it, gi); return <small className="pnl-cell-sub mono-number">전년 {p === 0 ? "-" : num(p)}</small>; }
    const p = view.sub === "mom" ? momOf(it, gi) : yoyOf(it, gi);
    if (view.val === view.sub) return null;
    return <small className="pnl-cell-sub">{pctTxt(p, it.invert, true)}</small>;
  };
  const totalOf = (it: Item) => (it.kind === "rate" ? (revItem.v.reduce((x, y) => x + y, 0) > 0 ? `${Math.round((items.find((x) => x.key === "op")!.v.reduce((x, y) => x + y, 0) / revItem.v.reduce((x, y) => x + y, 0)) * 1000) / 10}%` : "—") : num(it.v.reduce((x, y) => x + y, 0)));
  const openDrill = (it: Item, gi: number) => { if (!it.f) return; const ms = groups[gi].months.map((mi) => `${year}-${String(mi + 1).padStart(2, "0")}`); setDrill({ title: `${it.label} · ${groups[gi].label}`, lines: lines.filter((l) => ms.includes(l.month) && it.f!(l)) }); };
  const rowCls = (it: Item) => it.kind === "sec" ? "pnl-mx-sec" : it.kind === "sub" ? "pnl-mx-sub" : it.kind === "total" ? "pnl-mx-total-row" : it.kind === "rate" ? "pnl-mx-rate" : "pnl-mx-acct";
  const visibleItems = items.filter((it) => !it.parent || openSec.has(it.parent));
  const acctCount = (key: string) => items.filter((it) => it.parent === key).length;

  // ── 걸린 설정 칩 · 적용 ──
  const apply = (v: View) => { setView(v); setDraft(v); if (v.rows === "all") setOpenSec(new Set(["revenue", "cogs", "opex"])); };
  const chips: AppliedChip[] = [
    ...(view.val !== DEFAULT_VIEW.val ? [{ group: "표시값", label: VAL_LABEL[view.val], onRemove: () => apply({ ...view, val: DEFAULT_VIEW.val }) }] : []),
    ...(view.sub !== DEFAULT_VIEW.sub ? [{ group: "함께", label: SUB_LABEL[view.sub], onRemove: () => apply({ ...view, sub: DEFAULT_VIEW.sub }) }] : []),
    ...(view.col !== DEFAULT_VIEW.col ? [{ group: "열", label: COL_LABEL[view.col], onRemove: () => apply({ ...view, col: DEFAULT_VIEW.col }) }] : []),
    ...(view.dir !== DEFAULT_VIEW.dir ? [{ group: "방향", label: DIR_LABEL[view.dir], onRemove: () => apply({ ...view, dir: DEFAULT_VIEW.dir }) }] : []),
    ...(view.rows !== DEFAULT_VIEW.rows ? [{ group: "행", label: ROWS_LABEL[view.rows], onRemove: () => apply({ ...view, rows: DEFAULT_VIEW.rows }) }] : []),
    ...([...view.hl].sort().join() !== [...DEFAULT_VIEW.hl].sort().join() ? [{ group: "강조", label: view.hl.length ? view.hl.map((h) => HL_LABEL[h]).join(" · ") : "없음", onRemove: () => apply({ ...view, hl: DEFAULT_VIEW.hl }) }] : []),
    ...(!view.cum ? [{ group: "누계", label: "숨김", onRemove: () => apply({ ...view, cum: true }) }] : []),
  ];
  const paramsNow = { view };
  const paramsBasic = { view: DEFAULT_VIEW };
  const excel = [{
    label: `${year}년 월별 표 (지금 보이는 모양)`, count: visibleItems.length,
    onClick: () => downloadCsv(`손익_월별표_${year}`, ["항목", ...shownGroups.map((g) => g.label), ...(view.cum ? ["누계"] : [])],
      visibleItems.map((it) => [it.label, ...shownGroups.map((g) => { const c = valueOf(it, g.i); return it.kind === "rate" ? (Number.isNaN(c) ? "" : Math.round(c * 10) / 10) : Math.round(c); }), ...(view.cum ? [it.kind === "rate" ? totalOf(it) : Math.round(it.v.reduce((x, y) => x + y, 0))] : [])])),
  }];
  const quick = <T extends string>(cur: T, opts: [T, string][], set: (v: T) => void) => (
    <span className="qk-quicks">{opts.map(([v, l]) => <button key={v} type="button" onClick={() => set(v)} className={cur === v ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span>
  );

  return (
    <>
      <ReportHead
        bar={<>
          <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs">
            {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          {/* 보기 설정 — 표시값·함께 보기·열 묶음·방향·행 구성·강조·누계 (검색조건 문법: 고르고 → 적용) */}
          <ConditionPanel label="보기 설정" open={panelOpen} onOpenChange={(v) => { if (v) setDraft(view); setPanelOpen(v); }} activeCount={viewCount(view)}
            tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
              onApply={(sv) => { const v = { ...DEFAULT_VIEW, ...((sv.params?.view as Partial<View>) || {}) }; apply(v); setPanelOpen(false); }}
              onBasic={() => { apply(DEFAULT_VIEW); }} onRemove={saved.remove} onSetDefault={saved.setDefault} />}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft(DEFAULT_VIEW)}>기본으로</button>
              <ConditionSave suggest={() => [VAL_LABEL[draft.val], draft.sub !== "none" ? `+${SUB_LABEL[draft.sub]}` : "", COL_LABEL[draft.col].split(" ")[0], draft.dir === "tall" ? "세로" : ""].filter(Boolean).join(" · ").slice(0, 30)}
                onSave={(name, asDefault) => { saved.save(name, { view: draft }, asDefault); apply(draft); setPanelOpen(false); }} />
              <span className="ml-auto" />
              <button type="button" className="btn-primary btn-sm" onClick={() => { apply(draft); setPanelOpen(false); }}>적용</button>
            </>}>
            <ConditionRow label="표시값" hint="셀에 크게 보이는 것">{quick(draft.val, [["amount", "금액"], ["mom", "전월비 %"], ["yoy", "전년동월 %"], ["share", "매출 대비 %"]], (v) => setDraft((d) => ({ ...d, val: v })))}</ConditionRow>
            <ConditionRow label="함께 보기" hint="셀 아래 작은 글씨">{quick(draft.sub, [["none", "없음"], ["mom", "전월비 %"], ["yoy", "전년동월 %"], ["yoyAmt", "전년 금액"]], (v) => setDraft((d) => ({ ...d, sub: v })))}</ConditionRow>
            <ConditionRow label="열 묶음">{quick(draft.col, [["month", "월 (12)"], ["quarter", "분기 (4)"], ["half", "반기 (2)"]], (v) => setDraft((d) => ({ ...d, col: v })))}</ConditionRow>
            <ConditionRow label="방향">{quick(draft.dir, [["wide", "가로 (항목↓ 월→)"], ["tall", "세로 (월↓ 항목→)"]], (v) => setDraft((d) => ({ ...d, dir: v })))}</ConditionRow>
            <ConditionRow label="행 구성">{quick(draft.rows, [["summary", "요약 4줄"], ["opex", "판관비 계정 펼침"], ["all", "전 계정 펼침"]], (v) => setDraft((d) => ({ ...d, rows: v })))}</ConditionRow>
            <ConditionRow label="강조" hint="여러 개">
              <span className="qk-quicks">{Object.entries(HL_LABEL).map(([k, l]) => <button key={k} type="button" onClick={() => setDraft((d) => ({ ...d, hl: d.hl.includes(k) ? d.hl.filter((x) => x !== k) : [...d.hl, k] }))} className={draft.hl.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span>
            </ConditionRow>
            <ConditionRow label="누계 열">{quick(draft.cum ? "y" : "n", [["y", "보이기"], ["n", "숨김"]], (v) => setDraft((d) => ({ ...d, cum: v === "y" })))}</ConditionRow>
          </ConditionPanel>
          <span className="text-[11px] text-[var(--text-dim)]">셀을 누르면 그 기간 그 항목의 원천 전표 · 확정 전표 기준</span>
        </>}
        right={<><ExcelMenu items={excel} /><button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button></>}
        stats={<>
          <Stat label={`${year}년 매출`} value={won(revItem?.v.reduce((x, y) => x + y, 0) || 0)} />
          <Stat label="판관비" value={won(items.find((x) => x.key === "opex")?.v.reduce((x, y) => x + y, 0) || 0)} />
          <Stat label="영업이익" tone={(items.find((x) => x.key === "op")?.v.reduce((x, y) => x + y, 0) || 0) >= 0 ? "plus" : "minus"} value={won(items.find((x) => x.key === "op")?.v.reduce((x, y) => x + y, 0) || 0)} />
          {(() => { const ex = extreme(items.find((x) => x.key === "op")!); return ex.max >= 0 ? <><Stat label={view.col === "month" ? "최고 달" : "최고 기간"} value={`${groups[ex.max].label} ${won(valueOf(items.find((x) => x.key === "op")!, ex.max))}`} tone="plus" /><Stat label={view.col === "month" ? "최저 달" : "최저 기간"} value={`${groups[ex.min].label} ${won(valueOf(items.find((x) => x.key === "op")!, ex.min))}`} tone="minus" /></> : null; })()}
        </>}
      />
      <AppliedChips chips={chips} onClearAll={() => apply(DEFAULT_VIEW)} />

      {isLoading ? <div className="collect-empty">불러오는 중…</div> : lines.length === 0 ? (
        <div className="collect-empty">{year}년 확정 전표가 없습니다 — 수집·전표에서 전표를 만들면 여기 표가 채워집니다</div>
      ) : view.dir === "wide" ? (
        <div className="pnl-tbl-wrap">
          <table className="ev-table ev-lined pnl-mx-table" style={{ minWidth: shownGroups.length > 6 ? 1180 : 760 }}>
            <thead><tr><th className="text-left">항목</th>{shownGroups.map((g) => <th key={g.i}>{g.label}</th>)}{view.cum && <th>누계</th>}</tr></thead>
            <tbody>
              {visibleItems.map((it) => {
                const ex = extreme(it);
                return (
                  <tr key={it.key} className={`${rowCls(it)} ${it.kind === "sec" && acctCount(it.key) > 0 ? "pnl-mx-toggle" : ""}`} onClick={it.kind === "sec" && acctCount(it.key) > 0 ? () => setOpenSec((o) => { const n = new Set(o); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n; }) : undefined}>
                    <td className={`text-left pnl-mx-label ${it.indent ? "pl-7" : ""}`}>
                      {it.kind === "sec" && acctCount(it.key) > 0 && <span className={`bs-caret ${openSec.has(it.key) ? "rotate-90" : ""}`}>▸</span>}
                      {it.label}{it.code && <small className="ml-1 text-[var(--text-dim)]">{it.code}</small>}
                      {it.kind === "sec" && acctCount(it.key) > 0 && <em className="bs-cnt">{acctCount(it.key)}</em>}
                    </td>
                    {shownGroups.map((g) => (
                      <td key={g.i} className={`text-right ${it.f ? "pnl-mx-click" : ""} ${heatCls(it, g.i)} ${g.i === ex.max ? "pnl-mx-max" : g.i === ex.min ? "pnl-mx-min" : ""}`}
                        onClick={it.f ? (e) => { e.stopPropagation(); openDrill(it, g.i); } : undefined}>
                        {cellMain(it, g.i)}{cellSub(it, g.i)}
                      </td>
                    ))}
                    {view.cum && <td className="text-right pnl-mx-total"><b className="mono-number">{totalOf(it)}</b></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pnl-tbl-wrap">
          <table className="ev-table ev-lined pnl-mx-table" style={{ minWidth: 760 }}>
            <thead><tr><th className="text-left">{view.col === "month" ? "월" : view.col === "quarter" ? "분기" : "반기"}</th>{visibleItems.filter((it) => it.kind !== "acct").map((it) => <th key={it.key}>{it.label}</th>)}</tr></thead>
            <tbody>
              {shownGroups.map((g) => (
                <tr key={g.i} className="pnl-mx-tall-row">
                  <td className="text-left pnl-mx-label">{g.label}</td>
                  {visibleItems.filter((it) => it.kind !== "acct").map((it) => {
                    const ex = extreme(it);
                    return <td key={it.key} className={`text-right ${it.f ? "pnl-mx-click" : ""} ${heatCls(it, g.i)} ${g.i === ex.max ? "pnl-mx-max" : g.i === ex.min ? "pnl-mx-min" : ""} ${it.kind === "total" ? "font-bold" : ""}`} onClick={it.f ? () => openDrill(it, g.i) : undefined}>{cellMain(it, g.i)}{cellSub(it, g.i)}</td>;
                  })}
                </tr>
              ))}
              {view.cum && (
                <tr className="pnl-mx-total-row"><td className="text-left pnl-mx-label">누계</td>{visibleItems.filter((it) => it.kind !== "acct").map((it) => <td key={it.key} className="text-right mono-number">{totalOf(it)}</td>)}</tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-[var(--text-dim)]">
        {view.hl.includes("heat") && <>초록/빨강 농도 = 전월비(비용은 늘면 빨강, ±30% 이상 진하게) · </>}{view.hl.includes("minmax") && <>테두리 = 매출·영업이익의 최고(파랑)·최저(빨강) 기간 · </>}
        현금 흐름(수입·지출·부가세·통장 잔액) 월별 표는 <a href="/reports/flow" className="text-[var(--primary)] font-semibold">경영 흐름 › 월별 표(1년치)</a>에 있습니다.
      </p>
      <DrillModal drill={drill} onClose={() => setDrill(null)} />
    </>
  );
}
