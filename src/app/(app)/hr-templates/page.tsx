"use client";

/**
 * 양식 관리 (인사) — HR 양식(표준근로계약서 등) doc_templates 관리.
 *   전자계약(비즈니스) 양식은 /signatures 의 "양식 관리" 탭에서 관리.
 *   데이터(doc_templates)는 동일 테이블, scope(type) 로만 분리.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getDocTemplates } from "@/lib/queries";
import { TemplatesTab } from "@/components/templates-tab";
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

  // 외부 파트너 차단 (인사 양식은 회사 관리자 전용)
  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="인사 양식 관리는 회사 관리자 전용입니다." />;
  }

  return (
    <div className="space-y-5 p-5">
      <header className="page-sticky-header">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">양식 관리 (인사)</h1>
        <p className="text-sm text-[var(--text-muted)]">표준근로계약서 등 인사 양식을 관리하세요.</p>
      </header>

      {companyId && userId ? (
        <TemplatesTab
          scope="hr"
          companyId={companyId}
          userId={userId}
          templates={docTemplates as any[]}
          onInvalidate={() => qc.invalidateQueries({ queryKey: ["doc-templates", companyId] })}
        />
      ) : (
        <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>
      )}
    </div>
  );
}
