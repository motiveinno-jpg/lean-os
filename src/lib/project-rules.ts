// PR4 — 프로젝트(deals) 자동 상태룰 + 다음액션 엔진 (순수 함수).
//   PR2 project-badges.ts 를 흡수·확장.
//   - getProjectBadge: 카드 상단 1개 배지 (마진위험 > 위험 > 임박 > 대기 > none)
//   - getNextAction:   stage + 현 상태 조합으로 "지금 해야 할 일 1개" 자동 산출
//   - getMetaSummary:  priority·risk·classification 등 메타 정보 → 고급 토글에서만 노출
//
// 호출자:
//   /projects 칸반 카드 (PR2): getProjectBadge(deal) — 가벼운 버전
//   /projects?deal=<id> 슬라이드 패널 (PR3): getProjectBadge(deal, sched, cost) + getNextAction + getMetaSummary
//   dashboard 위젯 (PR4 선택): stage 기반 미니맵
//
// 절대규칙: side-effect 0, DB 의존성 0, 입력만으로 출력. 단위테스트 가능.

import { getProjectBadge as getProjectBadgeFromBase, type ProjectBadge, formatDueLabel } from './project-badges';
import type { ApprovalLite } from './quote-approvals';

export type ProjectStage = 'estimate' | 'contract' | 'in_progress' | 'completed' | 'settlement';

export type ProjectDealLite = {
  id: string;
  name: string | null;
  stage: string | null;
  status?: string | null;
  end_date?: string | null;
  contract_total?: number | null;
  priority?: string | null;
  risk_label?: string | null;
  classification?: string | null;
};

export type ProjectScheduleLite = {
  status?: string | null;
  due_date?: string | null;
  deal_id?: string | null;
  amount?: number | null;
};

export type ProjectCostsLite = {
  totalCost?: number;
  subdealCount?: number;
};

// ── 배지 (PR2 의 lib 그대로 재export) ──
export { getProjectBadgeFromBase as getProjectBadge, formatDueLabel };
export type { ProjectBadge };

// ── 다음액션 CTA ──
//   stage 별로 가장 자연스러운 "지금 해야 할 일 1개" 산출.
//   priority: 자동상태배지(위험/마진위험)가 있으면 그쪽 액션 우선.

export type NextAction = {
  text: string;        // CTA 라벨
  href?: string;       // 클릭 시 이동 (옵션)
  icon?: string;       // 이모지 1개
  reason?: string;     // 왜 이 액션이 추천됐는지 (툴팁용)
  level: 'critical' | 'recommended' | 'optional';
};

export function getNextAction(
  deal: ProjectDealLite,
  schedules?: ProjectScheduleLite[],
  costs?: ProjectCostsLite,
  hasQuoteDoc?: boolean,
  hasContractDoc?: boolean,
  // STEP 4 (PR-E): 견적 단계 외부 승인 latest approval (선택).
  //   호출자(슬라이드 패널)가 getLatestApproval(dealId,'estimate') 결과를 prop 으로 전달.
  //   본 함수는 sync 유지 — fetch 책임은 호출자에게.
  latestApproval?: ApprovalLite | null,
): NextAction {
  const stage = (deal.stage || 'estimate') as ProjectStage;
  // PR3.5: 모든 CTA href 를 /projects?open=<id>&action=<key> 로 통일.
  //   기존 /deals?detail= 는 멘탈모델 깨짐(패널 안에서 완결) — 패널이 action 쿼리
  //   읽어 해당 탭/섹션으로 자동 점프 후 URL 클리어.
  const panelHref = (action?: string) =>
    action ? `/projects?deal=${deal.id}&action=${action}` : `/projects?deal=${deal.id}`;

  // 1) Critical — 자동 배지 활성 시 그쪽 액션 우선
  const badge = getProjectBadgeFromBase(
    { stage: deal.stage, end_date: deal.end_date ?? null, contract_total: deal.contract_total ?? null },
    schedules,
    costs,
  );
  if (badge.key === 'margin_risk') {
    return { text: '비용 구조 재검토 →', href: panelHref('cost-review'), icon: '🔴', reason: '비용 합계가 계약가를 초과', level: 'critical' };
  }
  if (badge.key === 'danger') {
    return { text: '기한 만료 처리 →', href: panelHref('recover'), icon: '⚠', reason: '기한 초과', level: 'critical' };
  }
  if (badge.key === 'pending') {
    return { text: '미수금 회수 알림 보내기 →', href: panelHref('recover'), icon: '📋', reason: '미수금 입금 일정 초과', level: 'critical' };
  }

  // 2) Recommended — stage 별 자연 흐름
  switch (stage) {
    case 'estimate': {
      // STEP 4 (PR-E): latestApproval 우선 매핑.
      //   null         → 견적서 작성
      //   draft        → 견적 발송 (CTA hasQuoteDoc 케이스와 동일)
      //   sent         → 거래처 확인 대기 중 (optional)
      //   viewed       → 거래처가 견적을 봤습니다 (optional)
      //   approved     → 보통 deal.stage='contract' 로 이미 전환됨 (이 분기 도달 안 함)
      //                  도달했다면 안전망: '계약 단계로 이동' optional
      //   rejected     → 거절됨 — 수정 후 재발송 (recommended)
      //   expired      → 만료 — 재발송하기 (recommended)
      if (latestApproval) {
        const st = latestApproval.status;
        if (st === 'sent') {
          return { text: '거래처 확인 대기 중', href: panelHref('quote'), icon: '⏳', reason: '발송 후 응답 대기', level: 'optional' };
        }
        if (st === 'viewed') {
          return { text: '거래처가 견적을 봤습니다', href: panelHref('quote'), icon: '👁', reason: '확인됨 — 응답 대기', level: 'optional' };
        }
        if (st === 'rejected') {
          return { text: '거절됨 — 수정 후 재발송 →', href: panelHref('quote'), icon: '❌', reason: '거래처 거절 — 수정 후 재발송', level: 'recommended' };
        }
        if (st === 'expired') {
          return { text: '만료 — 재발송하기 →', href: panelHref('send'), icon: '⏰', reason: '응답 기한 만료 — 재발송', level: 'recommended' };
        }
        if (st === 'approved') {
          return { text: '계약 단계로 이동 →', href: panelHref('move-settlement'), icon: '✅', reason: '거래처 승인 — 계약 단계로', level: 'optional' };
        }
        // 'draft' 면 hasQuoteDoc 분기 로직과 동일하게 발송 권장
        if (st === 'draft') {
          return { text: '견적 발송하기 →', href: panelHref('quote'), icon: '📤', reason: '견적 작성됨 — 거래처 발송', level: 'recommended' };
        }
      }
      if (!hasQuoteDoc) {
        return { text: '견적서 작성하기 →', href: panelHref('quote'), icon: '📝', reason: '견적 단계인데 견적서 없음', level: 'recommended' };
      }
      return { text: '견적 발송하기 →', href: panelHref('send'), icon: '📤', reason: '견적서 발송 → 계약 단계 진입', level: 'recommended' };
    }

    case 'contract':
      if (!hasContractDoc) {
        return { text: '계약서 작성하기 →', href: panelHref('contract'), icon: '📄', reason: '계약 단계인데 계약서 없음', level: 'recommended' };
      }
      return { text: '서명 요청 보내기 →', href: panelHref('send'), icon: '✍️', reason: '계약서 서명 진행', level: 'recommended' };

    case 'in_progress': {
      // B 핸드오프: deal.stage='in_progress' → approval stage='progress_report' 매핑.
      //   진척 보고서 작성·발송이 다음 자연 액션. 거래처가 승인하면 자동 완료(submit_quote_decision 매핑).
      if (badge.key === 'urgent') {
        return { text: '진척 보고서 작성·발송 →', href: panelHref('quote'), icon: '⏰', reason: '기한 임박 — 진척 보고서로 마감 정렬', level: 'recommended' };
      }
      return { text: '진척 보고서 작성·발송 →', href: panelHref('quote'), icon: '📊', reason: '진행중 — 거래처에 진척 공유 + 완료 단계 진입', level: 'recommended' };
    }

    case 'completed':
      return { text: '정산 단계로 이동 →', href: panelHref('move-settlement'), icon: '💰', reason: '완료 — 세금계산서·수금 마무리', level: 'recommended' };

    case 'settlement':
      return { text: '아카이브 →', href: panelHref('archive'), icon: '📦', reason: '정산 완료 — 보관', level: 'optional' };

    default:
      return { text: '상세 보기 →', href: panelHref(), icon: '🔍', reason: '', level: 'optional' };
  }
}

// ── 메타 요약 (고급 토글 전용) ──
//   카드에는 노출 안 함. 패널 "고급" 아코디언/토글에서만.

export type MetaSummary = {
  priority?: { label: string; emoji: string; color: string };
  risk?: { label: string; emoji: string; color: string };
  classification?: string;
  hasAny: boolean;
};

const PRIORITY_MAP: Record<string, { label: string; emoji: string; color: string }> = {
  urgent: { label: '긴급', emoji: '🔥', color: 'text-red-500' },
  high: { label: '높음', emoji: '⬆️', color: 'text-orange-500' },
  medium: { label: '보통', emoji: '➖', color: 'text-gray-500' },
  low: { label: '낮음', emoji: '⬇️', color: 'text-blue-400' },
};

const RISK_MAP: Record<string, { label: string; emoji: string; color: string }> = {
  HIGH_RISK: { label: '고위험', emoji: '⚠️', color: 'text-red-500' },
  LOW_MARGIN: { label: '마진주의', emoji: '📉', color: 'text-orange-400' },
  DELAYED: { label: '지연', emoji: '⏳', color: 'text-yellow-500' },
  HEALTHY: { label: '건전', emoji: '✅', color: 'text-green-500' },
};

export function getMetaSummary(deal: ProjectDealLite): MetaSummary {
  const priority = deal.priority ? PRIORITY_MAP[deal.priority] : undefined;
  const risk = deal.risk_label ? RISK_MAP[deal.risk_label] : undefined;
  const classification = deal.classification || undefined;
  return {
    priority,
    risk,
    classification,
    hasAny: !!(priority || risk || classification),
  };
}

// ── stage 라벨/색상 (UI 공통) ──

export const STAGE_LABEL: Record<ProjectStage, string> = {
  estimate: '견적',
  contract: '계약',
  in_progress: '진행',
  completed: '완료',
  settlement: '정산',
};

export const STAGE_COLOR: Record<ProjectStage, { bg: string; text: string; dot: string }> = {
  estimate:    { bg: 'bg-gray-500/10',  text: 'text-gray-400',  dot: 'bg-gray-400' },
  contract:    { bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400' },
  in_progress: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  completed:   { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  settlement:  { bg: 'bg-purple-500/10',text: 'text-purple-400',dot: 'bg-purple-400' },
};

export const STAGE_ORDER: ProjectStage[] = ['estimate', 'contract', 'in_progress', 'completed', 'settlement'];
