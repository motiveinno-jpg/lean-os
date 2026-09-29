//   근속기간 — 모든 화면(구성원 목록·직원 상세·퇴직금 계산·퇴직금 추계·증명서)이 이 함수 하나를 쓴다.
//   전에는 화면마다 따로 셈해 같은 사람이 "10개월"·"11개월 0일(330일)"·"331일"로 달리 보였다
//   (30일을 한 달로, 365일을 한 해로 나누거나 날짜를 안 따지고 달만 빼는 식).
//
//   규칙
//   · 기간은 입사일과 기준일(퇴직일·오늘)을 모두 포함한다 — 퇴직금 재직일수(estimate_retirement,
//     calculateRetirementPay)와 같은 기준이라 총일수가 어디서나 같다.
//   · 년·개월·일은 실제 달력으로 센다: 기준일 다음 날까지 몇 해·몇 달·며칠 지났는지.
//     예) 2025-03-04 ~ 2026-03-03 = 1년 0개월 0일 · 365일, 2025-11-03 ~ 2026-09-29 = 10개월 27일 · 331일.
//   · 날짜 문자열(YYYY-MM-DD)만 UTC 로 다뤄 시간대에 따라 하루 밀리지 않는다.

import { kstDateStr, todayKst } from "@/lib/kst";

export type Tenure = { years: number; months: number; days: number; totalDays: number };

const toYmd = (v: string | Date): string => (v instanceof Date ? kstDateStr(v) : String(v).slice(0, 10));
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
const utc = (s: string) => { const { y, m, d } = parse(s); return Date.UTC(y, (m || 1) - 1, d || 1); };

/** 입사 N개월째 응당일(YYYY-MM-DD). 그 달에 같은 날이 없으면(1/31 입사 → 2월) 다음 달 1일 —
 *  민법 제160조 제3항(기간은 그 달 말일로 만료)과 같이 1/31 ~ 2월 말일이 한 달이 된다. */
export function anniversary(hire: string, months: number): string {
  const a = parse(hire.slice(0, 10));
  const last = new Date(Date.UTC(a.y, a.m - 1 + months + 1, 0)).getUTCDate();
  const t = a.d <= last ? Date.UTC(a.y, a.m - 1 + months, a.d) : Date.UTC(a.y, a.m - 1 + months + 1, 1);
  return new Date(t).toISOString().slice(0, 10);
}

/** 입사일 ~ 기준일(양 끝 포함) 근속. 기준일이 입사일보다 앞이거나 날짜가 없으면 null. */
export function tenureBetween(hire: string | Date | null | undefined, asof: string | Date = todayKst()): Tenure | null {
  if (!hire) return null;
  const from = toYmd(hire), to = toYmd(asof);
  const f = utc(from), t = utc(to);
  if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return null;
  const totalDays = Math.round((t - f) / 86_400_000) + 1;
  //   기준일을 포함하므로 기준일 다음 날까지 입사 응당일이 몇 번 지났는지 센다.
  const next = t + 86_400_000;
  const a = parse(from);
  const anniv = (n: number) => utc(anniversary(from, n));
  const nd = new Date(next);
  let total = (nd.getUTCFullYear() - a.y) * 12 + (nd.getUTCMonth() + 1 - a.m);
  while (total > 0 && anniv(total) > next) total--;
  const days = Math.round((next - anniv(total)) / 86_400_000);
  const years = Math.floor(total / 12), months = total % 12;
  return { years, months, days, totalDays };
}

/** 표시 — withDays: 'never' = "2년 6개월", 'under-year' = 1년 미만만 일까지, 'always' = "2년 6개월 26일" */
export function formatTenure(t: Tenure | null, withDays: "never" | "under-year" | "always" = "never"): string {
  if (!t) return "—";
  const parts: string[] = [];
  if (t.years > 0) parts.push(`${t.years}년`);
  if (t.months > 0 || (withDays === "never" && t.years === 0)) parts.push(`${t.months}개월`);
  const showDays = withDays === "always" || (withDays === "under-year" && t.years === 0);
  if (showDays && (t.days > 0 || parts.length === 0)) parts.push(`${t.days}일`);
  return parts.length ? parts.join(" ") : "0개월";
}

/** 오늘까지 근속 — 퇴사일이 이미 지났으면 퇴사일까지(퇴사자 근속이 계속 늘지 않게) */
export function tenureToday(hire: string | null | undefined, endDate?: string | null): Tenure | null {
  const today = todayKst();
  const end = endDate && String(endDate).slice(0, 10) < today ? String(endDate).slice(0, 10) : today;
  return tenureBetween(hire, end);
}
