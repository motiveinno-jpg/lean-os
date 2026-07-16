"use client";

import { useState } from "react";
import { DateField } from "@/components/date-field";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { updateEmployee, LEAVE_TYPES, initLeaveBalance, calculateAnnualLeave } from "@/lib/hr";
import { uploadEmployeeFile, getSignedUrl } from "@/lib/file-storage";
import { generateEmploymentCertificate, generateCareerCertificate, saveCertificateLog } from "@/lib/certificates";
import { generateInsuranceEDI, downloadEDIFile, LOSS_REASONS } from "@/lib/insurance-edi";
import { calculateRetirementPay } from "@/lib/payment-batch";
import { useUser } from "@/components/user-context";
import { GRANTABLE_TABS, getUserTabAccess, setTabAccess, effectiveTabAccess } from "@/lib/tab-access";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getContractTemplates, createContractPackage, sendContractPackage, buildDefaultContractFields, type ContractField } from "@/lib/hr-contracts";

// 구성원 디렉토리(flex-people-directory)와 동일한 해시 팔레트 — 같은 직원은 어디서나 같은 아바타 색.
function avatarColor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const palette = ["#6C5CE7", "#0984E3", "#00B894", "#E17055", "#00CEC9", "#A29BFE", "#FF7675", "#55A3FF"];
  return palette[Math.abs(h) % palette.length];
}

// ── Employee Detail Panel ──
type DetailTab = "info" | "docs" | "notes" | "history" | "contracts" | "certificates" | "leave" | "access";

export function EmployeeDetailPanel({ employeeId, companyId, onClose, initialTab }: { employeeId: string; companyId: string; onClose: () => void; initialTab?: DetailTab }) {
  const [detailTab, setDetailTab] = useState<DetailTab>(initialTab || "info");
  const { user: viewer } = useUser();
  const canManageAccess = viewer?.role === "owner" || viewer?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  const [showTermModal, setShowTermModal] = useState(false);
  const [termDate, setTermDate] = useState(new Date().toISOString().slice(0, 10));
  const [termChecklist, setTermChecklist] = useState({ equipment: false, systemAccess: false, handover: false, insurance: false });
  const [terminating, setTerminating] = useState(false);
  const [termLossReason, setTermLossReason] = useState("11");
  const [ediGenerated, setEdiGenerated] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});
  // 연봉 raw 입력 보존 — ÷12 → ×12 반올림으로 input 이 깨지지 않게.
  const [annualSalaryInput, setAnnualSalaryInput] = useState<string>("");

  // 퇴사 확정 — 모달 내부(JSX)에서만 쓰던 걸 최상위로 끌어올려 useModalKeys(Enter 확인)에서도 참조 가능하게 함
  async function confirmTermination() {
    setTerminating(true);
    try {
      const { error } = await (supabase as any).from("employees").update({
        status: "inactive",
        resignation_date: termDate,
      }).eq("id", employeeId);
      if (error) throw error;
      const { data: verify } = await (supabase as any).from("employees").select("id,status").eq("id", employeeId).maybeSingle();
      if (!verify || verify.status !== "inactive") throw new Error("상태 업데이트 실패 — 권한을 확인해주세요");
      queryClient.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      setShowTermModal(false);
      toast("퇴사 처리가 완료되었습니다", "success");
      setTimeout(() => onClose(), 300);
    } catch (err: any) {
      toast("퇴사 처리 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally {
      setTerminating(false);
    }
  }
  const termAllChecked = termChecklist.equipment && termChecklist.systemAccess && termChecklist.handover && termChecklist.insurance;

  // ESC 닫기(모달 열려있으면 모달만, 아니면 패널 전체) · Enter 확인(퇴사 확정, 체크리스트 미완료/처리중이면 비활성)
  useModalKeys(!showTermModal, onClose);
  useModalKeys(showTermModal, () => setShowTermModal(false), termAllChecked && !terminating ? confirmTermination : undefined);

  // Retirement pay calculation state
  const [retirementEndDate, setRetirementEndDate] = useState(new Date().toISOString().slice(0, 10));

  // Company data for EDI generation
  const { data: companyInfo } = useQuery({
    queryKey: ["company-info-edi", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name, representative, address, business_number").eq("id", companyId).maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

  // Fetch employee details
  const { data: emp } = useQuery({
    queryKey: ["employee-detail", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employees").select("*").eq("id", employeeId).maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // 프로필 사진 — 마이페이지에서 설정한 users.avatar_url. user_id(우선) 또는 email 로 매칭.
  const { data: avatarUrl = null } = useQuery<string | null>({
    queryKey: ["employee-avatar", employeeId, emp?.user_id, emp?.email],
    queryFn: async () => {
      const db = supabase as any;
      if (emp?.user_id) {
        const { data } = await db.from("users").select("avatar_url").eq("id", emp.user_id).maybeSingle();
        return data?.avatar_url || null;
      }
      if (emp?.email) {
        const { data } = await db.from("users").select("avatar_url").eq("company_id", companyId).eq("email", emp.email).maybeSingle();
        return data?.avatar_url || null;
      }
      return null;
    },
    enabled: !!emp,
  });

  // Fetch employee contracts (Flex-style 계약서 탭)
  const { data: empContracts = [] } = useQuery({
    queryKey: ["emp-contracts", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employee_contracts").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!employeeId && detailTab === "contracts",
  });

  // Fetch HR contract packages (전자서명 패키지) for this employee
  const { data: empPackages = [] } = useQuery({
    queryKey: ["emp-hr-packages", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("hr_contract_packages")
        .select("id, title, status, sign_token, sent_at, completed_at, expires_at, created_at, hr_contract_package_items(id, status)")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!employeeId && detailTab === "contracts",
  });

  // "+ 계약서 보내기" — 이 직원 전용 발송 폼(직원 선택 스텝 없이 서식선택→필드입력→발송).
  //   회사 전체 서식 편집/발송현황/일괄발송은 인사관리 > 양식 관리로 이관됨(2026-07-15).
  const [showCreateContract, setShowCreateContract] = useState(false);
  const [contractTitle, setContractTitle] = useState("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [contractFields, setContractFields] = useState<ContractField[]>(() => buildDefaultContractFields(null));

  const { data: contractTemplates = [] } = useQuery({
    queryKey: ["contract-templates", companyId],
    queryFn: () => getContractTemplates(companyId!),
    enabled: !!companyId && showCreateContract,
  });

  function openCreateContract() {
    setContractTitle(`${emp?.name || ""} ${new Date().getFullYear()}년 계약`);
    setSelectedTemplateIds([]);
    setContractFields(buildDefaultContractFields(emp));
    setShowCreateContract(true);
  }

  function toggleContractTemplate(id: string) {
    setSelectedTemplateIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  const sendContractMut = useMutation({
    mutationFn: async () => {
      const overrides: Record<string, string> = {};
      for (const f of contractFields) {
        if (f.included && f.value) {
          overrides[f.label] = String(f.value);
          if (f.key && f.key !== f.label) overrides[f.key] = String(f.value);
        }
      }
      const pkg = await createContractPackage({
        companyId,
        employeeId,
        title: contractTitle || `${emp?.name || ""} ${new Date().getFullYear()}년 계약`,
        templateIds: selectedTemplateIds,
        createdBy: viewer?.id ?? null,
        variableOverrides: overrides,
      });
      const result = await sendContractPackage(pkg.package.id);
      if (!result.success) throw new Error(result.error || "발송에 실패했습니다");
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emp-hr-packages", employeeId] });
      setShowCreateContract(false);
      toast("계약서를 발송했습니다.", "success");
    },
    onError: (err: any) => toast("계약서 발송 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Fetch certificate logs for this employee
  const { data: empCertLogs = [] } = useQuery({
    queryKey: ["emp-cert-logs", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("certificate_logs").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!employeeId && detailTab === "certificates",
  });

  // Fetch leave balance + requests for this employee
  const { data: empLeaveBalance } = useQuery({
    queryKey: ["emp-leave-balance", employeeId, currentYear],
    queryFn: async () => {
      const { data } = await (supabase as any).from("leave_balances").select("*").eq("employee_id", employeeId).eq("year", currentYear).maybeSingle();
      return data;
    },
    enabled: !!employeeId && detailTab === "leave",
  });

  // 연차 설정(관리자) — 휴가 신청은 전자결재로 이관됨(2026-07-15). 여기선 구성원 총괄 관점의
  //   연차 총 부여일수 설정/조정만 담당(초기화·수정). initLeaveBalance = upsert.
  const [leaveDaysInput, setLeaveDaysInput] = useState<string>("");
  const setLeaveMut = useMutation({
    mutationFn: (totalDays: number) => initLeaveBalance(companyId, employeeId, currentYear, totalDays),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emp-leave-balance", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances-list"] });
      setLeaveDaysInput("");
      toast("연차가 설정되었습니다", "success");
    },
    onError: (e: any) => toast("연차 설정 실패: " + friendlyError(e, "알 수 없는 오류"), "error"),
  });

  const { data: empLeaveRequests = [] } = useQuery({
    queryKey: ["emp-leave-requests", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("leave_requests").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(20);
      return data || [];
    },
    enabled: !!employeeId && detailTab === "leave",
  });

  const BANK_LABELS: Record<string, string> = {
    ibk: "IBK 기업은행", kb: "KB 국민은행", shinhan: "신한은행", hana: "하나은행",
    woori: "우리은행", nh: "NH 농협은행", kdb: "KDB 산업은행", sc: "SC 제일은행",
    kakao: "카카오뱅크", toss: "토스뱅크", kbank: "케이뱅크",
  };

  if (!emp) return null;

  return (
    <div className="employee-detail-modal glass-card animate-slide-in">
      {/* 히어로 헤더 — 2026-07-15: 좌우 분할(프로필카드+탭콘텐츠) 구조 폐기, 그라데이션 배너 + 아바타 오버랩 단일 헤더로 재구성 */}
      <div className="employee-detail-hero">
        <div className="h-20 w-full" style={{ background: `linear-gradient(120deg, ${avatarColor(emp.id)}, color-mix(in srgb, ${avatarColor(emp.id)} 25%, var(--bg-card)))` }} />
        <button onClick={onClose} className="absolute top-3 right-3 p-2 rounded-xl bg-black/15 hover:bg-black/25 text-white transition backdrop-blur-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="px-6 pb-4 -mt-9 flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-end gap-3.5 min-w-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={emp.name || "프로필"} className="w-[72px] h-[72px] rounded-3xl object-cover shadow-xl ring-4 ring-[var(--bg-card)] shrink-0" />
            ) : (
              <div
                className="w-[72px] h-[72px] rounded-3xl flex items-center justify-center text-white font-extrabold text-2xl shadow-xl ring-4 ring-[var(--bg-card)] shrink-0"
                style={{ background: `linear-gradient(135deg, ${avatarColor(emp.id)}, ${avatarColor(emp.id)}99)` }}
              >
                {emp.name?.charAt(0)}
              </div>
            )}
            <div className="min-w-0 pb-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-extrabold text-[var(--text)] truncate">{emp.name}</span>
                {["active", "joined"].includes(emp.status)
                  ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--success)]/12 text-[var(--success)] shrink-0">재직</span>
                  : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--text-dim)]/15 text-[var(--text-dim)] shrink-0">퇴직</span>}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                {[emp.position, emp.department].filter(Boolean).join(" · ") || "직책 미지정"}
                {emp.employee_number ? ` · #${emp.employee_number}` : ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 pb-0.5">
            {!isEditing && detailTab === "info" && (
              <button onClick={() => { setEditData({ name: emp.name || "", department: emp.department || "", position: emp.position || "", job_grade: emp.job_grade || "", employment_type: emp.employment_type || "", employee_number: emp.employee_number || "", hire_date: emp.hire_date || "", email: emp.email || "", phone: emp.phone || "", birth_date: emp.birth_date || "", address: emp.address || "", emergency_contact: emp.emergency_contact || "", emergency_phone: emp.emergency_phone || "", salary: emp.salary ? String(emp.salary) : "", bank_name: emp.bank_name || "", bank_account: emp.bank_account || "", bank_holder: emp.bank_holder || "", is_4_insurance: emp.is_4_insurance ? "true" : "false", work_start_time: emp.work_start_time ? emp.work_start_time.slice(0, 5) : "", work_end_time: emp.work_end_time ? emp.work_end_time.slice(0, 5) : "" }); setAnnualSalaryInput(emp.salary ? String(Number(emp.salary) * 12) : ""); setIsEditing(true); }} className="px-3.5 py-1.5 text-[11px] font-semibold text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 rounded-xl transition">
                ✏ 수정
              </button>
            )}
            {emp.status !== "inactive" && emp.status !== "resigned" && (
              <button onClick={() => setShowTermModal(true)} className="px-3.5 py-1.5 text-[11px] font-semibold text-[var(--danger)] bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20 rounded-xl transition">
                퇴사 처리
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 탭 바 — 히어로 아래, 전체 폭 */}
      <div className="employee-detail-tabbar">
        <div className="seg-bar flex-wrap mb-3">
          {[
            { key: "info", label: "정보" },
            { key: "contracts", label: "계약서" },
            { key: "certificates", label: "증명서" },
            { key: "leave", label: "휴가" },
            { key: "docs", label: "입사서류" },
            { key: "notes", label: "노트" },
            { key: "history", label: "발령" },
            ...(canManageAccess ? [{ key: "access", label: "탭 권한" }] : []),
          ].map((t) => (
            <button key={t.key} onClick={() => setDetailTab(t.key as any)}
              className={`seg-item ${detailTab === t.key ? "seg-item-active" : ""}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 본문 — 단일 컬럼 전체폭(좌우 분할 폐기), 정보 탭은 2열 카드 그리드로 재배치 */}
      <div className="employee-detail-body">
        {/* Info Tab — Flex-style sections */}
        {detailTab === "info" && (
          <div className="employee-info-tab">
            {isEditing && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--info)]">정보 수정 중</span>
                <div className="flex gap-2">
                  <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)] transition">취소</button>
                  <button onClick={async () => { try { await updateEmployee(employeeId, { ...editData, salary: editData.salary ? Number(editData.salary) : undefined, is_4_insurance: editData.is_4_insurance === "true" }); queryClient.invalidateQueries({ queryKey: ["employee-detail", employeeId] }); queryClient.invalidateQueries({ queryKey: ["employees"] }); setIsEditing(false); toast("저장 완료", "success"); } catch (e: any) { toast(friendlyError(e, "저장 실패"), "error"); } }} className="px-3 py-1.5 text-[10px] font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg transition">저장</button>
                </div>
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
            {/* 인사 정보 */}
            <div className="employee-info-section">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                인사 정보
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {isEditing ? (<>
                  <EditField label="이름" value={editData.name} onChange={(v) => setEditData({ ...editData, name: v })} />
                  <EditField label="사번" value={editData.employee_number} onChange={(v) => setEditData({ ...editData, employee_number: v })} />
                  <EditField label="부서" value={editData.department} onChange={(v) => setEditData({ ...editData, department: v })} />
                  <EditField label="직책" value={editData.position} onChange={(v) => setEditData({ ...editData, position: v })} />
                  <EditField label="직급" value={editData.job_grade} onChange={(v) => setEditData({ ...editData, job_grade: v })} />
                  <EditField label="입사일" value={editData.hire_date} onChange={(v) => setEditData({ ...editData, hire_date: v })} type="date" />
                  <div><div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">고용형태</div><select value={editData.employment_type} onChange={(e) => setEditData({ ...editData, employment_type: e.target.value })} className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"><option value="">선택</option><option value="regular">정규직</option><option value="contract">계약직</option><option value="parttime">파트타임</option><option value="intern">인턴</option></select></div>
                  <div><div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">4대보험</div><select value={editData.is_4_insurance} onChange={(e) => setEditData({ ...editData, is_4_insurance: e.target.value })} className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"><option value="true">가입</option><option value="false">미가입</option></select></div>
                </>) : (<>
                  <InfoRow label="사번" value={emp.employee_number} />
                  <InfoRow label="부서" value={emp.department} />
                  <InfoRow label="직책" value={emp.position} />
                  <InfoRow label="직급" value={emp.job_grade} />
                  <InfoRow label="입사일" value={emp.hire_date} />
                  <InfoRow label="근속기간" value={emp.hire_date ? (() => { const d = new Date(emp.hire_date); const now = new Date(); const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth(); const y = Math.floor(months / 12); const m = months % 12; return y > 0 ? `${y}년 ${m}개월` : `${m}개월`; })() : undefined} />
                  <InfoRow label="고용형태" value={emp.employment_type === "regular" ? "정규직" : emp.employment_type === "contract" ? "계약직" : emp.employment_type === "parttime" ? "파트타임" : emp.employment_type === "intern" ? "인턴" : emp.employment_type || ""} />
                  <InfoRow label="4대보험" value={emp.is_4_insurance ? "가입" : "미가입"} />
                </>)}
              </div>
            </div>
            {/* 근무시간 (개인 설정) */}
            <div className="employee-info-section">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                근무시간 (개인 설정)
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {isEditing ? (<>
                  <EditField label="출근 시간" value={editData.work_start_time} onChange={(v) => setEditData({ ...editData, work_start_time: v })} type="time" />
                  <EditField label="퇴근 시간" value={editData.work_end_time} onChange={(v) => setEditData({ ...editData, work_end_time: v })} type="time" />
                </>) : (<>
                  <InfoRow label="출근 시간" value={emp.work_start_time ? emp.work_start_time.slice(0, 5) : "회사 기본값"} />
                  <InfoRow label="퇴근 시간" value={emp.work_end_time ? emp.work_end_time.slice(0, 5) : "회사 기본값"} />
                </>)}
              </div>
              <div className="text-[10px] text-[var(--text-dim)] mt-1.5">비워두면 회사 설정(설정 &gt; 근태)의 기본 출퇴근 시간이 적용됩니다.</div>
            </div>
            {/* 기본 정보 */}
            <div className="employee-info-section">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                기본 정보
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {isEditing ? (<>
                  <EditField label="이메일" value={editData.email} onChange={(v) => setEditData({ ...editData, email: v })} type="email" />
                  <EditField label="전화번호" value={editData.phone} onChange={(v) => setEditData({ ...editData, phone: v })} />
                  <EditField label="생년월일" value={editData.birth_date} onChange={(v) => setEditData({ ...editData, birth_date: v })} type="date" />
                  <EditField label="주소" value={editData.address} onChange={(v) => setEditData({ ...editData, address: v })} />
                  <EditField label="비상연락처(이름)" value={editData.emergency_contact} onChange={(v) => setEditData({ ...editData, emergency_contact: v })} />
                  <EditField label="비상연락처(번호)" value={editData.emergency_phone} onChange={(v) => setEditData({ ...editData, emergency_phone: v })} />
                </>) : (<>
                  <InfoRow label="이메일" value={emp.email} />
                  <InfoRow label="전화번호" value={emp.phone} />
                  <InfoRow label="생년월일" value={emp.birth_date} />
                  <InfoRow label="주소" value={emp.address} />
                  <InfoRow label="비상연락처" value={emp.emergency_contact ? `${emp.emergency_contact} (${emp.emergency_phone || ""})` : undefined} />
                  <InfoRow label="전자서명" value={emp.saved_signature ? "등록됨" : "미등록"} />
                </>)}
              </div>
            </div>
            {/* 급여/계좌 정보 */}
            <div className="employee-info-section">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
                급여 · 계좌
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {isEditing ? (<>
                  {/* 연봉 직접 입력 — raw 값은 annualSalaryInput 에 보존 (반올림 깨짐 방지).
                      저장 직전 ÷12 로 월 급여 계산해서 editData.salary 에 동기화. */}
                  <div>
                    <div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">연봉</div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={annualSalaryInput ? Number(annualSalaryInput).toLocaleString('ko-KR') : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setAnnualSalaryInput(raw);
                        const monthly = raw ? String(Math.round(Number(raw) / 12)) : '';
                        setEditData({ ...editData, salary: monthly });
                      }}
                      placeholder="36,000,000"
                      className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">월 급여 (자동)</div>
                    <input
                      type="text"
                      value={editData.salary ? `₩${Number(editData.salary).toLocaleString('ko-KR')}` : '연봉 입력 시 자동 계산'}
                      readOnly
                      className="w-full px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] cursor-not-allowed"
                    />
                  </div>
                  <InfoRow label="퇴직충당금" value={emp.retirement_accrual ? `₩${Number(emp.retirement_accrual).toLocaleString()}` : undefined} />
                  <div><div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">급여 은행</div><select value={editData.bank_name} onChange={(e) => setEditData({ ...editData, bank_name: e.target.value })} className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"><option value="">선택</option>{Object.entries(BANK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <EditField label="계좌번호" value={editData.bank_account} onChange={(v) => setEditData({ ...editData, bank_account: v })} />
                  <EditField label="예금주" value={editData.bank_holder} onChange={(v) => setEditData({ ...editData, bank_holder: v })} />
                </>) : (<>
                  <InfoRow label="월 급여" value={emp.salary ? `₩${Number(emp.salary).toLocaleString()}` : undefined} />
                  <InfoRow label="연봉 (월급여 × 12)" value={emp.salary ? `₩${(Number(emp.salary) * 12).toLocaleString()}` : undefined} />
                  <InfoRow label="퇴직충당금" value={emp.retirement_accrual ? `₩${Number(emp.retirement_accrual).toLocaleString()}` : undefined} />
                  <InfoRow label="급여 은행" value={BANK_LABELS[emp.bank_name] || emp.bank_name} />
                  <InfoRow label="계좌번호" value={emp.bank_account} />
                  <InfoRow label="예금주" value={emp.bank_holder} />
                </>)}
              </div>
            </div>
            </div>
            {/* 퇴직금 계산 */}
            {emp.hire_date && emp.salary && (() => {
              const retCalcResult = calculateRetirementPay({
                startDate: emp.hire_date,
                endDate: retirementEndDate,
                last3MonthsSalary: Number(emp.salary || 0) * 3,
              });
              const hireDate = new Date(emp.hire_date);
              const endDate = new Date(retirementEndDate);
              const diffMs = endDate.getTime() - hireDate.getTime();
              const totalDaysRaw = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              const tenureYears = Math.floor(totalDaysRaw / 365);
              const tenureMonths = Math.floor((totalDaysRaw % 365) / 30);
              const tenureDays = totalDaysRaw % 365 % 30;

              return (
                <div className="employee-retirement-calc">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    퇴직금 계산
                  </div>
                  <div className="bg-[var(--bg)] rounded-xl border border-[var(--border)] p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="caption mb-0.5">입사일</div>
                        <div className="font-medium">{emp.hire_date}</div>
                      </div>
                      <div>
                        <div className="caption mb-0.5">퇴직일 (예상)</div>
                        <DateField
                          value={retirementEndDate}
                          onChange={(e) => setRetirementEndDate(e.target.value)}
                          className="w-full px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <div className="caption mb-0.5">근속기간</div>
                        <div className="font-medium">
                          {tenureYears > 0 && `${tenureYears}년 `}{tenureMonths > 0 && `${tenureMonths}개월 `}{tenureDays}일
                          <span className="text-[var(--text-dim)] ml-1">({totalDaysRaw}일)</span>
                        </div>
                      </div>
                      <div>
                        <div className="caption mb-0.5">월 평균임금</div>
                        <div className="font-medium">{`₩${Number(emp.salary).toLocaleString("ko-KR")}`}</div>
                      </div>
                      <div>
                        <div className="caption mb-0.5">1일 평균임금</div>
                        <div className="font-medium">{`₩${retCalcResult.dailyAvgWage.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`}</div>
                      </div>
                      <div>
                        <div className="caption mb-0.5">수급 자격</div>
                        <div className={`font-medium ${retCalcResult.eligible ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
                          {retCalcResult.eligible ? "해당 (1년 이상)" : "미해당 (1년 미만)"}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-[var(--border)] pt-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-[var(--text-muted)]">예상 퇴직금</div>
                        <div className="text-lg font-bold text-[var(--primary)]">
                          {`₩${retCalcResult.retirementPay.toLocaleString("ko-KR")}`}
                        </div>
                      </div>
                      <div className="text-[10px] text-[var(--text-dim)] mt-1">
                        산정 기준: 평균임금 x 30일 x 재직일수 / 365일 (근로기준법 제34조)
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Files Tab */}
        {/* 입사서류 Tab — Onboarding Document Checklist */}
        {detailTab === "docs" && (
          <OnboardingDocsSection employeeId={employeeId} companyId={companyId} emp={emp} queryClient={queryClient} />
        )}

        {/* Notes Tab (D-8: 관리자 인사노트) */}
        {detailTab === "notes" && (
          <AdminNotesSection employeeId={employeeId} emp={emp} queryClient={queryClient} />
        )}

        {/* History Tab (D-9: 인사발령 히스토리) */}
        {detailTab === "history" && (
          <EmploymentHistorySection employeeId={employeeId} emp={emp} queryClient={queryClient} />
        )}

        {/* 탭 권한 (관리자/대표 전용) */}
        {detailTab === "access" && canManageAccess && (
          <TabAccessSection companyId={companyId} targetUserId={emp?.user_id || null} grantedBy={viewer?.id || ""} empName={emp?.name || ""} />
        )}

        {/* Contracts Tab — Flex-style 계약서 목록 */}
        {detailTab === "contracts" && (
          <div className="employee-contracts-tab">
            <div className="flex items-center justify-end">
              <button onClick={() => (showCreateContract ? setShowCreateContract(false) : openCreateContract())} className="btn-secondary text-xs">
                {showCreateContract ? "취소" : "+ 계약서 보내기"}
              </button>
            </div>

            {showCreateContract && (
              <div className="contract-create-form glass-card">
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">계약 제목</label>
                  <input value={contractTitle} onChange={(e) => setContractTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>

                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1.5">서식 선택 *</label>
                  {contractTemplates.length === 0 ? (
                    <p className="text-xs text-[var(--text-dim)]">등록된 서식이 없습니다. 인사관리 &gt; 양식 관리에서 먼저 서식을 추가하세요.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {contractTemplates.map((t: any) => {
                        const selected = selectedTemplateIds.includes(t.id);
                        return (
                          <button key={t.id} type="button" onClick={() => toggleContractTemplate(t.id)}
                            className={`text-left px-3 py-2 rounded-lg border transition text-xs ${selected ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]/50"}`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${selected ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)]"}`}>
                                {selected && <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                              </div>
                              <span className="font-medium">{t.name}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1.5">필수 입력 정보 <span className="text-[var(--text-dim)] font-normal">— 서식의 {"{{변수명}}"} 자리에 자동 치환됨</span></label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {contractFields.map((f, i) => (
                      <div key={f.key + i} className={f.included ? "" : "opacity-40"}>
                        <label className="flex items-center gap-1 text-[10px] text-[var(--text-dim)] mb-0.5">
                          <input type="checkbox" checked={f.included}
                            onChange={(e) => setContractFields((prev) => prev.map((p, idx) => idx === i ? { ...p, included: e.target.checked } : p))}
                            className="rounded" />
                          {f.label}
                        </label>
                        {f.type === "date" ? (
                          <DateField value={f.value} disabled={!f.included}
                            onChange={(e) => setContractFields((prev) => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value } : p))}
                            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                        ) : f.type === "select" ? (
                          <select value={f.value} disabled={!f.included}
                            onChange={(e) => setContractFields((prev) => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value } : p))}
                            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]">
                            {(f.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : (
                          <input type="text" value={f.value} disabled={!f.included}
                            onChange={(e) => setContractFields((prev) => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value } : p))}
                            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button onClick={() => sendContractMut.mutate()} disabled={selectedTemplateIds.length === 0 || sendContractMut.isPending}
                    className="btn-primary text-xs">
                    {sendContractMut.isPending ? "발송 중..." : "생성 및 서명 요청 발송"}
                  </button>
                </div>
              </div>
            )}

            {empContracts.length === 0 && empPackages.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--text-dim)]">계약서가 없습니다</div>
            ) : (
              <>
                {/* 전자계약 패키지 (구성원 > 계약서 탭에서 발송된 것) */}
                {empPackages.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-[var(--text-muted)] mb-1.5 flex items-center gap-1.5">
                      전자계약
                      <span className="text-[10px] font-normal text-[var(--text-dim)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded-full">{empPackages.length}</span>
                    </div>
                    <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] overflow-hidden max-h-[300px] overflow-y-auto">
                      {empPackages.map((p: any) => {
                        const PKG_STATUS: Record<string, { label: string; color: string }> = {
                          draft: { label: "임시저장", color: "text-[var(--text-dim)] bg-[var(--bg-surface)]" },
                          sent: { label: "발송됨", color: "text-[var(--info)] bg-[var(--info)]/10" },
                          partially_signed: { label: "일부 서명", color: "text-[var(--warning)] bg-[var(--warning)]/10" },
                          completed: { label: "서명 완료", color: "text-[var(--success)] bg-[var(--success)]/10" },
                          cancelled: { label: "취소", color: "text-[var(--text-dim)] bg-[var(--bg-surface)]" },
                        };
                        const st = PKG_STATUS[p.status] || PKG_STATUS.draft;
                        const items = p.hr_contract_package_items || [];
                        const signedCount = items.filter((it: any) => it.status === "signed").length;
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] transition cursor-pointer"
                            onClick={() => p.sign_token && window.open(`/sign?token=${p.sign_token}`, "_blank", "noopener")}
                            title="클릭하여 계약서 열기"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">{p.title}</div>
                              <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">
                                {p.created_at ? new Date(p.created_at).toLocaleDateString("ko-KR") : ""}
                                {items.length > 0 ? ` · ${signedCount}/${items.length} 서명` : ""}
                                {p.completed_at ? ` · 완료 ${new Date(p.completed_at).toLocaleDateString("ko-KR")}` : p.sent_at ? ` · 발송 ${new Date(p.sent_at).toLocaleDateString("ko-KR")}` : ""}
                              </div>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {empContracts.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-bold text-[var(--text-muted)] mb-1.5 flex items-center gap-1.5">
                      근로 계약 (이력)
                      <span className="text-[10px] font-normal text-[var(--text-dim)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded-full">{empContracts.length}</span>
                    </div>
                    <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] overflow-hidden max-h-[220px] overflow-y-auto">
                      {empContracts.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[var(--bg-card)]">
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{c.contract_type === "regular" ? "정규직 근로계약서" : c.contract_type === "contract" ? "계약직 근로계약서" : c.contract_type || "근로계약서"}</div>
                            <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{c.start_date}{c.end_date ? ` ~ ${c.end_date}` : " ~ 현재"}</div>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${c.status === "active" ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--bg-surface)] text-[var(--text-dim)]"}`}>
                            {c.status === "active" ? "유효" : "종료"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Certificates Tab — 증명서 발급/이력 */}
        {detailTab === "certificates" && (
          <div className="employee-certificates-tab">
            {/* Quick issue buttons */}
            <div className="flex gap-3">
              <CertQuickIssue type="employment" label="재직증명서" emp={emp} companyId={companyId} queryClient={queryClient} />
              <CertQuickIssue type="career" label="경력증명서" emp={emp} companyId={companyId} queryClient={queryClient} />
            </div>
            {/* Issue history */}
            <div>
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">발급 내역</div>
              {empCertLogs.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--text-dim)]">발급 이력이 없습니다</div>
              ) : (
                <div className="space-y-1.5">
                  {empCertLogs.map((log: any) => (
                    <div key={log.id} className="flex items-center justify-between px-4 py-2.5 glass-card">
                      <div>
                        <div className="text-xs font-medium">{log.certificate_type}</div>
                        <div className="caption">{log.certificate_number} · {new Date(log.created_at).toLocaleDateString("ko-KR")}</div>
                      </div>
                      {log.pdf_url && (
                        <a href={log.pdf_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--primary)] hover:underline">PDF</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Leave Tab — 휴가 잔여/사용 기록 */}
        {detailTab === "leave" && (
          <div className="employee-leave-tab">
            {/* Leave balance summary */}
            {empLeaveBalance ? (
              <div className="leave-balance-summary">
                <div className="glass-card p-3 text-center">
                  <div className="caption">총 부여</div>
                  <div className="text-lg font-bold text-[var(--text)] mt-0.5">{empLeaveBalance.total_days}일</div>
                </div>
                <div className="glass-card p-3 text-center">
                  <div className="caption">사용</div>
                  <div className="text-lg font-bold text-[var(--danger)] mt-0.5">{empLeaveBalance.used_days}일</div>
                </div>
                <div className="glass-card p-3 text-center">
                  <div className="caption">잔여</div>
                  <div className={`text-lg font-bold mt-0.5 ${(empLeaveBalance.remaining_days ?? empLeaveBalance.total_days - empLeaveBalance.used_days) <= 3 ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
                    {empLeaveBalance.remaining_days ?? (empLeaveBalance.total_days - empLeaveBalance.used_days)}일
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card p-4 text-center text-xs text-[var(--text-dim)]">
                {currentYear}년 연차가 아직 설정되지 않았습니다
              </div>
            )}

            {/* 연차 설정(관리자) — 총 부여일수 초기화/조정. 휴가 신청/승인은 전자결재. */}
            {canManageAccess && (
              <div className="employee-leave-setter glass-card">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="text-xs font-bold text-[var(--text-muted)]">{currentYear}년 총 부여일수 설정</div>
                  {emp?.hire_date && (() => {
                    const calc = calculateAnnualLeave(emp.hire_date, `${currentYear}-12-31`);
                    return (
                      <button
                        onClick={() => setLeaveMut.mutate(calc.totalDays)}
                        disabled={setLeaveMut.isPending}
                        className="btn-ghost btn-sm text-[var(--primary)] disabled:opacity-50"
                        title={calc.formula}
                      >
                        입사일 기준 자동 {calc.totalDays}일
                      </button>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={leaveDaysInput}
                    onChange={(e) => setLeaveDaysInput(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder={empLeaveBalance ? String(empLeaveBalance.total_days) : "예: 15"}
                    className="field-input w-28"
                  />
                  <button
                    onClick={() => { const v = Number(leaveDaysInput); if (v >= 0) setLeaveMut.mutate(v); }}
                    disabled={setLeaveMut.isPending || leaveDaysInput === ""}
                    className="btn-primary btn-sm disabled:opacity-50"
                  >
                    {setLeaveMut.isPending ? "저장 중..." : empLeaveBalance ? "수정" : "설정"}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-dim)] mt-2">사용일수는 승인된 휴가에 따라 자동 반영됩니다.</p>
              </div>
            )}

            {/* Leave type cards (Flex-style) */}
            <div>
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">휴가 유형</div>
              <div className="grid grid-cols-3 gap-2">
                {LEAVE_TYPES.slice(0, 6).map((lt) => {
                  const used = empLeaveRequests.filter((r: any) => r.leave_type === lt.value && r.status === "approved")
                    .reduce((s: number, r: any) => s + Number(r.days || 0), 0);
                  return (
                    <div key={lt.value} className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] px-3 py-2">
                      <div className="caption">{lt.label}</div>
                      <div className="text-sm font-bold mt-0.5">{used > 0 ? `${used}일 사용` : `${lt.defaultDays}일`}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent leave requests */}
            <div>
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">사용 기록</div>
              {empLeaveRequests.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--text-dim)]">휴가 사용 기록이 없습니다</div>
              ) : (
                <div className="space-y-1.5">
                  {empLeaveRequests.slice(0, 10).map((r: any) => {
                    const typeLabel = LEAVE_TYPES.find((t) => t.value === r.leave_type)?.label || r.leave_type;
                    const statusColors: Record<string, string> = {
                      pending: "text-[var(--warning)] bg-[var(--warning)]/10",
                      approved: "text-[var(--success)] bg-[var(--success)]/10",
                      rejected: "text-[var(--danger)] bg-[var(--danger)]/10",
                    };
                    return (
                      <div key={r.id} className="flex items-center justify-between px-4 py-2.5 glass-card">
                        <div>
                          <div className="text-xs font-medium">{typeLabel} · {r.days}일</div>
                          <div className="caption">{r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[r.status] || "text-[var(--text-dim)] bg-[var(--bg-surface)]"}`}>
                          {r.status === "pending" ? "대기" : r.status === "approved" ? "승인" : "반려"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Termination Modal */}
      {showTermModal && (() => {
        const retCalc = emp.hire_date && emp.salary
          ? calculateRetirementPay({
              startDate: emp.hire_date,
              endDate: termDate,
              last3MonthsSalary: Number(emp.salary || 0) * 3,
            })
          : null;
        const allChecked = termAllChecked;

        return createPortal(
          <div className="employee-termination-modal fixed inset-0" onClick={() => setShowTermModal(false)}>
            <div className="w-full max-w-md max-h-[88vh] flex flex-col rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* 헤더 — 흰 카드 + 레드 포인트 아이콘 (라운드6: 그라데이션 제거) */}
              <div className="relative px-5 py-4 border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="kpi-icon danger shrink-0">🗂️</div>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-[var(--text)]">퇴사 처리</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">{emp.name} · {emp.department || ""} {emp.position || ""}</div>
                  </div>
                  <button onClick={() => setShowTermModal(false)} className="ml-auto p-2 hover:bg-[var(--bg-surface)] rounded-lg text-[var(--text-dim)] hover:text-[var(--text)] transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              {/* 본문 — 스크롤 */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* 퇴사일 */}
                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1.5">퇴사일</label>
                  <DateField
                    value={termDate}
                    onChange={(e) => setTermDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>

                {/* 퇴직금 계산 */}
                {retCalc && (
                  <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-3">
                    <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">퇴직금 계산 (예상)</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-[var(--text-dim)]">재직일수:</span> <span className="font-medium">{retCalc.totalDays}일</span></div>
                      <div><span className="text-[var(--text-dim)]">1일 평균임금:</span> <span className="font-medium">₩{retCalc.dailyAvgWage.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}</span></div>
                      <div><span className="text-[var(--text-dim)]">수급 자격:</span> <span className={`font-medium ${retCalc.eligible ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{retCalc.eligible ? "해당" : "미해당 (1년 미만)"}</span></div>
                      <div><span className="text-[var(--text-dim)]">예상 퇴직금:</span> <span className="font-bold">₩{retCalc.retirementPay.toLocaleString("ko-KR")}</span></div>
                    </div>
                  </div>
                )}

                {/* 상실사유 */}
                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1.5">상실사유</label>
                  <select
                    value={termLossReason}
                    onChange={(e) => setTermLossReason(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  >
                    {LOSS_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>{r.code} - {r.label}</option>
                    ))}
                  </select>
                </div>

                {/* 체크리스트 */}
                <div>
                  <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">퇴사 체크리스트</div>
                  <div className="space-y-2">
                    {([
                      { key: "equipment" as const, label: "장비 반납 완료" },
                      { key: "systemAccess" as const, label: "사내 시스템 접근 해제" },
                      { key: "handover" as const, label: "인수인계 완료" },
                      { key: "insurance" as const, label: ediGenerated ? "4대보험 상실 신고 (EDI 생성 완료)" : "4대보험 상실 신고" },
                    ]).map((item) => (
                      <label key={item.key} className="flex items-center gap-2.5 px-3 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition">
                        <input
                          type="checkbox"
                          checked={termChecklist[item.key]}
                          onChange={(e) => setTermChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded accent-[var(--primary)]"
                        />
                        <span className={`text-xs ${termChecklist[item.key] ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 4대보험 상실신고 EDI 생성 */}
                <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold text-[var(--text-muted)]">4대보험 상실신고 EDI</div>
                    {ediGenerated && <span className="text-[10px] text-[var(--success)] font-medium">생성 완료</span>}
                  </div>
                  <p className="text-[10px] text-[var(--text-dim)] mb-2">국민연금, 건강보험, 고용보험, 산재보험 상실신고 EDI 파일 4건을 일괄 생성합니다.</p>
                  <button
                    onClick={() => {
                      if (!emp || !companyInfo) return;
                      const reportDate = termDate.replace(/-/g, "");
                      const results = generateInsuranceEDI({
                        company: {
                          companyName: companyInfo.name || "",
                          businessNumber: companyInfo.business_number || "",
                          representativeName: companyInfo.representative || "",
                          address: companyInfo.address || "",
                        },
                        employees: [{
                          name: emp.name || "",
                          residentNumber: emp.resident_number || "000000-0000000",
                          leaveDate: reportDate,
                          monthlySalary: Number(emp.salary) || 0,
                          department: emp.department || "",
                          position: emp.position || "",
                          leaveReason: termLossReason,
                        }],
                        reportType: "loss",
                        reportDate,
                      });
                      results.forEach((r) => downloadEDIFile(r));
                      setEdiGenerated(true);
                      setTermChecklist((prev) => ({ ...prev, insurance: true }));
                    }}
                    disabled={!termDate || ediGenerated}
                    className="w-full py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition"
                  >
                    {ediGenerated ? "EDI 파일 다운로드 완료" : "EDI 파일 생성 (4건 다운로드)"}
                  </button>
                </div>

              </div>
              {/* 푸터 — 확정 */}
              <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-card)] shrink-0">
                {!allChecked && (
                  <div className="text-[10px] text-center text-[var(--text-dim)] mb-2">모든 체크리스트를 완료해야 퇴사를 확정할 수 있습니다</div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => setShowTermModal(false)} className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition shrink-0">
                    취소
                  </button>
                  <button
                    onClick={confirmTermination}
                    disabled={!allChecked || terminating}
                    className="flex-1 py-2.5 bg-[var(--danger)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition"
                  >
                    {terminating ? "처리 중..." : "퇴사 확정"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}

// ── 입사서류 체크리스트 ──

interface OnboardingDocItem {
  key: string;
  label: string;
  optional?: boolean;
  autoGen?: boolean;
  completed?: boolean;
  fileUrl?: string;
  storagePath?: string;
  fileName?: string;
  uploadedAt?: string;
}

const ONBOARDING_DOC_DEFAULTS: Omit<OnboardingDocItem, "completed" | "fileUrl" | "fileName" | "uploadedAt">[] = [
  { key: "resident_reg", label: "주민등록등본" },
  { key: "bank_copy", label: "통장사본" },
  { key: "diploma", label: "졸업증명서" },
  { key: "career_cert", label: "경력증명서", optional: true },
  { key: "health_check", label: "건강검진서", optional: true },
  { key: "nda", label: "비밀유지서약서", autoGen: true },
  { key: "privacy_consent", label: "개인정보동의서", autoGen: true },
];

function OnboardingDocsSection({ employeeId, companyId, emp, queryClient }: { employeeId: string; companyId: string; emp: any; queryClient: any }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const { toast } = useToast();

  // Read existing onboarding_docs JSONB from employee record
  const saved: Record<string, { completed: boolean; fileUrl?: string; storagePath?: string; fileName?: string; uploadedAt?: string }> =
    (emp?.onboarding_docs && typeof emp.onboarding_docs === "object") ? emp.onboarding_docs : {};

  const items: OnboardingDocItem[] = ONBOARDING_DOC_DEFAULTS.map((d) => ({
    ...d,
    completed: saved[d.key]?.completed || false,
    fileUrl: saved[d.key]?.fileUrl,
    storagePath: saved[d.key]?.storagePath,
    fileName: saved[d.key]?.fileName,
    uploadedAt: saved[d.key]?.uploadedAt,
  }));

  // 입사서류 파일 열기 — employee-files private 대비 signed URL. 기존 저장 URL 에서 path 추출 폴백.
  async function openDocFile(item: OnboardingDocItem) {
    let path = item.storagePath;
    if (!path && item.fileUrl) {
      const m = item.fileUrl.match(/\/object\/(?:public|sign|authenticated)\/employee-files\/([^?]+)/);
      if (m) path = decodeURIComponent(m[1]);
    }
    if (path) {
      const signed = await getSignedUrl("employee-files", path);
      if (signed) { window.open(signed, "_blank", "noopener"); return; }
    }
    if (item.fileUrl) window.open(item.fileUrl, "_blank", "noopener");
  }

  const completedCount = items.filter((i) => i.completed).length;
  const requiredCount = items.filter((i) => !i.optional).length;
  const requiredCompleted = items.filter((i) => !i.optional && i.completed).length;

  async function saveDocState(key: string, update: Partial<OnboardingDocItem>) {
    const current = { ...saved };
    current[key] = { ...current[key], ...update } as any;
    await (supabase as any).from("employees").update({ onboarding_docs: current }).eq("id", employeeId);
    queryClient.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
  }

  async function handleFileUpload(key: string, file: File) {
    setUploading(key);
    try {
      const result = await uploadEmployeeFile({
        companyId,
        employeeId,
        category: key,
        file,
      });
      await saveDocState(key, {
        completed: true,
        fileUrl: result.file_url,
        storagePath: result.storage_path,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
      });
      toast("파일이 업로드되었습니다", "success");
    } catch (err: any) {
      toast(friendlyError(err, "업로드 실패"), "error");
    } finally {
      setUploading(null);
    }
  }

  async function toggleCheck(key: string, checked: boolean) {
    await saveDocState(key, { completed: checked, uploadedAt: checked ? new Date().toISOString() : undefined });
  }

  return (
    <div className="employee-docs-checklist">
      {/* Progress summary */}
      <div className="flex items-center justify-between px-4 py-3 glass-card">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span className="text-xs font-semibold">입사서류 진행률</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--primary)] rounded-full transition-all" style={{ width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%` }} />
          </div>
          <span className="text-xs font-bold text-[var(--primary)]">{completedCount}/{items.length}</span>
          {requiredCompleted === requiredCount && (
            <span className="text-[10px] px-2 py-0.5 bg-[var(--success)]/10 text-[var(--success)] rounded-full font-medium">필수 완료</span>
          )}
        </div>
      </div>

      {/* Document checklist */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${item.completed ? "bg-[var(--success)]/5 border-[var(--success)]/20" : "bg-[var(--bg-card)] border-[var(--border)]"}`}>
            {/* Checkbox */}
            <input
              type="checkbox"
              checked={item.completed}
              onChange={(e) => toggleCheck(item.key, e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--primary)] flex-shrink-0 cursor-pointer"
            />

            {/* Label + badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-medium ${item.completed ? "text-[var(--text)] line-through opacity-70" : "text-[var(--text)]"}`}>
                  {item.label}
                </span>
                {item.optional && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface)] text-[var(--text-dim)] rounded-full">선택</span>
                )}
                {item.autoGen && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-[var(--info)]/10 text-[var(--info)] rounded-full font-medium">자동생성</span>
                )}
              </div>
              {item.uploadedAt && (
                <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                  {item.fileName && <span>{item.fileName} · </span>}
                  {new Date(item.uploadedAt).toLocaleDateString("ko-KR")} 제출
                </div>
              )}
            </div>

            {/* File link or upload button */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {(item.fileUrl || item.storagePath) && (
                <button type="button" onClick={() => openDocFile(item)} className="text-[10px] text-[var(--primary)] hover:underline">
                  보기
                </button>
              )}
              <label className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer transition ${uploading === item.key ? "opacity-50 pointer-events-none" : "bg-[var(--bg-surface)] hover:bg-[var(--primary)]/10 text-[var(--text-muted)] hover:text-[var(--primary)]"}`}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                {uploading === item.key ? "업로드중..." : "업로드"}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(item.key, f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* Helper text */}
      <p className="text-[10px] text-[var(--text-dim)] text-center">
        "자동생성" 서류는 HR 템플릿에서 자동 생성되며, 직원 서명 후 체크됩니다.
      </p>
    </div>
  );
}

// ── D-8: 관리자 인사노트 ──
function AdminNotesSection({ employeeId, emp, queryClient }: { employeeId: string; emp: any; queryClient: any }) {
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const notes: { text: string; author: string; date: string }[] = Array.isArray(emp?.admin_notes) ? emp.admin_notes : [];

  async function addNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const newNote = {
        text: noteText.trim(),
        author: "관리자",
        date: new Date().toISOString(),
      };
      const updated = [...notes, newNote];
      await (supabase as any).from("employees").update({ admin_notes: updated }).eq("id", employeeId);
      queryClient.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
      setNoteText("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="employee-notes-section">
      {/* 노트 입력 */}
      <div>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          placeholder="인사 메모를 입력하세요..."
          className="w-full px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={addNote}
            disabled={!noteText.trim() || saving}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition"
          >
            {saving ? "저장 중..." : "추가"}
          </button>
        </div>
      </div>

      {/* 노트 목록 */}
      {notes.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--text-dim)]">등록된 인사노트가 없습니다</div>
      ) : (
        <div className="space-y-2">
          {[...notes].reverse().map((n, i) => (
            <div key={i} className="px-4 py-3 glass-card">
              <div className="text-sm text-[var(--text)] whitespace-pre-wrap">{n.text}</div>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-dim)]">
                <span>{n.author}</span>
                <span>{n.date ? new Date(n.date).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── D-9: 인사발령 히스토리 ──
function EmploymentHistorySection({ employeeId, emp, queryClient }: { employeeId: string; emp: any; queryClient: any }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ department: "", position: "", date: "", note: "" });
  const [saving, setSaving] = useState(false);

  const history: { department: string; position: string; date: string; note: string }[] = Array.isArray(emp?.employment_history) ? emp.employment_history : [];

  async function addEntry() {
    if (!form.department && !form.position) return;
    setSaving(true);
    try {
      const newEntry = {
        department: form.department,
        position: form.position,
        date: form.date || new Date().toISOString().slice(0, 10),
        note: form.note,
      };
      const updated = [...history, newEntry];
      await (supabase as any).from("employees").update({ employment_history: updated }).eq("id", employeeId);
      queryClient.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
      setForm({ department: "", position: "", date: "", note: "" });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="employee-history-section">
      {/* 발령 추가 버튼 */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold transition"
        >
          + 발령 등록
        </button>
      </div>

      {/* 발령 등록 폼 */}
      {showForm && (
        <div className="glass-card p-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">부서 *</label>
              <input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="부서명"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직위</label>
              <input
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                placeholder="직위"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">발령일</label>
              <DateField
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">메모</label>
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="승진, 부서이동 등"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addEntry}
              disabled={(!form.department && !form.position) || saving}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {saving ? "저장 중..." : "등록"}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm({ department: "", position: "", date: "", note: "" }); }}
              className="px-3 py-2 text-xs text-[var(--text-muted)]"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 발령 이력 목록 */}
      {history.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--text-dim)]">인사발령 이력이 없습니다</div>
      ) : (
        <div className="space-y-0">
          {[...history].reverse().map((h, i) => (
            <div key={i} className="flex gap-3">
              {/* 타임라인 라인 */}
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === 0 ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />
                {i < history.length - 1 && <div className="w-px flex-1 bg-[var(--border)]" />}
              </div>
              {/* 내용 */}
              <div className="pb-4 flex-1">
                <div className="text-xs font-semibold text-[var(--text)]">
                  {h.department}{h.department && h.position ? " / " : ""}{h.position}
                </div>
                <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{h.date || "날짜 미지정"}</div>
                {h.note && <div className="text-xs text-[var(--text-muted)] mt-1">{h.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">{label}</div>
      <div className="text-xs text-[var(--text)]">{value || "—"}</div>
    </div>
  );
}

function EditField({ label, value, onChange, type, inputMode }: { label: string; value: string; onChange: (v: string) => void; type?: string; inputMode?: string }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">{label}</div>
      {type === "date" ? (
        <DateField value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
      ) : (
        <input type={type || "text"} inputMode={inputMode as any} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
      )}
    </div>
  );
}

// ── Certificate Quick Issue Button ──
function CertQuickIssue({ type, label, emp, companyId, queryClient }: { type: "employment" | "career"; label: string; emp: any; companyId: string; queryClient: any }) {
  const { toast } = useToast();
  const [issuing, setIssuing] = useState(false);
  async function issue() {
    setIssuing(true);
    try {
      const { data: company } = await supabase.from("companies").select("name, representative, address, business_number, seal_url").eq("id", companyId).maybeSingle();
      if (!company) { toast("회사 정보를 불러올 수 없습니다", "error"); return; }
      const empData = { name: emp.name, department: emp.department || "", position: emp.position || "", hire_date: emp.hire_date, employee_number: emp.employee_number, birth_date: emp.birth_date };
      const companyData = { name: company.name, representative: company.representative || "", address: company.address || "", business_number: company.business_number || "", seal_url: company.seal_url || "" };

      let result: { pdf: Blob; certificateNumber: string };
      if (type === "employment") {
        result = await generateEmploymentCertificate({ employee: empData, company: companyData, purpose: "제출용" });
      } else {
        result = await generateCareerCertificate({
          employee: { ...empData, end_date: emp.resignation_date || emp.end_date },
          company: companyData,
          duties: emp.job_title ? [emp.job_title] : [emp.position || emp.department || "업무 전반"],
        });
      }

      const url = URL.createObjectURL(result.pdf);
      window.open(url, "_blank");

      // Log
      const certType = type === "employment" ? "재직증명서" : "경력증명서";
      const { data: currentUser } = await supabase.auth.getUser();
      if (currentUser?.user) {
        await saveCertificateLog({ companyId, employeeId: emp.id, certificateType: certType, certificateNumber: result.certificateNumber, issuedBy: currentUser.user.id, purpose: "제출용" });
      }
      queryClient.invalidateQueries({ queryKey: ["emp-cert-logs", emp.id] });
    } catch (err: any) {
      toast(friendlyError(err, "증명서 생성 실패"), "error");
    } finally {
      setIssuing(false);
    }
  }
  return (
    <button onClick={issue} disabled={issuing} className="flex-1 py-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs font-semibold hover:border-[var(--primary)] transition disabled:opacity-50">
      {issuing ? "생성 중..." : `📄 ${label} 발급`}
    </button>
  );
}

// 탭 권한 부여 — 관리자/대표가 해당 구성원(로그인 계정)에 탭별 접근을 ON/OFF
function TabAccessSection({ companyId, targetUserId, grantedBy, empName }: {
  companyId: string; targetUserId: string | null; grantedBy: string; empName: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: overrides } = useQuery<Map<string, boolean>>({
    queryKey: ["user-tab-access", targetUserId],
    queryFn: () => getUserTabAccess(targetUserId!),
    enabled: !!targetUserId,
  });
  const overrideMap = overrides ?? new Map<string, boolean>();
  // 대상 계정 역할 — 대표(owner)는 항상 전체 접근(끌 수 없음). 관리자/직원은 기본 켜진 것도 끌 수 있음.
  const { data: targetRole } = useQuery<string | null>({
    queryKey: ["target-user-role", targetUserId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("users").select("role").eq("id", targetUserId).maybeSingle();
      return (data?.role as string) ?? null;
    },
    enabled: !!targetUserId,
  });
  const isOwner = targetRole === "owner";

  if (!targetUserId) {
    return (
      <div className="text-sm text-[var(--text-muted)] py-8 text-center leading-relaxed">
        이 구성원은 로그인 계정과 연결돼 있지 않아 탭 권한을 부여할 수 없습니다.<br />
        먼저 직원 초대 / 계정 연결을 진행해 주세요.
      </div>
    );
  }

  const toggle = async (route: string, nextOn: boolean) => {
    setBusy(route);
    try {
      await setTabAccess(companyId, targetUserId, route, nextOn, grantedBy);
      qc.invalidateQueries({ queryKey: ["user-tab-access", targetUserId] });
      qc.invalidateQueries({ queryKey: ["my-tab-access"] });
    } catch (e: any) { toast(e?.message || "변경 실패", "error"); }
    finally { setBusy(null); }
  };

  const groups = [...new Set(GRANTABLE_TABS.map((t) => t.group))];
  return (
    <div className="employee-tab-access-section">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        {isOwner ? (
          <><b className="text-[var(--text)]">{empName}</b> 님은 <b className="text-[var(--primary)]">대표</b>라 모든 탭에 접근합니다(끌 수 없음).</>
        ) : (
          <><b className="text-[var(--text)]">{empName}</b> 님의 탭 접근을 켜고/끌 수 있습니다. 기본 켜진 탭(관리자·기본 제공)도 끄면 접근이 차단됩니다.</>
        )}
      </p>
      {groups.map((g) => (
        <div key={g}>
          <div className="text-[11px] font-bold text-[var(--text-dim)] mb-1.5">{g}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {GRANTABLE_TABS.filter((t) => t.group === g).map((t) => {
              const on = effectiveTabAccess(t.route, targetRole, overrideMap);
              const locked = isOwner; // 대표만 잠금(끌 수 없음). 관리자/직원은 기본도 토글 가능.
              return (
                <button key={t.route} disabled={locked || busy === t.route} onClick={() => { if (!locked) toggle(t.route, !on); }}
                  title={locked ? "대표 — 전체 접근" : ""}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition ${locked ? "opacity-90 cursor-default" : "disabled:opacity-50"} ${on ? "bg-[var(--primary)]/10 border-[var(--primary)]/40 text-[var(--primary)]" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                  <span className="truncate">{locked && "🔒 "}{t.label}</span>
                  <span className={`shrink-0 w-7 h-4 rounded-full relative transition ${on ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? "left-[14px]" : "left-0.5"}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

