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
