"use client";

// 자금 전망 › 예정 항목 — 앞으로 들어올 돈·나갈 돈을 날짜대로 한 표에 (2026-08-19 재편, docs/20260819_PLAN_summary_outlook_redesign.md).
//   2026-07-08 '예정 지출'(세금·대출·고정비·미지급 5줄 나열) → 조회 표준 표: 날짜·항목·구분·금액·그때 잔액·근거·확실도·상태.
//   검색조건(구분·확실도·금액) · 빠른검색 · 보기 칩(전체/들어올 돈/나갈 돈) · 쪽 50. 줄 클릭 → 원천. 계산은 lib/cash-outlook.ts (전망과 같은 항목).

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportHead } from "../_components/ReportHead";
import { ConditionPanel, ConditionRow, ChipGroup, QuickSearch, quickSearchHit, Stat, ExcelMenu, AppliedChips, Pager, usePager, type AppliedChip } from "@/components/query-kit";
import { downloadCsv } from "@/lib/csv-export";
import { fetchOutlook, buildCurve, type ItemKind, type OutlookItem } from "@/lib/cash-outlook";

const won = (n: number) => `${n < 0 ? "−" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const KINDS: ItemKind[] = ["매출 입금", "계약 회차", "급여", "정기 지출", "대출 상환", "세금", "매입 지급", "계약 지출", "결재 대기"];
type Dir = "all" | "in" | "out";
type Cond = { kinds: ItemKind[]; sure: ("확정" | "추정")[]; minAmt: string };
const COND0: Cond = { kinds: [], sure: [], minAmt: "" };

export default function UpcomingPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [days, setDays] = useState<number>(90);
  const [dir, setDir] = useState<Dir>("all");
  const [q, setQ] = useState("");
  const [cond, setCond] = useState<Cond>(COND0);
  const [draft, setDraft] = useState<Cond>(COND0);
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } }); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["cash-outlook", companyId, days],
    queryFn: () => fetchOutlook(companyId!, days, userId || undefined),
    enabled: !!companyId, staleTime: 60_000,
  });
  //   그때 잔액 — 전망 곡선과 같은 계산
  const balAt = useMemo(() => { const m = new Map<string, number>(); if (data) for (const p of buildCurve(data, days).points) m.set(p.date, p.balance); return m; }, [data, days]);
  const rows = useMemo(() => {
    const min = Number(cond.minAmt.replace(/[^0-9]/g, "")) || 0;
    return (data?.items || []).filter((it) =>
      (dir === "all" || (dir === "in" ? it.amount > 0 : it.amount < 0)) &&
      (cond.kinds.length === 0 || cond.kinds.includes(it.kind)) &&
      (cond.sure.length === 0 || cond.sure.includes(it.sure)) &&
      Math.abs(it.amount) >= min &&
      quickSearchHit(q, [it.label, it.kind, it.basis, it.flag], [it.amount]));
  }, [data, dir, cond, q]);
  const pager = usePager(rows, 50, `${dir}|${q}|${JSON.stringify(cond)}|${days}`);

  if (role === "partner") return <AccessDenied detail="예정 항목은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const inflow = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const sureRate = rows.length ? Math.round((rows.filter((r) => r.sure === "확정").length / rows.length) * 100) : 0;
  const apply = (c: Cond) => { setCond(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...(cond.kinds.length ? [{ group: "구분", label: cond.kinds.join(" · "), onRemove: () => apply({ ...cond, kinds: [] }) }] : []),
    ...(cond.sure.length ? [{ group: "확실도", label: cond.sure.join(" · "), onRemove: () => apply({ ...cond, sure: [] }) }] : []),
    ...(cond.minAmt ? [{ group: "금액", label: `${Number(cond.minAmt.replace(/[^0-9]/g, "")).toLocaleString()} 이상`, onRemove: () => apply({ ...cond, minAmt: "" }) }] : []),
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
  ];
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const excel = [{ label: `예정 항목 ${rows.length}건`, count: rows.length, onClick: () => downloadCsv(`예정항목_${days}일`, ["날짜", "항목", "구분", "금액", "그때 잔액", "근거", "확실도", "상태"], rows.map((r) => [r.date, r.label, r.kind, Math.round(r.amount), balAt.get(r.date) ?? "", r.basis, r.sure, r.flag || ""])) }];
  const minDate = data ? buildCurve(data, days).min.date : "";

  return (
    <>
      <ReportHead
        bar={<>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="기간">
            {[30, 90, 180].map((h) => <option key={h} value={h}>앞으로 {h}일</option>)}
          </select>
          <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setDraft(cond); setPanelOpen(v); }} activeCount={chips.filter((c) => c.group !== "빠른검색").length}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft(COND0)}>기본으로</button>
              <span className="ml-auto" />
              <button type="button" className="btn-primary btn-sm" onClick={() => { apply(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="구분" hint="여러 개">
              <span className="qk-quicks">{KINDS.map((k) => <button key={k} type="button" onClick={() => setDraft((d) => ({ ...d, kinds: toggle(d.kinds, k) }))} className={draft.kinds.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{k}</button>)}</span>
            </ConditionRow>
            <ConditionRow label="확실도">
              <span className="qk-quicks">{(["확정", "추정"] as const).map((k) => <button key={k} type="button" onClick={() => setDraft((d) => ({ ...d, sure: toggle(d.sure, k) }))} className={draft.sure.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{k}</button>)}</span>
            </ConditionRow>
            <ConditionRow label="금액" hint="이상"><input className="qk-input h-8 w-40 px-2 text-xs" inputMode="numeric" placeholder="예: 1,000,000" value={draft.minAmt} onChange={(e) => setDraft((d) => ({ ...d, minAmt: e.target.value }))} /></ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="빠른검색 — 항목·구분·근거·금액 (쉼표=또는)" />
          <ChipGroup value={dir} onChange={setDir} options={[{ value: "all", label: `전체 ${data?.items.length ?? 0}` }, { value: "in", label: `들어올 돈 ${data?.items.filter((i) => i.amount > 0).length ?? 0}` }, { value: "out", label: `나갈 돈 ${data?.items.filter((i) => i.amount < 0).length ?? 0}` }] as const} />
        </>}
        right={<ExcelMenu items={excel} />}
        stats={<>
          <Stat label="들어올 돈" value={won(inflow)} tone="plus" />
          <Stat label="나갈 돈" value={won(outflow)} tone="minus" />
          <Stat label="순" value={won(inflow - outflow)} tone={inflow - outflow >= 0 ? "plus" : "minus"} />
          <Stat label="확정 비율" value={`${sureRate}%`} />
          <Stat label="건수" value={rows.length.toLocaleString()} />
        </>}
      />
      <AppliedChips chips={chips} onClearAll={() => { apply(COND0); setQ(""); }} />

      {isLoading || !data ? <div className="collect-empty">불러오는 중…</div> : rows.length === 0 ? (
        <div className="collect-empty">{data.items.length === 0 ? `앞으로 ${days}일 안에 날짜가 있는 예정 항목이 없습니다 — 세금계산서·급여·대출·정기 지출을 등록하면 여기 쌓입니다` : "조건에 맞는 항목이 없습니다"}</div>
      ) : (
        <>
          <div className="pnl-tbl-wrap">
            <table className="ev-table ev-lined ol-items-table">
              <thead><tr><th>날짜</th><th className="text-left">항목</th><th>구분</th><th>금액</th><th>그때 잔액</th><th>근거</th><th>확실도</th><th>상태</th></tr></thead>
              <tbody>
                {pager.view.map((it: OutlookItem) => {
                  const bal = balAt.get(it.date);
                  return (
                    <tr key={it.id} className={it.href ? "pnl-row-acct" : ""} onClick={() => it.href && (window.location.href = it.href)}>
                      <td className="text-center mono-number">{md(it.date)}<small className="ml-1 text-[var(--text-dim)]">{it.date.slice(0, 4)}</small></td>
                      <td className="text-left font-semibold">{it.label}</td>
                      <td className="text-center">{it.kind}</td>
                      <td className={`text-right mono-number font-bold ${it.amount >= 0 ? "bz-plus" : "bz-minus"}`}>{it.amount >= 0 ? "+" : "−"}{Math.abs(Math.round(it.amount)).toLocaleString()}</td>
                      <td className={`text-right mono-number ${bal !== undefined && bal < 0 ? "bz-minus" : it.date === minDate ? "bz-tone-y font-bold" : ""}`}>{bal !== undefined ? Math.round(bal).toLocaleString() : "—"}</td>
                      <td className="text-center text-[var(--text-muted)]">{it.basis}</td>
                      <td className="text-center"><span className={it.sure === "확정" ? "ol-sure ol-sure-ok" : "ol-sure ol-sure-est"}>{it.sure}</span></td>
                      <td className="text-center">{it.date === minDate ? <span className="ol-sure ol-sure-est">최저점</span> : it.flag ? <span className="ol-sure">{it.flag}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pager.page} pages={pager.pages} total={rows.length} from={pager.from} to={pager.to} size={50} onPage={pager.setPage} />
          <p className="mt-2 text-[11px] text-[var(--text-dim)]">'그때 잔액'은 오늘 잔액에서 그날까지 예정을 반영한 값(전망 곡선과 같음). 30일 넘은 미수·발행 30일 지난 미지급은 날짜를 몰라 여기 없습니다 — 전망의 '틀릴 수 있는 곳'.</p>
        </>
      )}
    </>
  );
}
