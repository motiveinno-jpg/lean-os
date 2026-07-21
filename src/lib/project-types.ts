// 프로젝트 유형(렌즈) 설정 — "공통 척추 + 유형 렌즈".
//   하나의 deals 행 + project_type 으로 (1)히어로 지표 (2)보이는 탭만 바꾼다. 페이지 포크 금지.
//   margin=수익형(마진률) · goal=목표형(달성률) · delivery=실행형(진행률).
//
// 절대규칙: side-effect 0, DB 의존성 0, 순수 함수만. 단위테스트 가능.

import { todayKst } from "@/lib/kst";
import { businessDaysBetween } from "@/lib/project-checkin";

export type ProjectType = "margin" | "goal" | "delivery";

// KPI 실적 출처 (주간보고 양식 §12-B/C). manual 외 3종은 태깅 회계데이터 자동 집계.
export type KpiSource = "manual" | "revenue_auto" | "profit_auto" | "count_auto";
export const KPI_SOURCE_LABEL: Record<KpiSource, string> = {
  manual: "수동 입력",
  revenue_auto: "매출 자동",
  profit_auto: "이익 자동",
  count_auto: "건수 자동",
};

// 상세 페이지의 탭 키 (page.tsx 의 TabKey 와 동일 집합).
//   margin = 현행 전체. goal/delivery = 유형 전용 탭으로 축소.
export type ProjectTabKey =
  | "overview"
  | "quote"
  | "contract"
  | "subdeals"
  | "transactions"
  | "issues"
  | "sales_pipeline"
  | "purchase_pipeline"
  | "subprojects"
  | "pnl"
  | "performance"
  | "tasks"
  | "workflow";

export type ProjectTypeConfig = {
  type: ProjectType;
  label: string;
  icon: string;
  desc: string;
  /** 히어로 지표 라벨 (정규화된 0~100% 게이지의 이름) */
  hero: string;
  /** 상세 페이지에서 노출할 탭 키 (순서대로) */
  tabs: ProjectTabKey[];
};

export const PROJECT_TYPES: Record<ProjectType, ProjectTypeConfig> = {
  margin: {
    type: "margin",
    label: "수익형",
    icon: "💰",
    desc: "계약·매출·매입으로 마진(수익성)을 관리하는 프로젝트. 견적·계약·손익 전체를 다룹니다.",
    hero: "마진률",
    // 거래 원장(부호 기반 매출·매입 단일 리스트) + 견적/계약/계산서 문서 흐름을 한 탭으로 통합.
    //   기존 수주/발주 2탭은 혼동을 줄이려 '거래' 하나로 축소(2026-07).
    tabs: ["overview", "transactions", "pnl", "subprojects"],
  },
  goal: {
    type: "goal",
    label: "목표형",
    icon: "🎯",
    desc: "여러 KPI(매출·건수 등)와 정성 성과 체크인으로 목표 달성을 관리하는 성과관리 프로젝트.",
    hero: "달성률",
    // 목표형은 성과 중심 — 무거운 칸반 대신 성과 탭 안 '실행 계획'(체크리스트)으로. 이슈=문제 트래커.
    tabs: ["overview", "performance", "issues"],
  },
  delivery: {
    type: "delivery",
    label: "실행형",
    icon: "✅",
    desc: "할 일(태스크)을 칸반·간트로 실행하며 진행률을 관리하는 프로젝트.",
    hero: "진행률",
    tabs: ["overview", "tasks", "workflow"],
  },
};

export const PROJECT_TYPE_ORDER: ProjectType[] = ["margin", "goal", "delivery"];

/** 알 수 없는/없는 project_type → margin 폴백 (회귀 안전). */
export function normalizeProjectType(t: unknown): ProjectType {
  return t === "goal" || t === "delivery" ? t : "margin";
}

export function getProjectTypeConfig(t: unknown): ProjectTypeConfig {
  return PROJECT_TYPES[normalizeProjectType(t)];
}

// ── 히어로 지표 정규화 (0~100%) ──
//   유형별로 의미가 다른 진척도를 단일 0~100 스케일로. 목록 막대·상세 게이지 공용.
//   margin: 마진률(=마진/매출). 음수면 0 으로 클램프하되 risk 플래그로 위험 표기.
//   goal:   달성률(=누적실적/목표).
//   delivery: 진행률(=완료태스크/전체).

export type HeroMetricInput = {
  // margin
  revenue?: number | null;
  cost?: number | null;
  // goal
  targetAmount?: number | null;
  actualAmount?: number | null;
  // delivery
  taskTotal?: number | null;
  taskDone?: number | null;
};

export type HeroMetric = {
  /** 0~100 (UI 막대/게이지용, 클램프됨) */
  pct: number;
  /** 표시용 원시 비율(클램프 전, 소수). null=계산불가 */
  raw: number | null;
  /** 위험 여부 (마진<0 등) → 빨강 표시 */
  risk: boolean;
  /** 표시 라벨 ("63%" 또는 "—") */
  label: string;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function getHeroMetric(type: ProjectType, input: HeroMetricInput): HeroMetric {
  if (type === "goal") {
    // goal 은 다중 KPI 모델 — 호출부에서 종합 달성률(0~1)을 actualAmount/targetAmount=1 로 넘기거나
    //   actualAmount(=종합 달성 비율), targetAmount=1 형태로 전달. 하위호환: target>0 면 비율 계산.
    const target = Number(input.targetAmount || 0);
    const actual = Number(input.actualAmount || 0);
    if (target <= 0) return { pct: 0, raw: null, risk: false, label: "—" };
    const raw = actual / target;
    return { pct: clamp(Math.round(raw * 100)), raw, risk: false, label: `${Math.round(raw * 100)}%` };
  }
  if (type === "delivery") {
    const total = Number(input.taskTotal || 0);
    const done = Number(input.taskDone || 0);
    if (total <= 0) return { pct: 0, raw: null, risk: false, label: "—" };
    const raw = done / total;
    return { pct: clamp(Math.round(raw * 100)), raw, risk: false, label: `${Math.round(raw * 100)}%` };
  }
  // margin
  const revenue = Number(input.revenue || 0);
  const cost = Number(input.cost || 0);
  if (revenue <= 0) return { pct: 0, raw: null, risk: false, label: "—" };
  const raw = (revenue - cost) / revenue;
  const risk = raw < 0;
  return { pct: clamp(Math.round(raw * 100)), raw, risk, label: `${Math.round(raw * 100)}%` };
}

// ── 목표형 페이스 경고 (순수 함수) ──
//   필요_일평균(잔여목표/잔여일) vs 현재_일평균(누적실적/경과일) 비교 → 현재 속도로 예상 달성.
//   최근 정체(최근 N일 증가 없음) 감지 → 📉정체.

export type PaceInput = {
  targetAmount: number;
  actualAmount: number;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
  today?: string | null; // 테스트 주입용. 없으면 현재일.
  /** 최근 정체 판정: 최근 stallDays 일 내 실적 증가분 (entries 합). 없으면 정체 미판정 */
  recentGain?: number | null;
};

export type PaceWarning = {
  /** 'ahead' 순항 | 'behind' 뒤처짐 | 'stalled' 정체 | 'done' 달성 | 'none' 판정불가 */
  status: "ahead" | "behind" | "stalled" | "done" | "none";
  /** 필요 일평균 (잔여목표/잔여일) */
  requiredDaily: number | null;
  /** 현재 일평균 (누적/경과일) */
  currentDaily: number | null;
  /** 현재 속도 유지 시 예상 최종 달성액 */
  projected: number | null;
  /** 사용자 표시 메시지 */
  message: string;
  /** UI tone */
  tone: "ok" | "warn" | "danger";
};


// 영업일(평일) 기준 페이스. 예상달성 = 누적 / 경과영업일 × 총영업일.
//   상태(주간보고 양식 §12-A): 예상달성률 ≥100% ahead(🟢) / 80~99% behind-warn(🟡) / <80% behind-danger(🔴).
export function getPaceWarning(input: PaceInput): PaceWarning {
  const target = Number(input.targetAmount || 0);
  const actual = Number(input.actualAmount || 0);
  if (target <= 0) return { status: "none", requiredDaily: null, currentDaily: null, projected: null, message: "목표값이 없습니다", tone: "ok" };
  if (actual >= target) return { status: "done", requiredDaily: 0, currentDaily: null, projected: actual, message: "🎉 목표 달성", tone: "ok" };

  const todayStr = input.today ? String(input.today).slice(0, 10) : todayKst();
  const startStr = input.startDate ? String(input.startDate).slice(0, 10) : null;
  const endStr = input.endDate ? String(input.endDate).slice(0, 10) : null;

  // 정체 우선: 최근 증가분이 0이면 정체.
  if (input.recentGain != null && input.recentGain <= 0 && actual > 0) {
    return { status: "stalled", requiredDaily: null, currentDaily: null, projected: null, message: "📉 최근 실적 정체 — 추이를 확인하세요", tone: "warn" };
  }

  // 영업일평균(필요/현재) — '하루 얼마씩' 표기에 사용
  let requiredDaily: number | null = null;
  if (endStr && todayStr <= endStr) {
    const remainBiz = Math.max(1, businessDaysBetween(todayStr, endStr));
    requiredDaily = (target - actual) / remainBiz;
  }
  let currentDaily: number | null = null;
  let projected: number | null = null;
  if (startStr && endStr) {
    const elapsedBiz = Math.max(1, businessDaysBetween(startStr, todayStr < startStr ? startStr : todayStr));
    const totalBiz = Math.max(1, businessDaysBetween(startStr, endStr));
    currentDaily = actual / elapsedBiz;
    projected = currentDaily * totalBiz;
  }

  if (projected != null) {
    const ratio = projected / target;
    if (ratio >= 1) {
      return { status: "ahead", requiredDaily, currentDaily, projected, message: `✅ 예상달성 ${Math.round(ratio * 100)}% — 순항 중`, tone: "ok" };
    }
    return {
      status: "behind",
      requiredDaily,
      currentDaily,
      projected,
      message: `${ratio < 0.8 ? "🔴" : "🟡"} 예상달성 ${Math.round(ratio * 100)}% — 페이스를 높여야 합니다`,
      tone: ratio < 0.8 ? "danger" : "warn",
    };
  }
  if (requiredDaily != null) {
    return { status: "none", requiredDaily, currentDaily, projected: null, message: "기간을 설정하면 예상달성률이 표시됩니다", tone: "ok" };
  }
  return { status: "none", requiredDaily: null, currentDaily, projected: null, message: "기간(시작·종료일)을 설정하면 페이스 경고가 표시됩니다", tone: "ok" };
}

// ── 다중 KPI 성과관리 모델 (순수 함수) ──
//   project_kpis(target_value, direction) + 실적값 → KPI별 달성률, 프로젝트 종합 달성률.

export type KpiDirection = "up" | "down";

/**
 * KPI 달성률 (0~1, cap 1.0).
 *   direction='up'  → actual/target (클수록 좋음. 매출·건수 등)
 *   direction='down' → target/actual (작을수록 좋음. 비용·이탈률 등. actual<=0 방어)
 *   target<=0 면 계산불가(null).
 */
export function getKpiAchievement(target: number, actual: number, direction: KpiDirection = "up"): number | null {
  const t = Number(target || 0);
  const a = Number(actual || 0);
  if (t <= 0) return null;
  let raw: number;
  if (direction === "down") {
    if (a <= 0) return 1; // 실적 0 이하 = 목표(낮을수록 좋음) 완전 달성
    raw = t / a;
  } else {
    raw = a / t;
  }
  return Math.min(1, Math.max(0, raw));
}

export type KpiAchievementRow = {
  target: number;
  actual: number;
  direction?: KpiDirection;
};

/**
 * 프로젝트 종합 달성률 = 평균(각 KPI 달성률), cap 100%.
 *   계산 가능한(target>0) KPI 만 평균. 없으면 null.
 *   반환: 0~1 (raw) — UI 는 *100 후 반올림.
 */
export function getOverallAchievement(rows: KpiAchievementRow[]): number | null {
  const vals = rows
    .map((r) => getKpiAchievement(r.target, r.actual, r.direction || "up"))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.min(1, Math.max(0, avg));
}

/** 최신 성과 체크인 신호등 → tone. 없으면 'neutral'. */
export type OverallStatus = "green" | "yellow" | "red" | "neutral";
export function getOverallStatus(latestStatus?: string | null): OverallStatus {
  return latestStatus === "green" || latestStatus === "yellow" || latestStatus === "red" ? latestStatus : "neutral";
}
