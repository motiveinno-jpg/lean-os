"use client";
import { appConfirm } from "@/components/global-confirm";
import { useMyPermissions } from "@/lib/permissions";
import { Ico } from "@/components/ui-icon";
import { todayKst, kstDateStr, kstDateTimeLocal, kstLocalToIso } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useEffect, useState, useMemo, useRef } from "react";
import { MonthField } from "@/components/month-field";
import { DateTimeField } from "@/components/datetime-field";
import { DateField } from "@/components/date-field";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { friendlyError } from "@/lib/friendly-error";
import {
  getSalaryHistory, addSalaryRecord,
  // Attendance & Leave
  getAttendanceRecords, getMonthlyAttendanceSummary,
  recomputeAttendance,
  calculateWeeklyHours,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  getLeaveBalances, correctAttendanceRecord,
  autoInitLeaveBalance, bulkAutoInitLeaveBalances, calculateAnnualLeave,
  cancelLeaveRequest, getCompanyMembers,
  getLeaveGrantMethod, setLeaveGrantMethod, type LeaveGrantMethod,
  LEAVE_TYPES, LEAVE_UNITS, ATTENDANCE_STATUS, LEAVE_REQUEST_STATUS,
  // Leave Promotion
  getLeavePromotionCandidates, sendLeavePromotionNotice, getLeavePromotionNotices,
} from "@/lib/hr";
import {
  getMonthlyAccrualSettings, setMonthlyAccrualSettings, syncLeaveAccruals, setRemainingLeaveDays,
  ACCRUAL_BASIS_LABELS, type MonthlyAccrualBasis,
  getCompanyLeaveTypes, setCompanyLeaveTypes, defaultCompanyLeaveTypes, type CompanyLeaveType,
} from "@/lib/leave-grants";
import { EmployeeDetailPanel } from "./_components/EmployeeDetailPanel";
import {
  getExpenseRequests, createExpenseRequest, approveExpense, rejectExpense,
  markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS,
} from "@/lib/expenses";
import { getSignedUrl } from "@/lib/file-storage";
import { previewPayroll } from "@/lib/payroll";
import { EmployeeBulkInviteModal } from "@/components/employee-bulk-invite"; // 엑셀 대량 초대(2026-07-31)
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { generateEmploymentCertificate, generateCareerCertificate, getCertificateLogs, saveCertificateLog } from "@/lib/certificates";
import { CertChoiceField, CERT_PURPOSE_OPTIONS, CERT_SUBMIT_TO_OPTIONS } from "@/components/cert-issue-fields";
import { type PayrollItem } from "@/lib/payment-batch";
import { createEmployeeInvitation, getEmployeeInvitations, getInviteUrl, sendInviteEmail, cancelEmployeeInvitation, addExistingMemberAsEmployee } from "@/lib/invitations";
import {
  MonthlyRecomputeButton,
  AttendanceEditRequestDialog,
  ManualAttendanceDialog,
} from "@/components/hr-attendance-extras";
import { AttendanceBadges } from "@/components/attendance-badges";
import { FlexPeopleDirectory } from "@/components/flex-people-directory";
import { PayrollHero, CertificatesHero } from "@/components/flex-hr-heroes";
import { useModalKeys } from "@/hooks/use-modal-keys";
// recomputeMonthlyAllowancesForCompany 자동 호출은 504 인시던트 3차 (2026-05-21) 후 제거됨.
//   수동 트리거 (MonthlyRecomputeButton / AllowanceAdminTab "월 일괄 재계산") 만 유지.

type Tab = "employees" | "salary" | "payroll" | "expenses" | "leave" | "certificates";

// Employee 역할은 자기 관련 탭만 접근 가능
// 근태 관리는 /attendance 별도 페이지로 분리됨. employees 페이지엔 휴가/경비/증명서만.
// (P3) EMPLOYEE_ROLE_TABS 삭제 — 권한 기반 탭 게이트로 대체.

export default function EmployeesPage() {
  const { toast } = useToast();
  const { user, role, loading: userLoading } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const sp = useSearchParams();
  const urlTab = sp?.get('tab') as Tab | null;
  const isValidTab = (t: string | null): t is Tab =>
    !!t && (['employees','salary','payroll','expenses','leave','certificates'] as const).includes(t as Tab);
  // V1: '급여이력' 완전 제거. '급여' 탭 = 급여 명세(PayrollPreviewTab)만.
  //   ?tab=salary / ?tab=payroll 딥링크 모두 '급여' 탭(명세)으로 정규화.
  const normalizeTab = (t: Tab): Tab => (t === "payroll" ? "salary" : t);
  const [tab, setTab] = useState<Tab>(isValidTab(urlTab) ? normalizeTab(urlTab) : "employees");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  // (P3) 관리 판정 권한 기반 — 인력관리 권한 보유(또는 마스터)=관리자급, 그 외=본인 스코프
  const { isMaster, hasPerm } = useMyPermissions();
  const isEmployee = !(isMaster || hasPerm("/employees:employees"));

  // URL ?tab=... 동기화. payroll/salary → '급여' 탭(명세).
  useEffect(() => {
    if (!isValidTab(urlTab)) return;
    setTab(normalizeTab(urlTab));
  }, [urlTab]);

  // (P3) 구 직원 탭 리셋 effect 제거 — 권한 기반 effectiveTab 렌더 경계가 대체.

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowForm(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Employees ──
  const { data: employees = [], error: mainError, refetch: mainRefetch, isLoading: mainLoading } = useQuery({
    queryKey: ["employees", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId!)
        .order("created_at"));
      return data || [];
    },
    enabled: !!companyId,
  });

  // V1: 급여이력(SalaryTab/salary-history) 제거 — '급여' 탭은 명세만.

  // (2026-07-30) 관리·추가/수정 뷰 삭제 — 디렉토리 단일.

  // ── Expenses ──
  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", companyId],
    queryFn: () => getExpenseRequests(companyId!),
    enabled: !!companyId && tab === "expenses",
  });

  // ── 휴가 탭용 디렉토리 — employees RLS 로 타인 행이 null 될 때 이름 폴백 (team 페이지와 동일 RPC) ──
  const { data: leaveDirectory = [] } = useQuery({
    queryKey: ["company-directory", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_directory");
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId && tab === "leave",
  });

  const totalSalary = employees.reduce((s: number, e: any) => s + Number(e.salary || 0), 0);
  const totalRetirement = employees.reduce((s: number, e: any) => s + Number(e.retirement_accrual || 0), 0);
  const activeCount = employees.filter((e: any) => ["active", "joined"].includes(e.status)).length;

  // (2026-07-30 개편 P3) 세부탭 권한 게이트 — 마스터=전체, 멤버=부여받은 탭만.
  //   카탈로그 키: /employees:employees|salary|leave|certificates. 구 role 분기 대체.
  const tabAllowed = (k: Tab) => isMaster || hasPerm(`/employees:${k === "payroll" ? "salary" : k}`);
  const isManager = !isEmployee;
  const allTabs: { key: Tab; label: string; count?: number }[] = [
    { key: "employees", label: "인력관리", count: activeCount },
    { key: "salary", label: "급여" },
    { key: "leave", label: "휴가" },
    { key: "certificates", label: "증명서 발급" },
  ];
  const tabs = allTabs.filter((t) => tabAllowed(t.key));
  // S-1: 렌더 경계 — 미허용 탭은 어떤 경로(딥링크 초기 state 포함)로도 해당 Tab 컴포넌트를
  //   마운트하지 않는다. 허용 탭이 하나도 없으면 certificates 자리(빈 안내)로.
  const effectiveTab: Tab = tabAllowed(tab === "payroll" ? "salary" : tab) ? tab : (tabs[0]?.key ?? "certificates");

  if (userLoading || mainLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">회사 정보를 불러올 수 없습니다. 새로고침 해주세요.</div>;

  // P2: 페이지-국소 인쇄 CSS 제거 → globals.css 공통 .print-area 유틸 사용.
  //     폭은 공통 토큰(--content-max-wide)으로 통일.
  return (
    <div className="print-area" id="employees-print-area">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* Tabs — 라운드6.5: 타이틀 제거 → 필형 seg-bar 컴팩트 툴바 행 */}
      <div className="employees-page-toolbar page-sticky-header">
        <div className="seg-bar">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`seg-item ${effectiveTab === t.key ? "seg-item-active" : ""}`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 badge badge-primary">{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Summary — Employee 역할에게는 급여/인원/퇴직충당금 숨김.
          휴가 탭은 시안대로 표가 주인공이라 상단 KPI 를 감춘다 (2026-08-06 사장님). */}
      {!isEmployee && effectiveTab !== "leave" && (
        <div className="employees-summary-stats">
          <div className="stat-tile">
            <div className="flex items-center justify-between">
              <span className="stat-tile-label">재직 인원</span>
              <span className="kpi-icon"><Ico e="👥" /></span>
            </div>
            <div className="flex items-end gap-2">
              <span className="stat-tile-value mono-number">{activeCount}명</span>
            </div>
          </div>
          <div className="stat-tile">
            <div className="flex items-center justify-between">
              <span className="stat-tile-label">연 인건비</span>
              <span className="kpi-icon danger"><Ico e="💸" /></span>
            </div>
            <div className="flex items-end gap-2">
              <span className="stat-tile-value mono-number">₩{(totalSalary * 12).toLocaleString()}</span>
            </div>
            <div className="kpi-callout">월 <b>₩{totalSalary.toLocaleString()}</b></div>
          </div>
          <div className="stat-tile">
            <div className="flex items-center justify-between">
              <span className="stat-tile-label">퇴직충당금</span>
              <span className="kpi-icon warning"><Ico e="🏦" /></span>
            </div>
            <div className="flex items-end gap-2">
              <span className="stat-tile-value mono-number">₩{totalRetirement.toLocaleString()}</span>
            </div>
          </div>
          <div className="stat-tile">
            <div className="flex items-center justify-between">
              <span className="stat-tile-label">미결 경비</span>
              <span className="kpi-icon warning"><Ico e="🧾" /></span>
            </div>
            <div className="flex items-end gap-2">
              <span className="stat-tile-value mono-number">
                {expenses.filter((e: any) => e.status === "pending").length}건
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content — S-1: effectiveTab 으로 직원 비허용 탭 컴포넌트 미마운트 */}
      {/* (2026-07-30 사장님) '관리·추가/수정' 화면 삭제 — 디렉토리 단일 화면 + 초대 섹션만 이동.
          직원 정보 수정은 디렉토리 카드 → 상세보기에서. */}
      {effectiveTab === "employees" && (
        <>
          {!isEmployee && <EmployeeInviteSection companyId={companyId} userId={userId} queryClient={queryClient} />}
          <FlexPeopleDirectory companyId={companyId} employees={employees} isManager={!isEmployee} />
        </>
      )}

      {/* P1-3: 급여 = 이력 ↔ 명세 서브뷰 단일 탭 */}
      {/* V1: '급여이력' 세그먼트 제거 — 급여 탭은 명세만 (이력 진입 0) */}
      {/* 보드 스타일(2026-06-12): 세부탭마다 모듈 히어로(실데이터 지표 칩) + flex-skin (탭 본체 무수정) */}
      {effectiveTab === "salary" && (
        <>
          {!isEmployee && <PayrollHero employees={employees} />}
          <div className="payroll-tab-panel flex-skin"><PayrollPreviewTab companyId={companyId} /></div>
        </>
      )}

      {/* 경비청구 탭은 구성원에서 제거(2026-06-29) — 경비/지출결의는 결재관리(/approvals)에서 처리(2026-07-08 이관). 미결 경비 요약 카드는 상단 유지. 휴가 탭은 근태관리로 이동. */}
      {/* 계약서 탭은 구성원에서 제거(2026-07-15) — 개별 발송은 인력관리 > 디렉토리에서 직원 선택 후 계약서 탭으로,
          서식 관리/회사 문서/발송 현황(일괄발송)은 인사관리 > 양식 관리(/hr-templates)로 이관됨. */}
      {/* 휴가 탭 복원(2026-07-30) — 관리자/대표 전용. 직원 딥링크는 S-1 렌더 경계(effectiveTab)가 차단. */}
      {effectiveTab === "leave" && (
        <LeaveTab
          employees={employees}
          directory={leaveDirectory}
          companyId={companyId}
          userId={userId}
          queryClient={queryClient}
          isEmployee={false}
          autoNew={sp?.get("new") === "1"}
          focusPending={sp?.get("focus") === "pending"}
        />
      )}

      {effectiveTab === "certificates" && (
        <>
          <CertificatesHero companyId={companyId} />
          <div className="certificate-tab-panel flex-skin"><CertificateTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} /></div>
        </>
      )}
    </div>
  );
}

// ── 구성원 초대 섹션 (2026-07-30 사장님) — 구 '관리·추가/수정' 화면에서 초대만 발췌해 디렉토리로 이동.
//   목록 테이블·조직도·역할 관리 등 관리 화면은 삭제(수정은 디렉토리 상세보기에서).
function EmployeeInviteSection({ companyId, userId, queryClient }: any) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "employee" as "employee" | "admin", department: "", position: "", salary: "", hireDate: "" });
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addExisting, setAddExisting] = useState(false);
  // 엑셀 대량 초대 (2026-07-31 사장님) — 단건 초대와 동일 경로를 행 단위로 반복
  const [showBulkInvite, setShowBulkInvite] = useState(false);

  const { data: invitations = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId!),
    enabled: !!companyId,
  });
  const { data: companyData } = useQuery({
    queryKey: ["company-name", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase.from("companies").select("name, representative, address, business_number").eq("id", companyId!).maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const [showAcqEdi, setShowAcqEdi] = useState(false);
  const [acqEdiData, setAcqEdiData] = useState<{ name: string; department: string; position: string; salary: string } | null>(null);

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("인증 필요");
      const trimmedEmail = form.email.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error("올바른 이메일 주소를 입력해주세요.");
      if (!form.department?.trim()) throw new Error("부서를 입력해주세요.");
      const invitation = await createEmployeeInvitation({
        companyId, email: form.email, name: form.name || undefined,
        role: form.role, invitedBy: userId,
      });
      await supabase.from("employees").insert({
        company_id: companyId,
        name: form.name || form.email.split("@")[0],
        email: form.email,
        department: form.department || null,
        position: form.position || null,
        salary: Math.round((Number(form.salary) || 0) / 12),
        hire_date: form.hireDate || todayKst(),
        status: "invited",
      });
      return invitation;
    },
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      if (data?.invite_token) {
        const result = await sendInviteEmail({
          email: data.email, name: data.name || undefined,
          role: data.role || form.role, inviteToken: data.invite_token,
          companyName: companyData?.name || undefined,
        });
        setInviteMsg(result.success
          ? { ok: true, msg: "초대 이메일 발송 완료" }
          : { ok: false, msg: result.error || "이메일 발송 실패 (초대 링크는 생성됨)" }
        );
      }
      setAcqEdiData({ name: form.name || form.email.split("@")[0], department: form.department, position: form.position, salary: form.salary });
      setShowAcqEdi(true);
      setShowForm(false);
      setForm({ email: "", name: "", role: "employee", department: "", position: "", salary: "", hireDate: "" });
    },
    onError: (err: any) => {
      const msg = err.message || "";
      if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
        setInviteMsg({ ok: false, msg: "이미 초대된 이메일입니다" });
      } else {
        setInviteMsg({ ok: false, msg: msg || "초대 실패" });
      }
      setTimeout(() => setInviteMsg(null), 4000);
    },
  });

  const addExistingMut = useMutation({
    mutationFn: async () => {
      const trimmedEmail = form.email.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error("올바른 이메일 주소를 입력해주세요.");
      return await addExistingMemberAsEmployee({
        email: trimmedEmail, name: form.name || undefined, role: form.role,
        department: form.department, position: form.position, salary: form.salary, hireDate: form.hireDate,
      });
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      setInviteMsg({ ok: true, msg: `${r?.name || "회원"}님을 직원으로 추가했습니다.` });
      setShowForm(false);
      setForm({ email: "", name: "", role: "employee", department: "", position: "", salary: "", hireDate: "" });
      setTimeout(() => setInviteMsg(null), 4000);
    },
    onError: (err: any) => {
      setInviteMsg({ ok: false, msg: err?.message || "직원 추가 실패" });
      setTimeout(() => setInviteMsg(null), 5000);
    },
  });

  // 초대 취소 — 초대 레코드 + 수락 전(invited) 직원 행까지 함께 정리 (구 관리 화면의 삭제 기능 흡수)
  const cancelMut = useMutation({
    mutationFn: async (inv: any) => {
      await cancelEmployeeInvitation(inv.id);
      if (inv.email) {
        await supabase.from("employees").delete().eq("email", inv.email).eq("company_id", companyId).eq("status", "invited");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
    },
    onError: (err: any) => toast("초대 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  function copyLink(token: string) {
    navigator.clipboard.writeText(getInviteUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }
  const [resending, setResending] = useState<string | null>(null);
  async function resend(inv: any) {
    if (!inv.invite_token || resending) return;
    setResending(inv.invite_token);
    const result = await sendInviteEmail({
      email: inv.email, name: inv.name || undefined,
      role: inv.role || "employee", inviteToken: inv.invite_token,
      companyName: companyData?.name || undefined,
    });
    setInviteMsg(result.success ? { ok: true, msg: "재발송 완료" } : { ok: false, msg: result.error || "발송 실패" });
    setResending(null);
    setTimeout(() => setInviteMsg(null), 4000);
  }

  const pendingInvites = invitations.filter((i: any) => i.status === "pending");

  return (
    <div className="employee-invite-section">
      <div className="employee-toolbar">
        <div className="text-xs text-[var(--text-dim)]">
          {pendingInvites.length > 0 && <span className="text-[var(--warning)] font-semibold">초대 대기 {pendingInvites.length}명</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkInvite(true)} className="btn-secondary">엑셀로 대량 초대</button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">+ 직원 초대</button>
        </div>
      </div>

      {showBulkInvite && companyId && userId && (
        <EmployeeBulkInviteModal
          companyId={companyId}
          userId={userId}
          companyName={companyData?.name || undefined}
          onClose={() => setShowBulkInvite(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
            queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
            queryClient.invalidateQueries({ queryKey: ["employee-emails", companyId] });
          }}
        />
      )}

      {inviteMsg && (
        <div className={`employee-invite-banner ${inviteMsg.ok ? "bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20" : "bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20"}`}>
          {inviteMsg.msg}
        </div>
      )}

      {showAcqEdi && acqEdiData && (
        <div className="employee-insurance-edi-panel">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-[var(--info)] flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                4대보험 취득신고 · Web EDI 업로드 파일 (준비 중)
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">신규 직원 <span className="font-semibold text-[var(--text)]">{acqEdiData.name}</span>의 국민건강보험 Web EDI 업로드용 정식 파일을 준비 중입니다.</p>
            </div>
            <button onClick={() => { setShowAcqEdi(false); setAcqEdiData(null); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>
          <div className="edi-prep-notice">
            국민건강보험 Web EDI 업로드용 <b>정식 파일(XLSX)</b>을 준비 중입니다. 준비 완료 전까지 이 화면에서 제출용 파일을 내려받을 수 없습니다.
            취득 신고가 급하시면 <b>공단 Web EDI</b>에서 직접 진행해주세요.
          </div>
        </div>
      )}

      {showForm && (
        <div className="employee-invite-form glass-card">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="text-sm font-bold">{addExisting ? "기존 회원 직원 추가" : "직원 초대"}</h4>
            <div className="ml-auto flex gap-1 p-0.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <button onClick={() => setAddExisting(false)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${!addExisting ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}>이메일 초대</button>
              <button onClick={() => setAddExisting(true)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${addExisting ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}>이미 가입한 회원</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이메일 *</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="user@company.com" className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이름</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="홍길동" className="field-input" /></div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">권한</label>
              <div className="px-3 py-2.5 rounded-xl text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)]">
                멤버로 합류 — 합류 후 구성원 상세의 <b>탭 권한</b>에서 마스터가 메뉴·기능을 부여합니다
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">부서</label><input value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">직위</label><input value={form.position} onChange={e => setForm({...form, position: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">입사일</label><DateField value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} className="field-input" />{!form.hireDate && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">비워두면 오늘 날짜로 설정됩니다</p>}</div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">연봉</label><input type="text" inputMode="numeric" value={form.salary ? Number(form.salary).toLocaleString('ko-KR') : ''} onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setForm({...form, salary: raw}); }} placeholder="36,000,000" className="field-input" />{form.salary && Number(form.salary) > 0 && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">월 ₩{Math.round(Number(form.salary) / 12).toLocaleString('ko-KR')}</p>}</div>
            <div className="flex items-end gap-2">
              {addExisting ? (
                <button onClick={() => form.email.trim() && addExistingMut.mutate()} disabled={!form.email.trim() || addExistingMut.isPending} className="flex-1 btn-primary">
                  {addExistingMut.isPending ? "추가중..." : "직원으로 추가"}
                </button>
              ) : (
                <button onClick={() => form.email.trim() && inviteMut.mutate()} disabled={!form.email.trim() || inviteMut.isPending} className="flex-1 btn-primary">
                  {inviteMut.isPending ? "전송중..." : "초대 전송"}
                </button>
              )}
              <button onClick={() => setShowForm(false)} className="px-3 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
          {addExisting ? (
            <p className="text-[10px] text-[var(--warning)]">이미 가입한 회원의 이메일로 바로 추가합니다. <b>해당 회원의 계정 소속이 우리 회사로 변경되고 멤버로 합류합니다(권한은 마스터가 부여).</b> (초대 이메일 없이 즉시 적용)</p>
          ) : (
            <p className="caption">초대 이메일이 발송되며, 직원이 가입 후 계약서 서명까지 완료하면 급여가 자동 반영됩니다.</p>
          )}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="employee-pending-invites">
          <h4 className="text-xs font-bold text-[var(--text-muted)] mb-2">초대 대기중</h4>
          <div className="space-y-2">
            {pendingInvites.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--warning)]/5 border border-[var(--warning)]/10">
                <div>
                  <div className="text-sm font-medium">{inv.name || inv.email}</div>
                  <div className="text-xs text-[var(--text-dim)]">{inv.email} · 멤버</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => resend(inv)} disabled={resending === inv.invite_token} className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50">
                    {resending === inv.invite_token ? "발송중..." : "재발송"}
                  </button>
                  <button onClick={() => copyLink(inv.invite_token)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)]">
                    {copiedToken === inv.invite_token ? "복사됨!" : "링크"}
                  </button>
                  <button onClick={() => cancelMut.mutate(inv)} className="text-xs text-[var(--danger)]/60 hover:text-[var(--danger)]">취소</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Salary Tab ──
function SalaryTab({ employees, selectedEmpId, setSelectedEmpId, salaryHistory, companyId, userId, queryClient }: any) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ effectiveDate: "", salary: "", reason: "" });

  const addSalary = useMutation({
    mutationFn: () => addSalaryRecord({
      companyId, employeeId: selectedEmpId!, effectiveDate: form.effectiveDate,
      salary: Number(form.salary), changeReason: form.reason, approvedBy: userId,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["salary-history"] }); setShowForm(false); setForm({ effectiveDate: "", salary: "", reason: "" }); },
    onError: (err: any) => toast("급여 기록 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  return (
    <div>
      <div className="salary-employee-selector">
        <select value={selectedEmpId || ""} onChange={e => setSelectedEmpId(e.target.value || null)} className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
          <option value="">직원 선택...</option>
          {employees.filter((e: any) => ['active', 'joined', 'invited'].includes(e.status)).map((e: any) => (
            <option key={e.id} value={e.id}>{e.name} ({e.department || '미배정'})</option>
          ))}
        </select>
        {selectedEmpId && <button onClick={() => setShowForm(!showForm)} className="btn-primary">+ 급여 변경</button>}
      </div>

      {showForm && selectedEmpId && (
        <div className="salary-change-form glass-card">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">적용일 *</label><DateField value={form.effectiveDate} onChange={e => setForm({...form, effectiveDate: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">변경 급여 (월급) *</label><input type="text" inputMode="numeric" value={form.salary ? Number(form.salary).toLocaleString('ko-KR') : ''} onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setForm({...form, salary: raw}); }} placeholder="3,000,000" className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">사유</label><input value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="승진, 연봉협상 등" className="field-input" /></div>
          </div>
          <button onClick={() => form.effectiveDate && form.salary && addSalary.mutate()} disabled={!form.effectiveDate || !form.salary || addSalary.isPending} className="btn-primary">{addSalary.isPending ? "등록 중..." : "등록"}</button>
        </div>
      )}

      {!selectedEmpId ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-4"><Ico e="💰" /></div>
          <div className="text-sm text-[var(--text-muted)]">직원을 선택하면 급여이력이 표시됩니다</div>
        </div>
      ) : (
        <div className="salary-history-table glass-card">
          {salaryHistory.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--text-muted)]">급여 변경 이력이 없습니다</div>
          ) : (
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead className="sticky-bar"><tr className="table-head-row">
                <th className="th-cell text-left">적용일</th>
                <th className="th-cell text-right">급여</th>
                <th className="th-cell text-right">이전 급여</th>
                <th className="th-cell text-left">사유</th>
                <th className="th-cell text-left">승인자</th>
              </tr></thead>
              <tbody>
                {salaryHistory.map((s: any) => (
                  <tr key={s.id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm">{s.effective_date}</td>
                    <td className="px-5 py-3 text-sm text-right font-medium">₩{Number(s.salary).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right text-[var(--text-dim)]">{s.previous_salary ? `₩${Number(s.previous_salary).toLocaleString()}` : "—"}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{s.change_reason || "—"}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{s.users?.name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expense Tab ──
function ExpenseTab({ expenses, companyId, userId, queryClient, isEmployee }: any) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", amount: "", category: "general", description: "" });
  const [receiptFiles, setReceiptFiles] = useState<{ file: File; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);

  async function uploadReceipts(): Promise<string[]> {
    if (receiptFiles.length === 0) return [];
    const urls: string[] = [];
    for (const { file } of receiptFiles) {
      const ext = file.name.split(".").pop();
      const path = `expense-receipts/${companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("document-files").upload(path, file);
      if (error) throw new Error(`영수증 업로드 실패: ${error.message}`);
      const { data: urlData } = supabase.storage.from("document-files").getPublicUrl(path);
      urls.push(urlData.publicUrl);
    }
    return urls;
  }

  async function ocrReceipt(file: File) {
    setOcrProcessing(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `expense-receipts/${companyId}/ocr-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("document-files").upload(path, file);
      if (upErr) throw upErr;
      // document-files private 전환 → OCR 엣지함수가 읽도록 signed URL 전달
      const signedUrl = await getSignedUrl("document-files", path);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ocr-receipt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ image_url: signedUrl }),
      });
      const result = await res.json();
      if (result.success && result.confidence > 30) {
        setForm(prev => ({
          ...prev,
          title: result.merchant ? `${result.merchant} 결제` : prev.title,
          amount: result.amount ? String(result.amount) : prev.amount,
          category: result.category === "식대" ? "meal" : result.category === "교통" ? "transport" : result.category === "소모품" ? "supplies" : prev.category,
          description: result.items.length > 0 ? result.items.join(", ") : prev.description,
        }));
        toast(`영수증 인식 완료 (확신도 ${result.confidence}%)`, "success");
      } else {
        toast("영수증 인식 실패 — 수동으로 입력해주세요", "info");
      }
    } catch (err: any) {
      toast(`OCR 실패: ${err.message}`, "error");
    } finally {
      setOcrProcessing(false);
    }
  }

  const addExpense = useMutation({
    mutationFn: async () => {
      setUploading(true);
      try {
        const receiptUrls = await uploadReceipts();
        return createExpenseRequest({
          companyId: companyId!, requesterId: userId!, title: form.title.trim(),
          amount: Number(form.amount), category: form.category, description: form.description.trim(),
          receiptUrls,
        });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["approval"] });
      setShowForm(false);
      setForm({ title: "", amount: "", category: "general", description: "" });
      setReceiptFiles([]);
    },
    onError: (err: any) => toast(friendlyError(err, "청구 실패"), "error"),
  });

  const approve = useMutation({
    mutationFn: (expenseId: string) => approveExpense({ companyId: companyId!, expenseId, approverId: userId! }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); queryClient.invalidateQueries({ queryKey: ["payment-queue"] }); },
    onError: (err: any) => toast("비용 승인 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const reject = useMutation({
    mutationFn: (expenseId: string) => rejectExpense({ companyId: companyId!, expenseId, approverId: userId! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
    onError: (err: any) => toast("비용 반려 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  return (
    <div>
      <div className="expense-toolbar">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">+ 경비 청구</button>
      </div>

      {showForm && (
        <div className="expense-request-form glass-card">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">제목 *</label><input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">금액 *</label><input type="text" inputMode="numeric" value={form.amount ? Number(form.amount).toLocaleString("ko-KR") : ""} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setForm({...form, amount: v}); }} placeholder="0" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-right font-mono focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">분류</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">설명</label><input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="field-input" /></div>
          </div>
          {/* 영수증 첨부 */}
          <div className="expense-receipt-uploader">
            <label className="block text-xs text-[var(--text-muted)] mb-1">영수증 첨부 (선택)</label>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--primary)] rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--primary)] cursor-pointer transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                </svg>
                파일 첨부
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.gif"
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    const added = files.map(f => ({ file: f, name: f.name }));
                    setReceiptFiles(prev => [...prev, ...added]);
                    const imageFile = files.find(f => /\.(jpg|jpeg|png|gif)$/i.test(f.name));
                    if (imageFile && !form.title && !form.amount) ocrReceipt(imageFile);
                    e.target.value = "";
                  }}
                />
              </label>
              {ocrProcessing && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-violet-500/10 text-violet-500 rounded-lg text-[10px]">
                  <span className="w-3 h-3 border-2 border-violet-300 border-t-violet-500 rounded-full animate-spin" />
                  AI 인식 중...
                </div>
              )}
              {receiptFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg text-[10px]">
                  <span className="max-w-[120px] truncate">{f.name}</span>
                  <button onClick={() => setReceiptFiles(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 opacity-70 hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => form.title.trim() && form.amount && addExpense.mutate()} disabled={!form.title.trim() || !form.amount || addExpense.isPending || uploading} className="btn-primary">{addExpense.isPending || uploading ? "처리 중..." : "청구"}</button>
        </div>
      )}

      <div className="expense-list-table glass-card">
        {expenses.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4"><Ico e="🧾" /></div><div className="text-sm text-[var(--text-muted)]">경비 청구 내역이 없습니다</div></div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
            <thead className="sticky-bar"><tr className="table-head-row">
              <th className="th-cell text-left">제목</th>
              <th className="th-cell text-left">청구자</th>
              <th className="th-cell text-left">분류</th>
              <th className="th-cell text-right">금액</th>
              <th className="th-cell text-center">상태</th>
              <th className="th-cell text-center">액션</th>
            </tr></thead>
            <tbody>
              {expenses.map((e: any) => {
                const st = EXPENSE_STATUS[e.status as keyof typeof EXPENSE_STATUS] || EXPENSE_STATUS.pending;
                const cat = EXPENSE_CATEGORIES.find(c => c.value === e.category);
                return (
                  <tr key={e.id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{e.title}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.users?.name || e.users?.email || "—"}</td>
                    <td className="px-5 py-3 text-xs">{cat?.label || e.category}</td>
                    <td className="px-5 py-3 text-sm text-right font-medium">₩{Number(e.amount).toLocaleString("ko-KR")}</td>
                    <td className="px-5 py-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span></td>
                    <td className="px-5 py-3 text-center">
                      {e.status === "pending" && !isEmployee && (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => approve.mutate(e.id)} className="text-[10px] px-2 py-1 rounded bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20">승인</button>
                          <button onClick={() => reject.mutate(e.id)} className="text-[10px] px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20">반려</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-[var(--bg-surface)]/60">
                <td colSpan={3} className="px-5 py-2 text-xs font-bold text-[var(--text-muted)]">합계</td>
                <td className="px-5 py-2 text-sm text-right font-bold">₩{expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0).toLocaleString("ko-KR")}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

// 근태 캘린더 리디자인(2026-07-15) — 직원 식별 색상. 구성원 디렉토리와 동일 팔레트로 통일.
function attAvatarColor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const palette = ["#6C5CE7", "#0984E3", "#00B894", "#E17055", "#00CEC9", "#A29BFE", "#FF7675", "#55A3FF"];
  return palette[Math.abs(h) % palette.length];
}
const attInitials = (name: string) => (/[가-힣]/.test(name || "") ? (name || "").slice(-2) : (name || "").slice(0, 2).toUpperCase());

// ── Attendance Tab ──
export function AttendanceTab({ employees, companyId, userId, userEmail, queryClient, role }: any) {
  const { toast } = useToast();
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  // 직원 역할은 '데이터'(표) 기본 — 본인 기록 옆 '수정 요청' 동선이 표에 있음. 관리자는 캘린더 조망 유지.
  const [viewMode, setViewMode] = useState<"calendar" | "table">(role === "employee" ? "table" : "calendar");
  const showDerivedAbsence = true; // 결근 자동표시(과거 평일 무기록) — 항상 on (2026-07-15 리디자인에서 토글 UI 제거)
  // 근태 캘린더 리디자인(2026-07-15) — 선택한 날짜(우측 패널에 그 날 직원별 출근 현황 표시).
  //   기본값은 오늘(선택 월이 이번 달일 때만) — 이미지 시안처럼 진입 시 바로 오늘 상세가 보임.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // 직원별 월간 요약 카드 클릭 시 상세(수당내역·근무내역) 모달.
  const [summaryDetailId, setSummaryDetailId] = useState<string | null>(null);
  // status 와 is_late 불일치 흡수: is_late=true 면 'late' 우선 (UI 일관성).
  //   edge attendance-checkin INSERT 시 status·is_late 계산 source 가 달라 어긋날 수 있음.
  //   근본 fix(edge 통합) 는 별건 — 본 헬퍼는 표시 단의 안전망.
  const effectiveStatus = (r: { is_late?: boolean | null; status?: string | null }): string =>
    r.is_late ? 'late' : (r.status || 'present');

  // Get month start/end for queries
  const monthStart = `${selectedMonth}-01`;
  const [ey, em] = selectedMonth.split('-').map(Number);
  const monthEnd = `${selectedMonth}-${String(new Date(ey, em, 0).getDate()).padStart(2, '0')}`;

  // Attendance records for the month
  const { data: records = [] } = useQuery({
    queryKey: ["attendance", companyId, selectedMonth],
    queryFn: () => getAttendanceRecords(companyId!, monthStart, monthEnd),
    enabled: !!companyId,
  });

  // 결근 파생용 — 해당 월 승인 휴가(기록 없는 평일을 결근으로 판정하되 휴가일은 제외).
  const { data: monthLeaves = [] } = useQuery({
    queryKey: ["attendance-cal-leaves", companyId, selectedMonth],
    queryFn: async () => {
      const data = logRead('employees/page:data', await (supabase).from("leave_requests")
        .select("employee_id, start_date, end_date, status")
        .eq("company_id", companyId).eq("status", "approved")
        .lte("start_date", monthEnd).gte("end_date", monthStart));
      return data || [];
    },
    enabled: !!companyId,
  });
  const leaveDaySet = useMemo(() => {
    const s = new Set<string>();
    for (const lv of monthLeaves as any[]) {
      if (!lv.start_date || !lv.end_date) continue;
      let d = new Date(String(lv.start_date).slice(0, 10) + "T00:00:00Z");
      const end = new Date(String(lv.end_date).slice(0, 10) + "T00:00:00Z");
      let guard = 0;
      while (d <= end && guard++ < 400) { s.add(`${lv.employee_id}:${d.toISOString().slice(0, 10)}`); d = new Date(d.getTime() + 86400000); }
    }
    return s;
  }, [monthLeaves]);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Monthly summary
  const { data: summary = [] } = useQuery({
    queryKey: ["attendance-summary", companyId, selectedMonth],
    queryFn: () => getMonthlyAttendanceSummary(companyId!, selectedMonth),
    enabled: !!companyId,
  });

  // 관리자 분기 — 직원별 월간 요약 표의 수당 컬럼 데이터 (allowance_entries × allowance_types).
  //   직원 분기 미조회 (enabled 가드). admin RLS 통과.
  const isAdminForAllowance = role === 'owner' || role === 'admin';
  const { data: monthlyAllowanceEntries = [] } = useQuery({
    queryKey: ["allowance-entries-monthly-summary", companyId, selectedMonth],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase;
      const data = logRead('employees/page:data', await db
        .from('allowance_entries')
        .select('employee_id, amount, allowance_types!inner(code, name, is_active)')
        .eq('company_id', companyId)
        .eq('payroll_month', selectedMonth)
        .filter('allowance_types.is_active', 'eq', true));
      return (data as Array<{ employee_id: string; amount: number; allowance_types: { code: string; name: string } | null }>) || [];
    },
    enabled: !!companyId && isAdminForAllowance,
  });

  // ⚠️ 비활성화 (2026-05-21 504 인시던트 3차) — 클라이언트 마운트마다 자동 호출이
  //   사용자 동시 진입·hot reload 시 폭증 → DB hung. 5/19·5/20 패턴 재발 차단.
  //   대안: 사용자가 화면의 "월 일괄 재계산" 버튼 수동 클릭 (MonthlyRecomputeButton).
  //   근본 해결: 별건 PR — pg_cron 1시간 1회 배치 + advisory lock 으로 동시 실행 1개 제한.
  // recomputeMonthlyAllowancesForCompany 자동 호출은 본 PR 에서 제거됨.

  // Admin attendance correction
  const isAdmin = role === "owner" || role === "admin";
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ check_in: "", check_out: "", status: "" });

  // 직원 본인 — 근태 수정 요청(관리자 승인 후 반영). 관리자는 위 인라인 '수정'으로 직접 보정.
  //   본인 직원 레코드 매칭: user_id 우선, 이메일 폴백(초대 수락 전 user_id 미연결 대비).
  const myEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of (employees as any[]) || []) {
      const byUser = userId && e.user_id === userId;
      const byEmail = userEmail && e.email && String(e.email).toLowerCase() === String(userEmail).toLowerCase();
      if (byUser || byEmail) ids.add(e.id);
    }
    return ids;
  }, [employees, userId, userEmail]);
  const [manualRecordOpen, setManualRecordOpen] = useState(false);
  const canRequestEdit = !isAdmin && myEmployeeIds.size > 0;
  // 관리(수정/수정 요청) 컬럼 노출 조건 — 관리자 전체, 직원은 본인 기록만.
  const showActionCol = isAdmin || canRequestEdit;
  const [editRequestRecord, setEditRequestRecord] = useState<any | null>(null);

  const doCorrectAttendance = useMutation({
    mutationFn: ({ recordId, updates }: { recordId: string; updates: { check_in?: string; check_out?: string; status?: string } }) =>
      correctAttendanceRecord(recordId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
      setEditingRecordId(null);
    },
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  const startEditing = (record: any) => {
    setEditingRecordId(record.id);
    // ⚠️ slice(0,16) 금지 — timestamptz 는 UTC 문자열이라 KST 18:30 이 09:30 으로 들어가고,
    //    그대로 저장하면 기록이 매번 9시간씩 밀렸다(2026-07-27 사장님 제보).
    setEditForm({
      check_in: kstDateTimeLocal(record.check_in),
      check_out: kstDateTimeLocal(record.check_out),
      status: record.status || "present",
    });
  };

  const submitCorrection = () => {
    if (!editingRecordId) return;
    const updates: { check_in?: string; check_out?: string; status?: string } = {};
    // 픽커 값은 KST 로 해석한다(브라우저 타임존 무관 — 읽기와 대칭).
    const ci = kstLocalToIso(editForm.check_in);
    const co = kstLocalToIso(editForm.check_out);
    if (ci) updates.check_in = ci;
    if (co) updates.check_out = co;
    if (editForm.status) updates.status = editForm.status;
    doCorrectAttendance.mutate({ recordId: editingRecordId, updates });
  };

  // Build calendar data
  const calendarData = useMemo(() => {
    const year = Number(selectedMonth.split("-")[0]);
    const month = Number(selectedMonth.split("-")[1]);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=Sun

    // Map: employeeId -> { date -> status }
    const empMap: Record<string, Record<string, string>> = {};
    records.forEach((r: any) => {
      if (!empMap[r.employee_id]) empMap[r.employee_id] = {};
      empMap[r.employee_id][r.date] = effectiveStatus(r);
    });

    return { year, month, daysInMonth, firstDayOfWeek, empMap };
  }, [selectedMonth, records]);


  const statusColor = (status: string) => {
    switch (status) {
      case "present": return "bg-[var(--success)]";
      case "late": return "bg-yellow-500";
      case "absent": return "bg-[var(--danger)]";
      case "half_day": return "bg-orange-400";
      case "remote": return "bg-[var(--info)]";
      default: return "bg-gray-400";
    }
  };

  const statusLabel = (status: string) => {
    return ATTENDANCE_STATUS.find((s) => s.value === status)?.label || status;
  };

  // active + joined 모두 포함 (초대 수락 후 아직 active 아닌 직원도 체크인 가능)
  const activeEmployees = employees.filter((e: any) => e.status === "active" || e.status === "joined");
  // employee 역할: 본인 직원 레코드 자동 선택 (user_id 매칭 → 이메일 폴백)
  const isEmployeeRole = role === "employee";

  // 관리자 분기 — 직원별 월간 수당 합산 (allowance_entries × allowance_types).
  //   key: employee_id → { overtime, night, holiday, on_duty, etc, total }
  //   allowance_types.code 기준 매칭 — 회사별 커스텀 코드는 'etc' 로 합산.
  const allowanceByEmployee = useMemo(() => {
    const m = new Map<string, { overtime: number; night: number; holiday: number; on_duty: number; etc: number; total: number }>();
    for (const row of monthlyAllowanceEntries) {
      const emp = row.employee_id;
      const amt = Number(row.amount || 0);
      if (!emp) continue;
      const code = (row.allowance_types?.code || '').toLowerCase();
      if (!m.has(emp)) m.set(emp, { overtime: 0, night: 0, holiday: 0, on_duty: 0, etc: 0, total: 0 });
      const e = m.get(emp)!;
      if (code === 'overtime') e.overtime += amt;
      else if (code === 'night') e.night += amt;
      else if (code === 'holiday') e.holiday += amt;
      else if (code === 'on_duty') e.on_duty += amt;
      else e.etc += amt;
      e.total += amt;
    }
    return m;
  }, [monthlyAllowanceEntries]);

  // 2026-05-22 오늘 출퇴근 현황 — KST 오늘 기준 출근/지각/휴가 집계 (records 의존 X, 별도 fetch).
  const kstToday = useMemo(() => todayKst(), []);
  const { data: todayStatus } = useQuery({
    queryKey: ["today-attendance-status", companyId, kstToday],
    queryFn: async () => {
      const [attRes, leaveRes] = await Promise.all([
        (supabase).from("attendance_records").select("employee_id, status, is_late").eq("company_id", companyId).eq("date", kstToday),
        (supabase).from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", kstToday).gte("end_date", kstToday),
      ]);
      const present = new Set<string>();
      const late = new Set<string>();
      for (const r of (attRes.data || []) as any[]) {
        if (r.is_late || r.status === "late") late.add(r.employee_id);
        else present.add(r.employee_id);
      }
      const leaveSet = new Set<string>(((leaveRes.data || []) as any[]).map((r) => r.employee_id));
      // 휴가자는 출근/지각 집계에서 제외(중복 방지)
      for (const id of leaveSet) { present.delete(id); late.delete(id); }
      return {
        present: present.size, late: late.size, leave: leaveSet.size,
        presentIds: [...present], lateIds: [...late], leaveIds: [...leaveSet],
      };
    },
    enabled: !!companyId && !isEmployeeRole,
    staleTime: 60_000,
  });
  // 오늘 통계 카드 클릭 → 명단 펼침 (2026-07-30 사장님: 숫자만으론 누구인지 모름)
  const [todayStatOpen, setTodayStatOpen] = useState<string | null>(null);
  const todayStatNames = useMemo(() => {
    const nameOf = (id: string) => (employees as any[]).find((e: any) => e.id === id)?.name || "구성원";
    const present = (todayStatus?.presentIds || []).map(nameOf);
    const late = (todayStatus?.lateIds || []).map(nameOf);
    const leave = (todayStatus?.leaveIds || []).map(nameOf);
    const counted = new Set([...(todayStatus?.presentIds || []), ...(todayStatus?.lateIds || []), ...(todayStatus?.leaveIds || [])]);
    const absent = activeEmployees.filter((e: any) => !counted.has(e.id)).map((e: any) => e.name || "구성원");
    return { present, late, absent, leave } as Record<string, string[]>;
  }, [todayStatus, employees, activeEmployees]);

  // 캘린더에서 선택한 날짜 — 없으면 조회 중인 달이 이번 달일 때만 오늘을 기본 선택(시안처럼 진입 시 바로 상세 노출).
  const effectiveSelectedDay = selectedDay || (
    selectedMonth === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}` ? todayStr : null
  );

  // 선택한 날짜의 직원별 출근 현황(상태별 그룹) — 캘린더 셀 클릭 시 우측 패널에 표시.
  const dayDetail = useMemo(() => {
    if (!effectiveSelectedDay) return null;
    const dow = new Date(`${effectiveSelectedDay}T00:00:00`).getDay();
    const isPast = effectiveSelectedDay < todayStr;
    const byStatus: Record<string, { id: string; name: string }[]> = {};
    activeEmployees.forEach((emp: any) => {
      const rec = records.find((r: any) => r.employee_id === emp.id && r.date === effectiveSelectedDay);
      let status = rec ? effectiveStatus(rec) : (calendarData.empMap[emp.id]?.[effectiveSelectedDay] || null);
      if (!status && isPast && dow !== 0 && dow !== 6 && showDerivedAbsence) {
        const onLeave = leaveDaySet.has(`${emp.id}:${effectiveSelectedDay}`);
        const employed = !emp.hire_date || effectiveSelectedDay >= String(emp.hire_date).slice(0, 10);
        if (!onLeave && employed) status = "absent";
      }
      if (status) {
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push({ id: emp.id, name: emp.name });
      }
    });
    return byStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSelectedDay, activeEmployees, records, calendarData, leaveDaySet, showDerivedAbsence, todayStr]);

  return (
    <div>
      {/* Controls: 타이틀 + 월 표시 + 캘린더/데이터 토글 + CSV Export (2026-07-15 리디자인 — 시안과 동일하게 단순화) */}
      <div className="attendance-toolbar">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-extrabold text-[var(--text)]">근태관리</h2>
          <MonthField
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-2 py-1 bg-transparent border-0 text-sm text-[var(--text-muted)] focus:outline-none"
          />
        </div>
        <div className="flex gap-2 items-center">
          <div className="seg-bar">
            <button
              onClick={() => setViewMode("calendar")}
              className={`seg-item ${viewMode === "calendar" ? "seg-item-active" : ""}`}
            >
              캘린더
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`seg-item ${viewMode === "table" ? "seg-item-active" : ""}`}
            >
              데이터
            </button>
          </div>
          {/* 관리자 대행 기록 — 직원이 출근 버튼을 못 눌렀을 때 대신 찍어준다(2026-07-27). */}
          {isAdmin && companyId && (
            <button
              type="button"
              onClick={() => setManualRecordOpen(true)}
              className="attendance-manual-add-btn"
            >
              + 출퇴근 기록
            </button>
          )}
          {/* L 근태 — C-3 관리자: 가산수당 재계산 (월 일괄) */}
          {isAdmin && companyId && (
            <MonthlyRecomputeButton companyId={companyId} from={monthStart} to={monthEnd} />
          )}
          {summary.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const header = ["직원", "출근일", "지각횟수", "지각합계(분)", "연장(분)", "야간(분)", "휴일(분)", "결근", "재택", "반차", "총근무(h)"];
                const rows = (summary as any[]).map((s) => [
                  s.name, String(s.totalDays), String(s.lateDays), String(Math.round(s.lateMinutesSum || 0)),
                  String(Math.round(s.overtimeMinutesSum || 0)), String(Math.round(s.nightMinutesSum || 0)), String(Math.round(s.holidayMinutesSum || 0)),
                  String(s.absentDays), String(s.remoteDays), String(s.halfDays), s.totalHours.toFixed(1),
                ]);
                const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `근태_월간요약_${selectedMonth}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)] rounded-xl text-xs font-semibold hover:bg-[var(--bg-surface)] transition"
            >
              CSV Export
            </button>
          )}
        </div>
      </div>

      {/* Calendar View — 2026-07-15 리디자인: 좌 월간 캘린더 + 우 오늘 통계·선택일 상세(관리자 전용) */}
      {viewMode === "calendar" && (
        <div className={`attendance-calendar-view ${!isEmployeeRole ? "lg:grid-cols-4" : ""}`}>
          <div className={`attendance-calendar glass-card ${!isEmployeeRole ? "lg:col-span-3" : ""}`}>
            {/* 헤더: 타이틀 + 범례 */}
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-[var(--border)]">
              <span className="text-sm font-bold text-[var(--text)]">월간 출근 현황</span>
              <div className="flex gap-2.5 flex-wrap items-center">
                {ATTENDANCE_STATUS.map((s) => (
                  <span key={s.value} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <span className={`w-2 h-2 rounded-full ${statusColor(s.value)}`} />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Calendar header: days of week */}
            <div className="grid grid-cols-7 border-b border-[var(--border)]">
              {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                <div key={d} className={`text-center text-xs font-medium py-2 ${i === 0 ? "text-[var(--danger)]" : i === 6 ? "text-[var(--info)]" : "text-[var(--text-dim)]"}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar body */}
            <div className="grid grid-cols-7">
              {/* Empty cells before first day */}
              {Array.from({ length: calendarData.firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[120px] border-b border-r border-[var(--border)]/30 bg-[var(--bg-surface)]/30" />
              ))}

              {/* Day cells */}
              {Array.from({ length: calendarData.daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                const isSelected = dateStr === effectiveSelectedDay;
                const dayOfWeek = (calendarData.firstDayOfWeek + i) % 7;
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                // Get all employee statuses for this day, aggregated into per-status counts
                //   (시안: 사람별 칩이 아니라 "●출근 7" 처럼 상태별 집계 pill — 개인 목록은 우측 선택일 패널에서).
                const isPastWeekday = dateStr < todayStr && !isWeekend;
                const dayStatusCounts = new Map<string, number>();
                activeEmployees.forEach((emp: any) => {
                  const rec = records.find((r: any) => r.employee_id === emp.id && r.date === dateStr);
                  let status = rec ? effectiveStatus(rec) : (calendarData.empMap[emp.id]?.[dateStr] || null);
                  // 결근 파생: 기록 없는 과거 평일 + 휴가 아님 + 입사일 이후 → 결근 (토글 ON일 때만)
                  if (!status && isPastWeekday && showDerivedAbsence) {
                    const onLeave = leaveDaySet.has(`${emp.id}:${dateStr}`);
                    const employed = !emp.hire_date || dateStr >= String(emp.hire_date).slice(0, 10);
                    if (!onLeave && employed) status = "absent";
                  }
                  if (status) dayStatusCounts.set(status, (dayStatusCounts.get(status) || 0) + 1);
                });

                return (
                  <button
                    type="button"
                    key={day}
                    onClick={() => setSelectedDay((cur) => (cur === dateStr ? null : dateStr))}
                    className={`min-h-[120px] border-b border-r border-[var(--border)]/30 p-2.5 text-left transition ${
                      isSelected ? "ring-2 ring-inset ring-[var(--primary)] bg-[var(--primary)]/8" : isToday ? "bg-[var(--primary)]/5" : isWeekend ? "bg-[var(--bg-surface)]/30" : "hover:bg-[var(--bg-surface)]/50"
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1.5 flex items-center gap-1 ${
                      isToday ? "text-[var(--primary)] font-bold" : dayOfWeek === 0 ? "text-[var(--danger)]" : dayOfWeek === 6 ? "text-[var(--info)]" : "text-[var(--text-muted)]"
                    }`}>
                      {isSelected ? <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-white text-[11px] flex items-center justify-center font-bold">{day}</span> : day}
                    </div>
                    <div className="flex flex-col gap-1 items-start">
                      {ATTENDANCE_STATUS.filter((s) => dayStatusCounts.get(s.value)).map((s) => (
                        <span key={s.value} className="inline-flex items-center gap-1 text-[11px] leading-none">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(s.value)}`} />
                          <span className="text-[var(--text)] font-medium">{s.label} {dayStatusCounts.get(s.value)}</span>
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 우 — 오늘 통계 2x2 + 선택일 상세 (관리자 전용). 캘린더와 높이 맞춤(flex-1로 하단까지 채움). */}
          {!isEmployeeRole && (
            <div className="attendance-today-panel">
              {/* 카드 클릭 → 하단에 해당 인원 명단 (2026-07-30 사장님) */}
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: "present", label: "오늘 출근", count: todayStatus?.present ?? 0, cls: "text-[var(--text)]" },
                  { key: "late", label: "지각", count: todayStatus?.late ?? 0, cls: "text-yellow-500" },
                  { key: "absent", label: "결근", count: Math.max(0, activeEmployees.length - (todayStatus?.present ?? 0) - (todayStatus?.late ?? 0) - (todayStatus?.leave ?? 0)), cls: "text-[var(--danger)]" },
                  { key: "leave", label: "자리비움", count: todayStatus?.leave ?? 0, cls: "text-[var(--info)]" },
                ] as const).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setTodayStatOpen((cur) => (cur === c.key ? null : c.key))}
                    className={`glass-card p-5 text-left transition ${todayStatOpen === c.key ? "ring-2 ring-inset ring-[var(--primary)]" : "hover:bg-[var(--bg-surface)]/60"}`}
                    title="클릭하면 해당 인원 명단이 아래에 표시됩니다"
                  >
                    <div className="text-xs text-[var(--text-dim)] mb-1.5">{c.label}</div>
                    <div className={`text-3xl font-extrabold ${c.cls}`}>{c.count}<span className="text-sm font-semibold text-[var(--text-dim)]"> 명</span></div>
                  </button>
                ))}
              </div>
              {todayStatOpen && (
                <div className="glass-card p-4">
                  <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                    오늘 {{ present: "출근", late: "지각", absent: "결근", leave: "자리비움" }[todayStatOpen]} — {todayStatNames[todayStatOpen]?.length ?? 0}명
                  </div>
                  {(todayStatNames[todayStatOpen] || []).length === 0 ? (
                    <div className="text-xs text-[var(--text-dim)]">해당 인원이 없습니다</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {todayStatNames[todayStatOpen].map((name, i) => (
                        <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]">{name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {effectiveSelectedDay && (() => {
                const [, , dStr] = effectiveSelectedDay.split("-");
                const dNum = Number(dStr);
                const weekday = new Date(`${effectiveSelectedDay}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "long" });
                const groups = ATTENDANCE_STATUS.filter((s) => dayDetail?.[s.value]?.length);
                return (
                  <div className="glass-card p-5 flex-1 flex flex-col min-h-0">
                    <div className="text-sm font-bold text-[var(--text)]">{dNum}일 {weekday}</div>
                    <div className="text-[11px] text-[var(--text-dim)] mb-3">캘린더의 날짜를 클릭하면 그 날 현황을 볼 수 있습니다</div>
                    {groups.length === 0 ? (
                      <div className="text-xs text-[var(--text-dim)]">해당 날짜 기록이 없습니다</div>
                    ) : (
                      <div className="space-y-4 overflow-y-auto">
                        {groups.map((s) => (
                          <div key={s.value}>
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] mb-1.5">
                              <span className={`w-2 h-2 rounded-full ${statusColor(s.value)}`} />
                              {s.label} <span className="text-[var(--text-dim)] font-normal">{dayDetail![s.value].length}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {dayDetail![s.value].map((emp) => (
                                <span key={emp.id} className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]">
                                  <span
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                                    style={{ background: attAvatarColor(emp.id) }}
                                  >
                                    {attInitials(emp.name)}
                                  </span>
                                  {emp.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="attendance-records-table glass-card">
          {records.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4"><Ico e="📊" /></div>
              <div className="text-sm text-[var(--text-muted)]">해당 월에 근태 기록이 없습니다</div>
            </div>
          ) : (
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead className="sticky-bar">
                <tr className="table-head-row">
                  <th className="th-cell text-left">직원</th>
                  <th className="th-cell text-left">날짜</th>
                  <th className="th-cell text-left">출근</th>
                  <th className="th-cell text-left">퇴근</th>
                  <th className="th-cell text-right">근무시간</th>
                  <th className="th-cell text-right">연장</th>
                  <th className="th-cell text-center">상태</th>
                  {showActionCol && <th className="th-cell text-center">관리</th>}
                </tr>
              </thead>
              <tbody>
                {records.map((r: any) => (
                  editingRecordId === r.id ? (
                    <tr key={r.id} className="border-b border-[var(--border)]/50 bg-[var(--primary)]/5">
                      <td className="px-5 py-2 text-sm font-medium">{r.employees?.name || "—"}</td>
                      <td className="px-5 py-2 text-sm text-[var(--text-muted)]">{r.date}</td>
                      <td className="px-3 py-2">
                        <DateTimeField
                          value={editForm.check_in}
                          onChange={(e) => setEditForm({ ...editForm, check_in: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <DateTimeField
                          value={editForm.check_out}
                          onChange={(e) => setEditForm({ ...editForm, check_out: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-5 py-2 text-sm text-right text-[var(--text-dim)]">자동계산</td>
                      <td className="px-5 py-2 text-sm text-right text-[var(--text-dim)]">자동계산</td>
                      <td className="px-3 py-2">
                        <select
                          value={editForm.status}
                          onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        >
                          {ATTENDANCE_STATUS.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={submitCorrection}
                            disabled={doCorrectAttendance.isPending}
                            className="px-2 py-1 text-xs bg-[var(--success)] hover:brightness-110 text-white rounded-lg transition disabled:opacity-50"
                          >
                            {doCorrectAttendance.isPending ? "..." : "저장"}
                          </button>
                          <button
                            onClick={() => setEditingRecordId(null)}
                            className="px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-card)] transition"
                          >
                            취소
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                  <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-5 py-3 text-sm font-medium">{r.employees?.name || "—"}</td>
                    <td className="px-5 py-3 text-sm text-[var(--text-muted)]">{r.date}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.check_in ? new Date(r.check_in).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.check_out ? new Date(r.check_out).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-right">{r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : "—"}</td>
                    <td className="px-5 py-3 text-sm text-right text-orange-400">
                      {(() => {
                        // L 근태 — overtime_minutes 우선, 없으면 overtime_hours fallback
                        const om = Number(r.overtime_minutes || 0);
                        if (om > 0) {
                          const h = Math.floor(om / 60);
                          const m = om % 60;
                          return `+${h}h${m > 0 ? ` ${m}m` : ''}`;
                        }
                        const oh = Number(r.overtime_hours || 0);
                        return oh > 0 ? `+${oh.toFixed(1)}h` : "—";
                      })()}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {/* 기본 상태 배지 */}
                        {(() => {
                          const es = effectiveStatus(r);
                          return (
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                              es === "present" ? "bg-[var(--success)]/10 text-[var(--success)]"
                              : es === "late" ? "bg-yellow-500/10 text-yellow-400"
                              : es === "absent" ? "bg-[var(--danger)]/10 text-[var(--danger)]"
                              : es === "half_day" ? "bg-orange-500/10 text-orange-400"
                              : es === "remote" ? "bg-[var(--info)]/10 text-[var(--info)]"
                              : "bg-gray-500/10 text-gray-400"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusColor(es)}`} />
                              {statusLabel(es)}
                            </span>
                          );
                        })()}
                        {/* 갭①-B: 인라인 배지 매핑 → AttendanceBadges 컴포넌트로 통합.
                            관리자·직원 본인 뷰가 동일 출력 (MyAttendanceCard 도 같은 컴포넌트 사용). */}
                        <AttendanceBadges record={r} compact />
                      </div>
                    </td>
                    {showActionCol && (
                      <td className="px-5 py-3 text-center">
                        {isAdmin ? (
                          <button
                            onClick={() => startEditing(r)}
                            className="px-2.5 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition"
                          >
                            수정
                          </button>
                        ) : myEmployeeIds.has(r.employee_id) ? (
                          <button
                            onClick={() => setEditRequestRecord(r)}
                            className="px-2.5 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition"
                          >
                            수정 요청
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                  )
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* Monthly Summary per Employee */}
      {summary.length > 0 && (() => {
        const fmtKRW = (n: number): string => {
          const v = Math.round(Number(n) || 0);
          return v > 0 ? `${v.toLocaleString('ko-KR')}원` : "—";
        };
        // 진행바용 — 선택 월의 평일 수(이번 달이면 오늘까지) 대비 출근일 비율. 가짜 목표치 아닌 실제 평일수 기반.
        const [wy, wm] = selectedMonth.split('-').map(Number);
        const lastDayOfMonth = new Date(wy, wm, 0).getDate();
        const isCurrentSelectedMonth = selectedMonth === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const upToDay = isCurrentSelectedMonth ? today.getDate() : lastDayOfMonth;
        let workdaysSoFar = 0;
        for (let d = 1; d <= upToDay; d++) {
          const dow = new Date(wy, wm - 1, d).getDay();
          if (dow !== 0 && dow !== 6) workdaysSoFar++;
        }
        return (
          <div className="attendance-monthly-summary">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--text-muted)]">직원별 월간 요약</h3>
              <span className="text-[11px] text-[var(--text-dim)]">카드를 클릭하면 상세 내역을 볼 수 있습니다</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {summary.map((s: any) => {
                const alw = allowanceByEmployee.get(s.employee_id);
                const alwTitle = alw
                  ? `연장 ${alw.overtime.toLocaleString('ko-KR')}원 · 야간 ${alw.night.toLocaleString('ko-KR')}원 · 휴일 ${alw.holiday.toLocaleString('ko-KR')}원 · 당직 ${alw.on_duty.toLocaleString('ko-KR')}원 · 기타 ${alw.etc.toLocaleString('ko-KR')}원`
                  : '수당 기록 없음';
                const ratio = workdaysSoFar > 0 ? Math.min(1, s.totalDays / workdaysSoFar) : 0;
                return (
                  <button
                    type="button"
                    key={s.employee_id}
                    onClick={() => setSummaryDetailId(s.employee_id)}
                    className="glass-card p-4 text-left hover:-translate-y-0.5 hover:shadow-lg transition"
                  >
                    <div className="flex items-center gap-2.5 mb-3">
                      <span
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ background: attAvatarColor(s.employee_id) }}
                      >
                        {attInitials(s.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[var(--text)] truncate">{s.name}</div>
                        <div className="text-[11px] text-[var(--text-dim)] truncate">
                          {s.totalDays}일 근무{s.lateDays > 0 ? ` · 지각 ${s.lateDays}회` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden mb-3">
                      <div className="h-full rounded-full bg-[var(--primary)] transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] text-[var(--text-dim)]">총 근무</div>
                        <div className="text-base font-extrabold mono-number text-[var(--text)]">{s.totalHours.toFixed(1)}h</div>
                      </div>
                      {isAdminForAllowance && (
                        <div className="text-right min-w-0" title={alwTitle}>
                          <div className="text-[10px] text-[var(--text-dim)]">수당</div>
                          <div className="text-sm font-bold mono-number text-[var(--success)] truncate">{fmtKRW(alw?.total ?? 0)}</div>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 직원별 월간 요약 카드 클릭 상세 — 수당내역 + 근무내역 */}
      {summaryDetailId && (() => {
        const s = (summary as any[]).find((x) => x.employee_id === summaryDetailId);
        if (!s) return null;
        const alw = allowanceByEmployee.get(summaryDetailId);
        const allowanceLines = (monthlyAllowanceEntries as any[]).filter((r) => r.employee_id === summaryDetailId);
        const empRecords = (records as any[]).filter((r) => r.employee_id === summaryDetailId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return (
          <div className="attendance-summary-detail-modal fixed inset-0" onClick={() => setSummaryDetailId(null)}>
            <div className="glass-card p-6 w-full max-w-lg shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: attAvatarColor(summaryDetailId) }}>
                    {attInitials(s.name)}
                  </span>
                  <div>
                    <div className="text-sm font-bold text-[var(--text)]">{s.name}</div>
                    <div className="text-[11px] text-[var(--text-dim)]">{selectedMonth} · {s.totalDays}일 근무 · 총 {s.totalHours.toFixed(1)}h</div>
                  </div>
                </div>
                <button onClick={() => setSummaryDetailId(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-xl leading-none px-1">✕</button>
              </div>

              {isAdminForAllowance && (
                <div className="mb-5">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2">수당 내역</div>
                  {allowanceLines.length === 0 ? (
                    <div className="text-xs text-[var(--text-dim)] px-1">이번 달 수당 기록이 없습니다</div>
                  ) : (
                    <div className="space-y-1.5">
                      {allowanceLines.map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                          <span className="text-[var(--text-muted)]">{r.allowance_types?.name || r.allowance_types?.code || "기타"}</span>
                          <span className="font-semibold mono-number text-[var(--success)]">₩{Number(r.amount || 0).toLocaleString('ko-KR')}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--success)]/10 text-xs font-bold">
                        <span className="text-[var(--text)]">합계</span>
                        <span className="mono-number text-[var(--success)]">₩{(alw?.total ?? 0).toLocaleString('ko-KR')}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="text-xs font-bold text-[var(--text-muted)] mb-2">근무 내역</div>
                {empRecords.length === 0 ? (
                  <div className="text-xs text-[var(--text-dim)] px-1">이번 달 근태 기록이 없습니다</div>
                ) : (
                  <div className="space-y-1">
                    {empRecords.map((r: any) => {
                      const es = effectiveStatus(r);
                      return (
                        <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                          <span className="text-[var(--text-muted)] mono-number">{r.date}</span>
                          <span className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${statusColor(es)}`} />
                            <span className="text-[var(--text)]">{statusLabel(es)}</span>
                          </span>
                          <span className="text-[var(--text-dim)] mono-number">
                            {r.check_in ? new Date(r.check_in).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                            {" ~ "}
                            {r.check_out ? new Date(r.check_out).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </span>
                          <span className="font-semibold mono-number text-[var(--text)]">{r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 직원 본인 — 근태 수정 요청 모달 (관리자 승인 후 attendance_records 반영) */}
      {editRequestRecord && companyId && userId && (
        <AttendanceEditRequestDialog
          open
          onClose={() => setEditRequestRecord(null)}
          companyId={companyId}
          attendanceRecordId={editRequestRecord.id}
          userId={userId}
          initial={{
            check_in: editRequestRecord.check_in || undefined,
            check_out: editRequestRecord.check_out || undefined,
            status: effectiveStatus(editRequestRecord),
          }}
        />
      )}

      {/* 관리자 대행 — 직원이 못 누른 출퇴근을 대신 기록 */}
      {isAdmin && companyId && (
        <ManualAttendanceDialog
          open={manualRecordOpen}
          onClose={() => setManualRecordOpen(false)}
          companyId={companyId}
          userId={userId}
          employees={employees as any[]}
          defaultDate={effectiveSelectedDay || todayKst()}
        />
      )}
    </div>
  );
}

// ── Missing Check-Out Modal (관리자 전용 일괄 보정) ──
//   - 이번 달 check_out=null 행을 모아 입력
//   - 각 행: 직원·날짜·check_in (읽기) + check_out time picker + 저장 버튼
//   - 저장: correctAttendanceRecord (UPDATE check_out) + recomputeAttendance (분 컬럼 산정)
//   - RLS: UPDATE 정책이 admin OR 본인 (dce3488b 후) — 관리자 통과 보장
function MissingCheckOutModal({
  companyId,
  records,
  employees,
  selectedMonth,
  onClose,
  onSaved,
}: {
  companyId: string;
  records: any[];
  employees: any[];
  selectedMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const empNameMap = useMemo(() => new Map(employees.map((e: any) => [e.id, e.name])), [employees]);
  // 행별 입력 시간 (HH:MM). 기본값 "18:30" (보편적 퇴근시각).
  const missingRows = useMemo(
    () => {
      // 오늘(KST) 제외 — 지난 날짜의 퇴근 미입력만 보정 대상 (오늘은 아직 퇴근 전 정상)
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      return (records || []).filter((r: any) => !r.check_out && (r.date || "") < today).sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
    },
    [records],
  );
  const [times, setTimes] = useState<Record<string, string>>(() =>
    Object.fromEntries(missingRows.map((r: any) => [r.id, "18:30"])),
  );
  const [saving, setSaving] = useState<Set<string>>(new Set());

  const saveOne = async (row: any) => {
    const t = times[row.id] || "18:30";
    if (!/^\d{2}:\d{2}$/.test(t)) {
      toast("시간 형식이 잘못되었습니다 (HH:MM).", "error");
      return;
    }
    setSaving((s) => new Set(s).add(row.id));
    try {
      // KST 기준 ISO 생성: YYYY-MM-DDTHH:MM:00+09:00
      const iso = `${row.date}T${t}:00+09:00`;
      await correctAttendanceRecord(row.id, { check_out: iso });
      // 분 컬럼 산정 (regular/overtime/night/holiday)
      await recomputeAttendance({
        companyId,
        employeeId: row.employee_id,
        from: row.date,
        to: row.date,
      });
      toast(`${empNameMap.get(row.employee_id) || "직원"} ${row.date} 퇴근 입력 완료`, "success");
      onSaved();
    } catch (e) {
      toast(friendlyError(e, "퇴근 입력에 실패했습니다."), "error");
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
    }
  };

  const saveAll = async () => {
    for (const row of missingRows) {
      await saveOne(row);
    }
  };

  // ESC 닫기 · Enter 확인(일괄 저장, 대상 없거나 저장 중이면 비활성)
  useModalKeys(true, onClose, missingRows.length === 0 || saving.size > 0 ? undefined : saveAll);

  return (
    <div className="attendance-checkout-modal fixed inset-0">
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-sm font-bold"><Ico e="📝" /> 퇴근 미입력 일괄 보정</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {selectedMonth} 누락 {missingRows.length}건 — 저장 시 자동으로 연장·야간·휴일 분이 산정됩니다.
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        <div className="overflow-auto flex-1">
          {missingRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--text-muted)]">미입력 행이 없습니다 ✅</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-surface)]/50 sticky top-0">
                <tr className="text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2 font-medium">직원</th>
                  <th className="text-left px-4 py-2 font-medium">날짜</th>
                  <th className="text-left px-4 py-2 font-medium">출근(KST)</th>
                  <th className="text-left px-4 py-2 font-medium">퇴근 시각</th>
                  <th className="text-center px-4 py-2 font-medium">저장</th>
                </tr>
              </thead>
              <tbody>
                {missingRows.map((row: any) => {
                  const ciStr = row.check_in
                    ? new Date(row.check_in).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })
                    : "—";
                  return (
                    <tr key={row.id} className="border-b border-[var(--border)]/50">
                      <td className="px-4 py-2 font-medium">{empNameMap.get(row.employee_id) || "—"}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)]">{row.date}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)] tabular-nums">{ciStr}</td>
                      <td className="px-4 py-2">
                        <input
                          type="time"
                          value={times[row.id] || "18:30"}
                          onChange={(e) => setTimes((t) => ({ ...t, [row.id]: e.target.value }))}
                          className="px-2 py-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-md text-xs focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          disabled={saving.has(row.id)}
                          onClick={() => saveOne(row)}
                          className="px-3 py-1 text-xs font-semibold bg-[var(--primary)]/20 text-[var(--primary)] hover:bg-[var(--primary)]/30 disabled:opacity-40 rounded-md transition"
                        >
                          {saving.has(row.id) ? "..." : "저장"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">기본 18:30, 직원별 변경 가능</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg transition"
            >
              닫기
            </button>
            {missingRows.length > 0 && (
              <button
                type="button"
                disabled={saving.size > 0}
                onClick={saveAll}
                className="px-4 py-1.5 text-xs font-semibold bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 disabled:opacity-40 rounded-lg transition"
              >
                {saving.size > 0 ? "저장 중..." : `일괄 저장 (${missingRows.length}건)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quick Attendance Buttons (sub-component) ──
function QuickAttendanceButtons({ employees, records, onCheckIn, onCheckOut }: any) {
  const [selectedEmp, setSelectedEmp] = useState("");
  const todayStr = todayKst();

  // Check if employee already checked in today
  const todayRecord = selectedEmp
    ? records.find((r: any) => r.employee_id === selectedEmp && r.date === todayStr)
    : null;
  const hasCheckedIn = !!todayRecord;
  const hasCheckedOut = !!todayRecord?.check_out;

  return (
    <div className="attendance-quick-buttons">
      <select
        value={selectedEmp}
        onChange={(e) => setSelectedEmp(e.target.value)}
        className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm"
      >
        <option value="">직원 선택...</option>
        {employees.map((e: any) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <button
        disabled={!selectedEmp || hasCheckedIn}
        onClick={() => selectedEmp && onCheckIn(selectedEmp)}
        className="px-4 py-2 bg-[var(--success)] hover:brightness-110 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
      >
        출근
      </button>
      <button
        disabled={!selectedEmp || !hasCheckedIn || hasCheckedOut}
        onClick={() => selectedEmp && onCheckOut(selectedEmp)}
        className="px-4 py-2 bg-[var(--warning)] hover:brightness-110 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
      >
        퇴근
      </button>
    </div>
  );
}

// ── Payroll Preview Tab ──
function PayrollPreviewTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<{ items: PayrollItem[]; totalGross: number; totalDeductions: number; totalNet: number; skippedNoBirth?: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  // 편집 모드 — 직원별 기본급(과세) / 비과세 직접 수정 + v4 H1 임의 수당/공제
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, { baseSalary: number; nonTaxable: number; extras: { type: 'allowance' | 'deduction'; name: string; amount: number }[]; deductions?: Record<string, number> }>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  // 조회 월 — month picker (YYYY-MM) + 표시용 라벨 변환
  const [periodMonth, setPeriodMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const periodLabel = (() => {
    const [y, m] = periodMonth.split('-');
    return `${y}년 ${parseInt(m, 10)}월`;
  })();

  const { data: companyMeta } = useQuery({
    queryKey: ["company-meta-payroll", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase.from("companies").select("name, representative, business_number, address, seal_url").eq("id", companyId!).maybeSingle());
      return data as { name: string; representative: string | null; business_number: string | null; address: string | null; seal_url: string | null } | null;
    },
    enabled: !!companyId,
  });

  const { data: empMap = {} } = useQuery({
    queryKey: ["payroll-emp-meta", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await supabase.from("employees").select("id, department, position, birth_date").eq("company_id", companyId!));
      const m: Record<string, { department: string | null; position: string | null; birthDate: string | null }> = {};
      (data || []).forEach((e: any) => { m[e.id] = { department: e.department, position: e.position, birthDate: e.birth_date }; });
      return m;
    },
    enabled: !!companyId,
  });

  // L 수당 — 법정 시스템 코드 → 한국어 고정 라벨
  const legalLabelFor = (code: string): string | null => {
    switch (code) {
      case "overtime": return "연장수당";
      case "night": return "야간수당";
      case "holiday": return "휴일수당";
      case "holiday_over_8h": return "휴일수당(8h초과)";
      case "on_duty": return "당직비";
      default: return null;
    }
  };

  // 2026-05-22 급여대장 작성(편집모드)에서 해당 월 산정된 수당(allowance_entries)을 불러와
  //   각 직원의 임의수당(extras allowance)으로 채운다. 근태 재계산(recompute)은 하지 않고
  //   이미 산정된 값만 조회 (무거운 RPC 자동호출 금지 — 504 패턴 회피).
  const [loadingAllowances, setLoadingAllowances] = useState(false);
  const loadAllowances = async () => {
    if (!companyId || !preview) return;
    setLoadingAllowances(true);
    try {
      const data = logRead('employees/page:data', await (supabase)
        .from("allowance_entries")
        .select("employee_id, amount, allowance_types!inner(name, code, display_order, is_active)")
        .eq("company_id", companyId)
        .eq("payroll_month", periodMonth));
      // 직원별 수당 그룹 (활성 + 금액>0, display_order 정렬)
      const byEmp = new Map<string, { name: string; amount: number; order: number }[]>();
      for (const r of (data || []) as any[]) {
        const t = r.allowance_types;
        if (!t?.is_active || Number(r.amount || 0) <= 0) continue;
        const label = legalLabelFor(t.code) || t.name;
        const arr = byEmp.get(r.employee_id) || [];
        arr.push({ name: label, amount: Math.round(Number(r.amount)), order: Number(t.display_order || 100) });
        byEmp.set(r.employee_id, arr);
      }
      let filled = 0;
      setEditValues((prev) => {
        const next = { ...prev };
        for (const it of preview.items) {
          const allowances = (byEmp.get(it.employeeId) || []).sort((a, b) => a.order - b.order);
          if (allowances.length === 0) continue;
          const cur = next[it.employeeId] || { baseSalary: it.baseSalary, nonTaxable: it.nonTaxableAmount, extras: [] };
          // 기존 공제는 유지 + 불러온 수당과 이름이 겹치지 않는 기존 수당 유지 → 불러온 수당 추가(중복 방지)
          const kept = (cur.extras || []).filter(
            (e) => e.type === "deduction" || !allowances.some((a) => a.name === e.name),
          );
          next[it.employeeId] = {
            ...cur,
            extras: [...kept, ...allowances.map((a) => ({ type: "allowance" as const, name: a.name, amount: a.amount }))],
          };
          filled++;
        }
        return next;
      });
      if (filled > 0) toast(`${filled}명 수당 불러오기 완료 (저장하려면 '편집 저장')`, "success");
      else toast(`${periodLabel} 산정된 수당이 없습니다. 근태 화면에서 수당을 먼저 산정하세요.`, "info");
    } catch (err: any) {
      toast("수당 불러오기 실패: " + (err.message || ""), "error");
    }
    setLoadingAllowances(false);
  };

  const downloadOne = async (item: PayrollItem) => {
    try {
      const { downloadPayslipPDF } = await import("@/lib/payslip-pdf");
      const meta = (empMap as Record<string, { department: string | null; position: string | null; birthDate: string | null }>)[item.employeeId] || {} as any;
      // 사원코드 — employee.id 의 끝 4자리(UUID 접미)를 사용
      const employeeCode = item.employeeId ? item.employeeId.slice(-4).toUpperCase() : undefined;
      // 2026-05-22 PDF = 화면 단일 진실. 임의 수당/공제는 PDF 가 item.extras 에서 직접 읽고
      //   합계는 item.netPay 를 그대로 신뢰 — 여기서 별도 변환·전달 불필요.
      await downloadPayslipPDF({
        item,
        companyName: companyMeta?.name || "회사",
        representative: companyMeta?.representative || undefined,
        businessNumber: companyMeta?.business_number || undefined,
        companyAddress: companyMeta?.address || undefined,
        sealUrl: companyMeta?.seal_url || undefined,
        periodLabel,
        department: meta.department || undefined,
        position: meta.position || undefined,
        employeeCode,
        birthDate: meta.birthDate || undefined,
      });
      toast(`${item.employeeName} 명세서 PDF 생성 완료`, "success");
    } catch (err: any) {
      toast("PDF 생성 실패: " + (err.message || ""), "error");
    }
  };

  const downloadAll = async () => {
    if (!preview) return;
    for (const item of preview.items) {
      await downloadOne(item);
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  // 'YYYY-MM' → 직전 달 'YYYY-MM'
  const prevMonthKey = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // m-1 이 당월, m-2 가 전월
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const generate = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // 1) 당월 override 존재 여부 확인 — 없고 전월엔 있으면 복사 제안
      const curOv = logRead('employees/page:curOv', await (supabase)
        .from('payslip_overrides')
        .select('employee_id')
        .eq('company_id', companyId)
        .eq('period_month', periodMonth));
      if (!curOv || curOv.length === 0) {
        const prevKey = prevMonthKey(periodMonth);
        const prevOv = logRead('employees/page:prevOv', await (supabase)
          .from('payslip_overrides')
          .select('employee_id, base_salary, non_taxable_amount')
          .eq('company_id', companyId)
          .eq('period_month', prevKey));
        if (prevOv && prevOv.length > 0) {
          const [py, pm] = prevKey.split('-');
          const ok = await appConfirm(
            `${py}년 ${parseInt(pm, 10)}월 명세서 수정값(${prevOv.length}명)이 있습니다.\n${periodLabel} 명세서에 그대로 복사하시겠습니까?`,
          );
          if (ok) {
            const rows = prevOv.map((o: any) => ({
              company_id: companyId,
              employee_id: o.employee_id,
              period_month: periodMonth,
              base_salary: Number(o.base_salary),
              non_taxable_amount: Number(o.non_taxable_amount),
              updated_at: new Date().toISOString(),
            }));
            const { error: copyErr } = await (supabase)
              .from('payslip_overrides')
              .upsert(rows, { onConflict: 'employee_id,period_month' });
            if (copyErr) {
              toast('전월 복사 실패: ' + (copyErr.message || ''), 'error');
            } else {
              toast(`${py}년 ${parseInt(pm, 10)}월 → ${periodLabel} 복사 완료`, 'success');
            }
          }
        }
      }

      // 2) (복사 반영된) 미리보기 계산
      const result = await previewPayroll(companyId, periodMonth);
      setPreview(result);
      // 편집값 초기화 — 현재 미리보기 값으로 (v4 H1: extras 포함)
      const init: Record<string, { baseSalary: number; nonTaxable: number; extras: { type: 'allowance' | 'deduction'; name: string; amount: number }[]; deductions?: Record<string, number> }> = {};
      result.items.forEach(it => {
        init[it.employeeId] = { baseSalary: it.baseSalary, nonTaxable: it.nonTaxableAmount, extras: it.extras ? [...it.extras] : [], deductions: {} };
      });
      setEditValues(init);
      // 입사일 필터 안내
      if (result.items.length === 0) {
        toast(`${periodLabel} 기준 재직 직원이 없습니다 (입사일 이전 또는 미등록).`, 'info');
      }
      // 생년월일 누락 안내
      if (result.skippedNoBirth && result.skippedNoBirth.length > 0) {
        toast(`⚠ 생년월일 미등록 ${result.skippedNoBirth.length}명: ${result.skippedNoBirth.join(', ')}. 명세서 PDF 비밀번호 보호 안 됨.`, 'error');
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  // 편집 모드에서 저장 — 해당 월(periodMonth) payslip_overrides 에만 저장.
  // employees.salary(연봉) 는 건드리지 않음 → 인력관리 연봉 유지 + 월별 독립.
  const saveEdits = async () => {
    if (!companyId || !preview) return;
    setSavingEdit(true);
    try {
      const rows = Object.entries(editValues).map(([id, v]) => ({
        company_id: companyId,
        employee_id: id,
        period_month: periodMonth, // 'YYYY-MM' — 이 달 명세서에만 적용
        base_salary: v.baseSalary,
        non_taxable_amount: v.nonTaxable,
        // v4 H1: 임의 수당/공제 — 빈 amount/name 행은 저장 안 함
        extras: v.extras.filter((e) => e.name.trim() && Number(e.amount) > 0),
        // 공제액 수동 수정 — 편집한 항목만 sparse 저장(없으면 null = 전부 자동계산)
        deduction_overrides: (v.deductions && Object.keys(v.deductions).length > 0) ? v.deductions : null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await (supabase)
        .from('payslip_overrides')
        .upsert(rows, { onConflict: 'employee_id,period_month' });
      if (error) throw error;
      toast(`${rows.length}명 ${periodLabel} 급여명세서 저장 완료 (연봉은 유지됨)`, 'success');
      setEditMode(false);
      await generate();
    } catch (err: any) {
      toast('저장 실패: ' + (err.message || err.code || ''), 'error');
      console.error('[saveEdits] error:', err);
    }
    setSavingEdit(false);
  };

  const handleSendPayslips = async (employeeIds?: string[]) => {
    if (!companyId || !preview) return;
    setSending(true);
    try {
      const { sendPayslipEmails } = await import("@/lib/payment-batch");
      const label = periodLabel || `${todayKst().slice(0, 7)} 급여`;
      const result = await sendPayslipEmails("preview", companyId, label, { employeeIds });
      const target = employeeIds && employeeIds.length === 1 ? '개인' : `${result.sent + result.failed}명`;
      toast(`급여명세서 ${target} 발송: ${result.sent}건 성공, ${result.failed}건 실패`, result.failed > 0 ? "error" : "success");
      if (result.errors && result.errors.length > 0) {
        console.warn('payslip send errors:', result.errors);
      }
    } catch (err: any) {
      toast("급여명세서 발송 실패: " + (err.message || ""), "error");
    }
    setSending(false);
  };

  const fmtKRW = (n: number) => `₩${n.toLocaleString()}`;

  return (
    <div>
      <div className="payroll-toolbar">
        <p className="text-sm text-[var(--text-muted)]">재직 직원 급여 기준 4대보험/원천세 자동 계산 미리보기</p>
        <div className="flex gap-2 items-center flex-wrap">
          <MonthField
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs"
            title="조회할 급여 명세 월 선택"
          />
          {preview && preview.items.length > 0 && (
            <>
              {editMode ? (
                <>
                  <button onClick={loadAllowances} disabled={loadingAllowances} className="px-3 py-2 bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/30 hover:bg-[var(--info)]/20 rounded-xl text-xs font-semibold transition disabled:opacity-50" title="해당 월 근태 산정 수당(야간·연장·당직 등)을 불러와 채웁니다">
                    {loadingAllowances ? "불러오는 중..." : "수당 불러오기"}
                  </button>
                  <button onClick={saveEdits} disabled={savingEdit} className="px-3 py-2 bg-[var(--warning)] hover:brightness-110 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
                    {savingEdit ? "저장 중..." : "편집 저장"}
                  </button>
                  <button onClick={() => { setEditMode(false); generate(); }} className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] rounded-xl text-xs font-semibold transition">
                    취소
                  </button>
                </>
              ) : (
                <button onClick={() => setEditMode(true)} className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] rounded-xl text-xs font-semibold transition">
                  ✏️ 급여대장 직접 작성
                </button>
              )}
              <button onClick={downloadAll} className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] rounded-xl text-xs font-semibold transition">
                전체 PDF 다운로드
              </button>
              <button onClick={() => handleSendPayslips()} disabled={sending} className="px-4 py-2.5 bg-[var(--success)] hover:brightness-110 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {sending ? "발송 중..." : `전 직원 발송 (${preview.items.length}명)`}
              </button>
            </>
          )}
          <button onClick={generate} disabled={loading || !companyId} className="btn-primary">
            {loading ? "계산 중..." : "급여 명세 미리보기"}
          </button>
        </div>
      </div>

      {!preview ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-4"><Ico e="📋" /></div>
          <div className="text-sm text-[var(--text-muted)]">"급여 명세 미리보기" 버튼을 클릭하면 이번 달 급여 명세를 확인할 수 있습니다</div>
        </div>
      ) : preview.items.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-sm text-[var(--text-muted)]">재직 중인 직원이 없거나 급여가 설정되지 않았습니다</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="payroll-summary-cards">
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 급여 (세전)</div>
              <div className="text-lg font-bold mt-1">{fmtKRW(preview.totalGross)}</div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 공제액</div>
              <div className="text-lg font-bold text-[var(--danger)] mt-1">-{fmtKRW(preview.totalDeductions)}</div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 실수령액</div>
              <div className="text-lg font-bold text-[var(--success)] mt-1">{fmtKRW(preview.totalNet)}</div>
            </div>
          </div>

          {/* Detail Table */}
          <div className="payroll-detail-table glass-card">
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead className="sticky-bar"><tr className="table-head-row">
                <th className="text-left px-4 py-3 font-medium">직원</th>
                <th className="text-right px-4 py-3 font-medium" title="과세 대상 기본급">기본급(과세)</th>
                <th className="text-right px-4 py-3 font-medium" title="식대 · 자가운전 등 비과세 합계">비과세</th>
                <th className="text-right px-4 py-3 font-medium" title="기본급(과세) + 비과세">지급합계</th>
                <th className="text-right px-4 py-3 font-medium">국민연금</th>
                <th className="text-right px-4 py-3 font-medium">건강보험</th>
                <th className="text-right px-4 py-3 font-medium">장기요양</th>
                <th className="text-right px-4 py-3 font-medium">고용보험</th>
                <th className="text-right px-4 py-3 font-medium">소득세</th>
                <th className="text-right px-4 py-3 font-medium">지방소득세</th>
                <th className="text-right px-4 py-3 font-medium">공제합계</th>
                <th className="text-right px-4 py-3 font-medium">실수령</th>
                <th className="text-center px-4 py-3 font-medium">발송</th>
              </tr></thead>
              <tbody>
                {preview.items.map((item) => {
                  const ev = editValues[item.employeeId] || { baseSalary: item.baseSalary, nonTaxable: item.nonTaxableAmount, extras: [] };
                  // v4 H1: 임의 수당/공제 합산 (preview netPay 에는 이미 반영됨)
                  const itemExtras = item.extras || [];
                  const allowanceSum = itemExtras.filter((e) => e.type === 'allowance').reduce((s, e) => s + Number(e.amount || 0), 0);
                  const deductionSum = itemExtras.filter((e) => e.type === 'deduction').reduce((s, e) => s + Number(e.amount || 0), 0);
                  return (
                  <>
                  <tr key={item.employeeId} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-4 py-3 text-sm font-medium">
                      {item.employeeName}
                      {!editMode && (allowanceSum > 0 || deductionSum > 0) && (
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {allowanceSum > 0 && <span className="text-[var(--info)]">수당 +{allowanceSum.toLocaleString()}</span>}
                          {allowanceSum > 0 && deductionSum > 0 && <span className="mx-1">·</span>}
                          {deductionSum > 0 && <span className="text-[var(--danger)]">공제 -{deductionSum.toLocaleString()}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      {editMode ? (
                        <CurrencyInput value={ev.baseSalary}
                          onValueChange={(raw) => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, baseSalary: Number(raw || 0) } }))}
                          className="w-28 px-2 py-1 text-right bg-[var(--bg)] border border-[var(--primary)]/40 rounded-md text-xs"
                        />
                      ) : fmtKRW(item.baseSalary)}
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">
                      {editMode ? (
                        <CurrencyInput value={ev.nonTaxable}
                          onValueChange={(raw) => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, nonTaxable: Number(raw || 0) } }))}
                          className="w-24 px-2 py-1 text-right bg-[var(--bg)] border border-[var(--primary)]/40 rounded-md text-xs"
                          placeholder="0"
                        />
                      ) : fmtKRW(item.nonTaxableAmount || 0)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-[var(--text)]">
                      {fmtKRW(editMode ? (Number(ev.baseSalary || 0) + Number(ev.nonTaxable || 0)) : (Number(item.baseSalary || 0) + Number(item.nonTaxableAmount || 0)))}
                    </td>
                    {([
                      ["nationalPension", item.nationalPension],
                      ["healthInsurance", item.healthInsurance],
                      ["longTermCareInsurance", item.longTermCareInsurance || 0],
                      ["employmentInsurance", item.employmentInsurance],
                      ["incomeTax", item.incomeTax],
                      ["localIncomeTax", item.localIncomeTax],
                    ] as const).map(([key, val]) => (
                      <td key={key} className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">
                        {editMode ? (
                          <CurrencyInput value={ev.deductions?.[key] ?? Number(val || 0)}
                            onValueChange={(raw) => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, deductions: { ...(ev.deductions || {}), [key]: Number(raw || 0) } } }))}
                            className="w-20 px-1.5 py-1 text-right bg-[var(--bg)] border border-[var(--primary)]/40 rounded-md text-xs"
                          />
                        ) : fmtKRW(Number(val || 0))}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-sm text-right text-[var(--danger)]">-{fmtKRW(item.deductionsTotal)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-[var(--success)]">{fmtKRW(item.netPay)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => downloadOne(item)} title="급여명세서 PDF 다운로드" className="px-2 py-1 text-[10px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg transition">
                          <Ico e="⬇" tone="mono" /> PDF
                        </button>
                        <button onClick={() => handleSendPayslips([item.employeeId])} disabled={sending}
                          title="이 직원에게만 메일로 명세서 발송 (비밀번호=생년월일)"
                          className="px-2 py-1 text-[10px] font-semibold bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20 rounded-lg transition disabled:opacity-50">
                          <Ico e="✉" tone="mono" /> 발송
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* v4 H1: 편집 모드일 때 row 아래 수당/공제 라인 편집 */}
                  {editMode && (
                    <tr key={`${item.employeeId}-extras`} className="bg-[var(--bg-surface)]/40 border-b border-[var(--border)]/30">
                      <td colSpan={13} className="px-4 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] text-[var(--text-dim)] font-semibold">임의 수당/공제 ({(ev.extras || []).length}건)</span>
                          <button type="button"
                            onClick={() => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: [...(ev.extras || []), { type: 'allowance', name: '', amount: 0 }] } }))}
                            className="text-[10px] px-2 py-0.5 rounded bg-[var(--info)]/10 text-[var(--info)] hover:bg-[var(--info)]/20">+ 수당</button>
                          <button type="button"
                            onClick={() => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: [...(ev.extras || []), { type: 'deduction', name: '', amount: 0 }] } }))}
                            className="text-[10px] px-2 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20">+ 공제</button>
                        </div>
                        {(ev.extras || []).length > 0 && (
                          <div className="space-y-1">
                            {(ev.extras || []).map((ex, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <select value={ex.type} onChange={(e) => {
                                  const next = [...(ev.extras || [])];
                                  next[idx] = { ...ex, type: e.target.value as 'allowance' | 'deduction' };
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} className={`text-[10px] px-2 py-1 rounded border ${ex.type === 'allowance' ? 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/30' : 'bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/30'}`}>
                                  <option value="allowance">수당</option>
                                  <option value="deduction">공제</option>
                                </select>
                                <input value={ex.name} onChange={(e) => {
                                  const next = [...(ev.extras || [])];
                                  next[idx] = { ...ex, name: e.target.value };
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} placeholder="예: 식대 / 직책수당 / 사내대출"
                                  className="flex-1 max-w-xs px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                                <CurrencyInput value={ex.amount}
                                  onValueChange={(raw) => {
                                    const next = [...(ev.extras || [])];
                                    next[idx] = { ...ex, amount: Number(raw || 0) };
                                    setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                  }}
                                  className="w-28 px-2 py-1 text-right bg-[var(--bg)] border border-[var(--border)] rounded text-xs" />
                                <button type="button" onClick={() => {
                                  const next = (ev.extras || []).filter((_, i) => i !== idx);
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} className="text-[var(--danger)]/70 hover:text-[var(--danger)] text-xs">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </>
                  );
                })}
              </tbody>
              {/* 직원 QA #13 — 3개 총계만이 아니라 컬럼별 합계 행 추가 */}
              <tfoot>
                {(() => {
                  const its = preview.items;
                  const sum = (f: (x: any) => number) => its.reduce((s, x) => s + Number(f(x) || 0), 0);
                  return (
                    <tr className="border-t-[3px] border-[var(--primary)]/40 bg-[var(--primary)]/10 font-bold">
                      <td className="px-4 py-3.5 text-sm font-extrabold text-[var(--primary)]">합계 ({its.length}명)</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold">{fmtKRW(sum((x) => x.baseSalary))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.nonTaxableAmount || 0))}</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold text-[var(--text)]">{fmtKRW(preview.totalGross)}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.nationalPension))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.healthInsurance))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.longTermCareInsurance || 0))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.employmentInsurance))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.incomeTax))}</td>
                      <td className="px-4 py-3.5 text-xs text-right">{fmtKRW(sum((x) => x.localIncomeTax))}</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold text-[var(--danger)]">-{fmtKRW(preview.totalDeductions)}</td>
                      <td className="px-4 py-3.5 text-[15px] text-right font-extrabold text-[var(--success)]">{fmtKRW(preview.totalNet)}</td>
                      <td className="px-4 py-3.5"></td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Leave Tab ──
export function LeaveTab({ employees, directory, companyId, userId, queryClient, isEmployee, autoNew, focusPending }: any) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(!!autoNew);
  const approveSectionRef = useRef<HTMLDivElement>(null);

  // 알림에서 진입(?focus=pending) 시 — 승인 대기 필터로 전환 후 승인 영역으로 스크롤.
  useEffect(() => {
    if (!focusPending) return;
    setStatusFilter("pending");
    const t = setTimeout(() => approveSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
  }, [focusPending]);

  // Auto-detect current user's employee record
  const myEmployee = isEmployee ? employees.find((e: any) => e.user_id === userId) : null;

  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "annual",
    leaveUnit: "full_day" as string,
    halfDayPeriod: "am" as "am" | "pm",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    reason: "",
    // Flex 승인 체인: 각 단계 = 승인자 user id (빈 문자열 = 미지정). 최소 1단계.
    approverSteps: [""] as string[],
    ccUserIds: [] as string[],
  });
  const [showPromotion, setShowPromotion] = useState(false);

  // 승인자·참조자 선택 풀 — 회사 전체 구성원 (비관리자 포함).
  const { data: members = [] } = useQuery({
    queryKey: ["company-members", companyId],
    queryFn: () => getCompanyMembers(companyId!),
    enabled: !!companyId,
  });
  // user_id → 직원 레코드(소속/직책 표시용) 매핑
  const memberMeta = useMemo(() => {
    const byUser: Record<string, { department?: string; position?: string }> = {};
    (employees as any[]).forEach((e: any) => {
      if (e.user_id) byUser[e.user_id] = { department: e.department, position: e.position };
    });
    return byUser;
  }, [employees]);
  const memberById = useMemo(() => {
    const m: Record<string, any> = {};
    (members as any[]).forEach((u: any) => { m[u.id] = u; });
    return m;
  }, [members]);

  // Auto-select employee for employee role
  useEffect(() => {
    if (myEmployee && !form.employeeId) {
      setForm(prev => ({ ...prev, employeeId: myEmployee.id }));
    }
  }, [myEmployee, form.employeeId]);

  // Leave requests
  const { data: leaveRequests = [] } = useQuery({
    queryKey: ["leave-requests", companyId, statusFilter],
    queryFn: () => getLeaveRequests(companyId!, statusFilter === "all" ? undefined : statusFilter),
    enabled: !!companyId,
  });

  // Leave balances
  const { data: balances = [] } = useQuery({
    queryKey: ["leave-balances", companyId, currentYear],
    queryFn: () => getLeaveBalances(companyId!, currentYear),
    enabled: !!companyId,
  });
  // 직원 계정은 본인 잔여연차만 — 다른 사람 연차는 숨김(관리자/대표는 전원 표시).
  const visibleBalances = isEmployee && myEmployee
    ? (balances as any[]).filter((b: any) => b.employee_id === myEmployee.id)
    : balances;

  // Leave promotion candidates
  const { data: promotionCandidates = [] } = useQuery({
    queryKey: ["leave-promotion-candidates", companyId, currentYear],
    queryFn: () => getLeavePromotionCandidates(companyId!, currentYear),
    enabled: !!companyId && showPromotion,
  });

  // Leave promotion notices
  const { data: promotionNotices = [] } = useQuery({
    queryKey: ["leave-promotion-notices", companyId, currentYear],
    queryFn: () => getLeavePromotionNotices(companyId!, currentYear),
    enabled: !!companyId && showPromotion,
  });

  // Create leave request mutation
  const createLeave = useMutation({
    mutationFn: () => {
      const unit = form.leaveUnit;
      let days: number;
      if (unit === "half_day") {
        days = 0.5;
      } else if (unit === "two_hours") {
        days = 0.25;
      } else {
        // full_day: calculate from date range
        const start = new Date(form.startDate);
        const end = new Date(form.endDate || form.startDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }

      return createLeaveRequest({
        companyId: companyId!,
        employeeId: form.employeeId,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        days,
        reason: form.reason,
        leaveUnit: unit as any,
        halfDayPeriod: unit === "half_day" ? form.halfDayPeriod : undefined,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        approverIds: form.approverSteps.filter(Boolean),
        ccUserIds: form.ccUserIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setShowForm(false);
      setForm({ employeeId: "", leaveType: "annual", leaveUnit: "full_day", halfDayPeriod: "am", startDate: "", endDate: "", startTime: "", endTime: "", reason: "", approverSteps: [""], ccUserIds: [] });
    },
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // Send promotion notice
  const sendPromotion = useMutation({
    mutationFn: (params: { employeeId: string; noticeType: "first" | "second"; unusedDays: number; email: string; employeeName: string }) =>
      sendLeavePromotionNotice({ companyId: companyId!, ...params, year: currentYear }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-promotion-notices"] });
      queryClient.invalidateQueries({ queryKey: ["leave-promotion-candidates"] });
    },
    onError: (err: any) => toast("촉진 알림 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Approve mutation
  const approveMut = useMutation({
    mutationFn: (id: string) => approveLeaveRequest(id, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
    onError: (err: any) => toast("휴가 승인 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Reject mutation
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectLeaveRequest(id, userId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
    onError: (err: any) => toast("휴가 반려 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Cancel mutation — 승인된 휴가 취소 시 잔여 복구
  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelLeaveRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast("휴가가 취소되었습니다 (잔여 복구됨).", "success");
    },
    onError: (err: any) => toast("휴가 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 남은 연차 직접 입력 (사장님 지시 2026-07-30) — 입력값은 '지금 남은 연차'다.
  //   내부적으로 총부여 = 남은 + 사용 을 'base' 발생으로 기록한다. leave_balances 를 직접 쓰면
  //   자동 발생 cron 이 매일 자정 grants 합계로 되돌려 손으로 넣은 값이 사라진다.
  const setRemaining = useMutation({
    mutationFn: (params: { employeeId: string; remainingDays: number; usedDays: number }) =>
      setRemainingLeaveDays({
        companyId: companyId!,
        employeeId: params.employeeId,
        year: currentYear,
        remainingDays: params.remainingDays,
        usedDays: params.usedDays,
        createdBy: userId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["emp-leave-grants"] });
    },
    onError: (err: any) => toast("남은 연차 설정 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 입사일 기준 자동 부여 (1년 미만 = 월 1일 만근, 1년+ = 근로기준법 기본)
  const autoInitMut = useMutation({
    mutationFn: (params: { employeeId: string; hireDate: string }) =>
      autoInitLeaveBalance(companyId!, params.employeeId, params.hireDate, currentYear),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-balances"] }),
    onError: (err: any) => toast("자동 부여 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const bulkAutoMut = useMutation({
    mutationFn: () => bulkAutoInitLeaveBalances(companyId!, currentYear),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast(`입사일 기준 자동 부여 완료 (${r?.updated ?? 0}명)`, "success");
    },
    onError: (err: any) => toast("일괄 자동 부여 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 연차 부여 방식 (자동부여 / 직접입력) — company_settings.settings JSONB
  const { data: grantMethod = "auto" } = useQuery<LeaveGrantMethod>({
    queryKey: ["leave-grant-method", companyId],
    queryFn: () => getLeaveGrantMethod(companyId!),
    enabled: !!companyId,
  });

  const setGrantMethodMut = useMutation({
    mutationFn: (m: LeaveGrantMethod) => setLeaveGrantMethod(companyId!, m),
    onSuccess: (_d, m) => {
      queryClient.invalidateQueries({ queryKey: ["leave-grant-method", companyId] });
      toast(
        m === "auto" ? "연차 부여 방식: 자동부여(입사일 기준)" : "연차 부여 방식: 직접입력",
        "success",
      );
    },
    onError: (err: any) => toast("부여 방식 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 연차 자동 발생(1년 미만 월 1일 + 1주년 법정 부여) — on/off + 기준(입사일/회계연도).
  //   실제 생성은 pg_cron. 설정이 없으면 켬이 기본이라 초기값도 true 로 둔다(로딩 중 잠깐 꺼짐으로 보이지 않게).
  const { data: accrual = { enabled: true, basis: "hire" as MonthlyAccrualBasis } } = useQuery({
    queryKey: ["leave-monthly-accrual", companyId],
    queryFn: () => getMonthlyAccrualSettings(companyId!),
    enabled: !!companyId,
  });
  const saveAccrualMut = useMutation({
    mutationFn: (next: { enabled: boolean; basis: MonthlyAccrualBasis }) => setMonthlyAccrualSettings(companyId!, next),
    onSuccess: (_d, next) => {
      queryClient.invalidateQueries({ queryKey: ["leave-monthly-accrual", companyId] });
      toast(next.enabled ? `연차 자동 발생 켬 · ${ACCRUAL_BASIS_LABELS[next.basis].label}` : "연차 자동 발생 끔", "success");
    },
    onError: (err: any) => toast("저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });
  // 연차 자동 발생 — 접힌 요약이 기본, '변경'으로 펼쳐 고른 뒤 저장 (2026-08-06 사장님 요청).
  //   '연차 부여 방식' 패널과 같은 규약. 켜고 끄는 즉시 저장되던 걸 저장 버튼으로 바꾼다.
  const [accrualEditing, setAccrualEditing] = useState(false);
  const [pendingAccrual, setPendingAccrual] = useState<{ enabled: boolean; basis: MonthlyAccrualBasis } | null>(null);
  const draftAccrual = pendingAccrual ?? accrual;

  // 회사별 휴가 유형·기본 일수 — 저장값이 없으면 법정 기본값
  const { data: companyLeaveTypes = defaultCompanyLeaveTypes() } = useQuery({
    queryKey: ["company-leave-types", companyId],
    queryFn: () => getCompanyLeaveTypes(companyId!),
    enabled: !!companyId,
  });
  const [typesEditing, setTypesEditing] = useState(false);
  const [draftTypes, setDraftTypes] = useState<CompanyLeaveType[] | null>(null);
  const saveTypesMut = useMutation({
    mutationFn: (next: CompanyLeaveType[]) => setCompanyLeaveTypes(companyId!, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-leave-types", companyId] });
      setTypesEditing(false); setDraftTypes(null);
      toast("휴가 유형을 저장했습니다", "success");
    },
    onError: (err: any) => toast("휴가 유형 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });
  // 유형 라벨 조회 — 회사 설정 우선, 없으면 저장된 원본 값 그대로(과거 요청이 깨지지 않게)
  const leaveTypeLabel = (v: string) => companyLeaveTypes.find((t) => t.value === v)?.label
    || LEAVE_TYPES.find((t) => t.value === v)?.label || v;
  const syncAccrualMut = useMutation({
    mutationFn: () => syncLeaveAccruals(),
    onSuccess: (count: number) => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances-list"] });
      queryClient.invalidateQueries({ queryKey: ["emp-leave-grants"] });
      toast(count > 0 ? `발생 ${count}건이 추가되었습니다` : "추가할 발생분이 없습니다", "success");
    },
    onError: (err: any) => toast("반영 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const activeEmployees = employees.filter((e: any) => e.status === "active" || e.status === "joined");

  // 휴가 탭 서브뷰 — '직원별 연차' / '설정' (2026-08-06 사장님 시안)
  const [leaveView, setLeaveView] = useState<"roster" | "settings">("roster");
  const [calendarOpen, setCalendarOpen] = useState(false);
  // 이름 클릭 → 그 구성원의 전체 연차 신청 내역, 월 셀 클릭 → 그 달 사용 내역
  const [rosterEmp, setRosterEmp] = useState<{ id: string; name: string } | null>(null);
  const [rosterMonth, setRosterMonth] = useState<{ empId: string; name: string; month: number } | null>(null);
  useModalKeys(calendarOpen, () => setCalendarOpen(false));
  useModalKeys(!!rosterEmp, () => setRosterEmp(null));
  useModalKeys(!!rosterMonth, () => setRosterMonth(null));

  // 연차 표용 — 그 해 전체 신청 건(상태 필터와 무관하게 항상 전량).
  //   월별 칸은 '승인' 건만 집계한다(신청 중인 건은 아직 쓴 게 아니다).
  const { data: yearRequests = [] } = useQuery({
    queryKey: ["leave-requests-year", companyId, currentYear],
    queryFn: () => getLeaveRequests(companyId!),
    enabled: !!companyId,
  });
  const rosterRows = useMemo(() => {
    const byEmp = new Map<string, { total: number; months: number[]; used: number }>();
    const ensure = (id: string) => {
      if (!byEmp.has(id)) byEmp.set(id, { total: 0, months: Array(12).fill(0), used: 0 });
      return byEmp.get(id)!;
    };
    for (const b of (visibleBalances as any[])) {
      const r = ensure(b.employee_id);
      r.total = Number(b.total_days || 0);
      r.used = Number(b.used_days || 0);
    }
    for (const req of (yearRequests as any[])) {
      if (req.status !== "approved" || !req.start_date) continue;
      const d = String(req.start_date);
      if (!d.startsWith(String(currentYear))) continue;
      const m = Number(d.slice(5, 7)) - 1;
      if (m < 0 || m > 11) continue;
      const r = ensure(req.employee_id);
      r.months[m] += Number(req.days || 0);
    }
    // 표에 올릴 대상 — 관리자는 재직 직원 전원(연차 미설정자도 0으로 보이게), 직원은 본인만
    const targets = isEmployee
      ? (myEmployee ? [myEmployee] : [])
      : activeEmployees;
    return (targets as any[]).map((e: any) => {
      const r = byEmp.get(e.id) || { total: 0, months: Array(12).fill(0), used: 0 };
      // 총 사용일수는 월별 칸의 합 — 표 안에서 눈으로 더한 값과 어긋나지 않게(시안 규약).
      //   leave_balances.used_days 는 차감 원장이라 조정분까지 포함될 수 있어 표의 합과 다를 수 있다.
      const usedTotal = r.months.reduce((a, b) => a + b, 0);
      return {
        id: e.id,
        name: e.name || "-",
        total: r.total,
        months: r.months,
        used: usedTotal,
        remain: Math.max(0, r.total - usedTotal),
        hasBalance: byEmp.has(e.id),
      };
    });
  }, [visibleBalances, yearRequests, activeEmployees, isEmployee, myEmployee, currentYear]);

  // 이름/월 팝업에 쓸 그 직원의 신청 내역
  const rosterEmpRequests = useMemo(
    () => (yearRequests as any[]).filter((r: any) => r.employee_id === rosterEmp?.id),
    [yearRequests, rosterEmp],
  );
  const rosterMonthRequests = useMemo(
    () => (yearRequests as any[]).filter((r: any) =>
      r.employee_id === rosterMonth?.empId
      && r.status === "approved"
      && String(r.start_date || "").startsWith(`${currentYear}-${String((rosterMonth?.month ?? 0) + 1).padStart(2, "0")}`)),
    [yearRequests, rosterMonth, currentYear],
  );

  // R12: 연차 부여 방식 — 선택+저장 후 작은 요약으로 접힘 (변경 시 펼침)
  const [grantEditing, setGrantEditing] = useState(false);
  const [pendingGrant, setPendingGrant] = useState<LeaveGrantMethod | null>(null);

  // 연차 일수 인라인 편집 상태
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalanceVal, setEditingBalanceVal] = useState<string>("");

  // 휴가 캘린더 이름 조회 — leave_requests.employees(name) 조인은 employees RESTRICTIVE
  //   RLS(직원 role=본인 1행만) 로 타인 행이 null 이 돼 "Unknown" 이 뜨던 원인. get_company_directory()
  //   기반 directory(안전 필드만, 전 직원) 로 employee_id → 이름을 우선 조회하고, 그래도 없으면
  //   (관리자 role 등 조인이 이미 성공한 경우) 기존 조인 결과로 폴백.
  const directoryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (directory as any[] || []).forEach((d: any) => { m[d.id] = d.name; });
    return m;
  }, [directory]);

  // Build leave calendar: who's on leave on which dates — 연차/반차/기타 3버킷으로 구분 표시.
  const leaveCalendar = useMemo(() => {
    const approved = leaveRequests.filter((r: any) => r.status === "approved");
    const dateMap: Record<string, { name: string; type: string; bucket: "annual" | "half" | "other" }[]> = {};

    approved.forEach((r: any) => {
      if (!r.start_date) return;
      // 날짜 문자열을 UTC 자정으로 고정해 순회 — 로컬 파싱이면 캘린더 키(toISOString)가 하루 밀린다.
      const start = new Date(String(r.start_date).slice(0, 10) + "T00:00:00Z");
      const end = new Date(String(r.end_date || r.start_date).slice(0, 10) + "T00:00:00Z");
      const name = directoryNameById[r.employee_id] || r.employees?.name || "구성원";
      const type = leaveTypeLabel(r.leave_type);
      const isHalf = r.leave_unit === "half_day" || r.leave_unit === "two_hours";
      const bucket: "annual" | "half" | "other" = isHalf ? "half" : r.leave_type === "annual" ? "annual" : "other";
      let guard = 0;
      for (let d = new Date(start); d <= end && guard++ < 400; d = new Date(d.getTime() + 86400000)) {
        const key = d.toISOString().slice(0, 10);
        if (!dateMap[key]) dateMap[key] = [];
        dateMap[key].push({ name, type, bucket });
      }
    });

    return dateMap;
  }, [leaveRequests, directoryNameById]);

  // Calendar for current month
  const today = new Date();
  const [calMonth, setCalMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const calYear = Number(calMonth.split("-")[0]);
  const calMon = Number(calMonth.split("-")[1]);
  const calDaysInMonth = new Date(calYear, calMon, 0).getDate();
  const calFirstDow = new Date(calYear, calMon - 1, 1).getDay();

  // 직원 계정은 본인 신청 + 본인이 승인자/참조자인 건만 노출 — 타인 휴가 승인내용은 숨김.
  //   (관리자/대표는 전원 표시. 비관리자 승인자도 승인 대상 건은 보여야 함.)
  const visibleRequests = useMemo(() => {
    if (!isEmployee) return leaveRequests as any[];
    const myEmpIds = new Set((employees as any[]).filter((e: any) => e.user_id === userId).map((e: any) => e.id));
    return (leaveRequests as any[]).filter((r: any) => {
      if (myEmpIds.has(r.employee_id)) return true;
      const steps = Array.isArray(r.approval_steps) ? r.approval_steps : [];
      if (steps.some((s: any) => String(s.approver_id) === userId)) return true;
      if (r.requested_approver_id === userId || r.second_approver_id === userId) return true;
      if (Array.isArray(r.cc_user_ids) && r.cc_user_ids.includes(userId)) return true;
      return false;
    });
  }, [leaveRequests, isEmployee, employees, userId]);


  // Track which employees have no balance yet
  const employeesWithBalance = new Set(balances.map((b: any) => b.employee_id));
  const employeesWithoutBalance = activeEmployees.filter((e: any) => !employeesWithBalance.has(e.id));

  // Calculate leave type usage summary
  const leaveTypeSummary = useMemo(() => {
    const approved = leaveRequests.filter((r: any) => r.status === "approved");
    return companyLeaveTypes.map(lt => {
      const used = approved.filter((r: any) => r.leave_type === lt.value).reduce((s: number, r: any) => s + Number(r.days || 0), 0);
      const pending = leaveRequests.filter((r: any) => r.leave_type === lt.value && r.status === "pending").length;
      return { ...lt, used, pending };
    });
  }, [leaveRequests, companyLeaveTypes]);

  // Flex 승인 체인 진행 상태 계산 (approval_steps 우선, 없으면 구 1차/2차).
  const stepInfo = (r: any): {
    steps: { approver_id: string; status: string }[];
    currentApprover: string | null; // 현재 pending 단계의 승인자 user id
    stageNo: number;                // 현재(또는 완료) 단계 번호
    total: number;
    label: string;                  // 상태 라벨
  } => {
    const raw = Array.isArray(r.approval_steps) ? r.approval_steps : [];
    if (raw.length > 0) {
      const steps = raw.map((s: any) => ({ approver_id: String(s.approver_id), status: s.status || "pending" }));
      const idx = steps.findIndex((s: any) => s.status === "pending");
      const done = steps.filter((s: any) => s.status === "approved").length;
      let label: string;
      if (r.status === "approved") label = "승인";
      else if (r.status === "rejected") label = "반려";
      else if (idx >= 0) label = `${idx + 1}단계 승인 대기${steps.length > 1 ? ` (${done}/${steps.length})` : ""}`;
      else label = "승인";
      return {
        steps,
        currentApprover: idx >= 0 ? steps[idx].approver_id : null,
        stageNo: idx >= 0 ? idx + 1 : steps.length,
        total: steps.length,
        label,
      };
    }
    // 구 흐름 폴백
    const cur = r.status === "first_approved" ? r.second_approver_id : r.requested_approver_id;
    const st = LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS];
    return {
      steps: [],
      currentApprover: (r.status === "pending" || r.status === "first_approved") ? (cur || null) : null,
      stageNo: r.status === "first_approved" ? 2 : 1,
      total: r.second_approver_id ? 2 : 1,
      label: st?.label || r.status,
    };
  };

  return (
    <div>
      {/* ── 휴가 탭 서브뷰 (2026-08-06 사장님 시안) ──
          상단 KPI 카드는 이 탭에서 감추고, '직원별 연차'(표) / '설정'(부여 방식·휴가 유형) 로 나눈다. */}
      <div className="leave-subtabs">
        <div className="leave-subtab-group">
          {([{ k: "roster", label: "직원별 연차" }, { k: "settings", label: "설정" }] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setLeaveView(t.k)}
              className={`leave-subtab ${leaveView === t.k ? "leave-subtab-on" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {leaveView === "roster" && (
          <button onClick={() => setCalendarOpen(true)} className="btn-secondary btn-sm">휴가 캘린더</button>
        )}
      </div>

      {leaveView === "roster" && (
        <div className="leave-roster">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-[var(--text-muted)]">{currentYear}년 직원별 연차</h3>
            {!isEmployee && grantMethod === "auto" && (
              <button
                onClick={() => bulkAutoMut.mutate()}
                disabled={bulkAutoMut.isPending}
                className="text-xs px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg hover:bg-[var(--primary)]/20 transition disabled:opacity-50"
                title="1년 미만: 1개월 만근당 1일(최대 11) · 1년 이상: 근로기준법 기본(15일+)"
              >
                {bulkAutoMut.isPending ? "처리 중..." : "입사일 기준 자동 부여"}
              </button>
            )}
          </div>
          {rosterRows.length === 0 ? (
            <div className="templates-empty">표시할 구성원이 없습니다.</div>
          ) : (
            <div className="leave-roster-scroll">
              <table className="leave-roster-table">
                <thead>
                  <tr>
                    <th className="leave-roster-th leave-roster-name-col">이름</th>
                    <th className="leave-roster-th">부여일수</th>
                    {Array.from({ length: 12 }, (_, m) => (
                      <th key={m} className="leave-roster-th">{m + 1}월</th>
                    ))}
                    <th className="leave-roster-th">총 사용일수</th>
                    <th className="leave-roster-th">잔여일수</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map((row) => (
                    <tr key={row.id} className="leave-roster-row">
                      <td className="leave-roster-td leave-roster-name-col">
                        <button
                          onClick={() => setRosterEmp({ id: row.id, name: row.name })}
                          className="leave-roster-name"
                          title="전체 연차 신청 내역 보기"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="leave-roster-td mono-number">{row.total}</td>
                      {row.months.map((v, m) => (
                        <td key={m} className="leave-roster-td mono-number">
                          {v > 0 ? (
                            <button
                              onClick={() => setRosterMonth({ empId: row.id, name: row.name, month: m })}
                              className="leave-roster-cell-btn"
                              title="사용 날짜·승인 내역 보기"
                            >
                              {v}
                            </button>
                          ) : (
                            <span className="text-[var(--text-dim)]">·</span>
                          )}
                        </td>
                      ))}
                      <td className="leave-roster-td mono-number font-semibold">{row.used}</td>
                      <td className="leave-roster-td mono-number font-bold">{row.remain}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      {leaveView === "settings" && (<>
        {/* 휴가 유형 — 작은 칩으로 한 줄 (2026-08-06 사장님: 공간 차지 줄이기).
            유형·기본 일수는 회사별로 편집 가능 — company_settings.settings.leave_types */}
        <div className="leave-type-overview">
          <div className="leave-type-head">
            <h3 className="text-sm font-bold text-[var(--text-muted)]">휴가 유형</h3>
            {!isEmployee && !typesEditing && (
              <button
                onClick={() => { setDraftTypes(companyLeaveTypes.map((t) => ({ ...t }))); setTypesEditing(true); }}
                className="leave-type-edit-btn"
              >
                유형·일수 수정
              </button>
            )}
          </div>

          {!typesEditing ? (
            <div className="leave-type-chip-row">
              {leaveTypeSummary.map(lt => (
                <div key={lt.value} className="leave-type-chip">
                  <span className="leave-type-chip-label">{lt.label}</span>
                  <span className="leave-type-chip-days">{lt.defaultDays}일</span>
                  {lt.used > 0 && <span className="leave-type-chip-used">-{lt.used}</span>}
                  {lt.pending > 0 && <span className="leave-type-chip-pending">{lt.pending}건 대기</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="leave-type-editor glass-card">
              <p className="text-[11px] text-[var(--text-dim)] mb-3">
                회사 규정에 맞게 유형 이름과 기본 일수를 고치세요. 이미 신청된 휴가의 유형은 그대로 유지됩니다.
              </p>
              <div className="leave-type-editor-rows">
                {(draftTypes || []).map((t, i) => (
                  <div key={i} className="leave-type-editor-row">
                    <input
                      value={t.label}
                      onChange={(e) => setDraftTypes((prev) => (prev || []).map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                      placeholder="유형 이름"
                      className="leave-type-editor-name field-input"
                    />
                    <div className="leave-type-editor-days-wrap">
                      <input
                        type="number"
                        min={0}
                        value={t.defaultDays}
                        onChange={(e) => setDraftTypes((prev) => (prev || []).map((x, xi) => xi === i ? { ...x, defaultDays: Math.max(0, Number(e.target.value) || 0) } : x))}
                        className="leave-type-editor-days field-input"
                      />
                      <span className="text-[11px] text-[var(--text-dim)]">일</span>
                    </div>
                    <button
                      onClick={() => setDraftTypes((prev) => (prev || []).filter((_, xi) => xi !== i))}
                      className="leave-type-editor-del"
                      title="이 유형 삭제"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
              <div className="leave-type-editor-actions">
                <button
                  onClick={() => setDraftTypes((prev) => [...(prev || []), { value: `custom_${Date.now()}`, label: "", defaultDays: 0 }])}
                  className="btn-secondary btn-sm"
                >
                  유형 추가
                </button>
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => { setTypesEditing(false); setDraftTypes(null); }}
                    disabled={saveTypesMut.isPending}
                    className="leave-type-editor-cancel"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      const cleaned = (draftTypes || [])
                        .map((t) => ({ ...t, label: t.label.trim() }))
                        .filter((t) => t.label !== "");
                      if (cleaned.length === 0) { toast("휴가 유형을 최소 1개는 남겨주세요", "error"); return; }
                      saveTypesMut.mutate(cleaned);
                    }}
                    disabled={saveTypesMut.isPending}
                    className="btn-primary btn-sm"
                  >
                    {saveTypesMut.isPending ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 연차 자동 발생 (근로기준법 60조) — 매일 자정 pg_cron 이 월 1일·1주년 부여를 생성.
            2026-08-06 사장님: 공간을 너무 먹어 접힌 요약이 기본. '변경'으로 펼쳐 고른 뒤 저장. */}
        {!isEmployee && (
          <div className="leave-accrual-panel glass-card">
            {!accrualEditing ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--text-muted)]">
                  연차 자동 발생 ·{" "}
                  <strong className="text-[var(--text)]">
                    {accrual.enabled ? `켬 · ${ACCRUAL_BASIS_LABELS[accrual.basis].label}` : "끔"}
                  </strong>
                </div>
                <button
                  onClick={() => { setPendingAccrual({ ...accrual }); setAccrualEditing(true); }}
                  className="leave-accrual-change-btn"
                >
                  변경
                </button>
              </div>
            ) : (
              <>
                <label className="leave-accrual-toggle">
                  <input
                    type="checkbox"
                    checked={draftAccrual.enabled}
                    onChange={(e) => setPendingAccrual({ ...draftAccrual, enabled: e.target.checked })}
                    className="w-4 h-4 accent-[var(--primary)] shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-bold">연차 자동 발생</div>
                    <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                      입사 1년 전까지는 매월 1일씩(최대 11일), 1주년부터는 근속연수별 법정 연차(1~2년 15일 · 3년 이상 2년마다 +1일 · 상한 25일)가
                      입사 응당일에 자동으로 발생합니다. 근로기준법 60조.
                    </p>
                    <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                      총 부여일수는 입사일 기준으로 자동 계산됩니다. 직원 카드에서 남은 연차를 직접 고치면 그 차액만 조정으로 반영됩니다.
                    </p>
                  </div>
                </label>

                {draftAccrual.enabled && (
                  <div className="leave-accrual-basis">
                    <div className="text-[11px] font-bold text-[var(--text-muted)] mb-2">발생 기준</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(Object.keys(ACCRUAL_BASIS_LABELS) as MonthlyAccrualBasis[]).map((k) => {
                        const on = draftAccrual.basis === k;
                        return (
                          <button
                            key={k}
                            onClick={() => setPendingAccrual({ ...draftAccrual, basis: k })}
                            className={`leave-accrual-basis-opt ${on ? "leave-accrual-basis-opt-on" : ""}`}
                          >
                            <div className="text-xs font-bold">{ACCRUAL_BASIS_LABELS[k].label}</div>
                            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{ACCRUAL_BASIS_LABELS[k].desc}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <button
                        onClick={() => syncAccrualMut.mutate()}
                        disabled={syncAccrualMut.isPending}
                        className="btn-secondary btn-sm disabled:opacity-50"
                        title="누락된 과거 발생분을 지금 즉시 생성합니다"
                      >
                        {syncAccrualMut.isPending ? "반영 중..." : "지금 반영"}
                      </button>
                      <span className="text-[11px] text-[var(--text-dim)]">매일 자정에도 자동으로 반영됩니다</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end mt-3">
                  <button
                    onClick={() => { setAccrualEditing(false); setPendingAccrual(null); }}
                    disabled={saveAccrualMut.isPending}
                    className="leave-accrual-cancel-btn"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => saveAccrualMut.mutate(draftAccrual, {
                      onSuccess: () => { setAccrualEditing(false); setPendingAccrual(null); },
                    })}
                    disabled={saveAccrualMut.isPending}
                    className="btn-primary btn-sm"
                  >
                    {saveAccrualMut.isPending ? "저장 중..." : "저장"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 연차 부여 방식 — R12: 저장 후 작은 요약으로 접힘, '변경' 시 펼침 */}
        {!isEmployee && (
          <div className="leave-grant-method-panel glass-card">
            {!grantEditing ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--text-muted)]">
                  연차 부여 방식 ·{" "}
                  <strong className="text-[var(--text)]">
                    {grantMethod === "auto" ? "자동부여 (입사일 기준)" : "직접입력"}
                  </strong>
                </div>
                <button
                  onClick={() => { setPendingGrant(grantMethod); setGrantEditing(true); }}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-surface)] transition shrink-0"
                >
                  변경
                </button>
              </div>
            ) : (
              <>
                <div className="text-sm font-bold mb-1">연차 부여 방식</div>
                <p className="text-[11px] text-[var(--text-dim)] mb-3">
                  회사 정책에 맞게 선택 후 <strong>저장</strong>하세요. 저장하면 아래 UI가 그에 맞게 표시됩니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { v: "auto" as LeaveGrantMethod, label: "자동부여 (입사일 기준)", desc: "근로기준법 공식으로 자동 산정" },
                    { v: "manual" as LeaveGrantMethod, label: "직접입력", desc: "직원별 연차를 수동으로 입력" },
                  ]).map((opt) => {
                    const active = (pendingGrant ?? grantMethod) === opt.v;
                    return (
                      <button
                        key={opt.v}
                        onClick={() => setPendingGrant(opt.v)}
                        className={`flex-1 min-w-[200px] text-left px-4 py-3 rounded-xl border transition ${
                          active
                            ? "border-[var(--primary)] bg-[var(--primary)]/10"
                            : "border-[var(--border)] hover:border-[var(--primary)]/40"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${active ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--text-dim)]"}`} />
                          <span className="text-sm font-semibold">{opt.label}</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-dim)] mt-1 ml-[22px]">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 justify-end mt-3">
                  <button
                    onClick={() => { setGrantEditing(false); setPendingGrant(null); }}
                    disabled={setGrantMethodMut.isPending}
                    className="px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--border)] hover:bg-[var(--bg-surface)] transition disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      const sel = pendingGrant ?? grantMethod;
                      setGrantMethodMut.mutate(sel, { onSuccess: () => { setGrantEditing(false); setPendingGrant(null); } });
                    }}
                    disabled={setGrantMethodMut.isPending}
                    className="btn-primary btn-sm"
                  >
                    {setGrantMethodMut.isPending ? "저장 중..." : "저장"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

      </>)}

      {leaveView === "roster" && (<>
      {/* Controls */}
      <div ref={approveSectionRef} id="leave-approve-section" className="leave-filter-toolbar">
        <div className="flex gap-2">
          {[
            { key: "all", label: "전체" },
            { key: "pending", label: "대기" },
            { key: "approved", label: "승인" },
            { key: "rejected", label: "반려" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === f.key
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {f.label}
              {f.key === "pending" && visibleRequests.filter((r: any) => r.status === "pending").length > 0 && (
                <span className="ml-1 text-[10px] px-1 py-0.5 rounded-full bg-white/20">
                  {visibleRequests.filter((r: any) => r.status === "pending").length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary"
        >
          + 휴가 신청
        </button>
      </div>

      {/* Leave Request Form */}
      {showForm && (
        <div className="leave-request-form glass-card">
          <h4 className="section-title">휴가 신청</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-4">
            {isEmployee && myEmployee ? (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">신청자</label>
                <div className="w-full px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)]">
                  {myEmployee.name}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">직원 *</label>
                <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                  <option value="">선택...</option>
                  {activeEmployees.map((e: any) => (<option key={e.id} value={e.id}>{e.name}</option>))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">휴가 유형</label>
              <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {companyLeaveTypes.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">사용 단위</label>
              <select value={form.leaveUnit} onChange={(e) => setForm({ ...form, leaveUnit: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {LEAVE_UNITS.map((u) => (<option key={u.value} value={u.value}>{u.label} ({u.days}일)</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">시작일 *</label>
              <DateField value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="field-input" />
            </div>
            {form.leaveUnit === "full_day" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
                <DateField value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="field-input" />
              </div>
            )}
            {form.leaveUnit === "half_day" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">반차 시간대</label>
                <div className="flex gap-1">
                  {([
                    { v: "am" as const, label: "오전" },
                    { v: "pm" as const, label: "오후" },
                  ]).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setForm({ ...form, halfDayPeriod: opt.v })}
                      className={`flex-1 px-2 py-2.5 rounded-xl text-xs font-semibold border transition ${
                        form.halfDayPeriod === opt.v
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {opt.label} 반차
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form.leaveUnit === "two_hours" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">시간대</label>
                <div className="flex gap-1">
                  <select value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="flex-1 px-2 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
                    <option value="">시작</option>
                    {["09:00","10:00","11:00","13:00","14:00","15:00","16:00"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="flex-1 px-2 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
                    <option value="">종료</option>
                    {["11:00","12:00","13:00","15:00","16:00","17:00","18:00"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="개인 사유" className="field-input" />
            </div>
          </div>

          {/* 보드 스타일 결재 패널 — 참조 + N단계 승인 */}
          {(() => {
            // 이미 선택된(승인자·참조) user id 집합
            const usedStepIds = new Set(form.approverSteps.filter(Boolean));
            const usedCc = new Set(form.ccUserIds);
            const memberLabel = (uid: string) => {
              const u = memberById[uid];
              if (!u) return uid;
              const meta = memberMeta[uid];
              const sub = [meta?.department, meta?.position].filter(Boolean).join(" · ");
              return { name: u.name || u.email || "구성원", sub, role: u.role };
            };
            const Avatar = ({ uid }: { uid: string }) => {
              const u = memberById[uid];
              const ch = (u?.name || u?.email || "?").slice(0, 1).toUpperCase();
              return (
                <span className="w-7 h-7 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-bold flex items-center justify-center shrink-0">
                  {ch}
                </span>
              );
            };
            const stepNames = form.approverSteps
              .map((id) => (id ? (memberById[id]?.name || memberById[id]?.email) : null))
              .filter(Boolean) as string[];
            const ccNames = form.ccUserIds
              .map((id) => memberById[id]?.name || memberById[id]?.email)
              .filter(Boolean) as string[];

            return (
              <div className="leave-approval-chain-panel">
                {/* 참조 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[var(--text-muted)]">참조 <span className="text-[var(--text-dim)] font-normal">(알림만)</span></span>
                    <select
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id && !form.ccUserIds.includes(id)) {
                          setForm({ ...form, ccUserIds: [...form.ccUserIds, id] });
                        }
                      }}
                      className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] font-semibold"
                    >
                      <option value="">+ 참조 추가</option>
                      {(members as any[])
                        .filter((u: any) => !usedCc.has(u.id) && !usedStepIds.has(u.id) && u.id !== form.employeeId)
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name || u.email}</option>
                        ))}
                    </select>
                  </div>
                  {form.ccUserIds.length === 0 ? (
                    <div className="text-[11px] text-[var(--text-dim)]">참조 대상이 없습니다</div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {form.ccUserIds.map((uid) => {
                        const lbl = memberLabel(uid) as any;
                        return (
                          <div key={uid} className="flex items-center gap-2 bg-[var(--bg-card)] rounded-xl px-2.5 py-1.5">
                            <Avatar uid={uid} />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">{lbl.name}</div>
                              {lbl.sub && <div className="text-[10px] text-[var(--text-dim)] truncate">{lbl.sub}</div>}
                            </div>
                            <button type="button" onClick={() => setForm({ ...form, ccUserIds: form.ccUserIds.filter((id) => id !== uid) })} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-sm px-1">×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* N단계 승인 */}
                <div className="space-y-3">
                  {form.approverSteps.map((stepId, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[var(--text-muted)]">{i + 1}단계 승인</span>
                        {form.approverSteps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, approverSteps: form.approverSteps.filter((_, idx) => idx !== i) })}
                            className="text-[10px] text-[var(--text-dim)] hover:text-[var(--danger)]"
                          >
                            단계 삭제
                          </button>
                        )}
                      </div>
                      {stepId ? (
                        <div className="flex items-center gap-2 bg-[var(--bg-card)] rounded-xl px-2.5 py-1.5">
                          <Avatar uid={stepId} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate">{(memberLabel(stepId) as any).name}</div>
                            {(memberLabel(stepId) as any).sub && <div className="text-[10px] text-[var(--text-dim)] truncate">{(memberLabel(stepId) as any).sub}</div>}
                          </div>
                          <button type="button" onClick={() => setForm({ ...form, approverSteps: form.approverSteps.map((s, idx) => idx === i ? "" : s) })} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-sm px-1">×</button>
                        </div>
                      ) : (
                        <select
                          value=""
                          onChange={(e) => setForm({ ...form, approverSteps: form.approverSteps.map((s, idx) => idx === i ? e.target.value : s) })}
                          className="field-input w-full"
                        >
                          <option value="">승인자 선택 (구성원)</option>
                          {(members as any[])
                            .filter((u: any) => (!usedStepIds.has(u.id) || u.id === stepId) && !usedCc.has(u.id) && u.id !== form.employeeId)
                            .map((u: any) => {
                              const meta = memberMeta[u.id];
                              const sub = [meta?.department, meta?.position].filter(Boolean).join(" · ");
                              return <option key={u.id} value={u.id}>{u.name || u.email}{sub ? ` — ${sub}` : ""}</option>;
                            })}
                        </select>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, approverSteps: [...form.approverSteps, ""] })}
                    className="w-full text-xs font-semibold text-[var(--primary)] border border-dashed border-[var(--primary)]/40 rounded-xl py-2 hover:bg-[var(--primary)]/5 transition"
                  >
                    + 승인 단계 추가하기
                  </button>
                </div>

                {/* 요약 */}
                {(stepNames.length > 0 || ccNames.length > 0) && (
                  <div className="mt-3 text-[11px] text-[var(--text-muted)]">
                    {stepNames.length > 0 && <span><strong className="text-[var(--text)]">{stepNames.join(", ")}</strong>님에게 승인</span>}
                    {stepNames.length > 0 && ccNames.length > 0 && ", "}
                    {ccNames.length > 0 && <span><strong className="text-[var(--text)]">{ccNames.join(", ")}</strong>님에게 참조</span>}
                    를 요청해요.
                  </div>
                )}
              </div>
            );
          })()}

          <button
            onClick={() => form.employeeId && form.startDate && !(form.endDate && form.endDate < form.startDate) && createLeave.mutate()}
            disabled={!form.employeeId || !form.startDate || (!!form.endDate && form.endDate < form.startDate) || createLeave.isPending}
            className="btn-primary mt-4"
          >
            {createLeave.isPending ? "처리 중..." : `승인 요청하기 (${(() => {
              const unit = form.leaveUnit;
              if (unit === "half_day") return 0.5;
              if (unit === "two_hours") return 0.25;
              if (!form.startDate) return 1;
              const start = new Date(form.startDate);
              const end = new Date(form.endDate || form.startDate);
              return Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            })()}일)`}
          </button>
        </div>
      )}

      {/* Leave Requests List */}
      <div className="leave-requests-table glass-card">
        {visibleRequests.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4"><Ico e="🏖" /></div>
            <div className="text-sm text-[var(--text-muted)]">휴가 신청 내역이 없습니다</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[800px]">
            <thead>
              <tr className="table-head-row">
                <th className="th-cell text-left">직원</th>
                <th className="th-cell text-left">유형</th>
                <th className="th-cell text-left">기간</th>
                <th className="th-cell text-center">일수</th>
                <th className="th-cell text-left">사유</th>
                <th className="th-cell text-left">승인자</th>
                <th className="th-cell text-center">상태</th>
                <th className="th-cell text-center">액션</th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((r: any) => {
                const st = LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS] || LEAVE_REQUEST_STATUS.pending;
                const leaveLabel = leaveTypeLabel(r.leave_type);
                return (
                  <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-5 py-3 text-sm font-medium">{r.employees?.name || "—"}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{leaveLabel}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.start_date}{r.start_date !== r.end_date ? ` ~ ${r.end_date}` : ""}
                      {r.leave_unit === "two_hours" && r.start_time ? ` ${r.start_time}~${r.end_time}` : ""}
                      {r.leave_unit === "half_day" && r.start_time ? (() => {
                        // 오전/오후 판정: 시작 시각이 12:00 이전이면 오전 반차.
                        const isAm = Number(String(r.start_time).slice(0, 2)) < 12;
                        return <span className="ml-1 text-[10px] text-[var(--primary)]">({isAm ? "오전" : "오후"} 반차 {r.start_time}~{r.end_time})</span>;
                      })() : ""}
                    </td>
                    <td className="px-5 py-3 text-sm text-center font-medium">
                      {Number(r.days)}일
                      {r.leave_unit && r.leave_unit !== "full_day" && (
                        <span className="ml-1 text-[10px] text-[var(--text-dim)]">
                          ({LEAVE_UNITS.find(u => u.value === r.leave_unit)?.label || r.leave_unit})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.reason || "—"}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      <div className="flex flex-col gap-0.5">
                        {(() => {
                          const info = stepInfo(r);
                          if (info.steps.length > 0) {
                            return info.steps.map((s: any, i: number) => {
                              const u = memberById[s.approver_id];
                              const nm = u?.name || u?.email || "구성원";
                              const mark = s.status === "approved" ? "✓" : s.status === "rejected" ? "✕" : "·";
                              const cls = s.status === "approved" ? "text-[var(--success)]" : s.status === "rejected" ? "text-[var(--danger)]" : "text-[var(--text-dim)]";
                              return <span key={i}><span className={cls}>{mark}</span> {i + 1}단계: {nm}</span>;
                            });
                          }
                          return (
                            <>
                              <span>1차: {r.requested_approver?.name || r.requested_approver?.email || <span className="text-[var(--text-dim)]">전체</span>}</span>
                              {r.second_approver_id && <span>2차: {r.second_approver?.name || r.second_approver?.email || "—"}</span>}
                            </>
                          );
                        })()}
                        {Array.isArray(r.cc_user_ids) && r.cc_user_ids.length > 0 && (
                          <span className="text-[10px] text-[var(--text-dim)]">참조 {r.cc_user_ids.length}명</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{stepInfo(r).label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        {(r.status === "pending" || r.status === "first_approved") && (() => {
                          // 승인/반려 버튼 노출 조건.
                          //   · 현재 pending 단계의 지정 승인자이면 노출 — isEmployee 무관.
                          //   · owner/admin(!isEmployee)은 지정 승인자가 따로 있어도 항상 오버라이드 노출.
                          //     (백엔드 approveLeaveRequest 도 isAdmin 오버라이드를 허용 — 정합)
                          const info = stepInfo(r);
                          const canAct = info.currentApprover === userId || !isEmployee;
                          if (!canAct) return null;
                          const stageLabel = info.steps.length > 0
                            ? `${info.stageNo}단계 승인`
                            : (r.status === "first_approved" ? "2차 승인" : "1차 승인");
                          return (
                            <>
                              <button
                                onClick={() => approveMut.mutate(r.id)}
                                className="text-[10px] px-2 py-1 rounded bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20"
                              >
                                {stageLabel}
                              </button>
                              <button
                                onClick={() => rejectMut.mutate(r.id)}
                                className="text-[10px] px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20"
                              >
                                반려
                              </button>
                            </>
                          );
                        })()}
                        {/* 취소 — 대기/1차승인/승인 상태 + 시작일 미래일 때만. v4 H2: 본인 직원도 취소 가능. */}
                        {(r.status === "pending" || r.status === "first_approved" || r.status === "approved") && (() => {
                          const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
                          const isFuture = r.start_date > todayKst;
                          const isMine = (employees as any[])?.find((emp: any) => emp.id === r.employee_id)?.user_id === userId;
                          if (isEmployee && !isMine) return null;
                          return (
                            <button
                              onClick={async () => {
                                if (!isFuture) return;
                                if (await appConfirm(r.status === "approved" ? "승인된 휴가를 취소하시겠습니까? 연차 잔여가 복구됩니다." : "이 휴가 신청을 취소하시겠습니까?")) {
                                  cancelMut.mutate(r.id);
                                }
                              }}
                              disabled={cancelMut.isPending || !isFuture}
                              title={isFuture ? "휴가 취소" : "이미 시작된(또는 오늘) 휴가는 취소 불가"}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              취소
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      </>)}

      {/* 휴가 캘린더 — 시안대로 팝업 (2026-08-06) */}
      {calendarOpen && (
        <div className="leave-modal-backdrop" onClick={() => setCalendarOpen(false)}>
          <div className="leave-modal leave-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="leave-modal-head">
              <h3 className="text-sm font-bold">휴가 캘린더</h3>
              <button onClick={() => setCalendarOpen(false)} className="leave-modal-close">✕</button>
            </div>
            <div className="leave-modal-body">
          <div className="leave-calendar">
            {/* 제목은 팝업 머리에 이미 있다 — 범례·월 선택만 남긴다 */}
            <div className="flex items-center justify-end mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                {/* 범례 — 연차/반차/기타휴가 색상 구분 */}
                <div className="flex items-center gap-2.5 text-[10px] text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />연차</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />반차</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />기타휴가</span>
                </div>
                <MonthField
                  value={calMonth}
                  onChange={(e) => setCalMonth(e.target.value)}
                  className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="glass-card overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-7 border-b border-[var(--border)]">
                {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                  <div
                    key={d}
                    className={`text-center text-xs font-medium py-2 ${
                      i === 0 ? "text-[var(--danger)]" : i === 6 ? "text-[var(--info)]" : "text-[var(--text-dim)]"
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7">
                {Array.from({ length: calFirstDow }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-[72px] border-b border-r border-[var(--border)]/30 bg-[var(--bg-surface)]/30" />
                ))}
                {Array.from({ length: calDaysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${calMonth}-${String(day).padStart(2, "0")}`;
                  const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                  const dow = (calFirstDow + i) % 7;
                  const isWeekend = dow === 0 || dow === 6;
                  const onLeave = leaveCalendar[dateStr] || [];

                  return (
                    <div
                      key={day}
                      className={`min-h-[72px] border-b border-r border-[var(--border)]/30 p-1.5 ${
                        isToday ? "bg-[var(--primary)]/5" : isWeekend ? "bg-[var(--bg-surface)]/30" : ""
                      }`}
                    >
                      <div className={`text-xs font-medium mb-1 ${
                        isToday ? "text-[var(--primary)] font-bold" : dow === 0 ? "text-[var(--danger)]" : dow === 6 ? "text-[var(--info)]" : "text-[var(--text-muted)]"
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {onLeave.slice(0, 3).map((l, idx) => {
                          const chipCls = l.bucket === "annual"
                            ? "bg-purple-500/10 text-purple-400"
                            : l.bucket === "half"
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-blue-500/10 text-blue-400";
                          return (
                            <div
                              key={idx}
                              className={`text-[9px] px-1 py-0.5 rounded truncate ${chipCls}`}
                              title={`${l.name} — ${l.type}${l.bucket === "half" ? " (반차)" : ""}`}
                            >
                              {l.name}{l.bucket !== "annual" && <span className="opacity-70"> · {l.bucket === "half" ? "반차" : l.type}</span>}
                            </div>
                          );
                        })}
                        {onLeave.length > 3 && (
                          <div className="text-[9px] text-[var(--text-dim)]">+{onLeave.length - 3}명</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 연차 상세 월별 Breakdown */}
          {!isEmployee && balances.length > 0 && (
            <div className="leave-monthly-breakdown-table">
              <h3 className="text-sm font-bold text-[var(--text-muted)] mb-3">연차 월별 사용 현황 ({currentYear}년)</h3>
              <div className="glass-card overflow-hidden">
                <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[900px]">
                  <thead className="sticky-bar"><tr className="table-head-row">
                    <th className="text-left px-4 py-2.5 font-medium sticky left-0 bg-[var(--bg-card)] z-10">직원</th>
                    <th className="text-center px-2 py-2.5 font-medium">총부여</th>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <th key={m} className="text-center px-2 py-2.5 font-medium">{m}월</th>)}
                    <th className="text-center px-2 py-2.5 font-medium">합계</th>
                    <th className="text-center px-2 py-2.5 font-medium">잔여</th>
                  </tr></thead>
                  <tbody>
                    {balances.map((b: any) => {
                      const approved = leaveRequests.filter((r: any) => r.status === "approved" && r.employee_id === b.employee_id);
                      const monthUsage = Array(12).fill(0);
                      approved.forEach((r: any) => {
                        const start = new Date(r.start_date);
                        if (start.getFullYear() === currentYear) {
                          monthUsage[start.getMonth()] += Number(r.days || 0);
                        }
                      });
                      const totalUsed = monthUsage.reduce((s, v) => s + v, 0);
                      const remaining = b.total_days - totalUsed;
                      return (
                        <tr key={b.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                          <td className="px-4 py-2.5 text-sm font-medium sticky left-0 bg-[var(--bg-card)]">{b.employees?.name || "—"}</td>
                          <td className="px-2 py-2.5 text-xs text-center font-semibold">{b.total_days}</td>
                          {monthUsage.map((u, i) => (
                            <td key={i} className="px-2 py-2.5 text-center">
                              {u > 0 ? <span className="text-xs font-semibold text-[var(--danger)]">{u}</span> : <span className="text-[10px] text-[var(--border)]">-</span>}
                            </td>
                          ))}
                          <td className="px-2 py-2.5 text-xs text-center font-bold text-[var(--danger)]">{totalUsed > 0 ? totalUsed : "-"}</td>
                          <td className={`px-2 py-2.5 text-xs text-center font-bold ${remaining <= 0 ? "text-[var(--danger)]" : remaining <= 3 ? "text-yellow-400" : "text-[var(--success)]"}`}>{remaining}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              </div>
            </div>
          )}

          {/* Leave Promotion (연차촉진) Section */}
          {!isEmployee && (
            <div className="leave-promotion-section">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[var(--text-muted)]">연차촉진 관리 (근로기준법 §61)</h3>
                <button
                  onClick={() => setShowPromotion(!showPromotion)}
                  className="text-xs px-3 py-1.5 bg-[var(--warning)]/10 text-[var(--warning)] rounded-lg hover:bg-[var(--warning)]/20 transition"
                >
                  {showPromotion ? "접기" : "연차촉진 관리"}
                </button>
              </div>

              {showPromotion && (
                <div className="space-y-4">
                  {/* Candidates */}
                  {promotionCandidates.length > 0 && (
                    <div className="glass-card overflow-hidden">
                      <div className="px-5 py-3 border-b border-[var(--border)] bg-yellow-500/5">
                        <span className="text-xs font-semibold text-[var(--warning)]">미사용 연차 보유 직원 ({promotionCandidates.length}명)</span>
                      </div>
                      <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
                        <thead className="sticky-bar"><tr className="table-head-row">
                          <th className="text-left px-5 py-2 font-medium">직원</th>
                          <th className="text-left px-5 py-2 font-medium">부서</th>
                          <th className="text-center px-5 py-2 font-medium">총 연차</th>
                          <th className="text-center px-5 py-2 font-medium">사용</th>
                          <th className="text-center px-5 py-2 font-medium">미사용</th>
                          <th className="text-center px-5 py-2 font-medium">촉진 통보</th>
                        </tr></thead>
                        <tbody>
                          {promotionCandidates.map((c: any) => (
                            <tr key={c.employeeId} className="border-b border-[var(--border)]/50">
                              <td className="px-5 py-2.5 text-sm font-medium">{c.employeeName}</td>
                              <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{c.department || "—"}</td>
                              <td className="px-5 py-2.5 text-sm text-center">{c.totalDays}일</td>
                              <td className="px-5 py-2.5 text-sm text-center">{c.usedDays}일</td>
                              <td className="px-5 py-2.5 text-sm text-center font-bold text-[var(--warning)]">{c.remainingDays}일</td>
                              <td className="px-5 py-2.5 text-center">
                                <div className="flex gap-1 justify-center">
                                  <button
                                    onClick={() => c.email && sendPromotion.mutate({
                                      employeeId: c.employeeId, noticeType: "first",
                                      unusedDays: c.remainingDays, email: c.email, employeeName: c.employeeName,
                                    })}
                                    disabled={!c.email || sendPromotion.isPending}
                                    className="text-[10px] px-2 py-1 rounded bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 disabled:opacity-50"
                                  >
                                    1차
                                  </button>
                                  <button
                                    onClick={() => c.email && sendPromotion.mutate({
                                      employeeId: c.employeeId, noticeType: "second",
                                      unusedDays: c.remainingDays, email: c.email, employeeName: c.employeeName,
                                    })}
                                    disabled={!c.email || sendPromotion.isPending}
                                    className="text-[10px] px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 disabled:opacity-50"
                                  >
                                    2차
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </div>
                  )}

                  {/* Sent notices history */}
                  {promotionNotices.length > 0 && (
                    <div className="glass-card overflow-hidden">
                      <div className="px-5 py-3 border-b border-[var(--border)]">
                        <span className="text-xs font-semibold text-[var(--text-muted)]">촉진 통보 이력</span>
                      </div>
                      <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[500px]">
                        <thead className="sticky-bar"><tr className="table-head-row">
                          <th className="text-left px-5 py-2 font-medium">직원</th>
                          <th className="text-center px-5 py-2 font-medium">차수</th>
                          <th className="text-center px-5 py-2 font-medium">미사용</th>
                          <th className="text-left px-5 py-2 font-medium">발송일</th>
                          <th className="text-left px-5 py-2 font-medium">기한</th>
                        </tr></thead>
                        <tbody>
                          {promotionNotices.map((n: any) => (
                            <tr key={n.id} className="border-b border-[var(--border)]/50">
                              <td className="px-5 py-2.5 text-sm">{n.employees?.name || "—"}</td>
                              <td className="px-5 py-2.5 text-center">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${n.notice_type === 'first' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
                                  {n.notice_type === "first" ? "1차" : "2차"}
                                </span>
                              </td>
                              <td className="px-5 py-2.5 text-sm text-center">{Number(n.unused_days)}일</td>
                              <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{n.sent_at ? kstDateStr(new Date(n.sent_at)) : "—"}</td>
                              <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{n.deadline || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </div>
                  )}

                  {promotionCandidates.length === 0 && (
                    <div className="glass-card p-8 text-center">
                      <div className="text-sm text-[var(--text-muted)]">모든 직원이 연차를 전부 사용했습니다</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
            </div>
          </div>
        </div>
      )}

      {/* 이름 클릭 — 그 구성원의 전체 연차 신청 내역. 관리자는 여기서 바로 휴가를 등록할 수 있다. */}
      {rosterEmp && (
        <div className="leave-modal-backdrop" onClick={() => setRosterEmp(null)}>
          <div className="leave-modal" onClick={(e) => e.stopPropagation()}>
            <div className="leave-modal-head">
              <h3 className="text-sm font-bold">{rosterEmp.name} · 연차 신청 내역</h3>
              <button onClick={() => setRosterEmp(null)} className="leave-modal-close">✕</button>
            </div>
            <div className="leave-modal-body">
              {!isEmployee && (
                <button
                  onClick={() => {
                    setForm((prev: any) => ({ ...prev, employeeId: rosterEmp.id }));
                    setRosterEmp(null);
                    setShowForm(true);
                  }}
                  className="btn-primary btn-sm mb-3"
                >
                  이 구성원 휴가 등록
                </button>
              )}
              {rosterEmpRequests.length === 0 ? (
                <div className="templates-empty">신청 내역이 없습니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {rosterEmpRequests.map((r: any) => (
                    <div key={r.id} className="leave-modal-row">
                      <div>
                        <div className="text-xs font-semibold">{leaveTypeLabel(r.leave_type)} · {r.days}일</div>
                        <div className="caption">
                          {r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold">
                        {LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS]?.label || r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 월 셀 클릭 — 그 달 사용 날짜·승인 내역 */}
      {rosterMonth && (
        <div className="leave-modal-backdrop" onClick={() => setRosterMonth(null)}>
          <div className="leave-modal" onClick={(e) => e.stopPropagation()}>
            <div className="leave-modal-head">
              <h3 className="text-sm font-bold">{rosterMonth.name} · {currentYear}년 {rosterMonth.month + 1}월 사용 내역</h3>
              <button onClick={() => setRosterMonth(null)} className="leave-modal-close">✕</button>
            </div>
            <div className="leave-modal-body">
              {rosterMonthRequests.length === 0 ? (
                <div className="templates-empty">이 달 사용 내역이 없습니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {rosterMonthRequests.map((r: any) => (
                    <div key={r.id} className="leave-modal-row">
                      <div>
                        <div className="text-xs font-semibold">
                          {r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""} · {r.days}일
                        </div>
                        <div className="caption">{leaveTypeLabel(r.leave_type)}</div>
                      </div>
                      <span className="text-[11px] font-semibold text-[var(--success)]">
                        {r.approved_at ? `${kstDateStr(new Date(r.approved_at))} 승인` : "승인"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Certificate Tab ──
function CertificateTab({ employees, companyId, userId, queryClient }: any) {
  const { toast } = useToast();
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [certType, setCertType] = useState<"employment" | "career">("employment");
  const [purpose, setPurpose] = useState("");
  const [submitTo, setSubmitTo] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const db = supabase;

  // Certificate logs query
  const { data: certLogs = [] } = useQuery({
    queryKey: ["certificate-logs", companyId],
    queryFn: () => getCertificateLogs(companyId),
    enabled: !!companyId,
  });

  // Company info query
  const { data: companyInfo } = useQuery({
    queryKey: ["company-info", companyId],
    queryFn: async () => {
      const data = logRead('employees/page:data', await db.from("companies").select("*").eq("id", companyId).maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const activeEmployees = employees.filter((e: any) => ["active", "joined"].includes(e.status));
  const allEmployees = employees;

  const CERT_TYPES = [
    { value: "employment", label: "재직증명서" },
    { value: "career", label: "경력증명서" },
  ];

  const handleIssue = async () => {
    if (!selectedEmpId || !companyId || !userId) return;

    const employee = allEmployees.find((e: any) => e.id === selectedEmpId);
    if (!employee) return;

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
        name: companyInfo?.name || "",
        representative: companyInfo?.representative ?? undefined,
        address: companyInfo?.address ?? undefined,
        business_number: companyInfo?.business_number ?? undefined,
        seal_url: companyInfo?.seal_url ?? undefined,
      };

      let result;
      if (certType === "employment") {
        result = await generateEmploymentCertificate({
          employee: empData,
          company: companyData,
          purpose: purpose || undefined,
          submitTo: submitTo || undefined,
        });
      } else {
        result = await generateCareerCertificate({
          employee: empData,
          company: companyData,
          purpose: purpose || undefined,
          submitTo: submitTo || undefined,
        });
      }

      // Download the PDF
      const url = URL.createObjectURL(result.pdf);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${certType === "employment" ? "재직증명서" : "경력증명서"}_${employee.name}_${result.certificateNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      // Save log
      await saveCertificateLog({
        companyId,
        employeeId: selectedEmpId,
        certificateType: certType === "employment" ? "재직증명서" : "경력증명서",
        certificateNumber: result.certificateNumber,
        issuedBy: userId,
        purpose: purpose || undefined,
        submitTo: submitTo || undefined,
      });

      queryClient.invalidateQueries({ queryKey: ["certificate-logs"] });
      setPurpose("");
      setSubmitTo("");
      toast(`증명서가 발급되었습니다.\n증명서번호: ${result.certificateNumber}`, "success");
    } catch (err: any) {
      toast("증명서 발급 실패: " + (err?.message || err), "error");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div>
      {/* Issue Form — 실제 증명서 발급(최상단, 2026-06-29 순서 조정) */}
      <div className="certificate-issue-form glass-card">
        <h3 className="section-title">증명서 발급</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">직원 선택 *</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="field-input"
            >
              <option value="">직원을 선택하세요</option>
              {allEmployees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.department || "미배정"}) {!["active", "joined"].includes(e.status) ? "[퇴직]" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">증명서 유형 *</label>
            <select
              value={certType}
              onChange={(e) => setCertType(e.target.value as "employment" | "career")}
              className="field-input"
            >
              {CERT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <CertChoiceField label="용도" options={CERT_PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} />
          <CertChoiceField label="제출처" options={CERT_SUBMIT_TO_OPTIONS} value={submitTo} onChange={setSubmitTo} />
          <div className="flex items-end">
            <button
              onClick={handleIssue}
              disabled={!selectedEmpId || isGenerating}
              className="w-full btn-primary"
            >
              {isGenerating ? "발급 중..." : "발급"}
            </button>
          </div>
        </div>
      </div>

      {/* Certificate Logs */}
      <div className="certificate-log-table glass-card">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-muted)]">발급 이력</span>
        </div>
        {certLogs.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4"><Ico e="📜" /></div>
            <div className="text-sm text-[var(--text-muted)]">발급된 증명서가 없습니다</div>
            <div className="text-xs text-[var(--text-dim)] mt-1">직원을 선택하고 증명서를 발급하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
            <thead>
              <tr className="table-head-row">
                <th className="th-cell text-left">증명서번호</th>
                <th className="th-cell text-left">유형</th>
                <th className="th-cell text-left">직원</th>
                <th className="th-cell text-left">소속/직위</th>
                <th className="th-cell text-left">용도</th>
                <th className="th-cell text-left">발급자</th>
                <th className="th-cell text-left">발급일</th>
              </tr>
            </thead>
            <tbody>
              {certLogs.map((log: any) => (
                <tr key={log.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-xs font-mono text-[var(--primary)]">{log.certificate_number}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      log.certificate_type === "재직증명서"
                        ? "bg-[var(--info)]/10 text-[var(--info)]"
                        : "bg-purple-500/10 text-purple-400"
                    }`}>
                      {log.certificate_type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm font-medium">{log.employees?.name || "--"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                    {log.employees?.department || "--"} / {log.employees?.position || "--"}
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{log.purpose || "--"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{log.issuer?.name || log.issuer?.email || "--"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                    {log.created_at ? kstDateStr(new Date(log.created_at)) : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* 연말정산 간소화 자료 수집 — 증명서 발급/이력 아래로 이동(2026-06-29) */}
      <div className="mt-6">
        <YearEndTaxSection employees={activeEmployees} companyId={companyId} />
      </div>
    </div>
  );
}

// ── 연말정산 간소화 자료 수집 ──
function YearEndTaxSection({ employees, companyId }: { employees: any[]; companyId: string | null }) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const storageKey = companyId ? `yet:${companyId}:${year}` : "";

  type Status = "pending" | "submitted" | "reviewed";
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      setStatuses(raw ? JSON.parse(raw) : {});
    } catch { setStatuses({}); }
  }, [storageKey]);

  const persist = (next: Record<string, Status>) => {
    setStatuses(next);
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
    }
  };

  const setStatus = (id: string, s: Status) => persist({ ...statuses, [id]: s });

  const counts = useMemo(() => {
    const c = { pending: 0, submitted: 0, reviewed: 0 };
    employees.forEach((e: any) => {
      const s = statuses[e.id] || "pending";
      c[s] += 1;
    });
    return c;
  }, [employees, statuses]);

  const total = employees.length || 1;
  const completedPct = Math.round(((counts.submitted + counts.reviewed) / total) * 100);

  const sendReminderToAll = () => {
    const subject = encodeURIComponent(`[연말정산] ${year}년 간소화 자료 제출 안내`);
    const body = encodeURIComponent(
      `안녕하세요.\n\n${year}년 연말정산 간소화 자료 제출 기간입니다.\n\n` +
      `1) 홈택스 (https://www.hometax.go.kr) 접속 → 장려금·연말정산·전자기부금 → 연말정산 간소화\n` +
      `2) 본인 인증 후 PDF 일괄 다운로드\n` +
      `3) 부양가족 자료가 있는 경우 별도 동의 후 추가 다운로드\n` +
      `4) 의료비/기부금/월세 등 별도 영수증이 있다면 함께 첨부\n\n` +
      `회신: 회사 메일로 PDF 첨부 후 회신 부탁드립니다.\n\n감사합니다.`
    );
    const emails = employees.map((e: any) => e.email).filter(Boolean).join(",");
    if (!emails) {
      toast("등록된 이메일이 있는 직원이 없습니다", "error");
      return;
    }
    window.location.href = `mailto:${emails}?subject=${subject}&body=${body}`;
  };

  const STATUS_META: Record<Status, { label: string; bg: string; text: string }> = {
    pending: { label: "미제출", bg: "bg-[var(--danger)]/10", text: "text-[var(--danger)]" },
    submitted: { label: "제출완료", bg: "bg-[var(--info)]/10", text: "text-[var(--info)]" },
    reviewed: { label: "검토완료", bg: "bg-[var(--success)]/10", text: "text-[var(--success)]" },
  };

  return (
    <div className="certificate-yeartax-panel glass-card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Ico e="🧾" /> 연말정산 간소화 자료 수집
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">{year}년</span>
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">홈택스 간소화 자료 제출 현황을 직원별로 추적합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => <option key={y} value={y}>{y}년 귀속</option>)}
          </select>
          <a href="https://www.hometax.go.kr" target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition">
            홈택스 열기 ↗
          </a>
          <button onClick={sendReminderToAll} className="px-3 py-2 bg-[var(--warning)]/10 hover:bg-[var(--warning)]/20 text-[var(--warning)] rounded-xl text-xs font-semibold transition border border-[var(--warning)]/30">
            전체 안내 발송
          </button>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="yeartax-progress-bar">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-[var(--text-muted)]">제출 진행률</span>
          <span className="font-bold">{counts.submitted + counts.reviewed} / {employees.length}명 ({completedPct}%)</span>
        </div>
        <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden flex">
          <div className="bg-[var(--info)]" style={{ width: `${(counts.submitted / total) * 100}%` }} />
          <div className="bg-[var(--success)]" style={{ width: `${(counts.reviewed / total) * 100}%` }} />
        </div>
        <div className="flex gap-4 mt-2 text-[10px]">
          <span className="text-[var(--danger)]">미제출 {counts.pending}명</span>
          <span className="text-[var(--info)]">제출완료 {counts.submitted}명</span>
          <span className="text-[var(--success)]">검토완료 {counts.reviewed}명</span>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="text-center py-8 text-xs text-[var(--text-dim)]">재직 중인 직원이 없습니다</div>
      ) : (
        <div className="yeartax-status-table">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-3 py-2 font-medium">직원</th>
                <th className="text-left px-3 py-2 font-medium">이메일</th>
                <th className="text-center px-3 py-2 font-medium">상태</th>
                <th className="text-right px-3 py-2 font-medium">상태 변경</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e: any) => {
                const s = statuses[e.id] || "pending";
                const meta = STATUS_META[s];
                return (
                  <tr key={e.id} className="border-b border-[var(--border)]/50">
                    <td className="px-3 py-2 text-sm">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-[10px] text-[var(--text-dim)] ml-2">{e.department || ""}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{e.email || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {(["pending", "submitted", "reviewed"] as Status[]).map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setStatus(e.id, opt)}
                            className={`text-[10px] px-2 py-1 rounded-md transition ${s === opt ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg)]"}`}
                          >
                            {STATUS_META[opt].label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]/50">
        <div className="text-[10px] font-semibold text-[var(--text-muted)] mb-1.5"><Ico e="📌" /> 안내</div>
        <ul className="text-[11px] text-[var(--text-muted)] leading-relaxed space-y-0.5">
          <li>• 홈택스 일정: 매년 1월 15일부터 간소화 자료 일괄제공</li>
          <li>• 부양가족 자료는 부양가족 본인이 자료제공 동의 후 조회 가능</li>
          <li>• 의료비/기부금/월세 등은 간소화에 누락될 수 있어 별도 영수증 수집 권장</li>
        </ul>
      </div>
    </div>
  );
}
