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
  // 2026-07-27 QA: 결재 알림은 entity_type 이 'approval_request' 인데 여기에 없어
  //   전부 /dashboard 로 떨어졌다(알림을 눌러도 결재 내용이 안 나옴).
  approval_request: () => `/approvals`,
  // 참조자는 결재함·내 요청이 모두 비어 있으므로 '참조' 탭으로 바로 보낸다.
  approval_reference: () => `/approvals?tab=references`,
  invoice: () => `/tax-invoices`,
  payment: () => `/payments`,
  chat: () => `/chat`,
  chat_channel: (id) => `/chat?channel=${id}`,
  board_post: (id) => `/board?id=${id}`,
  document: (id) => `/documents?id=${id}`,
  document_share: (id) => `/documents?id=${id}`,
  signature_request: () => `/signatures`,
  signature: (id) => `/contracts/signed/${id}`,
  company_join_request: (id) => `/settings?tab=team&request=${id}`,
  hr_contract_package: () => `/mypage?tab=docs`,   //   2026-08-19 마이페이지 › 급여·계약·증명
  leave_request: () => `/approvals`,
  overtime_request: () => `/approvals?tab=my-approvals`,   //   2026-08-20 연장근무 탭 폐지 — 초과근무는 일반 결재로 처리
  project_checkin: (id) => `/projecthub/${id}?tab=performance`,
  // 프로젝트 표의 행 메모에서 @로 불렀을 때 — entity_id 는 그 프로젝트(deal) id 다
  project_board_item: (id) => `/projecthub/${id}`,
  attendance_edit_request: () => `/attendance?view=records`,
  expense_request: () => `/approvals`,
  quote_approval: () => `/projects`,
  // 2026-08-04 사장님 제보: 고객센터 답변 알림이 매핑에 없어 /dashboard 로 떨어졌다
  //   — 고객센터 내 문의 내역에서 해당 문의를 바로 펼친다.
  support_ticket: (id) => `/support?id=${encodeURIComponent(id)}`,
};

export const TYPE_HREF: Record<string, (id: string | null) => string> = {
  document: (id) => id ? `/documents?id=${id}` : `/documents`,
  document_feedback: (id) => id ? `/documents?id=${id}` : `/documents`,
  signature_request: (id) => id ? `/contracts/signed/${id}` : `/signatures`,
  deal_update: (id) => id ? `/projects/${id}` : `/projects`,
  payment_due: () => `/payments`,
  expense_request: () => `/approvals`,
  contract_expiry: (id) => id ? `/documents?id=${id}` : `/documents`,
  approval: () => `/approvals`,
  approval_request: () => `/approvals`,
  approval_approved: (id) => id ? `/approvals?tab=my-requests&request=${encodeURIComponent(id)}` : `/approvals?tab=my-requests`,
  approval_rejected: (id) => id ? `/approvals?tab=my-requests&request=${encodeURIComponent(id)}` : `/approvals?tab=my-requests`,
  chat: () => `/chat`,
  company_join_request: () => `/settings?tab=team`,
  // 운영자용 AI 진단 알림 — 고객 화면(/support)이 아니라 운영자 문의 화면으로
  support_ai: () => `/platform/support`,
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
  // 네이티브 휴가 참조 통보([참조] 접두) — 직원 계정이 /approvals 로만 가면 기본 탭(새 요청)에
  //   떨어져 내용을 못 본다(2026-07-30 사장님 제보: 연준호 건). 참조함으로 직행.
  if (n.entity_type === "leave_request" && (n.title || "").startsWith("[참조]")) {
    return "/approvals?tab=references";
  }
  // 결재 결과 알림(승인·반려)은 요청자 본인에게 가는 것이다. entity_type 매핑만 타면 /approvals 기본 탭
  //   = '내 결재함'(남이 올린 결재 대기함)으로 떨어져 정작 내 요청 결과가 안 보인다(2026-07-31 사장님 제보).
  //   → '내 요청' 탭 + 해당 건 상세를 바로 연다. 참조자 통보는 entity_type=approval_reference 라 여기 안 걸림.
  if ((n.type === "approval_approved" || n.type === "approval_rejected")
      && n.entity_type === "approval_request" && n.entity_id) {
    return `/approvals?tab=my-requests&request=${encodeURIComponent(n.entity_id)}`;
  }
  // 운영자용 AI 진단 알림은 entity_type 이 support_ticket 이라 고객 화면 매핑에 걸린다 — type 우선 분기
  if (n.type === "support_ai") {
    return `/platform/support`;
  }
  if (n.entity_type && n.entity_id && ENTITY_HREF[n.entity_type]) {
    return ENTITY_HREF[n.entity_type](n.entity_id);
  }
  if (TYPE_HREF[n.type]) {
    return TYPE_HREF[n.type](n.entity_id);
  }
  return "/dashboard";
}
