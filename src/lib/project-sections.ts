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
export type SectionKey = "todo" | "flow" | "money" | "work" | "goal" | "team";

export const SECTION_ORDER: SectionKey[] = ["todo", "flow", "money", "work", "goal", "team"];

/** 목차(레일)에 쓰는 짧은 이름 */
export const SECTION_LABEL: Record<SectionKey, string> = {
  todo: "할 일",
  flow: "흐름",
  money: "돈",
  work: "일",
  goal: "성과",
  team: "팀",
};

/** 자리 제목 — 본문 머리에 쓰는 문장형 이름 */
export const SECTION_TITLE: Record<SectionKey, string> = {
  todo: "지금 할 일",
  flow: "어디까지 왔나",
  money: "돈",
  work: "일",
  goal: "성과",
  team: "사람과 기록",
};

// ── 보기(뷰) ───────────────────────────────────────────────
//   같은 데이터를 다르게 본다. 첫 항목이 그 자리의 기본 보기(가장 단순한 것).
export type SectionView = { key: string; label: string };

//   ⚠️ 여기 정의한 보기는 화면에 실제로 구현된 것만 둔다 — 정의만 있고 화면이 없으면
//      눌렀을 때 빈 화면이 된다. 추세·분해 같은 추가 보기는 구현과 함께 넣는다.
export const SECTION_VIEWS: Record<SectionKey, SectionView[]> = {
  todo: [{ key: "queue", label: "급한 순" }],
  flow: [{ key: "ribbon", label: "흐름" }],
  money: [{ key: "ledger", label: "원장" }, { key: "docs", label: "문서" }, { key: "cost", label: "비용" }],
  work: [{ key: "tasks", label: "할 일" }, { key: "issues", label: "이슈" }],
  goal: [{ key: "score", label: "성과" }, { key: "manage", label: "목표 관리" }],
  team: [{ key: "activity", label: "활동" }, { key: "info", label: "기본 정보" }],
};

// ── 목록 화면 보기 ──────────────────────────────────────────
//   board = 기존 워크플로우 보드(monday-board.tsx). 회사 전체 프로젝트를 커스텀 컬럼으로
//   보는 도구라 목록 레벨이 원래 자리다 — 실행형 프로젝트 상세 탭에 있던 것을 끌어올렸다.
//   ready:false 는 아직 구현 전(3단계 예정) — UI 에 노출하지 않는다.
export type ListView = { key: string; label: string; desc: string; ready: boolean };

export const LIST_VIEWS: ListView[] = [
  { key: "card", label: "카드", desc: "프로젝트마다 대표 지표와 다음 액션을 한 장으로", ready: true },
  { key: "table", label: "표", desc: "정렬·비교하기 좋은 한 줄 목록", ready: true },
  { key: "board", label: "보드", desc: "회사가 만든 컬럼으로 관리하는 보드(워크플로우)", ready: true },
  { key: "timeline", label: "타임라인", desc: "프로젝트 기간을 막대로 겹쳐 보기", ready: false },
  { key: "chart", label: "차트", desc: "파이프라인·손익·미수 분석", ready: false },
  { key: "cal", label: "캘린더", desc: "청구일·마감·서명 기한을 달에 배치", ready: false },
];

export const READY_LIST_VIEWS = LIST_VIEWS.filter((v) => v.ready);

/** 알 수 없는 값이 오면 기본 보기(카드)로 — 저장된 값이 깨져도 화면은 뜬다. */
export function normalizeListView(v: unknown): string {
  return READY_LIST_VIEWS.some((x) => x.key === v) ? (v as string) : "card";
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
//   우선순위: 돈(마진) > 성과(달성률) > 일(진행률). 돈이 걸린 프로젝트는 마진이 먼저다.

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
