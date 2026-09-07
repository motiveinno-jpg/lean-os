// 근무 규칙 — 화면(워크보드·근태 현황·내 출퇴근)이 같은 값을 읽게 한 곳에 둔다 (2026-09-07).
//   판정(지각·휴일·상태) 자체는 DB 트리거 attendance_records_judge → attendance_judge() 가 하고,
//   화면은 "이 사람의 오늘 근무 시작은 몇 시인가 / 오늘이 근무일인가" 를 알아야 결근·미출근을 그릴 수 있다.
//   예전엔 파일마다 기본값(유예 0 vs 30)·요일(토·일 고정)·개인 시각 반영 여부가 달라 화면끼리 어긋났다.
//   기본값은 attendance-checkin 엣지·attendance_judge() 와 같다: 09:00~18:00, 점심 60, 유예 30, 월~금.

export const ATT_DEFAULTS = { start: 9 * 60, end: 18 * 60, lunch: 60, grace: 30, mask: 31 } as const;

/** 'HH:MM' 또는 'HH:MM:SS' → 분. 못 읽으면 기본값 */
export function hhmmToMin(v: unknown, def: number): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  if (!m) return def;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return def;
  return h * 60 + mi;
}

export type CompanyWorkCfg = { start: number; end: number; lunch: number; grace: number; mask: number };

/** company_settings 한 줄(없을 수도 있다) → 회사 기본 근무 규칙 */
export function companyWorkCfgFromRow(row: {
  work_start_time?: unknown; work_end_time?: unknown; lunch_minutes?: unknown; late_grace_minutes?: unknown; workdays_mask?: unknown;
} | null | undefined): CompanyWorkCfg {
  const lunchRaw = Number(row?.lunch_minutes);
  const graceRaw = Number(row?.late_grace_minutes);
  const maskRaw = Number(row?.workdays_mask);
  return {
    start: hhmmToMin(row?.work_start_time, ATT_DEFAULTS.start),
    end: hhmmToMin(row?.work_end_time, ATT_DEFAULTS.end),
    lunch: Number.isFinite(lunchRaw) && lunchRaw >= 0 ? lunchRaw : ATT_DEFAULTS.lunch,
    grace: Number.isFinite(graceRaw) ? Math.min(240, Math.max(0, Math.trunc(graceRaw))) : ATT_DEFAULTS.grace,
    mask: Number.isFinite(maskRaw) && maskRaw > 0 ? Math.trunc(maskRaw) : ATT_DEFAULTS.mask,
  };
}

export type EmpWorkTime = { work_start_time?: string | null; work_end_time?: string | null };

/** 직원 개인 출근 시각(employees.work_start_time)이 있으면 그것, 없으면 회사 기본 */
export function employeeStartMin(cfg: CompanyWorkCfg, emp?: EmpWorkTime | null): number {
  return hhmmToMin(emp?.work_start_time, cfg.start);
}
export function employeeEndMin(cfg: CompanyWorkCfg, emp?: EmpWorkTime | null): number {
  return hhmmToMin(emp?.work_end_time, cfg.end);
}

/** 근무 요일 비트 — 월=1, 화=2, 수=4, 목=8, 금=16, 토=32, 일=64 */
export function isWorkdayMonIdx(mask: number, monIdx: number): boolean {
  if (monIdx < 0 || monIdx > 6) return false;
  return (mask & (1 << monIdx)) !== 0;
}
/** JS getDay 순서(0=일…6=토) */
export function isWorkdayDow(mask: number, dow: number): boolean {
  const bit = [64, 1, 2, 4, 8, 16, 32][dow];
  return bit !== undefined && (mask & bit) !== 0;
}
/** 'YYYY-MM-DD' 가 근무일인가 — 요일 마스크 + 회사 공휴일 */
export function isWorkdayDate(mask: number, dateStr: string, holidays?: Set<string> | null): boolean {
  if (holidays?.has(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return false;
  return isWorkdayDow(mask, new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/** 지금 KST 시각(분) — 화면의 '미출근 · n분 지각 중' 기준 */
export function kstNowMin(now: number = Date.now()): number {
  const k = new Date(now + 9 * 3600 * 1000);
  return k.getUTCHours() * 60 + k.getUTCMinutes();
}

/** 분 → 'HH:MM' */
export function minToHhmm(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * 오늘 미출근 판정(화면용). DB 판정과 같은 기준: 이 사람의 근무 시작 + 유예가 지났는데 출근 기록이 없다.
 *   · 근무일이 아니거나 공휴일 → 아니다  · 종일·오전반차 휴가 → 아니다(오후반차는 아침 출근 의무)
 *   · 입사 전 → 아니다  · 퇴근 시각까지 지나면 afterEnd=true(결근으로 그린다)
 */
export function judgeMissingToday(args: {
  cfg: CompanyWorkCfg; emp: EmpWorkTime & { hire_date?: string | null }; todayStr: string; nowMin: number;
  holidays?: Set<string> | null; leaveKind?: "full" | "am" | "pm" | null; hasRecord: boolean;
}): { missing: false } | { missing: true; lateMin: number; afterEnd: boolean } {
  const { cfg, emp, todayStr, nowMin } = args;
  if (args.hasRecord) return { missing: false };
  if (!isWorkdayDate(cfg.mask, todayStr, args.holidays)) return { missing: false };
  if (emp.hire_date && todayStr < emp.hire_date) return { missing: false };
  if (args.leaveKind === "full" || args.leaveKind === "am") return { missing: false };
  const start = employeeStartMin(cfg, emp);
  if (nowMin < start + cfg.grace) return { missing: false };
  return { missing: true, lateMin: nowMin - start, afterEnd: nowMin >= employeeEndMin(cfg, emp) };
}
