//   연차 사용 촉진 일정 — 근로기준법 제61조. 휴가 › 촉진 화면·처리할 것·촉진 통보 기한이 이 계산 하나를 쓴다.
//   전에는 회사가 '입사일 기준'으로 연차를 줘도 촉진 안내가 회계연도(7/1~7/10 · 10/31) 일정으로만 나왔다.
//
//   ① 1년 이상 근로자의 연차(제61조 제1항) — 사용기간이 끝나기
//      · 6개월 전을 기준으로 10일 이내: 미사용 일수를 알리고 사용 시기를 정해 통보하라고 서면 촉구(1차)
//      · 촉구를 받은 때부터 10일 안에 근로자가 사용 시기를 안 정하면, 2개월 전까지 회사가 사용 시기를 정해 서면 통보(2차)
//   ② 1년 미만 근로자의 월 연차(제61조 제2항, 제60조 제2항) — 최초 1년의 근로기간이 끝나기
//      · 3개월 전을 기준으로 10일 이내 1차 촉구, 1개월 전까지 2차 통보
//      · 1차 촉구 뒤에 생긴 휴가는 1개월 전을 기준으로 5일 이내 촉구, 10일 전까지 통보
//
//   사용기간
//   · 입사일 기준: 입사 응당일 ~ 다음 응당일 전날 (1년 미만이면 입사일 ~ 1주년 전날)
//   · 회계연도 기준: 1/1 ~ 12/31 (1년 미만 근로자의 월 연차는 기준과 무관하게 입사 1주년 전날까지 — 제60조 제7항)
//   'N개월 전' 은 사용기간이 끝난 다음 날(소멸일)에서 N개월을 뺀 날, '까지' 는 그 전날까지로 센다
//   (회계연도 12/31 만료 → 1차 7/1~7/10 · 2차 10/31 까지로, 고용노동부 안내 예시와 같다).

import type { MonthlyAccrualBasis } from "@/lib/leave-grants";
import { anniversary } from "@/lib/tenure";

export type PromotionKind = "annual" | "under-year";
export type PromotionSchedule = {
  kind: PromotionKind;
  /** 사용기간 시작·끝(끝 = 이날까지 쓸 수 있다) */
  periodStart: string;
  periodEnd: string;
  /** 1차 서면 촉구 기간 */
  firstFrom: string;
  firstTo: string;
  /** 2차 서면 통보 기한(이날까지) */
  secondBy: string;
  /** 1년 미만만 — 1차 촉구 뒤에 생긴 휴가의 촉구 기간·통보 기한 */
  laterFirstFrom?: string;
  laterFirstTo?: string;
  laterSecondBy?: string;
};

const p = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return { y, m, d }; };
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const { y, m, d } = p(s); return fmt(Date.UTC(y, m - 1, d) + n * 86_400_000); };
/** 달 더하기 — 없는 날(2/30 등)은 그 달 말일로 */
const addMonths = (s: string, n: number) => {
  const { y, m, d } = p(s);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fmt(Date.UTC(y, m - 1 + n, Math.min(d, last)));
};

/** today 가 속한 촉진 대상 사용기간의 일정. 입사일이 없거나 입사 전이면 null */
export function promotionSchedule(hireDate: string | null | undefined, basis: MonthlyAccrualBasis, today: string): PromotionSchedule | null {
  if (!hireDate) return null;
  const hire = hireDate.slice(0, 10);
  if (today < hire) return null;
  const firstAnniv = anniversary(hire, 12);
  if (today < firstAnniv) {
    //   ② 1년 미만 — 소멸일 = 입사 1주년
    const expiry = firstAnniv;
    const firstFrom = addMonths(expiry, -3);
    const laterFirstFrom = addMonths(expiry, -1);
    return {
      kind: "under-year", periodStart: hire, periodEnd: addDays(expiry, -1),
      firstFrom, firstTo: addDays(firstFrom, 9),
      secondBy: addDays(addMonths(expiry, -1), -1),
      laterFirstFrom, laterFirstTo: addDays(laterFirstFrom, 4),
      laterSecondBy: addDays(expiry, -11),
    };
  }
  let start: string, expiry: string;
  if (basis === "fiscal") {
    const y = today.slice(0, 4);
    start = `${y}-01-01`; expiry = `${Number(y) + 1}-01-01`;
  } else {
    //   가장 최근 입사 응당일 ~ 다음 응당일
    let n = Number(today.slice(0, 4)) - Number(hire.slice(0, 4));
    while (n > 1 && anniversary(hire, 12 * n) > today) n--;
    if (anniversary(hire, 12 * n) > today) n--;
    start = anniversary(hire, 12 * n); expiry = anniversary(hire, 12 * (n + 1));
  }
  const firstFrom = addMonths(expiry, -6);
  return { kind: "annual", periodStart: start, periodEnd: addDays(expiry, -1), firstFrom, firstTo: addDays(firstFrom, 9), secondBy: addDays(addMonths(expiry, -2), -1) };
}

export type PromotionPhase = { code: "before" | "first" | "between" | "late" | "over"; text: string; tone: "" | "warn" | "danger" };

const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

/** 오늘이 일정의 어디쯤인지 — 화면 한 줄 안내와 '처리할 것' 에 쓴다 */
export function promotionPhase(s: PromotionSchedule, today: string): PromotionPhase {
  const plan = `1차 ${md(s.firstFrom)}~${md(s.firstTo)} · 2차 ${md(s.secondBy)}까지`;
  if (today < s.firstFrom) return { code: "before", text: `아직 통보 시기가 아닙니다 (${plan})`, tone: "" };
  if (today <= s.firstTo) return { code: "first", text: `1차 촉구 기간입니다 (${plan})`, tone: "warn" };
  if (today <= s.secondBy) return { code: "between", text: `1차 기간은 지났고 2차 통보는 ${md(s.secondBy)}까지입니다`, tone: "warn" };
  if (today <= s.periodEnd) return { code: "late", text: `2차 통보 기한(${md(s.secondBy)})이 지났습니다 — 촉진을 마치지 못했으면 미사용분은 보상 대상입니다`, tone: "danger" };
  return { code: "over", text: "사용기간이 끝났습니다", tone: "" };
}

/** 통보에 적는 기한 — 1차: 촉구를 받은 날부터 10일(사용 시기 회신), 2차: 사용기간 마지막 날 */
export function promotionNoticeDeadline(s: PromotionSchedule | null, noticeType: "first" | "second", sentDate: string): string {
  if (noticeType === "first") return addDays(sentDate, 10);
  return s ? s.periodEnd : addDays(sentDate, 30);
}
