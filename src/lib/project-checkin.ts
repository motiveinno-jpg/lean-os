// 목표형 성과 체크인 — 주기(period) 계산 순수 함수. side-effect 0, 단위테스트 가능.
//   period_start = 현재 시점이 속한 체크인 주기의 시작일(YYYY-MM-DD). 미제출 판정·중복방지의 키.
//   weekly/biweekly = 월요일 시작, monthly = 1일 시작. 마감요일(due_weekday)은 알림/마감 표기용.

export type Cadence = "weekly" | "biweekly" | "monthly" | "none";

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "매주",
  biweekly: "격주",
  monthly: "매월",
  none: "안 함",
};

export const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

const parseYMD = (s: string) => new Date(s + "T00:00:00Z");
const toYMD = (d: Date) => d.toISOString().slice(0, 10);

export function todayYMD(): string {
  // KST 기준 오늘 (UTC+9)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function normalizeCadence(c: unknown): Cadence {
  return c === "weekly" || c === "biweekly" || c === "monthly" || c === "none" ? c : "none";
}

// 현재 시점이 속한 주기의 시작일
export function computePeriodStart(cadence: Cadence, today: string = todayYMD()): string {
  const d = parseYMD(today);
  if (cadence === "monthly") return today.slice(0, 8) + "01";
  if (cadence === "weekly" || cadence === "biweekly") {
    const dow = d.getUTCDay();          // 0=일 ~ 6=토
    const sinceMon = (dow + 6) % 7;     // 월요일까지의 일수
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - sinceMon);
    if (cadence === "biweekly") {
      // 에폭 주차 패리티로 2주 블록 고정
      const epochWeeks = Math.floor(mon.getTime() / (7 * 86400000));
      if (epochWeeks % 2 === 1) mon.setUTCDate(mon.getUTCDate() - 7);
    }
    return toYMD(mon);
  }
  return today.slice(0, 8) + "01"; // none — 월 기준(표시용)
}

// 주기 마감일 (알림·표기용). weekly/biweekly = 주 내 마감요일, monthly = 말일.
export function computeDueDate(periodStart: string, cadence: Cadence, dueWeekday: number | null | undefined): string {
  const d = parseYMD(periodStart);
  if (cadence === "monthly") {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return toYMD(end);
  }
  const wd = dueWeekday == null ? 5 : dueWeekday; // 기본 금요일
  const offsetFromMon = (wd + 6) % 7;             // 월요일(=1)부터의 일수
  const due = new Date(d);
  due.setUTCDate(d.getUTCDate() + offsetFromMon + (cadence === "biweekly" ? 7 : 0));
  return toYMD(due);
}

// 주기 라벨 (UI 표시)
export function periodLabel(periodStart: string, cadence: Cadence): string {
  if (cadence === "monthly" || cadence === "none") return periodStart.slice(0, 7); // YYYY-MM
  const [, m, day] = periodStart.split("-");
  return `${Number(m)}/${Number(day)} 주`;
}

// 마감 임박/경과 — today 가 마감일을 지났으면 overdue
export function isOverdue(dueDate: string, today: string = todayYMD()): boolean {
  return today > dueDate;
}

// 영업일수 — [fromYMD, toYMD] 구간의 평일(월~금) 수(양끝 포함). 주말 제외.
//   공휴일 소스 미정이라 1차는 주말만 제외(영업일 ≈ 평일). to < from 이면 0.
export function businessDaysBetween(fromYMD: string, toYMD: string): number {
  const from = parseYMD(fromYMD);
  const to = parseYMD(toYMD);
  if (to < from) return 0;
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  const fullWeeks = Math.floor(days / 7);
  let biz = fullWeeks * 5;
  const extra = days - fullWeeks * 7;
  const dow = from.getUTCDay(); // 0=일 ~ 6=토
  for (let i = 0; i < extra; i++) {
    const d = (dow + i) % 7;
    if (d !== 0 && d !== 6) biz++;
  }
  return biz;
}
