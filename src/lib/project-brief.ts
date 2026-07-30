// 주간 성과 체크인 "초안" 생성 (2026-07-30 기획 v3 4단계).
//
// 왜 필요한가: 프로덕션 전체에서 성과 체크인이 **1건**만 작성됐다. 기능이 없어서가 아니라
//   매주 빈 칸을 사람이 채워야 했기 때문이다. 숫자는 시스템이 이미 알고 있으니 초안까지
//   써두고, 사람은 판단 한 줄만 덧붙인다.
//
// 절대규칙: side-effect 0, DB 의존성 0, 순수 함수만. 단위테스트 가능.
//   ⚠️ 없는 숫자를 만들지 않는다. 계산 불가(target<=0 등)면 그 항목은 문장에서 빼고,
//      비교할 지난 기록이 없으면 증감을 쓰지 않는다. 초안이 한 번이라도 틀리면 아무도 안 쓴다.

export type BriefKpi = {
  label: string;
  unit?: string | null;
  /** 달성률 0~1 (계산 불가면 null) */
  achievement: number | null;
};

export type BriefInput = {
  /** "7월 4주" 처럼 사람이 읽는 기간 이름. 없으면 문장에서 생략 */
  periodLabel?: string | null;
  kpis: BriefKpi[];
  /** 지난 체크인 시점의 종합 달성률 0~1 (없으면 증감 문장 생략) */
  prevOverall?: number | null;
  /** 마감이 지난 미완료 할 일 수 */
  overdueTasks?: number;
  /** 열린 이슈 수 */
  openIssues?: number;
  /** 미수 금액(원). 0 이하면 생략 */
  outstanding?: number | null;
};

export type BriefDraft = {
  /** 체크인 본문 초안 */
  body: string;
  /** 신호등 제안 */
  status: "green" | "yellow" | "red";
  /** 왜 그 신호등인지 — 화면에 함께 보여 판단 근거를 남긴다 */
  reason: string;
  /** 종합 달성률 0~1 (계산 가능한 KPI 평균). 없으면 null */
  overall: number | null;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 종합 달성률 — 계산 가능한 KPI 의 평균(0~1). 없으면 null */
export function overallOf(kpis: BriefKpi[]): number | null {
  const vals = kpis.map((k) => k.achievement).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * 신호등 제안 규칙 (근거를 함께 반환):
 *   · 마감 지난 할 일이 있으면 최소 '주의' — 숫자가 좋아도 약속이 밀린 건 알려야 한다.
 *   · 종합 90% 이상 정상 / 70~90% 주의 / 70% 미만 위험.
 *   · 종합을 계산할 수 없으면(목표 미설정) '주의' — 모르는 상태를 정상이라 하지 않는다.
 */
export function suggestStatus(overall: number | null, overdueTasks = 0): { status: BriefDraft["status"]; reason: string } {
  if (overall == null) {
    return { status: "yellow", reason: "목표값이 없어 달성률을 계산할 수 없어요 — 확인이 필요해요" };
  }
  if (overall < 0.7) {
    return { status: "red", reason: `종합 달성률 ${pct(overall)} — 70% 미만이에요` };
  }
  if (overdueTasks > 0) {
    return { status: "yellow", reason: `지연된 할 일 ${overdueTasks}건이 있어요` };
  }
  if (overall < 0.9) {
    return { status: "yellow", reason: `종합 달성률 ${pct(overall)} — 90% 미만이에요` };
  }
  return { status: "green", reason: `종합 달성률 ${pct(overall)} — 순항 중이에요` };
}

/** 체크인 초안 — 본문 + 신호등 제안. 마지막 줄은 사람이 채울 자리를 비워둔다. */
export function buildCheckinDraft(input: BriefInput): BriefDraft {
  const overall = overallOf(input.kpis);
  const { status, reason } = suggestStatus(overall, input.overdueTasks || 0);

  const parts: string[] = [];

  if (overall != null) {
    const head = input.periodLabel ? `${input.periodLabel} 종합 달성률 ${pct(overall)}` : `종합 달성률 ${pct(overall)}`;
    if (input.prevOverall != null) {
      const diff = Math.round((overall - input.prevOverall) * 100);
      const move = diff > 0 ? `+${diff}%p` : diff < 0 ? `${diff}%p` : "변동 없음";
      parts.push(`${head} (지난 체크인 ${pct(input.prevOverall)} → ${move}).`);
    } else {
      parts.push(`${head}.`);
    }
  }

  // KPI 별 달성률 — 계산 가능한 것만, 최대 4개까지(길어지면 안 읽는다)
  const shown = input.kpis.filter((k) => k.achievement != null).slice(0, 4);
  if (shown.length > 0) {
    parts.push(shown.map((k) => `${k.label} ${pct(k.achievement as number)}`).join(" · ") + ".");
  }

  const risks: string[] = [];
  if ((input.overdueTasks || 0) > 0) risks.push(`지연된 할 일 ${input.overdueTasks}건`);
  if ((input.openIssues || 0) > 0) risks.push(`열린 이슈 ${input.openIssues}건`);
  if (input.outstanding != null && input.outstanding > 1) risks.push(`미수 ${won(input.outstanding)}`);
  if (risks.length > 0) parts.push(`${risks.join(" · ")}.`);

  if (parts.length === 0) {
    parts.push("아직 집계할 실적이 없어요.");
  }

  // 마지막 줄 — 사람이 판단을 적는 자리. 이 문구를 지우지 않고 그대로 제출해도 뜻이 통한다.
  parts.push("\n판단: ");

  return { body: parts.join(" ").replace(" \n", "\n"), status, reason, overall };
}
