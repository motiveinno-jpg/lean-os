// 목표형 개요 콕핏 — 시계열 버킷·목표 페이스 순수 함수. side-effect 0, 단위테스트 가능.
//   달성률/페이스(예상착지)는 project-types.ts(getKpiAchievement/getOverallAchievement/getPaceWarning) 재사용.
//   여기서는 추세 그래프(②)용 주간 누적 + 목표 페이스 이상선만 담당.

import { businessDaysBetween, todayYMD } from "@/lib/project-checkin";

const parseYMD = (s: string) => new Date(s + "T00:00:00Z");
const toYMD = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type Pt = { x: number; y: number };
export type Trend = { actual: Pt[]; pace: Pt[]; todayX: number; weekLabels: string[] };

// 주간 누적 실적 vs 목표 페이스(영업일 선형 분배).
//   entries: 일자별 실적 증분. target: KPI 목표값. 기간 없으면 실적 범위로 폴백.
export function buildTrend(opts: {
  entries: { date: string; value: number }[];
  target: number;
  startDate?: string | null;
  endDate?: string | null;
  today?: string;
}): Trend {
  const today = opts.today || todayYMD();
  const dates = opts.entries.map((e) => e.date).filter(Boolean).sort();
  const start = (opts.startDate || dates[0] || today).slice(0, 10);
  const end = (opts.endDate || dates[dates.length - 1] || today).slice(0, 10);
  const startD = parseYMD(start);
  const endD = parseYMD(end < start ? start : end);
  const totalDays = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000));
  const weeks = Math.max(1, Math.ceil(totalDays / 7));

  // 주차별 실적 증분
  const inc = new Array(weeks + 1).fill(0);
  for (const e of opts.entries) {
    if (!e.date) continue;
    const wi = clamp(Math.floor((parseYMD(e.date.slice(0, 10)).getTime() - startD.getTime()) / 86400000 / 7), 0, weeks);
    inc[wi] += Number(e.value || 0);
  }

  // 오늘 주차까지 누적 실적
  const todayD = parseYMD(today < start ? start : today);
  const todayWeek = clamp(Math.floor((todayD.getTime() - startD.getTime()) / 86400000 / 7), 0, weeks);
  const actual: Pt[] = [];
  let acc = 0;
  for (let i = 0; i <= todayWeek; i++) { acc += inc[i]; actual.push({ x: i, y: Math.round(acc) }); }

  // 목표 페이스(이상선) — 전 기간 영업일 대비 누적 비율 × target
  const totalBiz = businessDaysBetween(start, end) || 1;
  const target = Number(opts.target || 0);
  const pace: Pt[] = [];
  const weekLabels: string[] = [];
  for (let i = 0; i <= weeks; i++) {
    const weekEnd = toYMD(addDays(startD, Math.min(totalDays, (i + 1) * 7 - 1)));
    const bizElapsed = businessDaysBetween(start, weekEnd);
    pace.push({ x: i, y: Math.round(target * Math.min(1, bizElapsed / totalBiz)) });
    const wkStart = addDays(startD, i * 7);
    weekLabels.push(`${wkStart.getUTCMonth() + 1}/${wkStart.getUTCDate()}`);
  }

  return { actual, pace, todayX: todayWeek, weekLabels };
}

// 스파크라인용 — 주간 누적 실적 y 배열(없으면 빈 배열).
export function sparkPoints(entries: { date: string; value: number }[], startDate?: string | null, endDate?: string | null): number[] {
  if (!entries || entries.length === 0) return [];
  return buildTrend({ entries, target: 0, startDate, endDate }).actual.map((p) => p.y);
}

// 기간 진행률(영업일 기준) — 0~1.
export function periodProgress(startDate?: string | null, endDate?: string | null, today: string = todayYMD()): { elapsed: number; total: number; pct: number } | null {
  if (!startDate || !endDate) return null;
  const s = startDate.slice(0, 10), e = endDate.slice(0, 10);
  const total = businessDaysBetween(s, e);
  if (total <= 0) return null;
  const t = today < s ? s : today > e ? e : today;
  const elapsed = businessDaysBetween(s, t);
  return { elapsed, total, pct: Math.min(1, elapsed / total) };
}
