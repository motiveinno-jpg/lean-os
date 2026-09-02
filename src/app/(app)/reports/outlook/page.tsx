"use client";

// 자금 전망 › 전망 — "앞으로 돈 괜찮아?" (2026-07-08 신설: 직선 전망 D+7/30/60/90 + ±10% 시나리오 3칸 →
//   2026-08-19 재편, docs/20260819_PLAN_summary_outlook_redesign.md)
//   오늘 잔액에서 날짜 있는 예정 항목을 빼고 더한 잔액 곡선(실선) + 지금 속도 직선(점선, 예전 방식) + 시나리오 곡선(주황).
//   13주 자금 달력 · 틀릴 수 있는 곳(자동으로 못 푸는 것을 적는다) · 운영 가능 기간. 계산은 lib/cash-outlook.ts.
//   시나리오는 '보기 설정' 문법(ConditionPanel label) — 고르고 → 적용, 걸린 칩, 기본으로. 실제 숫자는 안 바뀐다.

import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportHead } from "../_components/ReportHead";
import { ConditionPanel, ConditionRow, Stat, ExcelMenu, AppliedChips, type AppliedChip } from "@/components/query-kit";
import { downloadCsv } from "@/lib/csv-export";
import { fetchOutlook, buildCurve, linearBalance, weekBuckets, runwayFromCurve, scenarioActive, SCENARIO_DEFAULT, addDays, type Scenario, type OutlookItem } from "@/lib/cash-outlook";
import { calcRunwayMonths } from "@/lib/engines";
import { LineChart, Legend } from "@/components/charts/kit";

const won = (n: number) => `${n < 0 ? "−" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
const man = (n: number) => { const a = Math.abs(n), sg = n < 0 ? "−" : ""; return a >= 1e8 ? `${sg}${(a / 1e8).toFixed(1)}억` : `${sg}${Math.round(a / 10000).toLocaleString("ko-KR")}만`; };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const HORIZONS = [30, 90, 180] as const;

export default function OutlookPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [days, setDays] = useState<number>(90);
  const [sc, setSc] = useState<Scenario>(SCENARIO_DEFAULT);
  const [draft, setDraft] = useState<Scenario>(SCENARIO_DEFAULT);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pick, setPick] = useState<{ title: string; items: OutlookItem[] } | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } }); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["cash-outlook", companyId, days],
    queryFn: () => fetchOutlook(companyId!, days, userId || undefined),
    enabled: !!companyId, staleTime: 60_000,
  });
  const base = useMemo(() => (data ? buildCurve(data, days) : null), [data, days]);
  const scen = useMemo(() => (data && scenarioActive(sc) ? buildCurve(data, days, sc) : null), [data, days, sc]);
  const weeks = useMemo(() => (base ? weekBuckets(base) : []), [base]);

  if (role === "partner") return <AccessDenied detail="자금 전망은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const apply = (v: Scenario) => { setSc(v); setDraft(v); };
  const chips: AppliedChip[] = [
    ...(sc.spendPct !== 0 ? [{ group: "지출", label: `${sc.spendPct > 0 ? "+" : ""}${sc.spendPct}%`, onRemove: () => apply({ ...sc, spendPct: 0 }) }] : []),
    ...(sc.delayDays !== 0 ? [{ group: "입금 지연", label: `${sc.delayDays}일`, onRemove: () => apply({ ...sc, delayDays: 0 }) }] : []),
    ...(sc.recoveryPct !== 0 ? [{ group: "미수 회수율", label: `${sc.recoveryPct}%`, onRemove: () => apply({ ...sc, recoveryPct: 0 }) }] : []),
    ...(sc.extraIn ? [{ group: "추가 자금", label: `${won(sc.extraIn.amount)} · ${md(sc.extraIn.date)}`, onRemove: () => apply({ ...sc, extraIn: null }) }] : []),
    ...(sc.extraOut ? [{ group: "큰 지출", label: `${won(sc.extraOut.amount)} · ${md(sc.extraOut.date)}`, onRemove: () => apply({ ...sc, extraOut: null }) }] : []),
  ];
  const quick = <T extends string | number>(cur: T, opts: [T, string][], set: (v: T) => void) => (
    <span className="qk-quicks">{opts.map(([v, l]) => <button key={String(v)} type="button" onClick={() => set(v)} className={cur === v ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span>
  );
  const runwayNow = data ? calcRunwayMonths(data.balance, 0, 0, data.burn) : 0;
  const rw = (m: number) => (m >= 999 ? "무기한" : `${m.toFixed(1)}개월`);
  const excel = base ? [{
    label: `잔액 곡선 ${days}일 (날짜별)`, count: base.points.length,
    onClick: () => downloadCsv(`자금전망_${days}일`, ["날짜", "예정 잔액", ...(scen ? ["시나리오 잔액"] : []), "지금 속도 직선", "그날 항목"],
      base.points.map((p, i) => [p.date, p.balance, ...(scen ? [scen.points[i]?.balance ?? ""] : []), linearBalance(data!.balance, data!.burn, p.day), p.items.map((it) => `${it.label} ${Math.round(it.amount)}`).join(" / ")])),
  }] : [];

  // ── 곡선 — 차트 키트 LineChart(축 글자는 HTML 이라 화면 폭에 안 늘어난다) · 큰 건은 그림 아래 칩으로 ──
  const big = base && data ? base.points.filter((p) => p.items.length).map((p) => ({ p, sum: p.items.reduce((s, it) => s + it.amount, 0) }))
    .filter((b) => Math.abs(b.sum) >= Math.max(1, data.balance * 0.05)).sort((a, b) => a.p.day - b.p.day).slice(0, 8) : [];
  const chart = base && data ? (
    <>
      <LineChart height={220} yFmt={(n) => `${man(n)}`}
        series={[
          { name: "예정 반영", points: base.points.map((p) => ({ label: p.day === 0 ? "오늘" : md(p.date), value: p.balance })) },
          { name: "지금 속도", points: base.points.map((p) => ({ label: p.day === 0 ? "오늘" : md(p.date), value: linearBalance(data.balance, data.burn, p.day) })) },
          ...(scen ? [{ name: "시나리오", points: scen.points.map((p) => ({ label: p.day === 0 ? "오늘" : md(p.date), value: p.balance })) }] : []),
        ]}
        styles={["solid", "dashed", "dotted"]} colors={["var(--primary)", "var(--text-dim)", "var(--warning)"]} />
      <Legend items={[{ name: "예정 반영 (실선)", color: "var(--primary)" }, { name: "지금 속도 직선 (점선)", color: "var(--text-dim)" }, ...(scen ? [{ name: "시나리오", color: "var(--warning)" }] : [])]} />
      <div className="ol-marks">
        <button type="button" className="ol-mark-chip ol-mark-min" onClick={() => setPick({ title: `${base.min.date} 최저점`, items: base.min.items })}>최저 {md(base.min.date)} <b className="mono-number">{man(base.min.balance)}</b></button>
        {big.filter(({ p }) => p.day !== base.min.day).map(({ p, sum }) => (
          <button type="button" key={p.date} className={`ol-mark-chip ${sum < 0 ? "ol-mark-out" : "ol-mark-in"}`} onClick={() => setPick({ title: `${p.date} 예정`, items: p.items })}>
            {md(p.date)} {p.items.length === 1 ? p.items[0].label.slice(0, 14) : `${p.items.length}건`} <b className="mono-number">{sum > 0 ? "+" : ""}{man(sum)}</b>
          </button>
        ))}
      </div>
    </>
  ) : null;

  return (
    <>
      <ReportHead
        bar={<>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="기간">
            {HORIZONS.map((h) => <option key={h} value={h}>앞으로 {h}일</option>)}
          </select>
          <ConditionPanel label="시나리오" open={panelOpen} onOpenChange={(v) => { if (v) setDraft(sc); setPanelOpen(v); }} activeCount={chips.length}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft(SCENARIO_DEFAULT)}>기본으로</button>
              <span className="ml-auto" />
              <button type="button" className="btn-primary btn-sm" onClick={() => { apply(draft); setPanelOpen(false); }}>적용</button>
            </>}>
            <ConditionRow label="지출 변화" hint="급여·정기 지출·대출에">
              <span className="ol-range"><input type="range" min={-30} max={30} step={5} value={draft.spendPct} onChange={(e) => setDraft((d) => ({ ...d, spendPct: Number(e.target.value) }))} /><b className="mono-number">{draft.spendPct > 0 ? "+" : ""}{draft.spendPct}%</b></span>
            </ConditionRow>
            <ConditionRow label="입금 지연" hint="매출 입금·계약 회차">{quick(draft.delayDays, [[0, "없음"], [15, "15일"], [30, "30일"], [60, "60일"]], (v) => setDraft((d) => ({ ...d, delayDays: v })))}</ConditionRow>
            <ConditionRow label="미수 회수율" hint={data && data.arOver30 > 0 ? `30일 넘은 미수 ${won(data.arOver30)} 중 · 오늘+30일에 한 번` : "30일 넘은 미수금이 없습니다"}>
              <span className="ol-range"><input type="range" min={0} max={100} step={10} value={draft.recoveryPct} disabled={!data || data.arOver30 <= 0} onChange={(e) => setDraft((d) => ({ ...d, recoveryPct: Number(e.target.value) }))} /><b className="mono-number">{draft.recoveryPct}%</b></span>
            </ConditionRow>
            <ConditionRow label="추가 자금" hint="대표 가수금·대출 실행 등 한 건">
              <span className="ol-extra">
                <input type="number" className="qk-input" placeholder="금액" value={draft.extraIn?.amount || ""} onChange={(e) => setDraft((d) => ({ ...d, extraIn: { date: d.extraIn?.date || addDays(data?.today || "2026-01-01", 30), label: d.extraIn?.label || "추가 자금", amount: Number(e.target.value) } }))} />
                <DateField className="qk-input" value={draft.extraIn?.date || ""} onChange={(e) => setDraft((d) => ({ ...d, extraIn: { amount: d.extraIn?.amount || 0, label: d.extraIn?.label || "추가 자금", date: e.target.value } }))} />
                <input type="text" className="qk-input" placeholder="이름" value={draft.extraIn?.label || ""} onChange={(e) => setDraft((d) => ({ ...d, extraIn: { amount: d.extraIn?.amount || 0, date: d.extraIn?.date || "", label: e.target.value } }))} />
                {draft.extraIn && <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft((d) => ({ ...d, extraIn: null }))}>지움</button>}
              </span>
            </ConditionRow>
            <ConditionRow label="큰 지출" hint="장비 구입·미지급 정산 등 한 건">
              <span className="ol-extra">
                <input type="number" className="qk-input" placeholder="금액" value={draft.extraOut?.amount || ""} onChange={(e) => setDraft((d) => ({ ...d, extraOut: { date: d.extraOut?.date || addDays(data?.today || "2026-01-01", 30), label: d.extraOut?.label || "큰 지출", amount: Number(e.target.value) } }))} />
                <DateField className="qk-input" value={draft.extraOut?.date || ""} onChange={(e) => setDraft((d) => ({ ...d, extraOut: { amount: d.extraOut?.amount || 0, label: d.extraOut?.label || "큰 지출", date: e.target.value } }))} />
                <input type="text" className="qk-input" placeholder="이름" value={draft.extraOut?.label || ""} onChange={(e) => setDraft((d) => ({ ...d, extraOut: { amount: d.extraOut?.amount || 0, date: d.extraOut?.date || "", label: e.target.value } }))} />
                {draft.extraOut && <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft((d) => ({ ...d, extraOut: null }))}>지움</button>}
              </span>
            </ConditionRow>
            <p className="ol-panel-note">시나리오는 곡선을 하나 더 그릴 뿐 실제 숫자는 바뀌지 않습니다.</p>
          </ConditionPanel>
          <span className="text-[11px] text-[var(--text-dim)]">실선 = 예정 항목 반영 · 점선 = 지금 속도 직선 · 주황 = 시나리오</span>
        </>}
        right={<><ExcelMenu items={excel} /><button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button></>}
        stats={data && base ? <>
          <Stat label="오늘" value={won(data.balance)} />
          <Stat label={`${days}일 뒤`} value={won(base.end)} tone={base.end >= 0 ? undefined : "minus"} />
          <Stat label="최저점" value={<>{won(base.min.balance)} <small className="font-normal text-[var(--text-dim)]">{md(base.min.date)}</small></>} tone={base.min.balance < 0 ? "minus" : undefined} />
          <Stat label="부족 시점" value={base.shortfall ? md(base.shortfall.date) : "없음"} tone={base.shortfall ? "minus" : "plus"} />
          {scen && <Stat label="시나리오 최저" value={<>{won(scen.min.balance)} <small className="font-normal text-[var(--text-dim)]">{md(scen.min.date)}</small></>} tone={scen.min.balance < 0 ? "minus" : undefined} />}
          <Stat label="운영 가능" value={rw(runwayFromCurve(base, days))} />
        </> : <span className="text-[11px] text-[var(--text-dim)]">불러오는 중…</span>}
      />
      <AppliedChips chips={chips} onClearAll={() => apply(SCENARIO_DEFAULT)} />

      {isLoading || !data || !base ? <div className="collect-empty">불러오는 중…</div> : (
        <div className="bz-body">
          <div className="pnl-basis-note">
            <b>오늘 통장 잔액 + 날짜 있는 예정 항목 {data.items.length}건</b> — 세금계산서(발행+30일)·급여·대출·정기 지출·부가세·계약 회차·결재 대기. 확정 {data.items.filter((i) => i.sure === "확정").length}건 · 추정 {data.items.filter((i) => i.sure === "추정").length}건.
            {data.gaps.length > 0 && <> 틀릴 수 있는 곳 <b className="text-[var(--warning)]">{data.gaps.length}</b>가지는 아래에.</>}
          </div>
          <div className="pnl-headline">
            <b>
              {base.shortfall
                ? `${md(base.shortfall.date)}에 통장이 마이너스가 됩니다 — 그날까지 ${man(Math.abs(base.min.balance))} 모자랍니다.`
                : `${days}일 안에는 통장이 마이너스가 되지 않습니다 — 가장 낮을 때는 ${md(base.min.date)} ${man(base.min.balance)}.`}
              {scen && (scen.shortfall ? ` 시나리오대로면 ${md(scen.shortfall.date)}에 모자랍니다.` : ` 시나리오대로도 ${days}일 안에는 버팁니다.`)}
            </b>
            <div className="pnl-headline-sub">오늘 {man(data.balance)} → {days}일 뒤 {man(base.end)} · 지금 속도(월 {man(data.burn)}원)로는 {rw(runwayNow)} · 예정 반영 {rw(runwayFromCurve(base, days))}</div>
          </div>
          <section className="pnl-panel">
            <h3>잔액 곡선 — 오늘부터 {days}일</h3>
            <p>{!data.hasBank ? "통장이 연결돼 있지 않아 오늘 잔액이 0 입니다. " : ""}선 위에 손을 올리면 그날 잔액. 아래 칩은 큰 예정 건·최저점 — 누르면 그날 항목. 예정 항목 {data.items.length}건 반영.</p>
            {chart}
          </section>

          <section className="pnl-panel">
            <h3>자금 달력 — 주 단위 {weeks.length}주</h3>
            <p>한 칸 = 한 주(월요일 시작). 들어올 돈 · 나갈 돈 · 주말 잔액(만원). 빨간 칸은 최저 주. 칸을 누르면 그 주 항목.</p>
            <div className="ol-cal">
              {weeks.map((w, i) => (
                <button type="button" key={w.start} className={`ol-wk ${w.low ? "ol-wk-low" : ""} ${i === 0 ? "ol-wk-now" : ""}`} onClick={() => setPick({ title: `${w.start} 주 예정`, items: w.items })}>
                  <b>{md(w.start)}</b>
                  <span className="ol-wk-in mono-number">{w.inflow ? `+${man(w.inflow)}` : "—"}</span>
                  <span className="ol-wk-out mono-number">{w.outflow ? `−${man(w.outflow)}` : "—"}</span>
                  <b className={`mono-number ${w.end < 0 ? "bz-minus" : ""}`}>{man(w.end)}</b>
                </button>
              ))}
            </div>
          </section>

          <div className="bz-grid2">
            <section className="pnl-panel">
              <h3>이 전망이 틀릴 수 있는 곳</h3>
              <p>자동으로 못 푸는 것은 사람에게 — 고치러 가는 길을 같이 적습니다.</p>
              {data.gaps.length === 0 ? <div className="collect-empty">지금은 없습니다</div> : (
                <ul className="ol-gaps">{data.gaps.map((g) => <li key={g.key}><span>{g.text}</span><Link href={g.href} className="bz-link">고치기 →</Link></li>)}</ul>
              )}
            </section>
            <section className="pnl-panel">
              <h3>운영 가능 기간</h3>
              <p>지금 속도 · 예정 반영 · 시나리오별. 부족이 예상되면 빨갛게.</p>
              <dl className="bz-kv">
                <div><dt>지금 속도 (월 지출 {man(data.burn)}원 직선)</dt><dd className="mono-number">{rw(runwayNow)}</dd></div>
                <div><dt>예정 항목 반영 (부가세·급여·대출 날짜대로)</dt><dd className={`mono-number ${base.shortfall ? "bz-minus" : ""}`}>{rw(runwayFromCurve(base, days))}</dd></div>
                {scen && <div><dt>시나리오 ({chips.map((c) => `${c.group} ${c.label}`).join(" · ")})</dt><dd className={`mono-number ${scen.shortfall ? "bz-minus" : "bz-tone-y"}`}>{rw(runwayFromCurve(scen, days))}</dd></div>}
                {data.arOver30 > 0 && <div><dt>30일 넘은 미수 전부 회수되면</dt><dd className="mono-number bz-plus">{rw(runwayFromCurve(buildCurve(data, days, { ...SCENARIO_DEFAULT, recoveryPct: 100 }), days))}</dd></div>}
              </dl>
              <p className="bz-why">'예정 항목 반영'은 {days}일 안에 부족이 없으면 그 기간 평균 소진 속도로 늘려 본 값입니다. 항목은 <Link href="/reports/upcoming" className="bz-link">예정 항목 →</Link></p>
            </section>
          </div>
        </div>
      )}

      {pick && (
        <div className="approval-detail-modal" onClick={() => setPick(null)}>
          <div className="pnl-drill ol-pick" onClick={(e) => e.stopPropagation()}>
            <div className="pnl-drill-head"><h3 className="text-sm font-bold">{pick.title}</h3><button type="button" className="btn-secondary btn-sm" onClick={() => setPick(null)}>닫기</button></div>
            {pick.items.length === 0 ? <div className="collect-empty">이 날엔 예정 항목이 없습니다</div> : (
              <div className="pnl-drill-body"><table className="ev-table ev-lined pnl-mini-table">
                <thead><tr><th>날짜</th><th className="text-left">항목</th><th>구분</th><th>금액</th><th>근거</th><th>확실도</th></tr></thead>
                <tbody>{pick.items.map((it) => (
                  <tr key={it.id} className={it.href ? "pnl-row-acct" : ""} onClick={() => it.href && (window.location.href = it.href)}>
                    <td className="text-center mono-number">{md(it.date)}</td><td className="text-left">{it.label}</td><td className="text-center">{it.kind}</td>
                    <td className={`text-right mono-number font-bold ${it.amount >= 0 ? "bz-plus" : "bz-minus"}`}>{it.amount >= 0 ? "+" : "−"}{Math.abs(Math.round(it.amount)).toLocaleString()}</td>
                    <td className="text-center text-[var(--text-muted)]">{it.basis}</td><td className="text-center"><span className={it.sure === "확정" ? "ol-sure ol-sure-ok" : "ol-sure ol-sure-est"}>{it.sure}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
