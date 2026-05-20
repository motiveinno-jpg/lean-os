// PR2: 프로젝트 자동 상태배지 계산.
//   /projects 칸반·리스트 카드에 1개씩 표시. 별도 DB 컬럼 없이 클라이언트 계산.
//   PR4 에서 정식 lib 화 예정 — 여기는 단순 4룰만.
//
// 우선순위: margin_risk > danger > urgent > pending > none
// 카드엔 1개만 표시 (가장 위 우선순위).

export type ProjectBadgeKey = "margin_risk" | "danger" | "urgent" | "pending" | "none";

export interface ProjectBadge {
  key: ProjectBadgeKey;
  label: string;
  emoji: string;
  color: string; // text color
  bg: string;    // bg color (rgba)
  reason: string; // tooltip / debug
}

const BADGE_CONFIG: Record<Exclude<ProjectBadgeKey, "none">, Omit<ProjectBadge, "key" | "reason">> = {
  margin_risk: { label: "마진위험", emoji: "🔴", color: "#DC2626", bg: "rgba(220,38,38,0.12)" },
  danger:      { label: "위험",     emoji: "⚠",  color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  urgent:      { label: "임박",     emoji: "⏰", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  pending:     { label: "대기",     emoji: "📋", color: "#6366F1", bg: "rgba(99,102,241,0.12)" },
};

interface BadgeDealInput {
  stage: string | null;
  end_date: string | null;
  contract_total: number | null;
}

interface RevenueScheduleRow {
  status?: string | null;
  due_date?: string | null;
  deal_id?: string | null;
}

interface CostInput {
  totalCost?: number;
}

/**
 * 프로젝트 1건의 배지 1개를 계산.
 *   deal: deals row (stage, end_date, contract_total 필요)
 *   revenueSchedules: 해당 deal 의 deal_revenue_schedule 행들 (optional — 없으면 pending 판정 스킵)
 *   costs: 해당 deal 의 비용 합계 (optional — 없으면 margin_risk 판정 스킵)
 */
export function getProjectBadge(
  deal: BadgeDealInput,
  revenueSchedules?: RevenueScheduleRow[],
  costs?: CostInput,
): ProjectBadge {
  const stage = deal.stage || "estimate";
  const isClosed = stage === "completed" || stage === "settlement";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. margin_risk — 비용 합계 > 계약가
  if (costs && typeof costs.totalCost === "number" && deal.contract_total && deal.contract_total > 0) {
    if (costs.totalCost > deal.contract_total) {
      return {
        key: "margin_risk",
        ...BADGE_CONFIG.margin_risk,
        reason: `비용 ${costs.totalCost.toLocaleString()} > 계약가 ${deal.contract_total.toLocaleString()}`,
      };
    }
  }

  // 2. danger — 기한 초과 + 미완료
  if (!isClosed && deal.end_date) {
    const end = new Date(deal.end_date);
    end.setHours(0, 0, 0, 0);
    if (end.getTime() < today.getTime()) {
      const overdue = Math.floor((today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
      return {
        key: "danger",
        ...BADGE_CONFIG.danger,
        reason: `기한 ${overdue}일 초과`,
      };
    }
  }

  // 3. urgent — 기한 7일 이내 + 미완료
  if (!isClosed && deal.end_date) {
    const end = new Date(deal.end_date);
    end.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= 7) {
      return {
        key: "urgent",
        ...BADGE_CONFIG.urgent,
        reason: `D-${diffDays}`,
      };
    }
  }

  // 4. pending — 미수금 입금 일정 초과 (status='expected' + due_date < today)
  if (revenueSchedules && revenueSchedules.length > 0) {
    const overdueExpected = revenueSchedules.find((r) => {
      if (r.status !== "expected") return false;
      if (!r.due_date) return false;
      const due = new Date(r.due_date);
      due.setHours(0, 0, 0, 0);
      return due.getTime() < today.getTime();
    });
    if (overdueExpected) {
      return {
        key: "pending",
        ...BADGE_CONFIG.pending,
        reason: `미수금 입금일정 초과 (${overdueExpected.due_date})`,
      };
    }
  }

  return {
    key: "none",
    label: "",
    emoji: "",
    color: "",
    bg: "",
    reason: "",
  };
}

/**
 * D-day 문자열 — 카드 기한 표시용.
 */
export function formatDueLabel(end_date: string | null | undefined): string {
  if (!end_date) return "기한 미정";
  const end = new Date(end_date);
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `만료 (${Math.abs(diffDays)}일 경과)`;
  if (diffDays === 0) return "D-Day";
  return `D-${diffDays}`;
}
