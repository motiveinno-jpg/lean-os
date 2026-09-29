// 계약서 보기 화면(ContractViewer)의 상태별 제목·안내·가능한 행동 — 한 곳에서 정한다.
//   두 출처(quote_approvals 단건 계약 / signature_requests 전자계약 요청)의 상태 어휘가 달라
//   화면에서 제각각 판단하면 만료된 요청에도 '서명된 계약서' 제목과 '우리 서명' 버튼이 뜬다.
//   우리 서명 가능 조건은 서버 RPC(submit_our_signature·submit_our_signature_for_request)와 같게 둔다.

export type ContractViewSource = "quote_approval" | "signature_request";

export type ContractViewKind =
  | "fully_signed"       // 양측 서명 끝
  | "awaiting_ours"      // 상대 서명 끝, 우리 서명 남음
  | "partner_signed"     // 상대 서명 끝(우리 서명 절차가 없는 요청)
  | "pending"            // 상대 서명 대기
  | "expired"            // 기한 지남(전자계약 요청은 취소도 여기로 저장된다)
  | "rejected"           // 상대가 거절
  | "revision_requested" // 상대가 수정 요청
  | "draft";             // 아직 안 보냄

export interface ContractViewInput {
  source: ContractViewSource;
  status: string | null | undefined;
  partnerSignedAt?: string | null;
  ourSignedAt?: string | null;
  ourSignatureDataUrl?: string | null;
  expiresAt?: string | null;
  now?: Date;
}

export interface ContractViewState {
  kind: ContractViewKind;
  title: string;
  /** 제목 아래 한 줄 안내 — 우리(보낸 쪽)가 할 수 있는 일 기준. */
  notice: string | null;
  /** '우리 서명' 버튼 노출 여부 — 서버가 받아 주는 상태에서만. */
  canOurSign: boolean;
  /** 같은 내용으로 다시 보내는 곳 — 실제 발송 화면이 있는 경우만. */
  resend: { href: string; label: string } | null;
}

export function contractViewState(i: ContractViewInput, opts: { dealId?: string | null } = {}): ContractViewState {
  const status = String(i.status || "");
  const ourSigned = !!(i.ourSignedAt || i.ourSignatureDataUrl);
  const now = i.now ?? new Date();
  const overdue = !!i.expiresAt && new Date(i.expiresAt).getTime() < now.getTime();
  const isReq = i.source === "signature_request";

  let kind: ContractViewKind;
  if (isReq) {
    if (status === "signed") kind = ourSigned ? "fully_signed" : "awaiting_ours";
    else if (status === "rejected") kind = "rejected";
    else if (status === "expired" || overdue) kind = "expired";
    else kind = "pending";
  } else {
    if (status === "fully_signed") kind = "fully_signed";
    else if (status === "pending_our_signature") kind = "awaiting_ours";
    else if (status === "approved") kind = ourSigned ? "fully_signed" : "partner_signed";
    else if (status === "rejected") kind = "rejected";
    else if (status === "revision_requested") kind = "revision_requested";
    else if (status === "expired" || ((status === "sent" || status === "viewed") && overdue)) kind = "expired";
    else if (status === "draft") kind = "draft";
    else kind = "pending";
  }

  // 단건 계약(approved)은 서버가 우리 서명을 받아 준다 — 거래처 승인만으로 끝나는 흐름이라 '선택' 안내.
  const canOurSign = !ourSigned && (kind === "awaiting_ours" || (kind === "partner_signed" && !isReq));

  const projectLink = opts.dealId ? { href: `/projects/${opts.dealId}`, label: "프로젝트 계약 단계로" } : null;
  const newRequest = { href: "/signatures?bulk=1", label: "다시 보내기(새 계약 요청)" };

  switch (kind) {
    case "fully_signed":
      return { kind, title: "서명 완료된 계약서", notice: null, canOurSign: false, resend: null };
    case "awaiting_ours":
      return { kind, title: "우리 서명 대기 중인 계약서", notice: "상대가 서명했습니다. 우리 서명을 더하면 계약이 성립됩니다.", canOurSign, resend: null };
    case "partner_signed":
      return { kind, title: "상대가 승인한 계약서", notice: canOurSign ? "필요하면 우리 서명·도장을 더할 수 있습니다." : null, canOurSign, resend: null };
    case "pending":
      return { kind, title: "서명 대기 중인 계약서", notice: "상대가 아직 서명하지 않았습니다. 서명하면 이 화면에 서명이 표시됩니다.", canOurSign: false, resend: null };
    case "draft":
      return { kind, title: "발송 전 계약서", notice: "아직 상대에게 보내지 않았습니다.", canOurSign: false, resend: projectLink };
    case "expired":
      return {
        kind,
        title: isReq ? "만료된 계약 요청" : "만료된 계약서",
        notice: isReq
          ? "서명 기한이 지났거나 취소된 요청이라 더 이상 서명할 수 없습니다. 같은 내용이 필요하면 새 계약 요청으로 다시 보내세요."
          : "서명 기한이 지나 더 이상 서명할 수 없습니다.",
        canOurSign: false,
        resend: isReq ? newRequest : projectLink,
      };
    case "rejected":
      return {
        kind,
        title: "거절된 계약서",
        notice: isReq ? "상대가 서명을 거절했습니다. 내용을 고쳐 새 계약 요청으로 다시 보낼 수 있습니다." : "상대가 거절했습니다. 프로젝트 계약 단계에서 고쳐 재발송할 수 있습니다.",
        canOurSign: false,
        resend: isReq ? newRequest : projectLink,
      };
    case "revision_requested":
      return { kind, title: "수정 요청된 계약서", notice: "상대가 수정을 요청했습니다. 프로젝트 계약 단계에서 반영해 재발송할 수 있습니다.", canOurSign: false, resend: projectLink };
  }
}
