"use client";

/**
 * 근로계약·서식 (인사) — 인사담당자 워크플로우 2탭(2026-07-23 재편).
 *   · 서식: 표준근로계약서 등 텍스트 서식 + PDF 양식(준비 단계 자산).
 *   · 계약 발송·현황: 일괄 발송 + 전 직원 서명 추적·독촉·보관(실행/추적). 개별 발송은 구성원 상세 › 근로계약.
 *   전자계약(외부·거래처) 양식은 /signatures 의 "양식 관리" 탭에서 별도 관리.
 *   데이터(doc_templates)는 동일 테이블, scope(type) 로만 분리.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
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
  const [tab, setTab] = useState<"library" | "contracts">("library");

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
          {/* 워크플로우 2탭 — 서식(준비) / 계약 발송·현황(실행·추적) */}
          <div className="seg-bar mb-4">
            <button onClick={() => setTab("library")} className={`seg-item ${tab === "library" ? "seg-item-active" : ""}`}>서식</button>
            <button onClick={() => setTab("contracts")} className={`seg-item ${tab === "contracts" ? "seg-item-active" : ""}`}>계약 발송·현황</button>
          </div>

          {tab === "library" ? (
            <div className="space-y-6">
              {/* 텍스트 서식 — 표준근로계약서 등 */}
              <TemplatesTab
                scope="hr"
                companyId={companyId}
                userId={userId}
                templates={docTemplates as any[]}
                onInvalidate={() => qc.invalidateQueries({ queryKey: ["doc-templates", companyId] })}
              />
              {/* PDF 양식 — 회사 PDF를 올려 채울 필드를 지정해 재사용 양식으로 저장 */}
              <HrFormManager companyId={companyId} />
            </div>
          ) : (
            <div className="space-y-4">
              {/* 개별 발송 동선 안내 — 어제 정리한 구성원 상세 › 근로계약과 연결 */}
              <div className="px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[13px] text-[var(--text-muted)] leading-relaxed">
                개별 직원의 근로·연봉계약 발송은 <Link href="/employees" className="text-[var(--primary)] font-semibold hover:underline no-underline">구성원 상세 › 근로계약</Link>에서 하세요. 이 탭은 <b className="text-[var(--text)]">회사 전체 일괄 발송과 서명 현황</b>을 관리합니다.
              </div>
              {/* 전자계약 서식/회사 문서/발송 현황 — 구성원 계약서 탭에서 이관(2026-07-15) */}
              <ContractAdminPanel companyId={companyId} contracts={contracts} />
            </div>
          )}
        </>
      ) : (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      )}
    </div>
  );
}
