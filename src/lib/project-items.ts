// 프로젝트 "항목" 모델 정의 — 상세 한 장(탭 4) 개편의 심장 (2026-08-31 기획 v2.6, 결정 0)
//
// 배경: 자리 7 × 보기 14 × 템플릿 8 × 전용 입력 7 이 배워야 할 개념 30+ 를 만들었다(사장님:
//   "굉장히 어렵고 복잡"). 개념을 둘로 줄인다 — 프로젝트, 그리고 항목. 항목은 구분 4종 중 하나다.
// 절대규칙: 이 파일은 side-effect 0 · DB 의존 0 · 순수 정의만. (project-sections.ts 와 같은 원칙)

// ── 구분 (탭이자 입력 칩) ──────────────────────────────────
export type ItemKind = "todo" | "money" | "note";
export type MoneyKind = "spend" | "revenue";

export const KIND_TABS: { key: ItemKind | "docs"; label: string }[] = [
  { key: "todo", label: "할 일" },
  { key: "money", label: "매출·지출" },
  { key: "note", label: "회의·메모" },
  { key: "docs", label: "증빙·문서" },
];

/** 입력줄 구분 칩 — 매출·지출은 입력 시 money_kind 로 갈린다 */
export const INPUT_KINDS: { key: string; kind: ItemKind; moneyKind?: MoneyKind; label: string; icon: string }[] = [
  { key: "todo", kind: "todo", label: "할 일", icon: "✓" },
  { key: "spend", kind: "money", moneyKind: "spend", label: "지출", icon: "💸" },
  { key: "revenue", kind: "money", moneyKind: "revenue", label: "매출", icon: "💰" },
  { key: "note", kind: "note", label: "회의·메모", icon: "📝" },
];

// ── 할 일 단계 — 프로젝트별로 이름·구성을 바꿀 수 있다 (결정 0-3) ──
export type ItemStage = { id: string; label: string; color: "gray" | "indigo" | "orange" | "green" | "red" };

export const DEFAULT_STAGES: ItemStage[] = [
  { id: "todo", label: "대기", color: "gray" },
  { id: "doing", label: "진행 중", color: "orange" },
  { id: "done", label: "완료", color: "green" },
];

/** 검수 흐름 — 요청·검수 업무용 꾸러미가 쓰는 4단계 (구멍 ① 보완) */
export const REVIEW_STAGES: ItemStage[] = [
  { id: "todo", label: "요청", color: "gray" },
  { id: "doing", label: "진행 중", color: "orange" },
  { id: "review", label: "검수", color: "indigo" },
  { id: "done", label: "완료", color: "green" },
];

export function stagesOf(raw: unknown): ItemStage[] {
  if (Array.isArray(raw) && raw.length > 0 && raw.every((s) => s && typeof s === "object" && "id" in s && "label" in s)) {
    return raw as ItemStage[];
  }
  return DEFAULT_STAGES;
}

export function stageLabel(stages: ItemStage[], id: string): string {
  return stages.find((s) => s.id === id)?.label || (id === "done" ? "완료" : id === "doing" ? "진행 중" : "대기");
}

// ── 우선순위 ───────────────────────────────────────────────
export const PRIORITIES = [
  { id: "high", label: "높음" },
  { id: "mid", label: "보통" },
  { id: "low", label: "낮음" },
] as const;

// ── 시작 꾸러미 (결정 0-7) — 하려는 일 이름으로 고르고, 초기 내용만 채운다 ──
//   ⚠️ 구조를 결정하지 않는다: 어느 것을 골라도 화면은 같은 한 장 4탭. 옛 템플릿과 다른 점.
export type StarterSeed = {
  kind: ItemKind; moneyKind?: MoneyKind; name: string;
  tags?: string[]; priority?: "high" | "mid" | "low"; isMilestone?: boolean;
};
export type Starter = {
  key: string; icon: string; name: string; desc: string;
  stages?: ItemStage[];        // 없으면 기본 3단계
  firstTab: ItemKind | "docs"; // 만들고 처음 보여줄 탭
  seeds: StarterSeed[];
};

export const STARTERS: Starter[] = [
  {
    key: "service", icon: "🤝", name: "고객 용역·납품",
    desc: "견적→계약→청구 흐름 · 매출 예정 틀 · 검수 단계",
    stages: REVIEW_STAGES, firstTab: "money",
    seeds: [
      { kind: "money", moneyKind: "revenue", name: "계약금 청구" },
      { kind: "money", moneyKind: "revenue", name: "잔금 청구" },
      { kind: "todo", name: "견적서 보내기", priority: "high" },
      { kind: "todo", name: "결과물 검수 받기", isMilestone: true },
    ],
  },
  {
    key: "event", icon: "🎪", name: "행사·전시 준비",
    desc: "준비 할 일 목록 · 예산 틀 · D-day",
    firstTab: "todo",
    seeds: [
      { kind: "todo", name: "장소·부스 예약", priority: "high" },
      { kind: "todo", name: "인쇄물·배너 제작", tags: ["제작"] },
      { kind: "todo", name: "행사 당일", isMilestone: true },
      { kind: "money", moneyKind: "spend", name: "부스 임차료" },
      { kind: "money", moneyKind: "spend", name: "제작비 예산" },
    ],
  },
  {
    key: "campaign", icon: "📣", name: "마케팅 캠페인",
    desc: "소재·집행 할 일 · 광고비 예정 틀",
    firstTab: "todo",
    seeds: [
      { kind: "todo", name: "소재 기획·제작", tags: ["디자인"] },
      { kind: "todo", name: "채널 세팅·집행 시작", priority: "high" },
      { kind: "money", moneyKind: "spend", name: "광고비 예산" },
      { kind: "note", name: "캠페인 킥오프 회의" },
    ],
  },
  {
    key: "grant", icon: "🏛", name: "정부 지원사업",
    desc: "신청·증빙 할 일 · 보조금 매출 틀 · 정산 마감",
    firstTab: "todo",
    seeds: [
      { kind: "todo", name: "신청서 제출", priority: "high", isMilestone: true },
      { kind: "todo", name: "증빙 서류 준비" },
      { kind: "todo", name: "정산 보고", isMilestone: true },
      { kind: "money", moneyKind: "revenue", name: "보조금 수령" },
    ],
  },
  {
    key: "internal", icon: "🛠", name: "사내 개선·TF",
    desc: "할 일 · 회의록 위주 — 돈 없는 프로젝트",
    firstTab: "todo",
    seeds: [
      { kind: "todo", name: "현황 정리" },
      { kind: "todo", name: "개선안 확정", isMilestone: true },
      { kind: "note", name: "킥오프 회의" },
    ],
  },
  { key: "blank", icon: "📄", name: "빈 프로젝트", desc: "아무것도 채우지 않고 시작", firstTab: "todo", seeds: [] },
];

// ── 속성필드 (결정 8-2) — 프로젝트별 추가 칸. 값은 project_items.fields jsonb ──
export type FieldType = "text" | "number" | "date" | "select" | "person" | "partner";
export const FIELD_TYPES: { id: FieldType; label: string }[] = [
  { id: "text", label: "텍스트" }, { id: "number", label: "숫자" }, { id: "date", label: "날짜" },
  { id: "select", label: "선택" }, { id: "person", label: "사람" }, { id: "partner", label: "거래처" },
];
