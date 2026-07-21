"use client";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import {
  generateEmploymentCertificate,
  generateCareerCertificate,
  saveCertificateLog,
  getCertificateLogs,
} from "@/lib/certificates";

// 내 증명서 — 본인 재직/경력 증명서를 직접 발급·다운로드.
//   개인 인사기록 허브(2026-07-15): 관리자에게 요청하지 않고 본인이 즉시 발급.
//   기존 인사관리 CertificateTab(관리자 전용, 전 직원 발급)과 별개로, 여기선 "나"만 대상.
export function MyCertificates({
  companyId,
  userId,
  employee,
}: {
  companyId: string | null;
  userId: string | null;
  employee: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [certType, setCertType] = useState<"employment" | "career">("employment");
  const [purpose, setPurpose] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: company } = useQuery({
    queryKey: ["mypage-cert-company", companyId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('_components/MyCertificates:data', await db
        .from("companies")
        .select("name, representative, address, business_number, seal_url")
        .eq("id", companyId!)
        .maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const { data: myLogs = [] } = useQuery({
    queryKey: ["mypage-cert-logs", companyId, employee?.id],
    queryFn: () => getCertificateLogs(companyId!, employee!.id),
    enabled: !!companyId && !!employee?.id,
  });

  const handleIssue = async () => {
    if (!employee?.id || !companyId || !userId) return;
    setIsGenerating(true);
    try {
      const empData = {
        name: employee.name,
        department: employee.department,
        position: employee.position,
        hire_date: employee.hire_date || todayKst(),
        end_date: !["active", "joined"].includes(employee.status) ? employee.updated_at?.slice(0, 10) : undefined,
        employee_number: employee.employee_number,
        birth_date: employee.birth_date,
      };
      const companyData = {
        name: company?.name || "",
        representative: company?.representative ?? undefined,
        address: company?.address ?? undefined,
        business_number: company?.business_number ?? undefined,
        seal_url: company?.seal_url ?? undefined,
      };

      const result =
        certType === "employment"
          ? await generateEmploymentCertificate({ employee: empData, company: companyData, purpose: purpose || undefined })
          : await generateCareerCertificate({ employee: empData, company: companyData });

      const url = URL.createObjectURL(result.pdf);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${certType === "employment" ? "재직증명서" : "경력증명서"}_${employee.name}_${result.certificateNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      // 발급 이력 저장(회사 감사용) — 실패해도 다운로드는 이미 됨(비차단).
      try {
        await saveCertificateLog({
          companyId,
          employeeId: employee.id,
          certificateType: certType === "employment" ? "재직증명서" : "경력증명서",
          certificateNumber: result.certificateNumber,
          issuedBy: userId,
          purpose: purpose || undefined,
        });
        qc.invalidateQueries({ queryKey: ["mypage-cert-logs"] });
      } catch { /* 이력 저장 실패는 무시 */ }

      setPurpose("");
      toast(`증명서가 발급되었습니다.\n증명서번호: ${result.certificateNumber}`, "success");
    } catch (err: any) {
      toast("증명서 발급 실패: " + (err?.message || err), "error");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mypage-certificates-card glass-card">
      <div className="mypage-certificates-header flex items-center justify-between mb-1">
        <h2 className="section-title mb-0">내 증명서</h2>
        {myLogs.length > 0 && <span className="badge badge-muted">발급 {myLogs.length}건</span>}
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-4">재직·경력 증명서를 직접 발급받아 PDF로 내려받을 수 있습니다.</p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">증명서 유형</label>
          <select value={certType} onChange={(e) => setCertType(e.target.value as any)} className="field-input">
            <option value="employment">재직증명서</option>
            <option value="career">경력증명서</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">용도 (선택)</label>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="제출용, 은행, 비자 등" className="field-input" />
        </div>
        <button onClick={handleIssue} disabled={!employee?.id || isGenerating} className="btn-primary sm:w-auto w-full disabled:opacity-50">
          {isGenerating ? "발급 중..." : "발급 · 다운로드"}
        </button>
      </div>

      {myLogs.length > 0 && (
        <div className="mypage-cert-history mt-5 flex-1">
          <div className="text-xs font-semibold text-[var(--text-dim)] mb-2">발급 이력</div>
          <div className="space-y-2">
            {myLogs.slice(0, 5).map((log: any) => (
              <div key={log.id} className="flex items-center justify-between text-xs bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border)]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium">{log.certificate_type}</span>
                  <span className="text-[var(--text-muted)] truncate">{log.certificate_number}</span>
                </div>
                <span className="text-[var(--text-dim)] shrink-0">{log.created_at ? new Date(log.created_at).toLocaleDateString("ko-KR") : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
