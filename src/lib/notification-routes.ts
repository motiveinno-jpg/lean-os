// 알림 라우팅 공통 로직 — /notifications 전체 목록과 헤더 알림 팝오버(notification-bell)가 공유.
//   entity_type 기반 1차 매핑 → type 기반 폴백 → 그래도 없으면 /dashboard.

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/projects/${id}`,
  partner: (id) => `/partners?id=${id}`,
  approval: () => `/approvals`,
  invoice: () => `/tax-invoices`,
  payment: () => `/payments`,
  chat: () => `/chat`,
  chat_channel: (id) => `/chat?channel=${id}`,
  board_post: (id) => `/board?id=${id}`,
  document: (id) => `/documents?id=${id}`,
  document_share: (id) => `/documents?id=${id}`,
  signature_request: () => `/signatures`,
  signature: (id) => `/contracts/signed/${id}`,
  company_join_request: () => `/settings?tab=team`,
  hr_contract_package: () => `/my-contracts`,
  leave_request: () => `/attendance?section=leave&focus=pending`,
  overtime_request: () => `/attendance?section=overtime`,
  project_checkin: (id) => `/projecthub/${id}?tab=performance`,
  attendance_edit_request: () => `/attendance?view=records`,
  expense_request: () => `/payments?tab=expenses`,
  quote_approval: () => `/projects`,
};

export const TYPE_HREF: Record<string, (id: string | null) => string> = {
  document: (id) => id ? `/documents?id=${id}` : `/documents`,
  document_feedback: (id) => id ? `/documents?id=${id}` : `/documents`,
  signature_request: (id) => id ? `/contracts/signed/${id}` : `/signatures`,
  deal_update: (id) => id ? `/projects/${id}` : `/projects`,
  payment_due: () => `/payments`,
  expense_request: () => `/payments?tab=expenses`,
  contract_expiry: (id) => id ? `/documents?id=${id}` : `/documents`,
  approval: () => `/approvals`,
  chat: () => `/chat`,
  company_join_request: () => `/settings?tab=team`,
};

export function stageToAction(stage: string | null | undefined): "quote" | "contract" {
  return stage === "contract" ? "contract" : "quote";
}

/** entity_type/entity_id → 라우트 해석. quote_approval 은 quoteMap(deal_id+stage)이 있어야 정확히 연결됨. */
export function resolveNotificationHref(
  n: NotificationRow,
  quoteMap: Record<string, { deal_id: string; stage: string }>,
): string {
  if (n.entity_type === "quote_approval" && n.entity_id && quoteMap[n.entity_id]) {
    const { deal_id, stage } = quoteMap[n.entity_id];
    return `/projects/${encodeURIComponent(deal_id)}?action=${stageToAction(stage)}`;
  }
  if (n.entity_type && n.entity_id && ENTITY_HREF[n.entity_type]) {
    return ENTITY_HREF[n.entity_type](n.entity_id);
  }
  if (TYPE_HREF[n.type]) {
    return TYPE_HREF[n.type](n.entity_id);
  }
  return "/dashboard";
}
