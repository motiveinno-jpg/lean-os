// 프로젝트 "자리(섹션)" · "보기(뷰)" 정의 — 유형 3분할(project_type)을 대체한다.
//
// 배경 (2026-07-30 사장님 승인, 기획 v3):
//   기존 project-types.ts 는 유형(margin/goal/delivery)으로 "보이는 탭"을 결정했다.
//   유형은 생성 후 변경 불가라, 수익형으로 만든 프로젝트 30개가 진행률·성과를 영구히
//   쓸 수 없었다(실측: 태스크는 2개 프로젝트, KPI는 3개 프로젝트에만 존재).
//   → 분류를 없애고, 데이터가 생기면 그 자리가 저절로 열리는 방식으로 바꾼다.
//
// 절대규칙: side-effect 0, DB 의존성 0, 순수 함수만. 단위테스트 가능.
//   (히어로 지표 산식 자체는 project-types.ts 의 getHeroMetric 을 그대로 재사용한다 —
//    마진율·달성률·진행률 계산은 검증된 코드라 건드리지 않는다.)

import { getHeroMetric, type HeroMetric, type HeroMetricInput } from "@/lib/project-types";

// ── 자리(섹션) ─────────────────────────────────────────────
//   순서는 "보는 빈도 × 지금 행동해야 하는가" 기준으로 고정한다. 프로젝트마다 자리가
//   늘거나 줄 뿐, 순서는 절대 바뀌지 않는다(한 번 배우면 다시 안 배운다).
export type SectionKey = "todo" | "flow" | "money" | "work" | "goal" | "team" | "boards";

//   boards = 새 프로젝트 구조의 표(2026-08-03 기획 v2). 1단계에서는 별도 탭으로 붙여 두고,
//   구조가 자리 잡으면 나머지 자리를 여기로 흡수한다.
export const SECTION_ORDER: SectionKey[] = ["boards", "todo", "flow", "money", "work", "goal", "team"];

/** 목차(레일)에 쓰는 짧은 이름
 *   ⚠️ 이름은 회사에서 실제로 쓰는 말로만 짓는다(2026-08-03 사장님 지시).
 *      구 "돈 / 일 / 성과 / 팀" 은 뜻은 통해도 업무에서 안 쓰는 말이라
 *      → 매출·비용 / 업무 / 목표·실적 / 구성원 으로 바꿨다. 회계·영업 문서와 같은 낱말을 쓴다. */
export const SECTION_LABEL: Record<SectionKey, string> = {
  todo: "확인 필요",
  flow: "진행 단계",
  money: "매출·비용",
  work: "업무",
  goal: "목표·실적",
  team: "구성원",
  boards: "표",
};

/** 자리 제목 — 본문 머리에 쓰는 이름 */
export const SECTION_TITLE: Record<SectionKey, string> = {
  todo: "확인이 필요한 항목",
  flow: "진행 단계",
  money: "매출·비용",
  work: "업무",
  goal: "목표별 실적",
  team: "구성원과 기록",
  boards: "표",
};

// ── 보기(뷰) ───────────────────────────────────────────────
//   같은 데이터를 다르게 본다. 첫 항목이 그 자리의 기본 보기(가장 단순한 것).
export type SectionView = { key: string; label: string };

//   ⚠️ 여기 정의한 보기는 화면에 실제로 구현된 것만 둔다 — 정의만 있고 화면이 없으면
//      눌렀을 때 빈 화면이 된다. 추세·분해 같은 추가 보기는 구현과 함께 넣는다.
export const SECTION_VIEWS: Record<SectionKey, SectionView[]> = {
  todo: [{ key: "queue", label: "급한 순" }],
  flow: [{ key: "ribbon", label: "단계" }],
  money: [{ key: "ledger", label: "매출·매입" }, { key: "docs", label: "견적·계약" }, { key: "cost", label: "비용" }],
  work: [{ key: "tasks", label: "할 일" }, { key: "schedule", label: "마일스톤" }, { key: "issues", label: "이슈" }],
  goal: [{ key: "score", label: "실적" }, { key: "manage", label: "목표 설정" }],
  team: [{ key: "who", label: "담당" }, { key: "activity", label: "활동 이력" }, { key: "info", label: "기본 정보" }],
  boards: [{ key: "table", label: "표" }],
};

// ── 목록 화면 보기 ──────────────────────────────────────────
//   board = 기존 워크플로우 보드(monday-board.tsx). 회사 전체 프로젝트를 커스텀 컬럼으로
//   보는 도구라 목록 레벨이 원래 자리다 — 실행형 프로젝트 상세 탭에 있던 것을 끌어올렸다.
//   ready:false 는 아직 구현 전(3단계 예정) — UI 에 노출하지 않는다.
export type ListView = { key: string; label: string; desc: string; ready: boolean };

//   보기를 6종이나 고르게 하지 않는다(2026-08-03 개편 ②). 평소 쓰는 3종만 남기고,
//   가끔 보는 분석(타임라인·차트)은 따로 뺀다. 'card' 는 폐지 — 목록이 카드를 겸한다
//   (문제 있는 건은 카드로 위에, 나머지는 한 줄씩).
export const LIST_VIEWS: ListView[] = [
  { key: "table", label: "목록", desc: "확인이 필요한 건은 카드로, 나머지는 한 줄씩", ready: true },
  { key: "board", label: "보드", desc: "회사가 만든 컬럼으로 관리하는 보드(워크플로우)", ready: true },
  { key: "cal", label: "캘린더", desc: "시작일·마감을 달에 배치", ready: true },
  { key: "people", label: "담당별", desc: "누가 몇 건을 맡고 있는지 사람 기준으로", ready: true },
];

/** 분석 보기 — 평소 목록과 섞지 않고 '분석' 에서 연다 */
export const ANALYSIS_VIEWS: ListView[] = [
  { key: "chart", label: "차트", desc: "파이프라인·마진 순위·미수 에이징 분석", ready: true },
  { key: "timeline", label: "타임라인", desc: "프로젝트 기간을 막대로 겹쳐 보기", ready: true },
];

export const READY_LIST_VIEWS = LIST_VIEWS.filter((v) => v.ready);
export const ALL_LIST_VIEWS = [...LIST_VIEWS, ...ANALYSIS_VIEWS];

/** 알 수 없는 값이 오면 기본 보기(목록)로 — 옛 'card' 저장값도 목록으로 받는다. */
export function normalizeListView(v: unknown): string {
  return ALL_LIST_VIEWS.some((x) => x.key === v) ? (v as string) : "table";
}

/** 보기 저장 키 — 사람별로 기억한다(신규 사용자는 저장값이 없어 항상 '카드'로 시작). */
export function viewStorageKey(scope: string, userId?: string | null): string {
  return `ov.view.${scope}.${userId || "anon"}`;
}

// ── 자리 노출 판정 ──────────────────────────────────────────
//   "모듈을 켤까요?" 를 묻지 않는다. 데이터가 생기면 그 자리가 열린다.

export type ProjectSignals = {
  /** 계약금액·견적·매출/매입 항목·계산서 중 하나라도 있음 */
  hasMoney?: boolean;
  /** 할 일(태스크)·마일스톤 중 하나라도 있음 */
  hasWork?: boolean;
  /** KPI(목표)가 하나라도 있음 */
  hasGoal?: boolean;
  /** 담당이 2명 이상이거나 채널·결재가 붙어 있음 */
  hasTeam?: boolean;
};

/**
 * 지금 열려 있어야 하는 자리 목록 (SECTION_ORDER 순서 유지).
 *   · todo: 항상 — 화면을 여는 이유가 이것이다(빈 프로젝트에서는 시작 제안 카드가 뜬다).
 *   · flow: 돈·일 중 하나라도 있을 때 (아무것도 없으면 보여줄 흐름이 없다)
 *   · money/work/goal/team: 각 신호가 있을 때
 */
export function getVisibleSections(s: ProjectSignals): SectionKey[] {
  const hasAny = !!s.hasMoney || !!s.hasWork;
  const on: Record<SectionKey, boolean> = {
    boards: true,   // 표는 언제나 열려 있다 — 입력이 기본 활동이다
    todo: true,
    flow: hasAny,
    money: !!s.hasMoney,
    work: !!s.hasWork,
    goal: !!s.hasGoal,
    team: !!s.hasTeam,
  };
  return SECTION_ORDER.filter((k) => on[k]);
}

/** 아직 안 열린 자리 — "＋ 목표 정하기" 처럼 한 줄 제안으로 노출할 대상 */
export function getDormantSections(s: ProjectSignals): SectionKey[] {
  const open = new Set(getVisibleSections(s));
  return SECTION_ORDER.filter((k) => !open.has(k) && k !== "todo" && k !== "flow");
}

// ── 대표 지표 자동 선택 ─────────────────────────────────────
//   유형별로 히어로 지표를 고정하던 것을 대체한다. 사용자가 "이 프로젝트의 대표 지표는
//   무엇으로 할까" 를 정하지 않는다 — 있는 데이터에서 고른다.
//   우선순위: 매출·비용(마진) > 목표·실적(달성률) > 업무(진행률). 돈이 걸린 프로젝트는 마진이 먼저다.

export type HeadlineKind = "margin" | "achievement" | "progress" | "none";

export const HEADLINE_LABEL: Record<HeadlineKind, string> = {
  margin: "마진율",
  achievement: "달성률",
  progress: "진행률",
  none: "—",
};

export function pickHeadlineKind(s: ProjectSignals): HeadlineKind {
  if (s.hasMoney) return "margin";
  if (s.hasGoal) return "achievement";
  if (s.hasWork) return "progress";
  return "none";
}

export type HeadlineInput = HeroMetricInput & {
  /** 다중 KPI 종합 달성률(0~1). goal 신호가 있을 때만 의미 있음 */
  achievement?: number | null;
};

export type Headline = HeroMetric & { kind: HeadlineKind; name: string };

/**
 * 대표 지표 1개 산출 — 목록 카드·표·상세 머리에서 공용으로 쓴다.
 *   margin      → getHeroMetric("margin", {revenue, cost})
 *   achievement → 종합 달성률(0~1) 을 그대로 백분율로
 *   progress    → getHeroMetric("delivery", {taskTotal, taskDone})
 */
export function getHeadline(s: ProjectSignals, input: HeadlineInput): Headline {
  const kind = pickHeadlineKind(s);
  const name = HEADLINE_LABEL[kind];
  if (kind === "achievement") {
    const a = input.achievement;
    if (a == null) return { kind, name, pct: 0, raw: null, risk: false, label: "—" };
    const p = Math.round(a * 100);
    return { kind, name, pct: Math.max(0, Math.min(100, p)), raw: a, risk: false, label: `${p}%` };
  }
  if (kind === "progress") {
    return { kind, name, ...getHeroMetric("delivery", input) };
  }
  if (kind === "margin") {
    return { kind, name, ...getHeroMetric("margin", input) };
  }
  return { kind, name, pct: 0, raw: null, risk: false, label: "—" };
}
