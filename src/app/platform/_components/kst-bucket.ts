// 운영자 콘솔의 월·일·시 묶음을 KST(Asia/Seoul) 기준으로 가르는 한 곳.
//   timestamptz 를 그대로 slice(0,7) 하거나 86,400,000ms 로 나누면 UTC 경계가 되어
//   KST 00~09시에 생긴 건이 전날·전달로 들어간다. 한국은 서머타임이 없어 +9시간 고정이다.

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type TimeLike = string | number | Date | null | undefined;

function toMs(t: TimeLike): number | null {
  if (t == null || t === "") return null;
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** KST 기준 'YYYY-MM' (없거나 잘못된 값이면 "") */
export function kstMonthKey(t: TimeLike): string {
  const ms = toMs(t);
  if (ms == null) return "";
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 7);
}

/** 지금 기준 i 달 전의 KST 'YYYY-MM' 과 표시용 'M월' */
export function kstMonthsBack(i: number, now: number = Date.now()): { key: string; name: string } {
  const d = new Date(now + KST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - i;
  const first = new Date(Date.UTC(y, m, 1));
  return { key: first.toISOString().slice(0, 7), name: `${first.getUTCMonth() + 1}월` };
}

/** 시각이 속한 KST 하루(자정)의 시작 ms */
export function kstDayStartMs(t: TimeLike): number | null {
  const ms = toMs(t);
  if (ms == null) return null;
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}

/** 시각이 속한 한 시간의 시작 ms (KST 는 정시 오프셋이라 UTC 정시와 같다) */
export function hourStartMs(t: TimeLike): number | null {
  const ms = toMs(t);
  if (ms == null) return null;
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** KST 기준 'M/D' 와 'M/D HH시' 라벨 */
export function kstDayLabel(t: TimeLike): string {
  const ms = toMs(t);
  if (ms == null) return "";
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
export function kstHourLabel(t: TimeLike): string {
  const ms = toMs(t);
  if (ms == null) return "";
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}시`;
}
