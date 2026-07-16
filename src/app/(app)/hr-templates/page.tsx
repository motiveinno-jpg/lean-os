"use client";

/**
 * 양식 관리 (인사) — HR 양식(표준근로계약서 등) doc_templates 관리.
 *   전자계약(비즈니스) 양식은 /signatures 의 "양식 관리" 탭에서 관리.
 *   데이터(doc_templates)는 동일 테이블, scope(type) 로만 분리.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getDocTemplates } from "@/lib/queries";
import { getActiveContracts } from "@/lib/hr";
import { TemplatesTab } from "@/components/templates-tab";
import { HrFormManager } from "@/components/hr-form-manager";
import { ContractAdminPanel } from "./_components/ContractAdminPanel";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

export default function HrTemplatesPage() {
  const { role } = useUser();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    });
  }, []);

  const { data: docTemplates = [] } = useQuery({
    queryKey: ["doc-templates", companyId],
    queryFn: () => getDocTemplates(companyId!),
    enabled: !!companyId,
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ["contracts", companyId],
    queryFn: () => getActiveContracts(companyId!),
    enabled: !!companyId,
  });

  // 외부 파트너 차단 (인사 양식은 회사 관리자 전용)
  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="인사 양식 관리는 회사 관리자 전용입니다." />;
  }

  return (
    <div className="hr-templates-page">
      {companyId && userId ? (
        <>
          <TemplatesTab
            scope="hr"
            companyId={companyId}
            userId={userId}
            templates={docTemplates as any[]}
            onInvalidate={() => qc.invalidateQueries({ queryKey: ["doc-templates", companyId] })}
          />
          {/* PDF 양식 — 회사 PDF를 올려 채울 필드를 지정해 재사용 양식으로 저장 */}
          <HrFormManager companyId={companyId} />
          {/* 전자계약 서식/회사 문서/발송 현황 — 구성원 계약서 탭에서 이관(2026-07-15) */}
          <ContractAdminPanel companyId={companyId} contracts={contracts} />
        </>
      ) : (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      )}
    </div>
  );
}
