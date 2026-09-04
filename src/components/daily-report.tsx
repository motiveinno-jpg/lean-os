"use client";

// 데일리 보고서 G안 — 카드형 (2026-09-03, docs/20260903_PLAN_dashboard_v3_report.md 결정 167)
//   History: E안(선 한 장, morning-report.tsx)을 배포한 뒤 사장님이 참고 대시보드 6장(6~11.PNG)을 보내며
//   "이미지별 공통점을 찾아 목업에 반영" → 공통 11가지(연회색 바탕+흰 카드, 아이콘+숫자+증감+스파크라인 KPI,
//   넓은 시계열+기간 토글+툴팁, 검색·상태 알약·쪽 있는 표 카드, 도넛+범례, 누적 막대, 아바타 순위 목록, 활동 타임라인,
//   묶음 막대, 주색 하나+상태색, 머리띠 컨트롤)를 G안으로 묶었고 사장님 "G안으로 가자" + "목업 배경색을 오너뷰 배경색으로".
//   feature_rollout('dashboard_g') — 모티브 먼저(CLAUDE.md 규칙). 켜진 회사는 이 파일, 아니면 E안(morning-report.tsx).
//   숫자는 lib/daily-report-data.ts 한 곳에서 읽는다(E안과 같은 값). 규모 규칙(결정 166)은 그대로.
//   2026-09-04 후속(결정 168): 자금 전망 30·60·90일 토글, 날짜 이동(지난 날은 daily_report_snapshots 저장본), 최근 활동 행위자, 잔액 이력.
//   결정 169: 자금 전망 기본 그림 = 폭포(Waterfall), 선(AreaFig)은 "날짜별" 토글. 목업 fund-charts 네 안 중 사장님 선택.
//   결정 170(2026-09-04, 123·12.PNG "이 형태로"): 자금 전망 카드 = 부제 + 탭 줄(전체 통장·왜 줄어드나·예정 목록·시나리오) + 엑셀/메일 +
//   지난 30일 실적(곡선)과 앞 N일 전망(계단)을 한 선으로 잇는 TrendFig(오늘·최저 알약). 미수 구성 = 금액 목록 + 바깥 라벨 도넛(Donut12).
//   오너뷰 것으로 남긴 것: AI 결론 카드, 챙길 것 체크리스트, 규모 규칙 각주, "이 화면이 읽은 것", 권한별 카드 숨김.

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Curve } from "@/lib/cash-outlook";
import { useDailyReportData, shiftDay, type ReportPerm, type RecentRow } from "@/lib/daily-report-data";
import { todayKst } from "@/lib/kst";
import { downloadCsv } from "@/lib/csv-export";
import { wonK, peopleShape, peopleRule, recvShape, AGE_LABELS, SCALE } from "@/lib/report-lines";

const fmtMd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
function axisWon(n: number): string {
  const a = Math.abs(n); const sign = n < 0 ? "−" : "";
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(a % 100_000_000 === 0 ? 0 : 1)}억`;
  if (a >= 10_000_000) return `${sign}${Math.round(a / 10_000_000)}천만`;
  if (a >= 10_000) return `${sign}${Math.round(a / 10_000)}만`;
  return `${sign}${a}`;
}
function ticks(min: number, max: number, parts = 2): number[] {
  const span = Math.max(1, max - min); const raw = span / parts;
  const mag = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) || mag * 10;
  const lo = Math.floor(min / step) * step; const out: number[] = [];
  for (let v = lo; v <= max + step * 0.01 && out.length < 8; v += step) out.push(v);
  return out;
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

// ── 부품 ──
const ICON: Record<string, ReactNode> = {
  wallet: <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" /></svg>,
  sales: <svg viewBox="0 0 24 24"><path d="M4 17l5-5 4 4 7-8" /><path d="M15 8h5v5" /></svg>,
  pnl: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 010 3h-2a1.5 1.5 0 000 3h3.5" /></svg>,
  recv: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 10h8M8 14h5" /></svg>,
  due: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
};

//   KPI 스파크라인 — 값 5개 이상일 때만. 선 1.8px, 끝점 하나.
function Spark({ vals }: { vals: number[] }) {
  if (vals.length < 3) return <div className="dg-spark dg-spark-none" />;
  const W = 120, H = 36; const mn = Math.min(...vals), mx = Math.max(...vals); const rng = Math.max(1e-9, mx - mn);
  const pts = vals.map((v, i) => [i * W / (vals.length - 1), H - 4 - (v - mn) / rng * (H - 8)] as const);
  const d = "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
  const last = pts[pts.length - 1];
  return <svg className="dg-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden><path d={d} /><circle cx={last[0]} cy={last[1]} r={2.5} /></svg>;
}

function Card({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`dg-card ${className || ""}`}>
      <div className="dg-card-h"><h2 className="dg-card-title">{title}</h2><span className="flex-1" />{right}</div>
      {children}
    </section>
  );
}

//   자금 전망 추세 (결정 170) — 지난 30일 실적(스냅샷·역산, 곡선)과 앞 N일 전망(cash-outlook, 계단)을 한 선으로. 오늘 알약(초록), 최저 알약(빨강).
//   실적은 매일 값이 있어 곡선이 맞고, 전망은 사건이 있는 날에만 움직여 계단이 정직하다(목업의 매끈한 곡선은 출렁여 보여 버림).
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}` : "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function TrendFig({ past, curve, horizon, today }: { past: number[]; curve: Curve; horizon: number; today: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 900, H = 230, pl = 46, pr = 14, pt = 26, pb = 28;
  //   합친 계열: 실적(오늘 제외 29일) + 전망(오늘 포함 horizon+1)
  const pastPts = past.slice(0, -1); const fut = curve.points;
  const n = pastPts.length + fut.length - 1; const T = pastPts.length;   // T = 오늘 인덱스
  const vals = [...pastPts, ...fut.map((p) => p.balance)];
  const lo = Math.min(0, ...vals), hiV = Math.max(...vals);
  const tk = ticks(lo, hiV, 3); const mn = tk[0], mx = Math.max(tk[tk.length - 1], hiV);
  const X = (i: number) => pl + (i * (W - pl - pr)) / Math.max(1, n);
  const Y = (v: number) => pt + ((mx - v) / Math.max(1, mx - mn)) * (H - pt - pb);
  const dateOf = (i: number) => i < T ? shiftDay(today, i - T) : fut[i - T].date;
  const pPts: [number, number][] = pastPts.map((v, i) => [X(i), Y(v)]);
  pPts.push([X(T), Y(fut[0].balance)]);
  const pastD = smoothPath(pPts);
  let futD = `M${X(T).toFixed(1)},${Y(fut[0].balance).toFixed(1)}`;
  for (let k = 1; k < fut.length; k++) futD += ` H${X(T + k).toFixed(1)} V${Y(fut[k].balance).toFixed(1)}`;
  const areaD = `${pastD} ${futD.slice(futD.indexOf(" ") + 1)} L${X(n).toFixed(1)},${Y(mn).toFixed(1)} L${X(0).toFixed(1)},${Y(mn).toFixed(1)} Z`;
  const minK = fut.reduce((m, p, k) => (p.balance < fut[m].balance ? k : m), 0);
  const step = Math.max(1, Math.round(horizon / 6));
  const h = hi != null ? { i: hi, bal: vals[hi], items: hi >= T ? fut[hi - T].items : [] } : null;
  const tipX = h ? (X(h.i) + 12 > W - 180 ? X(h.i) - 182 : X(h.i) + 12) : 0;
  const tipLines = h ? (h.i < T ? ["실적(통장)"] : h.items.length === 0 ? ["오가는 돈 없음"] : h.items.slice(0, 3).map((it) => `${it.label} ${it.amount > 0 ? "+" : "−"}${wonK(Math.abs(it.amount))}`)) : [];
  return (
    <svg className="dg-fig" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`지난 30일 실적과 ${horizon}일 전망`} onMouseLeave={() => setHi(null)}>
      <defs><linearGradient id="dg-grad2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity=".26" /><stop offset="1" stopColor="var(--primary)" stopOpacity=".02" /></linearGradient></defs>
      <rect className="dg-futbg" x={X(T)} y={pt} width={X(n) - X(T)} height={H - pt - pb} />
      {tk.map((v) => <g key={v}><line className={v === 0 && lo < 0 ? "dg-zero" : "dg-grid"} x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} /><text className="dg-ax" x={pl - 8} y={Y(v) + 3} textAnchor="end">{axisWon(v)}</text></g>)}
      <path className="dg-area2" d={areaD} />
      <path className="dg-line" d={pastD} />
      <path className="dg-line is-fut" d={futD} />
      <text className="dg-zone" x={(X(0) + X(T)) / 2} y={pt - 9} textAnchor="middle">지난 30일 실적</text>
      <text className="dg-zone" x={(X(T) + X(n)) / 2} y={pt - 9} textAnchor="middle">앞으로 {horizon}일 전망</text>
      {Array.from({ length: n + 1 }, (_, i) => i).filter((i) => (i < T ? (T - i) % 10 === 0 : (i - T) % step === 0) || i === n).map((i) => <text key={i} className="dg-ax" x={X(i)} y={H - 8} textAnchor="middle">{fmtMd(dateOf(i))}</text>)}
      <line className="dg-vline" x1={X(T)} x2={X(T)} y1={pt} y2={H - pb} />
      {hi == null && <>
        <circle className="dg-pt" cx={X(T)} cy={Y(fut[0].balance)} r={5} />
        <g transform={`translate(${X(T).toFixed(1)},${Y(fut[0].balance).toFixed(1)})`}><rect className="dg-pill is-today" x={-50} y={-34} width={100} height={22} rx={11} /><text className="dg-pill-t" x={0} y={-19} textAnchor="middle">오늘 {wonK(fut[0].balance)}</text></g>
        {minK > 0 && <>
          <circle className="dg-pt is-low" cx={X(T + minK)} cy={Y(fut[minK].balance)} r={4} />
          <g transform={`translate(${Math.min(X(T + minK), W - 70).toFixed(1)},${Y(fut[minK].balance).toFixed(1)})`}><rect className={`dg-pill is-low`} x={-62} y={-32} width={124} height={20} rx={10} /><text className="dg-pill-t" x={0} y={-18} textAnchor="middle">최저 {wonK(fut[minK].balance)} · {fmtMd(fut[minK].date)}</text></g>
        </>}
      </>}
      {h && <>
        <line className="dg-cross" x1={X(h.i)} x2={X(h.i)} y1={pt} y2={H - pb} />
        <circle className="dg-hp" cx={X(h.i)} cy={Y(h.bal)} r={4} />
        <g transform={`translate(${tipX.toFixed(1)},${Math.max(0, Y(h.bal) - 58).toFixed(1)})`}>
          <rect className="dg-tip" width={172} height={30 + tipLines.length * 14} rx={8} />
          <text className="dg-tip-t1" x={12} y={18}>{fmtMd(dateOf(h.i))} · 잔액 {wonK(h.bal)}</text>
          {tipLines.map((t, i) => <text key={i} className="dg-tip-t2" x={12} y={34 + i * 14}>{t}</text>)}
        </g>
      </>}
      {Array.from({ length: n + 1 }, (_, i) => <rect key={i} className="dg-hit" x={X(i) - (W - pl - pr) / (2 * n)} y={0} width={(W - pl - pr) / n} height={H} onMouseEnter={() => setHi(i)} />)}
    </svg>
  );
}

//   미수 구성 도넛 (결정 170, 12.PNG) — 바깥 라벨 + 이음선. 5% 아래 조각은 라벨을 붙이지 않는다(목록이 대신 말한다).
function Donut12({ segs, total, center }: { segs: { name: string; value: number; cls: string }[]; total: number; center: string }) {
  const R = 64, C = 2 * Math.PI * R, cx = 170, cy = 125; let off = 0;
  return (
    <svg className="dg-donut12" viewBox="0 0 340 250" aria-hidden>
      {segs.map((sg) => {
        const frac = sg.value / (total || 1); const len = Math.max(0, C * frac - 3);
        const mid = ((off + (C * frac) / 2) / C) * 2 * Math.PI - Math.PI / 2;
        const ax = cx + Math.cos(mid) * (R + 13), ay = cy + Math.sin(mid) * (R + 13), bx = cx + Math.cos(mid) * (R + 34), by = cy + Math.sin(mid) * (R + 34);
        const right = Math.cos(mid) >= 0; const ex = bx + (right ? 18 : -18);
        const el = (
          <g key={sg.name}>
            <circle className={sg.cls} r={R} cx={cx} cy={cy} strokeDasharray={`${len.toFixed(1)} ${(C - len).toFixed(1)}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} />
            {frac >= 0.05 && <><polyline className={`dg-lead ${sg.cls}`} points={`${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)} ${ex.toFixed(1)},${by.toFixed(1)}`} /><text className="dg-lead-t" x={ex + (right ? 4 : -4)} y={by + 4} textAnchor={right ? "start" : "end"}>{sg.name.length > 8 ? sg.name.slice(0, 7) + "…" : sg.name}</text></>}
          </g>
        );
        off += C * frac; return el;
      })}
      <text className="dg-donut-c" x={cx} y={cy - 4} textAnchor="middle">미수</text><text className="dg-donut-v" x={cx} y={cy + 16} textAnchor="middle">{center}</text>
    </svg>
  );
}

//   자금 전망 폭포 (2026-09-04 결정 169, 사장님 "2번(폭포)이 좋다") — 지금 잔액에서 사건 하나하나가 내려가고 올라가 N일 뒤에 닿는다.
//   "얼마"가 아니라 "무엇 때문에" 줄어드는지에 답한다. 사건이 9개를 넘으면 큰 것 8개만 두고 나머지는 '기타 N건'. 시간 축은 선 보기가 맡는다.
function Waterfall({ curve, horizon }: { curve: Curve; horizon: number }) {
  const evs = curve.points.flatMap((p) => p.items.filter((it) => it.amount !== 0).map((it) => ({ date: p.date, day: p.day, kind: it.kind as string, name: it.label, basis: it.basis, amount: it.amount })));
  let bars = evs;
  if (evs.length > 9) {
    const keep = new Set([...evs].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8));
    const rest = evs.filter((e) => !keep.has(e));
    bars = [...evs.filter((e) => keep.has(e)), { date: "", day: 9999, kind: `기타 ${rest.length}건`, name: rest.map((r) => r.name).slice(0, 5).join(", ") + (rest.length > 5 ? " …" : ""), basis: "", amount: rest.reduce((x, e) => x + e.amount, 0) }];
  }
  const start = curve.points[0].balance; const end = curve.end;
  type Bar = { label: string; sub: string; tip: string; kind: "tot" | "in" | "out"; amount: number; from: number; to: number };
  const seq: Bar[] = []; let run = start;
  seq.push({ label: "지금", sub: "", tip: `지금 잔액 ${wonK(start)}`, kind: "tot", amount: start, from: start, to: start });
  for (const b of bars) { const prev = run; run += b.amount; seq.push({ label: b.day === 9999 ? b.kind : fmtMd(b.date), sub: b.day === 9999 ? "" : b.kind, tip: `${b.day === 9999 ? b.kind : `${fmtMd(b.date)} ${b.kind}`} · ${b.name}${b.basis ? ` · ${b.basis}` : ""} · ${b.amount > 0 ? "+" : "−"}${wonK(Math.abs(b.amount))}`, kind: b.amount > 0 ? "in" : "out", amount: b.amount, from: prev, to: run }); }
  seq.push({ label: `${horizon}일 뒤`, sub: "", tip: `${horizon}일 뒤 잔액 ${wonK(end)}`, kind: "tot", amount: end, from: end, to: end });
  const W = 720, H = 220, pl = 44, pr = 12, pt = 18, pb = 40; const n = seq.length; const gw = (W - pl - pr) / n; const bw = Math.min(34, gw * 0.6);
  const allV = [0, ...seq.flatMap((x) => [x.from, x.to])]; const lo = Math.min(...allV), hi = Math.max(...allV);
  const tk = ticks(lo, hi, 4); const bot = tk[0]; const top = Math.max(tk[tk.length - 1], hi);
  const Y = (v: number) => pt + ((top - v) / Math.max(1, top - bot)) * (H - pt - pb);
  const base = lo < 0 ? 0 : bot;
  return (
    <svg className="dg-fig" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${horizon}일 잔액 폭포`}>
      {tk.map((v) => <g key={v}><line className={v === 0 && lo < 0 ? "dg-zero" : "dg-grid"} x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} /><text className="dg-ax" x={pl - 8} y={Y(v) + 3} textAnchor="end">{axisWon(v)}</text></g>)}
      {seq.map((b, k) => {
        const cx = pl + gw * k + gw / 2; const x = cx - bw / 2;
        const y0 = b.kind === "tot" ? Y(Math.max(b.amount, base)) : Y(Math.max(b.from, b.to)); const y1 = b.kind === "tot" ? Y(Math.min(b.amount, base)) : Y(Math.min(b.from, b.to));
        const parts = b.sub ? [b.label, b.sub] : [b.label];
        return (
          <g key={k}>
            <title>{b.tip}</title>
            <rect className={`dg-wf-${b.kind}`} x={x} y={y0} width={bw} height={Math.max(2, y1 - y0)} rx={3} />
            <text className={`dg-wf-v is-${b.kind} mono-number`} x={cx} y={y0 - 5} textAnchor="middle">{b.kind === "tot" ? wonK(b.amount) : `${b.amount > 0 ? "+" : "−"}${wonK(Math.abs(b.amount))}`}</text>
            {k < n - 1 && <line className="dg-wf-link" x1={x + bw} x2={pl + gw * (k + 1) + gw / 2 - bw / 2} y1={Y(b.to)} y2={Y(b.to)} />}
            {parts.map((t, i) => <text key={i} className="dg-ax" x={cx} y={H - 22 + i * 13} textAnchor="middle">{t.length > 9 ? t.slice(0, 8) + "…" : t}</text>)}
          </g>
        );
      })}
    </svg>
  );
}

//   매출·비용 묶음 막대 — 6개월. 막대 9px 둥근 끝, 비용은 연한 주색.
function GroupedBars({ series }: { series: { month: string; revenue: number; cost: number }[] }) {
  const W = 420, H = 190, pl = 36, pr = 8, pt = 14, pb = 24; const n = series.length; const gw = (W - pl - pr) / n; const bw = 9;
  const mx = Math.max(1, ...series.flatMap((x) => [x.revenue, x.cost])); const tk = ticks(0, mx); const top = Math.max(tk[tk.length - 1], mx);
  const Y = (v: number) => pt + (1 - v / top) * (H - pt - pb);
  return (
    <svg className="dg-fig" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최근 6개월 매출과 비용">
      {tk.filter((v) => v > 0).map((v) => <g key={v}><line className="dg-grid" x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} /><text className="dg-ax" x={pl - 6} y={Y(v) + 3} textAnchor="end">{axisWon(v)}</text></g>)}
      {series.map((x, i) => { const cx = pl + gw * i + gw / 2; return (
        <g key={x.month}>
          <rect className="dg-bar1" x={cx - bw - 2} y={Y(x.revenue)} width={bw} height={Math.max(0, H - pb - Y(x.revenue))} rx={4} />
          <rect className="dg-bar2" x={cx + 2} y={Y(x.cost)} width={bw} height={Math.max(0, H - pb - Y(x.cost))} rx={4} />
          <text className="dg-ax" x={cx} y={H - 6} textAnchor="middle">{Number(x.month.slice(5, 7))}월</text>
        </g>); })}
    </svg>
  );
}

//   비율 띠 한 줄(연령·근태) — 10px, 칸 사이 2px 틈
function Stack({ parts }: { parts: { label: string; value: number; cls: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return <div className="dg-stack">{parts.filter((p) => p.value > 0).map((p) => <i key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />)}</div>;
}

export function DailyReport({
  companyId, userId, companyName, perm, forecast30, unclassified, approvalsPending, lead, checklist, appendix, appendixCount,
}: {
  companyId: string; userId: string | null; companyName: string; perm: ReportPerm;
  forecast30: number | null; unclassified: { bank: number; card: number }; approvalsPending: number | null;
  lead: ReactNode; checklist: ReactNode; appendix: ReactNode; appendixCount: number;
}) {
  //   보는 날 — 오늘이 기본, ‹ › 로 지난 날(저장본). 자금 전망 일수는 30·60·90.
  const [offset, setOffset] = useState(0);
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const [fundTab, setFundTab] = useState<"trend" | "wf" | "list">("trend");   // 결정 170: 추세(실적+전망)가 기본, 왜 줄어드나(폭포)·예정 목록은 탭
  const viewDay = useMemo(() => shiftDay(todayKst(), offset), [offset]);
  const { today, day, past, snapshotMissing, savedAt, balHistory, s, curve, taxItems, bankToday, recv, proj, inv, people, recent } = useDailyReportData(companyId, userId, perm, { horizon, day: viewDay, snapshot: true });
  const isWeekend = [0, 6].includes(new Date(day + "T00:00:00").getDay());

  //   잔액 30일 추세 — 스냅샷에 남은 날은 그 값, 없는 날은 오늘 잔액에서 일별 순증감을 거꾸로 뺀 값
  const balHist = useMemo(() => {
    if (!s || !bankToday) return [] as number[];
    const out: number[] = []; let b = s.cash.balance;
    for (let i = 0; i < 30; i++) { const key = shiftDay(today, -i); const snapB = balHistory?.get(key); out.unshift(snapB ?? b); b -= bankToday.netByDay.get(key) || 0; }
    return out;
  }, [s, bankToday, today, balHistory]);

  // ── 최근 처리 표: 검색 + 쪽(6줄) ──
  const [q, setQ] = useState(""); const [page, setPage] = useState(0); const PER = 6;
  const filtered = useMemo(() => { const k = q.trim().toLowerCase(); return (recent || []).filter((r: RecentRow) => !k || r.title.toLowerCase().includes(k) || r.kind.includes(k) || r.status.label.includes(k)); }, [recent, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER)); const pageRows = filtered.slice(page * PER, page * PER + PER);
  useEffect(() => { setPage(0); }, [q]);

  // ── 부록 펼침 (보기 상태 — 기기에 기억) ──
  const [apx, setApx] = useState(false);
  useEffect(() => { try { setApx(localStorage.getItem("dash-apx-open") === "1"); } catch { /* noop */ } }, []);
  const toggleApx = () => { const v = !apx; setApx(v); try { localStorage.setItem("dash-apx-open", v ? "1" : "0"); } catch { /* noop */ } };

  const dateLabel = new Date(day + "T00:00:00").toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const fmtAt = (at: string | null) => { if (!at) return "-"; const d = String(at); if (d.slice(0, 10) === today) return d.slice(11, 16) || "오늘"; return d.slice(0, 10) === shiftDay(today, -1) ? `어제 ${d.slice(11, 16)}` : `${fmtMd(d)} ${d.slice(11, 16)}`; };
  const revShape = recv ? recvShape(recv.list.length) : "all";
  const pplShape = people ? peopleShape(people.active) : "dots";
  const pnlPrev = s?.pnl.prev; const revRatio = s && pnlPrev && pnlPrev.revenue > 0 ? (s.pnl.cur.revenue - pnlPrev.revenue) / pnlPrev.revenue : null;
  const vat30 = s?.arap.vatNext && s.arap.vatNext.dday <= 30 && s.arap.vatNext.pay ? s.arap.vatNext.amount : 0;
  const showSales = perm.finance || perm.ledger;
  const showRecent = perm.approvals || perm.tax;
  //   도넛 조각 = 금액 상위 5 + 기타 N곳(결정 170). 색 6개는 주색·상태색·연보라·파랑·회색 — 순위 고정.
  const donutSegs = recv && recv.byAmount.length > 0 ? [...recv.byAmount.slice(0, 5).map((g, i) => ({ name: g.name, value: g.outstanding, cls: `dg-d${i + 1}` })), ...(recv.byAmount.length > 5 ? [{ name: `기타 ${(recv.byAmount.length - 5).toLocaleString("ko")}곳`, value: recv.byAmount.slice(5).reduce((x, g) => x + g.outstanding, 0), cls: "dg-d6" }] : [])] : [];
  const top3Share = recv && recv.total > 0 ? pct(recv.byAmount.slice(0, 3).reduce((x, g) => x + g.outstanding, 0), recv.total) : 0;

  return (
    <div className="dg">
      <header className="dg-top">
        <div><h1 className="dg-title">데일리 보고서</h1><div className="dg-crumb">{companyName}{s?.cash.hasBank ? " · 통장 수집" : ""}{past && savedAt && ` · 그날 ${String(savedAt).slice(11, 16)} 저장본`}</div></div>
        <span className="flex-1" />
        <div className="dg-date">
          <button type="button" className="dg-date-btn" onClick={() => setOffset((o) => o - 1)} title="하루 전 보고서">‹</button>
          <span className="dg-date-d">{dateLabel}</span>
          <button type="button" className="dg-date-btn" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))} title="하루 뒤">›</button>
          {past && <button type="button" className="dg-date-today" onClick={() => setOffset(0)}>오늘</button>}
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>인쇄</button>
      </header>

      {past && snapshotMissing && <div className="dg-lead"><p className="dg-p">{fmtMd(day)} 저장된 보고서가 없습니다. 보고서는 열어 본 날만 그날 숫자가 저장됩니다.</p></div>}
      {past && !snapshotMissing && <div className="dg-lead"><p className="dg-p"><b>{fmtMd(day)} 저장본</b>입니다. 결론·챙길 것은 오늘 것만 보여 주고, 숫자는 그날 저장된 값입니다.</p></div>}
      {perm.briefing && !past && <div className="dg-lead">{lead}</div>}

      {perm.finance && s && (
        <div className="dg-kpis">
          <Link href="/bank" className="dg-card dg-kpi">
            <div className="dg-kpi-t"><span className="dg-ico dg-c1">{ICON.wallet}</span><div><div className="dg-kpi-l">오늘 잔액</div><div className="dg-kpi-v mono-number">{s.cash.hasBank ? wonK(s.cash.balance) : "통장 없음"}</div><div className="dg-kpi-s mono-number">{bankToday && bankToday.n > 0 ? `오늘 +${wonK(bankToday.inn)} −${wonK(bankToday.out)}` : "오늘 거래 없음"}</div></div></div>
            <Spark vals={balHist} />
          </Link>
          <Link href="/reports/profit" className="dg-card dg-kpi">
            <div className="dg-kpi-t"><span className="dg-ico dg-c2">{ICON.sales}</span><div><div className="dg-kpi-l">이달 매출</div><div className="dg-kpi-v mono-number">{wonK(s.pnl.cur.revenue)}</div><div className="dg-kpi-s mono-number">{revRatio == null ? "지난달 자료 없음" : `지난달 대비 ${revRatio >= 0 ? "+" : "−"}${Math.round(Math.abs(revRatio) * 100)}%`}</div></div></div>
            <Spark vals={s.pnl.series.map((x) => x.revenue)} />
          </Link>
          <Link href="/reports/profit" className="dg-card dg-kpi">
            <div className="dg-kpi-t"><span className="dg-ico dg-c3">{ICON.pnl}</span><div><div className="dg-kpi-l">이달 손익</div><div className={`dg-kpi-v mono-number ${s.pnl.cur.operating < 0 ? "rep-t-bad" : ""}`}>{wonK(s.pnl.cur.operating)}</div><div className="dg-kpi-s mono-number">비용 {wonK(s.pnl.cur.cogs + s.pnl.cur.opex)} · 확정 전표만</div></div></div>
            <Spark vals={s.pnl.series.map((x) => x.op)} />
          </Link>
          <Link href="/partners/ledger?type=sales" className="dg-card dg-kpi">
            <div className="dg-kpi-t"><span className="dg-ico dg-c4">{ICON.recv}</span><div><div className="dg-kpi-l">미수</div><div className="dg-kpi-v mono-number">{wonK(s.arap.ar)}</div><div className="dg-kpi-s mono-number">{recv ? `${recv.list.length.toLocaleString("ko")}곳 · 90일 넘긴 곳 ${recv.over90Partners}` : s.arap.over30Partners > 0 ? `30일 넘긴 곳 ${s.arap.over30Partners}` : "30일 넘긴 곳 없음"}</div></div></div>
            {recv && recv.total > 0 ? <div className="dg-kpi-mini"><Stack parts={recv.age.map((v, i) => ({ label: AGE_LABELS[i], value: v, cls: `dg-a${i}` }))} /><span className="dg-kpi-mini-k">연령 30 · 90 · 180일</span></div> : <div className="dg-spark dg-spark-none" />}
          </Link>
          <Link href="/reports/outlook" className="dg-card dg-kpi">
            <div className="dg-kpi-t"><span className="dg-ico dg-c5">{ICON.due}</span><div><div className="dg-kpi-l">30일 안에 낼 돈</div><div className="dg-kpi-v mono-number">{wonK(s.arap.due30)}</div><div className="dg-kpi-s mono-number">급여 {wonK(s.arap.salary)} · 정기 {wonK(s.arap.recurring)}</div></div></div>
            <div className="dg-kpi-mini"><Stack parts={[{ label: "급여", value: s.arap.salary, cls: "dg-a3" }, { label: "정기", value: s.arap.recurring, cls: "dg-a2" }, { label: "대출", value: s.arap.loanMonthly, cls: "dg-a1" }, { label: "부가세", value: vat30, cls: "dg-a0" }]} /><span className="dg-kpi-mini-k">급여 · 정기 · 대출{vat30 > 0 ? " · 부가세" : ""}</span></div>
          </Link>
        </div>
      )}

      {(showRecent || perm.finance) && (
        <div className="dg-row dg-r21">
          {showRecent && (
            <Card title="최근 처리" right={<><span className="dg-mini">검색 <input className="dg-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="항목·종류·상태" /></span></>}>
              {!recent ? <p className="rep-none">읽는 중…</p> : filtered.length === 0 ? <p className="rep-none">{q ? "검색 결과가 없습니다." : "최근 처리한 결재·계산서가 없습니다."}</p> : (
                <>
                  <table className="dg-tbl">
                    <thead><tr><th>항목</th><th>일시</th><th className="r">금액</th><th>상태</th></tr></thead>
                    <tbody>{pageRows.map((r) => (
                      <tr key={r.id}><td><span className="dg-th">{r.kind.slice(0, 1)}</span><span className="dg-cell"><Link href={r.href} className="rep-link"><b>{r.title}</b></Link><span>{r.kind}{r.who ? ` · ${r.who}` : ""}</span></span></td><td className="m mono-number">{fmtAt(r.at)}</td><td className="r mono-number">{r.amount > 0 ? wonK(r.amount) : "-"}</td><td><span className={`dg-pill dg-pill-${r.status.tone}`}>{r.status.label}</span></td></tr>
                    ))}</tbody>
                  </table>
                  <div className="dg-pager"><span>{filtered.length}건 중 {page * PER + 1}~{Math.min(filtered.length, (page + 1) * PER)}</span><span className="flex-1" />
                    <button type="button" className="dg-pg" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>이전</button>
                    {Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={`dg-pg dg-pg-n ${i === page ? "is-on" : ""}`} onClick={() => setPage(i)}>{i + 1}</button>)}
                    <button type="button" className="dg-pg" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>다음</button></div>
                </>
              )}
            </Card>
          )}
          {perm.finance && (
            <Card title="매출·비용" right={<span className="dg-seg"><span className="is-on">월</span></span>}>
              {s && s.pnl.series.some((x) => x.revenue > 0 || x.cost > 0) ? (
                <>
                  <GroupedBars series={s.pnl.series} />
                  <div className="dg-legend"><span><i className="dg-bar1" />매출</span><span><i className="dg-bar2" />비용</span></div>
                  <p className="dg-note">확정 전표 기준 · 이달 매출 {wonK(s.pnl.cur.revenue)}, 비용 {wonK(s.pnl.cur.cogs + s.pnl.cur.opex)}</p>
                </>
              ) : <p className="rep-none">최근 6개월 확정 전표가 없습니다.</p>}
            </Card>
          )}
        </div>
      )}

      {perm.ledger && recv && recv.list.length > 0 && (
        <div className="dg-row dg-r-recv">
          <Card title={revShape === "stripFirst" ? "90일 넘긴 미수 상위" : "미수 상위"} right={<span className="dg-mini">오래된 순</span>}>
            <ul className="dg-list">{(revShape === "stripFirst" ? recv.list.filter((g) => g.oldestDays > 90) : recv.list).slice(0, 5).map((g) => (
              <li key={g.name}><span className="dg-avatar">{g.name.replace(/^(주식회사|\(주\)|유한회사)\s*/, "").slice(0, 1)}</span><span className="dg-cell"><Link href="/partners/ledger?type=sales" className="rep-link"><b>{g.name}</b></Link><span className={g.oldestDays > 90 ? "rep-t-bad" : g.oldestDays > 30 ? "rep-t-warn" : "rep-t-good"}>{g.oldestDays}일{g.count > 1 ? ` · ${g.count}건` : ""}</span></span><span className="dg-amt mono-number">{wonK(g.outstanding)}</span></li>
            ))}</ul>
            <p className="dg-note">{revShape === "all" ? `${recv.list.length}곳 전부를 봅니다.` : `${recv.list.length.toLocaleString("ko")}곳 중 상위 5곳이 미수의 ${pct(recv.list.slice(0, 5).reduce((x, g) => x + g.outstanding, 0), recv.total)}%.`} <Link href="/partners/ledger?type=sales" className="rep-link is-primary">거래처 원장 →</Link></p>
          </Card>
          <section className="dg-card">
            <div className="dg-card-h is-top"><div><h2 className="dg-card-title">미수 구성 · 거래처별</h2><div className="dg-sub2">확정 계산서 미정산 {recv.list.length.toLocaleString("ko")}곳 · {wonK(recv.total)}</div></div><span className="flex-1" /><Link href="/partners/ledger?type=sales" className="dg-more">거래처 원장 →</Link></div>
            <div className="dg-split">
              <ul className="dg-rlist">{donutSegs.map((sg) => <li key={sg.name}><i className={`dg-dot ${sg.cls}`} /><span className="dg-rlist-n" title={sg.name}>{sg.name}</span><span className="dg-rlist-v mono-number">{wonK(sg.value)}</span><span className="dg-rlist-p mono-number">{pct(sg.value, recv.total)}%</span></li>)}</ul>
              <Donut12 segs={donutSegs} total={recv.total} center={wonK(recv.total)} />
            </div>
            <p className="dg-note">상위 3곳이 {top3Share}%{top3Share >= 50 ? ` — ${recv.byAmount[0].name} 한 곳 회수가 ${pct(recv.byAmount[0].outstanding, recv.total)}%를 정리합니다` : ""} · 초안 제외</p>
          </section>
          <Card title="미수 연령">
            <div className="dg-tot"><span className="dg-tot-n mono-number">{wonK(recv.total)}</span><span className="dg-tot-k">{recv.list.length.toLocaleString("ko")}곳 · 90일 넘긴 비중 {pct(recv.over90, recv.total)}%</span></div>
            <Stack parts={recv.age.map((v, i) => ({ label: AGE_LABELS[i], value: v, cls: `dg-a${i}` }))} />
            {recv.age.map((v, i) => <div key={i} className="dg-arow"><i className={`dg-dot dg-a${i}`} /><span className="dg-arow-l">{AGE_LABELS[i]}</span><span className="dg-arow-v mono-number">{wonK(v)}</span><span className="dg-arow-p mono-number">{pct(v, recv.total)}%</span></div>)}
            <p className="dg-note">확정 계산서만 · 초안 제외 · 최근 400일{revShape !== "all" && ` · ${SCALE.recvAll + 1}곳부터 연령이 먼저`}</p>
          </Card>
        </div>
      )}
      {perm.ledger && recv && recv.list.length === 0 && <div className="dg-row"><Card title="미수"><p className="rep-none">미수금 없음 — 발행한 세금계산서가 모두 회수됐습니다.</p></Card></div>}

      {(perm.finance || perm.briefing) && (
        <div className="dg-row dg-r21">
          {perm.finance && (
            <section className="dg-card">
              <div className="dg-card-h is-top"><div><h2 className="dg-card-title">자금 전망</h2><div className="dg-sub2">통장 잔액 실적과 앞으로의 전망 · 확정 전표와 통장 기준</div></div><span className="flex-1" /><span className="dg-seg">{([30, 60, 90] as const).map((hz) => <button key={hz} type="button" className={hz === horizon ? "is-on" : ""} disabled={past} onClick={() => setHorizon(hz)}>{hz}일</button>)}</span></div>
              <div className="dg-tabs">
                <button type="button" className={`dg-tab ${fundTab === "trend" ? "is-on" : ""}`} onClick={() => setFundTab("trend")}>전체 통장</button>
                <button type="button" className={`dg-tab ${fundTab === "wf" ? "is-on" : ""}`} onClick={() => setFundTab("wf")}>왜 줄어드나</button>
                <button type="button" className={`dg-tab ${fundTab === "list" ? "is-on" : ""}`} onClick={() => setFundTab("list")}>예정 목록</button>
                <Link href="/reports/outlook" className="dg-tab">시나리오 →</Link>
                <span className="flex-1" />
                {curve && <button type="button" className="dg-tool" onClick={() => downloadCsv(`자금전망_${horizon}일`, ["날짜", "예정 잔액", "그날 항목"], curve.points.map((pp) => [pp.date, pp.balance, pp.items.map((it) => `${it.label} ${Math.round(it.amount)}`).join(" / ")]))}>⇩ 엑셀로 내려받기</button>}
                {curve && s && <a className="dg-tool" href={`mailto:?subject=${encodeURIComponent(`자금 전망 ${horizon}일 (${companyName})`)}&body=${encodeURIComponent(`지금 잔액 ${wonK(s.cash.balance)} → ${horizon}일 뒤 ${wonK(curve.end)}\n가장 낮은 날 ${fmtMd(curve.min.date)} ${wonK(curve.min.balance)}\n\n` + curve.points.filter((pp) => pp.items.length).map((pp) => `${fmtMd(pp.date)} ` + pp.items.map((it) => `${it.label} ${it.amount > 0 ? "+" : "−"}${wonK(Math.abs(it.amount))}`).join(", ")).join("\n"))}`}>✉ 메일로 보내기</a>}
              </div>
              {!s ? <p className="rep-none">통장 자료를 읽는 중…</p> : !s.cash.hasBank ? <p className="rep-none">연결된 통장이 없습니다. 통장을 연결하면 잔액·전망이 자동으로 채워집니다.</p> : (
                <>
                  {fundTab === "trend" && curve && <TrendFig past={balHist.length ? balHist : [s.cash.balance]} curve={curve} horizon={horizon} today={today} />}
                  {fundTab === "trend" && <div className="dg-legend"><span><i className="dg-lg-solid" />실적(통장)</span><span><i className="dg-lg-dash" />전망(급여·세금·정기 지출·계약 입금)</span><span className="rep-t-bad">● 최저점</span></div>}
                  {fundTab === "wf" && curve && <Waterfall curve={curve} horizon={horizon} />}
                  {fundTab === "list" && curve && (() => { const rows = curve.points.flatMap((pp) => pp.items.map((it) => ({ ...it, date: pp.date }))); return rows.length === 0 ? <p className="rep-none">{horizon}일 안에 예정된 돈이 없습니다.</p> : (
                    <>
                      <table className="dg-tbl dg-tbl-sm"><thead><tr><th>날짜</th><th>종류</th><th>내용</th><th className="r">금액</th><th>근거</th></tr></thead>
                        <tbody>{rows.slice(0, 12).map((it) => <tr key={it.id}><td className="mono-number">{fmtMd(it.date)}</td><td className="m">{it.kind}</td><td>{it.href ? <Link href={it.href} className="rep-link">{it.label}</Link> : it.label}</td><td className={`r mono-number ${it.amount < 0 ? "rep-t-bad" : "rep-t-good"}`}>{it.amount > 0 ? "+" : "−"}{wonK(Math.abs(it.amount))}</td><td className="m">{it.sure}{it.flag ? ` · ${it.flag}` : ""}</td></tr>)}</tbody></table>
                      {rows.length > 12 && <p className="dg-note"><Link href="/reports/outlook" className="rep-link is-primary">외 {rows.length - 12}건 — 자금 전망 →</Link></p>}
                    </>
                  ); })()}
                  <p className="dg-note">{(() => { const end = curve ? curve.end : (forecast30 ?? s.cash.balance); const d = end - s.cash.balance; return <>오늘 <b>{wonK(s.cash.balance)}</b> → {horizon}일 뒤 <b>{wonK(end)}</b>({d >= 0 ? "+" : "−"}{wonK(Math.abs(d))}).{curve && curve.min.day > 0 && <> 가장 낮은 날 {fmtMd(curve.min.date)} {wonK(curve.min.balance)}{curve.shortfall ? <b className="rep-t-bad">, {fmtMd(curve.shortfall.date)}에 마이너스</b> : ""}.</>} 30일 안에 낼 돈 {wonK(s.arap.due30)}.{unclassified.bank + unclassified.card > 0 && ` 미분류 ${unclassified.bank + unclassified.card}건 제외.`}</>; })()}{taxItems.length > 0 && <> 세금 {taxItems.map((t, i) => <span key={t.id}>{i > 0 && ", "}<Link href={t.href} className="rep-link">{t.title} {fmtMd(t.date)} <b className={t.daysLeft <= 7 ? "rep-t-bad" : ""}>{t.daysLeft === 0 ? "오늘" : `D-${t.daysLeft}`}</b></Link></span>)}</>}</p>
                </>
              )}
            </section>
          )}
          {perm.briefing && (
            <Card title="오늘 챙길 것" right={perm.approvals ? <Link href="/approvals" className="dg-more">결재 허브 →</Link> : undefined}>
              {past ? <p className="rep-none">챙길 것은 오늘 보고서에서만 봅니다.</p> : <div className="dg-checklist">{checklist}</div>}
              {(perm.approvals || perm.projects || perm.inventory) && (
                <>
                  <div className="dg-sub">업무 상태</div>
                  {perm.approvals && <div className="dg-stat"><span><i className="dg-sd dg-sd-bad" />결재 대기</span><b className="mono-number">{approvalsPending ?? "–"}건</b></div>}
                  {perm.projects && <div className="dg-stat"><span><i className="dg-sd dg-sd-warn" />마감 지난 프로젝트</span><b className="mono-number">{proj ? `${proj.overdueDeals}건` : "–"}</b></div>}
                  {perm.inventory && <div className="dg-stat"><span><i className="dg-sd dg-sd-acc" />안전재고 아래</span><b className="mono-number">{inv ? `${inv.count}품목` : "–"}</b></div>}
                  {perm.projects && <div className="dg-stat"><span><i className="dg-sd dg-sd-ok" />이번 주 마감</span><b className="mono-number">{proj ? `${proj.dueSoon}건` : "–"}</b></div>}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {(perm.people || showRecent || perm.tax) && (
        <div className="dg-row dg-r3">
          {perm.people && (
            <Card title="사람" right={<Link href="/attendance" className="dg-more">근태 →</Link>}>
              {!people ? <p className="rep-none">근태 자료를 읽는 중…</p> : people.active === 0 ? <p className="rep-none">등록된 구성원이 없습니다.</p> : isWeekend ? <p className="dg-p">재직 <b>{people.active}명</b>. 오늘은 휴일이라 근태 집계가 없습니다.</p> : (
                <>
                  <div className="dg-tot"><span className="dg-tot-n mono-number">{people.working}</span><span className="dg-tot-k">/ {people.active}명 근무중</span></div>
                  {pplShape === "dots" ? (
                    <div className="dg-dots">{people.each.map((x) => <i key={x.id} className={`is-${x.st}`} title={`${x.name} · ${x.st === "working" ? "근무중" : x.st === "done" ? "퇴근" : x.st === "leave" ? "휴가" : "기록 없음"}`} />)}</div>
                  ) : (
                    <>
                      <Stack parts={[{ label: "근무중", value: people.working, cls: "is-working" }, { label: "퇴근", value: people.done, cls: "is-done" }, { label: "휴가", value: people.onLeave, cls: "is-leave" }, { label: "기록 없음", value: people.missing, cls: "is-missing" }]} />
                      <table className="dg-tbl dg-tbl-sm"><thead><tr><th>부서</th><th className="r">인원</th><th className="r">근무</th><th className="r">휴가</th><th className="r">기록 없음</th></tr></thead>
                        <tbody>{people.depts.slice(0, 4).map((d) => <tr key={d.name}><td>{d.name}</td><td className="r mono-number">{d.n}</td><td className="r mono-number">{d.working}</td><td className="r mono-number">{d.leave}</td><td className={`r mono-number ${d.missing > 0 ? "rep-t-bad" : ""}`}>{d.missing}</td></tr>)}
                          {people.depts.length > 4 && (() => { const rest = people.depts.slice(4); return <tr><td className="m">외 {rest.length}부서</td><td className="r mono-number">{rest.reduce((x, d) => x + d.n, 0)}</td><td className="r mono-number">{rest.reduce((x, d) => x + d.working, 0)}</td><td className="r mono-number">{rest.reduce((x, d) => x + d.leave, 0)}</td><td className="r mono-number">{rest.reduce((x, d) => x + d.missing, 0)}</td></tr>; })()}</tbody></table>
                    </>
                  )}
                  <div className="dg-legend dg-legend-ppl"><span><i className="is-working" />{people.working} 근무중</span><span><i className="is-done" />{people.done} 퇴근</span><span><i className="is-leave" />{people.onLeave} 휴가{pplShape === "dots" && people.leaveNames.length > 0 && ` · ${people.leaveNames.join(", ")}`}</span><span><i className="is-missing" />{people.missing} 기록 없음</span>{people.late > 0 && <span className="rep-t-warn">지각 {people.late}</span>}</div>
                  <p className="dg-note">{peopleRule(pplShape)} 재직 {people.active}명 기준.</p>
                </>
              )}
            </Card>
          )}
          {showRecent && (
            <Card title="최근 활동" right={perm.approvals ? <Link href="/approvals" className="dg-more">전체 보기</Link> : undefined}>
              {!recent ? <p className="rep-none">읽는 중…</p> : recent.length === 0 ? <p className="rep-none">최근 활동이 없습니다.</p> : (
                <ul className="dg-tl">{recent.slice(0, 5).map((r) => (
                  <li key={r.id}>{r.who && <b>{r.who}</b>}{r.who && " · "}<Link href={r.href} className="rep-link">{r.title}</Link> · {r.kind} <span className={r.status.tone === "m" ? "m" : `rep-t-${r.status.tone}`}>{r.status.label}</span><span className="dg-tl-w mono-number">{fmtAt(r.at)}</span></li>
                ))}</ul>
              )}
            </Card>
          )}
          {perm.tax && (
            <Card title="세금·납부" right={<Link href="/finance/tax-filing" className="dg-more">세무 신고 →</Link>}>
              {taxItems.length === 0 ? <p className="rep-none">60일 안에 낼 세금 없음</p> : (
                <ul className="dg-list">{taxItems.map((t) => (
                  <li key={t.id}><span className={`dg-tic ${t.daysLeft <= 7 ? "is-hot" : ""} mono-number`}>{t.daysLeft === 0 ? "오늘" : `D-${t.daysLeft}`}</span><span className="dg-cell"><Link href={t.href} className="rep-link"><b>{t.title}</b></Link><span className="mono-number">{fmtMd(t.date)}</span></span><span className={`dg-pill ${t.daysLeft <= 7 ? "dg-pill-warn" : "dg-pill-m"}`}>{t.daysLeft <= 7 ? "납부 전" : "준비"}</span></li>
                ))}</ul>
              )}
            </Card>
          )}
        </div>
      )}

      <section className={`rep-apx ${apx ? "is-open" : ""}`}>
        <div className="rep-apx-h">
          <b>부록 — 위젯 격자</b><span className="rep-apx-hint mono-number">쓸 수 있는 위젯 {appendixCount}개</span>
          <span className="rep-apx-hint">보고서로 부족하면 여기서 펼쳐 보고, 순서를 바꾸거나 켜고 끕니다</span>
          <span className="flex-1" />
          <button type="button" className="rep-apx-btn" onClick={toggleApx}>{apx ? "접기 ▴" : "펼치기 ▾"}</button>
        </div>
        {apx && <div className="rep-apx-body">{appendix}</div>}
      </section>
      <footer className="rep-foot">
        <span>이 화면이 읽은 것: 확정 전표{s?.cash.hasBank ? " · 통장·카드 수집" : ""}{perm.projects && proj ? ` · 활성 프로젝트 ${proj.active}` : ""}{perm.people && people ? ` · 재직 ${people.active}명 · 승인된 휴가` : ""}.</span>
        <span>결론과 챙길 것만 AI 제안 · 보이는 카드는 내 권한에 따라 다릅니다.</span>
      </footer>
    </div>
  );
}
