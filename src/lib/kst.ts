// KST(Asia/Seoul) 날짜 문자열 공용 유틸 — 2026-07-21 QA 스윕.
//   new Date().toISOString().slice(0, 10) 은 UTC 기준이라 KST 자정~오전 9시 사이
//   "오늘"이 어제로 계산되던 결함류의 공용 해결책 (hr.ts·project-checkin.ts 등에
//   흩어져 있던 동일 구현의 표준화).
//   날짜 전용 문자열('YYYY-MM-DD')을 파싱한 Date(UTC 자정)에 적용해도 같은 날짜가
//   나오므로(+9h는 날짜 경계를 안 넘음), now 파생 Date 에 안전하게 적용 가능.

const KST_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

/** Date 인스턴스를 KST 기준 'YYYY-MM-DD' 문자열로 */
export function kstDateStr(d: Date): string {
  return KST_DATE_FMT.format(d);
}

/** KST 기준 오늘 'YYYY-MM-DD' */
export function todayKst(): string {
  return kstDateStr(new Date());
}

// ── datetime-local 입력용 KST 변환 (2026-07-27) ─────────────────────────────
//   timestamptz 를 그대로 slice(0,16) 하면 UTC 시각이 그대로 픽커에 들어가
//   KST 18:30 퇴근 기록이 09:30 으로 뜨고, 그 상태로 저장하면 -9h 씩 밀렸다.
//   브라우저 로컬 타임존에 의존하지 않도록 읽기·쓰기 양쪽을 KST 로 고정한다.

const KST_PARTS_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/** timestamptz(ISO) → datetime-local 값 'YYYY-MM-DDTHH:mm' (KST 기준) */
export function kstDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p: Record<string, string> = {};
  for (const part of KST_PARTS_FMT.formatToParts(d)) p[part.type] = part.value;
  // en-CA + hour12:false 는 자정을 '24' 로 내는 환경이 있어 '00' 으로 정규화한다.
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/** 화면 표시용 일시 'YYYY-MM-DD HH:mm' (KST). 화면마다 "2026. 8. 25. 18:16"/초 단위/ISO 가 섞이던 것을 통일 (2026-09-03) */
export function kstDateTime(iso: string | null | undefined): string {
  const v = kstDateTimeLocal(iso);
  return v ? v.replace("T", " ") : "";
}

/** datetime-local 값 'YYYY-MM-DDTHH:mm' (KST 로 해석) → 저장용 ISO 문자열 */
export function kstLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  // KST(UTC+9)는 서머타임이 없어 고정 오프셋 표기로 안전하게 파싱된다.
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 날짜 문자열(YYYY-MM-DD)에 일수를 더한다.
 *  ⚠️ new Date("...T00:00:00") 은 로컬 자정이고 toISOString() 은 UTC 라, 한국에서는
 *     하루 밀린다. 그래서 계산도 출력도 UTC 로만 한다(문자열 → UTC → 문자열). */
export function addDaysStr(date: string, days: number): string {
  const [y, m, d] = String(date).slice(0, 10).split("-").map(Number);
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 월요일 */
export function mondayOfStr(date: string): string {
  const [y, m, d] = String(date).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return addDaysStr(date, -((dt.getUTCDay() + 6) % 7));
}

/** 두 날짜 사이 일수(a - b) */
export function daysBetweenStr(a: string, b: string): number {
  const p = (x: string) => { const [y, m, d] = String(x).slice(0, 10).split("-").map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
  return Math.round((p(a) - p(b)) / 86_400_000);
}
