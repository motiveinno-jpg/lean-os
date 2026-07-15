"use client";

// L 계약: 서명된 계약서 회수 페이지 (회사 내부, 인증 사용자 only)
//   URL: /contracts/signed/<approvalId>
//   RLS quote_approvals_select_admin_or_self 가 회사 격리 + admin/본인 만 허용.
//   렌더는 ContractViewer 컴포넌트 공용 (페이지 + 공통 모달 DocumentViewerModal).
//   알림 딥링크·외부 진입 fallback 으로 페이지 라우트 유지.
//
// 보안: token 노출 없음. approval_id 만으로 RLS 체크.

import { useParams } from "next/navigation";
import { ContractViewer } from "@/components/contract-viewer";

export default function SignedContractPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  return (
    <div className="signed-contract-page max-w-[var(--content-max)] mx-auto p-6">
      <ContractViewer id={id} backHref="/projects" />
    </div>
  );
}
