// 자금 전망 기본 기간 — 앱 화면(/reports/outlook)의 첫 기간과 공개 페이지의 「N주 자금 캘린더」 문구가 같은 값을 쓴다.
//   cash-outlook.ts 는 DB 조회를 끌고 와 공개 페이지 번들에 넣을 수 없어 숫자만 따로 둔다.
//   기간을 바꾸면 랜딩·업종 페이지의 주 수도 같이 바뀐다.

/** 자금 전망 화면을 처음 열 때 보는 기간(일) */
export const OUTLOOK_DEFAULT_DAYS = 90;

/** 기본 기간을 주 단위로 셈 — 90일 ≈ 13주. 달력은 월요일로 끊어 첫·끝 주가 짧을 수 있다 */
export const OUTLOOK_DEFAULT_WEEKS = Math.round(OUTLOOK_DEFAULT_DAYS / 7);
