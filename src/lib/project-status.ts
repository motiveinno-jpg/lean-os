// 프로젝트 상태 — 정상 / 주의 / 지연 (+ 완료). 화면 전체가 이 한 곳에서만 상태를 받는다.
//
// 배경 (2026-08-03 개편 기획안 ①):
//   같은 뜻을 화면마다 다른 이름으로 불렀다 — 목록 렌즈는 "위험·지연", 카드 배지는 "지연 있음",
//   다음 액션은 "마감 기한 초과". 셋 다 같은 상태다. 사용자가 외워야 할 상태 단어가 13개였다.
//   → 단어를 3개로 줄이고, 목록 칩 · 카드 배지 · 표의 상태 열 · 상세 머리가 모두 이 함수를 쓴다.
//
// 단계(견적→계약→진행→정산)와 섞지 않는다. 단계는 "어디까지 왔나", 상태는 "지금 괜찮은가".
//
// 절대규칙: 순수 함수. side-effect 0, DB 의존 0. 판정 기준을 바꾸려면 여기만 고친다.

export type ProjectStatusKey = "late" | "warn" | "normal" | "done";

export const STATUS_LABEL: Record<ProjectStatusKey, string> = {
  late: "지연",
  warn: "주의",
  normal: "정상",
  done: "완료",
};

/** 급한 순 정렬용 — 낮을수록 위 */
export const STATUS_RANK: Record<ProjectStatusKey, number> = { late: 0, warn: 1, normal: 2, done: 3 };

/** 60일 넘게 못 받은 돈은 '주의'가 아니라 '지연'으로 본다 */
export const OVERDUE_PAYMENT_DAYS = 60;
/** 이 기간 아무 움직임이 없으면 '주의' (조용한 프로젝트 체크인과 같은 기준) */
export const QUIET_DAYS = 14;

export type StatusInput = {
  /** deals.stage */
  stage?: string | null;
  /** deals.end_date (YYYY-MM-DD) */
  endDate?: string | null;
  /** KST 오늘 (YYYY-MM-DD) */
  today: string;
  /** 지연된 할 일이 있는가 */
  overdueTasks?: boolean;
  /** 미수금(원). 1원 이하는 반올림 잔돈으로 보고 무시한다 */
  outstanding?: number;
  /** 가장 오래된 미수 계산서의 경과일 */
  oldestUnpaidDays?: number | null;
  /** 마지막 움직임 이후 경과일 */
  quietDays?: number | null;
  /** 대표 지표가 위험(마진 적자 등) */
  metricRisk?: boolean;
};

export type ProjectStatus = {
  key: ProjectStatusKey;
  label: string;
  /** 왜 이 상태인지 한 줄 — 화면에 그대로 쓴다 */
  why: string;
  /** 마감까지 남은 일수(음수=초과). 없으면 null */
  daysToEnd: number | null;
};

/** 마감까지 남은 일수. end_date 가 없으면 null. */
export function daysToEnd(endDate: string | null | undefined, today: string): number | null {
  if (!endDate) return null;
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  return Math.round((end.getTime() - now.getTime()) / 86_400_000);
}

export function getProjectStatus(i: StatusInput): ProjectStatus {
  const dd = daysToEnd(i.endDate, i.today);
  const out = Number(i.outstanding || 0);
  const finished = i.stage === "completed" || i.stage === "settlement";

  // 완료 — 끝났고 받을 돈도 없다. 끝났는데 미수가 남았으면 완료가 아니라 지연/주의로 내려간다.
  if (finished && out <= 1) {
    return { key: "done", label: STATUS_LABEL.done, why: "완료됐어요", daysToEnd: dd };
  }

  // 지연 — 기한을 넘겼거나, 할 일이 밀렸거나, 돈이 오래 안 들어왔거나, 남는 게 없다
  if (!finished && dd != null && dd < 0) {
    return { key: "late", label: STATUS_LABEL.late, why: `마감일이 ${-dd}일 지났어요`, daysToEnd: dd };
  }
  if (i.overdueTasks) {
    return { key: "late", label: STATUS_LABEL.late, why: "지연된 업무가 있어요", daysToEnd: dd };
  }
  if (i.oldestUnpaidDays != null && i.oldestUnpaidDays > OVERDUE_PAYMENT_DAYS && out > 1) {
    return { key: "late", label: STATUS_LABEL.late, why: `${i.oldestUnpaidDays}일째 미수금이 남아 있어요`, daysToEnd: dd };
  }
  if (i.metricRisk) {
    return { key: "late", label: STATUS_LABEL.late, why: "마진이 적자예요", daysToEnd: dd };
  }

  // 주의 — 곧 마감이거나, 받을 돈이 있거나, 오래 조용하다
  if (!finished && dd != null && dd <= 7) {
    return { key: "warn", label: STATUS_LABEL.warn, why: dd === 0 ? "오늘 마감이에요" : `마감이 ${dd}일 남았어요`, daysToEnd: dd };
  }
  if (out > 1) {
    return { key: "warn", label: STATUS_LABEL.warn, why: "미수금이 남아 있어요", daysToEnd: dd };
  }
  if (i.quietDays != null && i.quietDays >= QUIET_DAYS) {
    return { key: "warn", label: STATUS_LABEL.warn, why: `${i.quietDays}일째 변동이 없어요`, daysToEnd: dd };
  }

  return {
    key: "normal",
    label: STATUS_LABEL.normal,
    why: dd != null ? `다음 마감까지 ${dd}일` : "특별히 챙길 건 없어요",
    daysToEnd: dd,
  };
}
