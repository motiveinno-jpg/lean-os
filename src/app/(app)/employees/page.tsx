"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { friendlyError } from "@/lib/friendly-error";
import { SiyanStatCard } from "@/components/siyan";
import {
  getSalaryHistory, addSalaryRecord, getActiveContracts,
  // Attendance & Leave
  checkIn, checkOut, cancelCheckOut, getAttendanceRecords, getMonthlyAttendanceSummary,
  recomputeAttendance,
  calculateWeeklyHours,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  getLeaveBalances, initLeaveBalance, correctAttendanceRecord,
  autoInitLeaveBalance, bulkAutoInitLeaveBalances, calculateAnnualLeave,
  cancelLeaveRequest,
  getLeaveGrantMethod, setLeaveGrantMethod, type LeaveGrantMethod,
  LEAVE_TYPES, LEAVE_UNITS, ATTENDANCE_STATUS, LEAVE_REQUEST_STATUS,
  // Leave Promotion
  getLeavePromotionCandidates, sendLeavePromotionNotice, getLeavePromotionNotices,
} from "@/lib/hr";
import { ContractTab } from "./_components/ContractTab";
import { EmployeeDetailPanel } from "./_components/EmployeeDetailPanel";
import { MemberRoleManager } from "./_components/MemberRoleManager";
import {
  getExpenseRequests, createExpenseRequest, approveExpense, rejectExpense,
  markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS,
} from "@/lib/expenses";
import { getSignedUrl } from "@/lib/file-storage";
import { previewPayroll } from "@/lib/payroll";
import { generateInsuranceEDI, downloadEDIFile } from "@/lib/insurance-edi";
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { generateEmploymentCertificate, generateCareerCertificate, getCertificateLogs, saveCertificateLog } from "@/lib/certificates";
import { type PayrollItem } from "@/lib/payment-batch";
import { createEmployeeInvitation, getEmployeeInvitations, getInviteUrl, sendInviteEmail, cancelEmployeeInvitation, resendEmployeeInvitationByEmail, addExistingMemberAsEmployee } from "@/lib/invitations";
import {
  AttendanceEditRequestDialog,
  EditRequestInbox,
  MonthlyRecomputeButton,
} from "@/components/hr-attendance-extras";
import { AttendanceBadges } from "@/components/attendance-badges";
import AllowanceAdminTab from "@/components/hr-allowance-admin";
import { FlexPeopleDirectory } from "@/components/flex-people-directory";
import { PayrollHero, ContractsHero, ExpensesHero, LeaveHero, CertificatesHero } from "@/components/flex-hr-heroes";
// recomputeMonthlyAllowancesForCompany 자동 호출은 504 인시던트 3차 (2026-05-21) 후 제거됨.
//   수동 트리거 (MonthlyRecomputeButton / AllowanceAdminTab "월 일괄 재계산") 만 유지.

type Tab = "employees" | "salary" | "payroll" | "contracts" | "expenses" | "leave" | "certificates";

// Employee 역할은 자기 관련 탭만 접근 가능
// 근태 관리는 /attendance 별도 페이지로 분리됨. employees 페이지엔 휴가/경비/증명서만.
const EMPLOYEE_ROLE_TABS: Tab[] = ["leave", "expenses", "certificates"];

export default function EmployeesPage() {
  const { toast } = useToast();
  const { user, role, loading: userLoading } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const sp = useSearchParams();
  const urlTab = sp?.get('tab') as Tab | null;
  const isValidTab = (t: string | null): t is Tab =>
    !!t && (['employees','salary','payroll','contracts','expenses','leave','certificates'] as const).includes(t as Tab);
  // V1: '급여이력' 완전 제거. '급여' 탭 = 급여 명세(PayrollPreviewTab)만.
  //   ?tab=salary / ?tab=payroll 딥링크 모두 '급여' 탭(명세)으로 정규화.
  const normalizeTab = (t: Tab): Tab => (t === "payroll" ? "salary" : t);
  const [tab, setTab] = useState<Tab>(isValidTab(urlTab) ? normalizeTab(urlTab) : "employees");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const isEmployee = role === "employee";

  // URL ?tab=... 동기화. payroll/salary → '급여' 탭(명세).
  useEffect(() => {
    if (!isValidTab(urlTab)) return;
    setTab(normalizeTab(urlTab));
  }, [urlTab]);

  // S-1(보안): 직원 비허용 탭 차단은 아래 effectiveTab 렌더 가드가 본 경계다.
  //   이 useEffect 단독(사후 setTab)이면 한 프레임 SalaryTab/PayrollPreviewTab
  //   가 마운트돼 회사 전체 급여 쿼리가 발사될 수 있어, 상태/하이라이트 동기화
  //   보조용으로만 둔다(/employees 는 직원 딥링크 fallback 허용 라우트).
  useEffect(() => {
    if (isEmployee && !EMPLOYEE_ROLE_TABS.includes(tab)) {
      setTab("leave");
    }
  }, [isEmployee, tab]);

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
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId!)
        .order("created_at");
      return data || [];
    },
    enabled: !!companyId,
  });

  // V1: 급여이력(SalaryTab/salary-history) 제거 — '급여' 탭은 명세만.

  // 플렉스 스타일: 인력관리 탭 = [디렉토리](카드·프로필 패널) 기본 / [관리·수정](기존 EmployeeTab) 토글
  const [empView, setEmpView] = useState<"dir" | "manage">("dir");

  // ── Contracts ──
  const { data: contracts = [] } = useQuery({
    queryKey: ["contracts", companyId],
    queryFn: () => getActiveContracts(companyId!),
    enabled: !!companyId && tab === "contracts",
  });

  // ── Expenses ──
  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", companyId],
    queryFn: () => getExpenseRequests(companyId!),
    enabled: !!companyId && tab === "expenses",
  });

  const totalSalary = employees.reduce((s: number, e: any) => s + Number(e.salary || 0), 0);
  const totalRetirement = employees.reduce((s: number, e: any) => s + Number(e.retirement_accrual || 0), 0);
  const activeCount = employees.filter((e: any) => ["active", "joined"].includes(e.status)).length;

  // P1-3: salary/payroll 두 키 → '급여' 단일. 명세는 탭 내부 서브뷰.
  const allTabs: { key: Tab; label: string; count?: number }[] = [
    { key: "employees", label: "인력관리", count: activeCount },
    { key: "salary", label: "급여" },
    { key: "contracts", label: "계약서" },
    { key: "expenses", label: "경비청구", count: expenses.filter((e: any) => e.status === "pending").length },
    { key: "leave", label: "휴가" },
    { key: "certificates", label: "증명서 발급" },
  ];
  const tabs = isEmployee ? allTabs.filter(t => EMPLOYEE_ROLE_TABS.includes(t.key)) : allTabs;
  // S-1: 렌더 경계 — 직원 비허용 탭은 어떤 경로(딥링크 초기 state 포함)로도
  //   해당 Tab 컴포넌트를 마운트하지 않는다(useEffect 사후 리셋 이전 프레임 차단).
  const effectiveTab: Tab = isEmployee && !EMPLOYEE_ROLE_TABS.includes(tab) ? "leave" : tab;

  if (userLoading || mainLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">회사 정보를 불러올 수 없습니다. 새로고침 해주세요.</div>;

  // P2: 페이지-국소 인쇄 CSS 제거 → globals.css 공통 .print-area 유틸 사용.
  //     폭은 공통 토큰(--content-max-wide)으로 통일.
  return (
    <div className="print-area" id="employees-print-area">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="page-sticky-header flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">{isEmployee ? "근태 / 급여" : "인사관리"}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{isEmployee ? "출퇴근 + 휴가 + 경비 + 증명서" : "직원관리 · 급여 · 계약서 · 경비 · 휴가 · 증명서"}</p>
        </div>
      </div>

      {/* Summary — Employee 역할에게는 급여/인원/퇴직충당금 숨김 */}
      {!isEmployee && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <div className="glass-card p-4">
            <div className="text-xs text-[var(--text-dim)]">재직 인원</div>
            <div className="text-lg font-bold mt-1">{activeCount}명</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-xs text-[var(--text-dim)]">연 인건비</div>
            <div className="text-lg font-bold mono-number text-[var(--danger)] mt-1">₩{(totalSalary * 12).toLocaleString()}</div>
            <div className="text-[10px] text-[var(--text-dim)] mono-number mt-0.5">월 ₩{totalSalary.toLocaleString()}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-xs text-[var(--text-dim)]">퇴직충당금</div>
            <div className="text-lg font-bold mono-number text-[var(--warning)] mt-1">₩{totalRetirement.toLocaleString()}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-xs text-[var(--text-dim)]">미결 경비</div>
            <div className="text-lg font-bold text-[var(--warning)] mt-1">
              {expenses.filter((e: any) => e.status === "pending").length}건
            </div>
          </div>
        </div>
      )}

      {/* Tabs — horizontally scrollable on mobile */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border)] overflow-x-auto scrollbar-hide">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-3 py-2.5 rounded-lg text-sm font-semibold transition shrink-0 ${
              effectiveTab === t.key
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/20">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content — S-1: effectiveTab 으로 직원 비허용 탭 컴포넌트 미마운트 */}
      {/* 플렉스 스타일(2026-06-12): 디렉토리(카드 그리드+프로필 슬라이드) 기본, 추가/수정은 관리 모드 */}
      {effectiveTab === "employees" && (
        <>
          <div className="mb-4 inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-1 gap-1">
            {([["dir", "👥 디렉토리"], ["manage", "⚙️ 관리 · 추가/수정"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setEmpView(k)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition ${empView === k ? "text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
                style={empView === k ? { background: "#6C5CE7" } : undefined}>
                {l}
              </button>
            ))}
          </div>
          {empView === "dir" ? (
            <FlexPeopleDirectory companyId={companyId} employees={employees} isManager={!isEmployee} />
          ) : (
            <EmployeeTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} />
          )}
        </>
      )}

      {/* P1-3: 급여 = 이력 ↔ 명세 서브뷰 단일 탭 */}
      {/* V1: '급여이력' 세그먼트 제거 — 급여 탭은 명세만 (이력 진입 0) */}
      {/* 플렉스 스타일(2026-06-12): 세부탭마다 모듈 히어로(실데이터 지표 칩) + flex-skin (탭 본체 무수정) */}
      {effectiveTab === "salary" && (
        <>
          {!isEmployee && <PayrollHero employees={employees} />}
          <div className="flex-skin"><PayrollPreviewTab companyId={companyId} /></div>
        </>
      )}

      {effectiveTab === "contracts" && (
        <>
          <ContractsHero contracts={contracts} />
          <div className="flex-skin"><ContractTab employees={employees} contracts={contracts} companyId={companyId} queryClient={queryClient} /></div>
        </>
      )}
      {effectiveTab === "expenses" && (
        <>
          <ExpensesHero expenses={expenses} />
          <div className="flex-skin"><ExpenseTab expenses={expenses} companyId={companyId} userId={userId} queryClient={queryClient} isEmployee={isEmployee} /></div>
        </>
      )}
      {/* 휴가 — 2026-06-12: 페이지 이탈(/leave 리다이렉트) 대신 다른 탭처럼 인라인 렌더.
          LeaveTab 은 공유 컴포넌트(단일 소스) — /leave 페이지는 직원 사이드바 진입점으로 유지. */}
      {effectiveTab === "leave" && (
        <>
          <LeaveHero companyId={companyId} />
          <div className="flex-skin">
            <LeaveTab
              employees={employees}
              companyId={companyId}
              userId={userId}
              queryClient={queryClient}
              isEmployee={isEmployee}
              autoNew={false}
            />
          </div>
        </>
      )}
      {effectiveTab === "certificates" && (
        <>
          <CertificatesHero companyId={companyId} />
          <div className="flex-skin"><CertificateTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} /></div>
        </>
      )}
    </div>
  );
}

// ── Employee Tab (초대 기반 통합) ──
const EMP_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  invited: { label: "초대중", bg: "bg-amber-500/10", text: "text-amber-500" },
  joined: { label: "가입완료", bg: "bg-blue-500/10", text: "text-blue-400" },
  contract_pending: { label: "계약대기", bg: "bg-purple-500/10", text: "text-purple-400" },
  active: { label: "재직", bg: "bg-green-500/10", text: "text-green-400" },
  inactive: { label: "퇴직", bg: "bg-gray-500/10", text: "text-gray-400" },
  resigned: { label: "퇴사", bg: "bg-gray-500/10", text: "text-gray-400" },
};

function EmployeeTab({ employees, companyId, userId, queryClient }: any) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "employee" as "employee" | "admin", department: "", position: "", salary: "", hireDate: "" });
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  // 이미 가입한 회원을 초대 없이 바로 추가하는 모드
  const [addExisting, setAddExisting] = useState(false);
  const [detailEmpId, setDetailEmpId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "orgchart">("list");

  const currentYear = new Date().getFullYear();

  // 잔여연차 조회
  const { data: leaveBalancesForList = [] } = useQuery({
    queryKey: ["leave-balances-list", companyId, currentYear],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("leave_balances")
        .select("employee_id, total_days, used_days, remaining_days")
        .eq("company_id", companyId)
        .eq("year", currentYear);
      return data || [];
    },
    enabled: !!companyId,
  });

  const leaveBalanceMap: Record<string, number> = {};
  leaveBalancesForList.forEach((b: any) => {
    leaveBalanceMap[b.employee_id] = b.remaining_days ?? (Number(b.total_days || 0) - Number(b.used_days || 0));
  });

  // 초대 목록
  const { data: invitations = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId!),
    enabled: !!companyId,
  });

  // 회사명 + EDI용 회사정보 (이메일 발송용)
  const { data: companyData } = useQuery({
    queryKey: ["company-name", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name, representative, address, business_number").eq("id", companyId!).maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

  // 4대보험 취득신고 EDI state
  const [showAcqEdi, setShowAcqEdi] = useState(false);
  const [acqEdiData, setAcqEdiData] = useState<{ name: string; department: string; position: string; salary: string } | null>(null);
  const [acqEdiGenerated, setAcqEdiGenerated] = useState(false);

  // 직원 초대 mutation
  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("인증 필요");
      const trimmedEmail = form.email.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error("올바른 이메일 주소를 입력해주세요.");
      if (!form.department?.trim()) throw new Error("부서를 입력해주세요.");
      // 1. 초대 레코드 생성
      const invitation = await createEmployeeInvitation({
        companyId, email: form.email, name: form.name || undefined,
        role: form.role, invitedBy: userId,
      });
      // 2. employees 테이블에도 추가 (user_id=null, status=invited)
      await supabase.from("employees").insert({
        company_id: companyId,
        name: form.name || form.email.split("@")[0],
        email: form.email,
        department: form.department || null,
        position: form.position || null,
        salary: Math.round((Number(form.salary) || 0) / 12),
        hire_date: form.hireDate || new Date().toISOString().slice(0, 10),
        status: "invited",
      });
      return invitation;
    },
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      // 이메일 발송
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
      // 4대보험 취득신고 EDI 생성 안내
      setAcqEdiData({ name: form.name || form.email.split("@")[0], department: form.department, position: form.position, salary: form.salary });
      setShowAcqEdi(true);
      setAcqEdiGenerated(false);
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

  // 이미 가입한 회원 → 바로 직원 추가 (초대 없이). 회원 소속이 우리 회사로 전환됨.
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

  // 초대 취소
  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelEmployeeInvitation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-invitations"] }),
    onError: (err: any) => toast("초대 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 직원 삭제 (중복/초대 정리용)
  const deleteMut = useMutation({
    mutationFn: async (empId: string) => {
      const emp = employees.find((e: any) => e.id === empId);
      if (!emp) throw new Error("직원을 찾을 수 없습니다");
      if (["active", "joined"].includes(emp.status)) throw new Error("재직 중인 직원은 삭제할 수 없습니다");
      if (emp.email) {
        await supabase.from("employee_invitations").delete().eq("email", emp.email).eq("company_id", companyId);
      }
      const { error } = await supabase.from("employees").delete().eq("id", empId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees", companyId] });
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      setInviteMsg({ ok: true, msg: "삭제 완료" });
      setTimeout(() => setInviteMsg(null), 3000);
    },
    onError: (err: any) => {
      setInviteMsg({ ok: false, msg: err.message || "삭제 실패" });
      setTimeout(() => setInviteMsg(null), 4000);
    },
  });

  // 초대 링크 복사
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  function copyLink(token: string) {
    navigator.clipboard.writeText(getInviteUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  // 초대 이메일 재발송
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

  // 대기중인 초대 (아직 수락 안 한 건)
  const pendingInvites = invitations.filter((i: any) => i.status === "pending");

  return (
    <div>
      {/* 상단 버튼 + 알림 */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-[var(--text-dim)]">
          {pendingInvites.length > 0 && <span className="text-amber-500 font-semibold">초대 대기 {pendingInvites.length}명</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">+ 직원 초대</button>
        </div>
      </div>

      {inviteMsg && (
        <div className={`mb-4 p-3 rounded-xl text-sm font-medium ${inviteMsg.ok ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
          {inviteMsg.msg}
        </div>
      )}

      {/* 4대보험 취득신고 EDI 생성 패널 */}
      {showAcqEdi && acqEdiData && (
        <div className="mb-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-blue-400 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                4대보험 취득신고 EDI 생성
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">신규 직원 <span className="font-semibold text-[var(--text)]">{acqEdiData.name}</span>의 4대보험 취득신고 EDI 파일을 생성합니다.</p>
            </div>
            <button onClick={() => { setShowAcqEdi(false); setAcqEdiData(null); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-[10px]">
            <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border)]"><span className="text-[var(--text-dim)]">국민연금</span></div>
            <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border)]"><span className="text-[var(--text-dim)]">건강보험</span></div>
            <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border)]"><span className="text-[var(--text-dim)]">고용보험</span></div>
            <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border)]"><span className="text-[var(--text-dim)]">산재보험</span></div>
          </div>
          {acqEdiGenerated ? (
            <div className="text-xs text-green-400 font-medium text-center py-2">EDI 파일 4건 다운로드 완료</div>
          ) : (
            <button
              onClick={() => {
                if (!companyData) return;
                const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                const results = generateInsuranceEDI({
                  company: {
                    companyName: companyData.name || "",
                    businessNumber: companyData.business_number || "",
                    representativeName: companyData.representative || "",
                    address: companyData.address || "",
                  },
                  employees: [{
                    name: acqEdiData.name,
                    residentNumber: "000000-0000000",
                    joinDate: today,
                    monthlySalary: Math.round((Number(acqEdiData.salary) || 0) / 12),
                    department: acqEdiData.department || "",
                    position: acqEdiData.position || "",
                  }],
                  reportType: "acquisition",
                  reportDate: today,
                });
                results.forEach((r) => downloadEDIFile(r));
                setAcqEdiGenerated(true);
              }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition"
            >
              EDI 파일 생성 (4건 다운로드)
            </button>
          )}
        </div>
      )}

      {/* 초대 폼 */}
      {showForm && (
        <div className="glass-card p-6 mb-6">
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
              <label className="block text-xs text-[var(--text-muted)] mb-1">역할</label>
              <div className="flex gap-2">
                <button onClick={() => setForm({...form, role: "employee"})} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition ${form.role === "employee" ? "bg-green-600 text-white border-green-600" : "text-[var(--text-muted)] border-[var(--border)]"}`}>직원</button>
                <button onClick={() => setForm({...form, role: "admin"})} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition ${form.role === "admin" ? "bg-blue-600 text-white border-blue-600" : "text-[var(--text-muted)] border-[var(--border)]"}`}>관리자</button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">부서</label><input value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">직위</label><input value={form.position} onChange={e => setForm({...form, position: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">입사일</label><input type="date" value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} className="field-input" />{!form.hireDate && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">비워두면 오늘 날짜로 설정됩니다</p>}</div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">연봉</label><input type="text" inputMode="numeric" value={form.salary ? Number(form.salary).toLocaleString('ko-KR') : ''} onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setForm({...form, salary: raw}); }} placeholder="36,000,000" className="field-input" />{form.salary && Number(form.salary) > 0 && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">월 ₩{Math.round(Number(form.salary) / 12).toLocaleString('ko-KR')}</p>}</div>
            <div className="flex items-end gap-2">
              {addExisting ? (
                <button onClick={() => form.email.trim() && addExistingMut.mutate()} disabled={!form.email.trim() || addExistingMut.isPending} className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {addExistingMut.isPending ? "추가중..." : "직원으로 추가"}
                </button>
              ) : (
                <button onClick={() => form.email.trim() && inviteMut.mutate()} disabled={!form.email.trim() || inviteMut.isPending} className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {inviteMut.isPending ? "전송중..." : "초대 전송"}
                </button>
              )}
              <button onClick={() => setShowForm(false)} className="px-3 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
          {addExisting ? (
            <p className="text-[10px] text-amber-500">이미 가입한 회원의 이메일로 바로 추가합니다. <b>해당 회원의 계정 소속이 우리 회사로 변경되고 직원 권한이 됩니다.</b> (초대 이메일 없이 즉시 적용)</p>
          ) : (
            <p className="caption">초대 이메일이 발송되며, 직원이 가입 후 계약서 서명까지 완료하면 급여가 자동 반영됩니다.</p>
          )}
        </div>
      )}

      {/* 대기중 초대 목록 */}
      {pendingInvites.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-bold text-[var(--text-muted)] mb-2">초대 대기중</h4>
          <div className="space-y-2">
            {pendingInvites.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <div>
                  <div className="text-sm font-medium">{inv.name || inv.email}</div>
                  <div className="text-xs text-[var(--text-dim)]">{inv.email} · {inv.role === "admin" ? "관리자" : "직원"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => resend(inv)} disabled={resending === inv.invite_token} className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50">
                    {resending === inv.invite_token ? "발송중..." : "재발송"}
                  </button>
                  <button onClick={() => copyLink(inv.invite_token)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)]">
                    {copiedToken === inv.invite_token ? "복사됨!" : "링크"}
                  </button>
                  <button onClick={() => cancelMut.mutate(inv.id)} className="text-xs text-red-400/60 hover:text-red-400">취소</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 뷰 전환: 목록 / 조직도 */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setViewMode("list")} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${viewMode === "list" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"}`}>
          <svg className="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>목록
        </button>
        <button onClick={() => setViewMode("orgchart")} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${viewMode === "orgchart" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"}`}>
          <svg className="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>조직도
        </button>
      </div>

      {viewMode === "orgchart" ? (
        /* ── 조직도 뷰 (SVG 트리) ── */
        <OrgChartSVG employees={employees} onSelect={setDetailEmpId} />
      ) : (
      /* ── 직원 목록 뷰 ── */
      <div className="glass-card overflow-hidden">
        {employees.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">👥</div><div className="text-sm font-medium text-[var(--text)]">직원을 등록하면 급여 자동계산, 4대보험이 시작됩니다</div><div className="text-xs text-[var(--text-muted)] mt-1">근태, 휴가, 증명서 발급까지 한번에 관리하세요</div><button onClick={() => setShowForm(true)} className="mt-4 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90">+ 직원 등록</button></div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
            <thead className="sticky-bar"><tr className="table-head-row">
              <th className="th-cell text-left">이름</th>
              <th className="th-cell text-left">부서</th>
              <th className="th-cell text-left">직위</th>
              <th className="th-cell text-right">연봉</th>
              <th className="th-cell text-left">입사일</th>
              <th className="th-cell text-center">잔여연차</th>
              <th className="th-cell text-right">퇴직충당금</th>
              <th className="th-cell text-center">상태</th>
              <th className="px-3 py-3 font-medium w-10"></th>
            </tr></thead>
            <tbody>
              {employees.map((e: any) => {
                const st = EMP_STATUS[e.status] || EMP_STATUS.active;
                return (
                  <tr key={e.id} onClick={() => setDetailEmpId(detailEmpId === e.id ? null : e.id)} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] cursor-pointer">
                    <td className="px-5 py-3 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        {e.name}
                        {e.onboarding_completed_at ? null : e.status !== "active" && e.status !== "inactive" && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded-full">온보딩 미완료</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.department || "—"}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.position || "—"}</td>
                    <td className="px-5 py-3 text-sm text-right">{Number(e.salary) > 0 ? `₩${(Number(e.salary) * 12).toLocaleString()}` : "—"}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.hire_date || "—"}</td>
                    <td className="px-5 py-3 text-center">
                      {leaveBalanceMap[e.id] !== undefined ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          leaveBalanceMap[e.id] <= 0 ? "bg-red-500/10 text-red-400"
                            : leaveBalanceMap[e.id] <= 3 ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-green-500/10 text-green-400"
                        }`}>
                          {leaveBalanceMap[e.id]}일{leaveBalanceMap[e.id] <= 0 ? " (소진)" : leaveBalanceMap[e.id] <= 3 ? " (임박)" : ""}
                        </span>
                      ) : (
                        <span className="caption">미설정</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-right text-[var(--warning)]">₩{Number(e.retirement_accrual || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {e.status === "invited" && e.email && (
                          <button
                            onClick={async (ev) => {
                              ev.stopPropagation();
                              try {
                                let inv = await resendEmployeeInvitationByEmail(e.email, companyId);
                                if (!inv?.invite_token) {
                                  inv = await createEmployeeInvitation({
                                    companyId, email: e.email, name: e.name || undefined,
                                    role: (e.role as 'employee' | 'admin') || "employee", invitedBy: userId,
                                  });
                                  queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
                                }
                                const result = await sendInviteEmail({
                                  email: e.email, name: e.name || undefined,
                                  role: inv.role || "employee", inviteToken: inv.invite_token,
                                  companyName: companyData?.name || undefined,
                                });
                                setInviteMsg(result.success ? { ok: true, msg: `${e.email}로 초대 메일 발송 완료` } : { ok: false, msg: result.error || "이메일 발송 실패" });
                              } catch (err: any) {
                                setInviteMsg({ ok: false, msg: err?.message || "초대 발송 중 오류 발생" });
                              }
                              setTimeout(() => setInviteMsg(null), 4000);
                            }}
                            className="text-[10px] text-[var(--primary)] hover:underline"
                            title="초대 메일 재발송"
                          >
                            재발송
                          </button>
                        )}
                        {e.status !== "active" && (
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              if (confirm(`${e.name} 직원을 삭제하시겠습니까?`)) deleteMut.mutate(e.id);
                            }}
                            className="text-[var(--text-dim)] hover:text-red-500 transition"
                            title="삭제"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
      )}

      {/* 구성원 권한 관리 (회사 설정 '멤버 관리'에서 이동) — 역할/인사파일/회사제외 */}
      <div className="mt-6 pt-6 border-t border-[var(--border)]">
        <MemberRoleManager companyId={companyId} />
      </div>

      {/* Employee Detail Panel — 중앙 모달 팝업(기존엔 목록 하단 인라인이라 멀리 떠서 안 보였음) */}
      {detailEmpId && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setDetailEmpId(null)}>
          <div className="w-full max-w-4xl my-6" onClick={(e) => e.stopPropagation()}>
            <EmployeeDetailPanel employeeId={detailEmpId} companyId={companyId} onClose={() => setDetailEmpId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── SVG 트리 조직도 ──
const ORG_DEPT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#14b8a6"];

function OrgChartSVG({ employees, onSelect }: { employees: any[]; onSelect: (id: string) => void }) {
  const active = employees.filter((e: any) => e.status === "active" || e.status === "joined" || e.status === "contract_pending");
  const ceo = active.filter((e: any) => (e.position || "").toLowerCase().includes("ceo") || (e.position || "").includes("대표") || (e.department || "").includes("대표"));
  const ceoIds = new Set(ceo.map((c: any) => c.id));
  const deptMap: Record<string, any[]> = {};
  active.forEach((e: any) => {
    if (ceoIds.has(e.id)) return;
    const d = e.department || "미배정";
    if (!deptMap[d]) deptMap[d] = [];
    deptMap[d].push(e);
  });
  const deptEntries = Object.entries(deptMap).sort((a, b) => b[1].length - a[1].length);

  if (active.length === 0) {
    return (
      <div className="glass-card p-16 text-center">
        <div className="text-4xl mb-4">🏢</div>
        <div className="text-sm text-[var(--text-muted)]">등록된 직원이 없어 조직도를 표시할 수 없습니다</div>
      </div>
    );
  }

  // 좌표 계산
  const NODE_W = 180;
  const NODE_H = 64;
  const DEPT_GAP_X = 24;
  const ROW_GAP_Y = 80;
  const MEMBER_GAP_Y = 12;
  const MEMBER_H = 48;
  const PAD_X = 40;
  const PAD_Y = 30;

  const ceoY = PAD_Y;
  const busY = ceoY + NODE_H + 36;
  const deptHeaderY = busY + 16;
  const memberStartY = deptHeaderY + NODE_H + 18;

  const totalDeptW = deptEntries.length * NODE_W + Math.max(0, deptEntries.length - 1) * DEPT_GAP_X;
  const svgW = Math.max(720, totalDeptW + PAD_X * 2);
  const tallestCol = Math.max(1, ...deptEntries.map(([, m]) => m.length));
  const svgH = memberStartY + tallestCol * (MEMBER_H + MEMBER_GAP_Y) + PAD_Y;

  const ceoX = svgW / 2;
  const startX = (svgW - totalDeptW) / 2;
  const deptCenters = deptEntries.map((_, i) => startX + i * (NODE_W + DEPT_GAP_X) + NODE_W / 2);

  const downloadSvg = () => {
    const el = document.getElementById("orgchart-svg");
    if (!el) return;
    const blob = new Blob([new XMLSerializer().serializeToString(el)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `조직도_${new Date().toISOString().slice(0, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-card">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
        <div className="text-xs text-[var(--text-muted)]">총 {active.length}명 · {deptEntries.length}개 부서</div>
        <button onClick={downloadSvg} className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--bg)] border border-[var(--border)] rounded-lg font-semibold transition">
          ⬇ SVG 다운로드
        </button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
        <svg id="orgchart-svg" xmlns="http://www.w3.org/2000/svg" width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ background: "transparent" }}>
          <defs>
            <style>{`
              .org-node { cursor: pointer; }
              .org-node:hover rect { filter: brightness(1.08); }
              .org-name { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 600; font-size: 13px; fill: #fff; }
              .org-pos { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 10px; fill: rgba(255,255,255,0.85); }
              .dept-name { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 700; font-size: 13px; fill: #fff; }
              .dept-count { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 10px; fill: rgba(255,255,255,0.85); }
              .member-name { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; font-weight: 500; fill: var(--text, #e5e7eb); }
              .member-pos { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 10px; fill: var(--text-muted, #9ca3af); }
            `}</style>
          </defs>

          {/* CEO */}
          {ceo.length > 0 && (
            <g className="org-node" onClick={() => onSelect(ceo[0].id)} transform={`translate(${ceoX - NODE_W / 2}, ${ceoY})`}>
              <rect width={NODE_W} height={NODE_H} rx={12} fill="#1d4ed8" stroke="#3b82f6" strokeWidth={2} />
              <circle cx={28} cy={NODE_H / 2} r={18} fill="rgba(255,255,255,0.18)" />
              <text x={28} y={NODE_H / 2 + 5} textAnchor="middle" className="org-name" fontSize={16}>{(ceo[0].name || "?")[0]}</text>
              <text x={56} y={26} className="org-name">{ceo[0].name}</text>
              <text x={56} y={44} className="org-pos">{ceo[0].position || "대표"}</text>
            </g>
          )}

          {/* CEO -> 버스 수직선 */}
          {ceo.length > 0 && deptEntries.length > 0 && (
            <line x1={ceoX} y1={ceoY + NODE_H} x2={ceoX} y2={busY} stroke="#475569" strokeWidth={1.5} />
          )}

          {/* 수평 버스 */}
          {deptEntries.length > 1 && (
            <line x1={deptCenters[0]} y1={busY} x2={deptCenters[deptCenters.length - 1]} y2={busY} stroke="#475569" strokeWidth={1.5} />
          )}

          {/* 부서별 */}
          {deptEntries.map(([dept, members], dIdx) => {
            const color = ORG_DEPT_COLORS[dIdx % ORG_DEPT_COLORS.length];
            const cx = deptCenters[dIdx];
            const headX = cx - NODE_W / 2;
            const lead = members.find((m: any) => (m.position || "").includes("팀장") || (m.position || "").includes("본부장") || (m.position || "").includes("리드"));
            const others = members.filter((m: any) => m.id !== lead?.id);
            const ordered = lead ? [lead, ...others] : members;
            return (
              <g key={dept}>
                {/* 버스 -> 부서 헤더 */}
                <line x1={cx} y1={busY} x2={cx} y2={deptHeaderY} stroke="#475569" strokeWidth={1.5} />
                {/* 부서 헤더 */}
                <g>
                  <rect x={headX} y={deptHeaderY} width={NODE_W} height={NODE_H} rx={10} fill={color} />
                  <text x={cx} y={deptHeaderY + 26} textAnchor="middle" className="dept-name">{dept}</text>
                  <text x={cx} y={deptHeaderY + 46} textAnchor="middle" className="dept-count">{members.length}명</text>
                </g>
                {/* 헤더 -> 멤버 그룹 수직선 */}
                {ordered.length > 0 && (
                  <line x1={cx} y1={deptHeaderY + NODE_H} x2={cx} y2={memberStartY + ordered.length * (MEMBER_H + MEMBER_GAP_Y) - MEMBER_GAP_Y - MEMBER_H / 2} stroke={`${color}66`} strokeWidth={1.2} strokeDasharray="3,3" />
                )}
                {/* 멤버 카드 */}
                {ordered.map((m: any, mi: number) => {
                  const my = memberStartY + mi * (MEMBER_H + MEMBER_GAP_Y);
                  const mx = headX;
                  return (
                    <g key={m.id} className="org-node" onClick={() => onSelect(m.id)}>
                      <line x1={cx} y1={my + MEMBER_H / 2} x2={mx + 4} y2={my + MEMBER_H / 2} stroke={`${color}66`} strokeWidth={1.2} strokeDasharray="3,3" />
                      <rect x={mx} y={my} width={NODE_W} height={MEMBER_H} rx={8} fill="var(--bg-surface, #1f2937)" stroke={`${color}55`} strokeWidth={1} />
                      <circle cx={mx + 22} cy={my + MEMBER_H / 2} r={14} fill={`${color}22`} />
                      <text x={mx + 22} y={my + MEMBER_H / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={color}>{(m.name || "?")[0]}</text>
                      <text x={mx + 44} y={my + 19} className="member-name">{m.name}</text>
                      <text x={mx + 44} y={my + 36} className="member-pos">{m.position || "—"}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
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
      <div className="flex gap-4 mb-6">
        <select value={selectedEmpId || ""} onChange={e => setSelectedEmpId(e.target.value || null)} className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
          <option value="">직원 선택...</option>
          {employees.filter((e: any) => ['active', 'joined', 'invited'].includes(e.status)).map((e: any) => (
            <option key={e.id} value={e.id}>{e.name} ({e.department || '미배정'})</option>
          ))}
        </select>
        {selectedEmpId && <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">+ 급여 변경</button>}
      </div>

      {showForm && selectedEmpId && (
        <div className="glass-card p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">적용일 *</label><input type="date" value={form.effectiveDate} onChange={e => setForm({...form, effectiveDate: e.target.value})} className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">변경 급여 (월급) *</label><input type="text" inputMode="numeric" value={form.salary ? Number(form.salary).toLocaleString('ko-KR') : ''} onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setForm({...form, salary: raw}); }} placeholder="3,000,000" className="field-input" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">사유</label><input value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="승진, 연봉협상 등" className="field-input" /></div>
          </div>
          <button onClick={() => form.effectiveDate && form.salary && addSalary.mutate()} disabled={!form.effectiveDate || !form.salary || addSalary.isPending} className="btn-primary">{addSalary.isPending ? "등록 중..." : "등록"}</button>
        </div>
      )}

      {!selectedEmpId ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-4">💰</div>
          <div className="text-sm text-[var(--text-muted)]">직원을 선택하면 급여이력이 표시됩니다</div>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
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
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">+ 경비 청구</button>
      </div>

      {showForm && (
        <div className="glass-card p-6 mb-6">
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
          <div className="mb-4">
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

      <div className="glass-card overflow-hidden">
        {expenses.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">🧾</div><div className="text-sm text-[var(--text-muted)]">경비 청구 내역이 없습니다</div></div>
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
                          <button onClick={() => approve.mutate(e.id)} className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20">승인</button>
                          <button onClick={() => reject.mutate(e.id)} className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">반려</button>
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

// ── Attendance Tab ──
export function AttendanceTab({ employees, companyId, userId, userEmail, queryClient, role }: any) {
  const { toast } = useToast();
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const [viewMode, setViewMode] = useState<"calendar" | "table">("calendar");
  // 관리자 분기: 수당 명세 임베드 collapse 토글.
  //   직원 분기 MyAllowanceCard 가 항상 표시되는 IA 와 일치하도록 기본 펼침 (true).
  //   필요시 사용자가 접을 수 있게 토글은 유지.
  const [allowanceExpanded, setAllowanceExpanded] = useState(true);
  // 오늘 출퇴근 현황 — 탭 클릭 시 해당 직원 명단 펼침
  const [attnDetail, setAttnDetail] = useState<"present" | "late" | "leave" | "absent" | null>(null);
  // 퇴근 미입력 일괄 보정 모달 (관리자 전용)
  const [showMissingCheckOutModal, setShowMissingCheckOutModal] = useState(false);
  // status 와 is_late 불일치 흡수: is_late=true 면 'late' 우선 (UI 일관성).
  //   edge attendance-checkin INSERT 시 status·is_late 계산 source 가 달라 어긋날 수 있음.
  //   근본 fix(edge 통합) 는 별건 — 본 헬퍼는 표시 단의 안전망.
  const effectiveStatus = (r: { is_late?: boolean; status?: string | null }): string =>
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
      const db = supabase as any;
      const { data } = await db
        .from('allowance_entries')
        .select('employee_id, amount, allowance_types!inner(code, name, is_active)')
        .eq('company_id', companyId)
        .eq('payroll_month', selectedMonth)
        .filter('allowance_types.is_active', 'eq', true);
      return (data as Array<{ employee_id: string; amount: number; allowance_types: { code: string; name: string } | null }>) || [];
    },
    enabled: !!companyId && isAdminForAllowance,
  });

  // ⚠️ 비활성화 (2026-05-21 504 인시던트 3차) — 클라이언트 마운트마다 자동 호출이
  //   사용자 동시 진입·hot reload 시 폭증 → DB hung. 5/19·5/20 패턴 재발 차단.
  //   대안: 사용자가 화면의 "월 일괄 재계산" 버튼 수동 클릭 (MonthlyRecomputeButton).
  //   근본 해결: 별건 PR — pg_cron 1시간 1회 배치 + advisory lock 으로 동시 실행 1개 제한.
  // recomputeMonthlyAllowancesForCompany 자동 호출은 본 PR 에서 제거됨.

  // Check-in mutation
  const doCheckIn = useMutation({
    mutationFn: (employeeId: string) => checkIn(companyId!, employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // Check-out mutation
  const doCheckOut = useMutation({
    mutationFn: (employeeId: string) => checkOut(employeeId, companyId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // Cancel check-out mutation
  const doCancelCheckOut = useMutation({
    mutationFn: (employeeId: string) => cancelCheckOut(employeeId, companyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
      toast("퇴근 취소 완료", "success");
    },
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // Admin attendance correction
  const isAdmin = role === "owner" || role === "admin";
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ check_in: "", check_out: "", status: "" });

  // L 근태 — C-2 직원 수정요청 다이얼로그 상태
  const [editReqOpen, setEditReqOpen] = useState(false);
  const [editReqRecord, setEditReqRecord] = useState<{ id: string; check_in?: string; check_out?: string; status?: string } | null>(null);

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
    setEditForm({
      check_in: record.check_in ? record.check_in.slice(0, 16) : "",
      check_out: record.check_out ? record.check_out.slice(0, 16) : "",
      status: record.status || "present",
    });
  };

  const submitCorrection = () => {
    if (!editingRecordId) return;
    const updates: { check_in?: string; check_out?: string; status?: string } = {};
    if (editForm.check_in) updates.check_in = new Date(editForm.check_in).toISOString();
    if (editForm.check_out) updates.check_out = new Date(editForm.check_out).toISOString();
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

  // Stats
  const totalRecords = records.length;
  const presentCount = records.filter((r: any) => { const s = effectiveStatus(r); return s === "present" || s === "remote"; }).length;
  const lateCount = records.filter((r: any) => effectiveStatus(r) === "late").length;
  const avgHours = totalRecords > 0
    ? (records.reduce((s: number, r: any) => s + Number(r.work_hours || 0), 0) / totalRecords).toFixed(1)
    : "0.0";
  const attendanceRate = totalRecords > 0
    ? ((presentCount / totalRecords) * 100).toFixed(1)
    : "0.0";
  const lateRate = totalRecords > 0
    ? ((lateCount / totalRecords) * 100).toFixed(1)
    : "0.0";

  // 52-hour check: compute weekly hours for current week for each employee
  const weeklyWarnings = useMemo(() => {
    // Get current Monday
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const mondayStr = monday.toISOString().slice(0, 10);
    const sundayDate = new Date(monday);
    sundayDate.setDate(sundayDate.getDate() + 6);
    const sundayStr = sundayDate.toISOString().slice(0, 10);

    // Filter records for this week
    const weekRecords = records.filter(
      (r: any) => r.date >= mondayStr && r.date <= sundayStr
    );

    const empWeekHours: Record<string, number> = {};
    weekRecords.forEach((r: any) => {
      empWeekHours[r.employee_id] = (empWeekHours[r.employee_id] || 0) + Number(r.work_hours || 0);
    });

    const warnings: { employeeId: string; name: string; hours: number; level: "warning" | "danger" }[] = [];
    Object.entries(empWeekHours).forEach(([empId, hours]) => {
      if (hours > 48) {
        const emp = employees.find((e: any) => e.id === empId);
        warnings.push({
          employeeId: empId,
          name: emp?.name || "Unknown",
          hours: Math.round(hours * 10) / 10,
          level: hours > 52 ? "danger" : "warning",
        });
      }
    });

    return warnings;
  }, [records, employees]);

  const statusColor = (status: string) => {
    switch (status) {
      case "present": return "bg-green-500";
      case "late": return "bg-yellow-500";
      case "absent": return "bg-red-500";
      case "half_day": return "bg-orange-400";
      case "remote": return "bg-blue-500";
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
  const myEmployeeRecord = isEmployeeRole
    ? employees.find((e: any) => e.user_id === userId) || employees.find((e: any) => e.email === userEmail)
    : null;

  // L 근태 — C-3 관리자 수정요청 인박스용 reviewerId (현재 user.id 가 admin 일 때만 의미 있음)
  // employees 배열의 직원 row 는 user_id 보유 — admin 본인의 user.id 는 props 로 받은 userId 가 가장 정확
  const reviewerUserId = userId || null;

  // 관리자 분기 — 이번 달 "퇴근 미입력" 행 수 (overtime/night/holiday 산정 불가 사유).
  //   사용자 호소 "수당 일괄 계산 후 0" 의 근본 원인 안내용.
  //   check_out 이 null 인 attendance_records 카운트.
  const missingCheckOutCount = useMemo(() => {
    if (isEmployeeRole) return 0;
    return (records as any[]).filter((r) => !r.check_out).length;
  }, [records, isEmployeeRole]);

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

  // 관리자 분기 — 지각 식별 요약 (오늘 지각자 + 이번 달 누적 Top 5).
  //   직원 분기에선 미노출. records / activeEmployees / effectiveStatus 재사용.
  //   비용: O(records) 1패스. typical 회사(<50명, <1500행) 무시 가능.
  const lateAdminSummary = useMemo(() => {
    if (isEmployeeRole) return { todayList: [] as { name: string; minutes: number }[], monthTop: [] as { name: string; count: number }[] };
    const todayStr = new Date().toISOString().slice(0, 10);
    const empNameMap = new Map<string, string>(activeEmployees.map((e: any) => [e.id, e.name]));
    const todayList: { name: string; minutes: number }[] = [];
    const monthCount = new Map<string, number>();
    for (const r of records as any[]) {
      if (effectiveStatus(r) !== 'late') continue;
      monthCount.set(r.employee_id, (monthCount.get(r.employee_id) || 0) + 1);
      if (r.date === todayStr) {
        todayList.push({
          name: empNameMap.get(r.employee_id) || '직원',
          minutes: Number(r.late_minutes || 0),
        });
      }
    }
    const monthTop = Array.from(monthCount.entries())
      .map(([id, count]) => ({ name: empNameMap.get(id) || '직원', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return { todayList, monthTop };
  }, [records, activeEmployees, isEmployeeRole]);

  // 2026-05-22 오늘 출퇴근 현황 — KST 오늘 기준 출근/지각/휴가 집계 (records 의존 X, 별도 fetch).
  const kstToday = useMemo(() => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10), []);
  const { data: todayStatus } = useQuery({
    queryKey: ["today-attendance-status", companyId, kstToday],
    queryFn: async () => {
      const [attRes, leaveRes] = await Promise.all([
        (supabase as any).from("attendance_records").select("employee_id, status, is_late").eq("company_id", companyId).eq("date", kstToday),
        (supabase as any).from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", kstToday).gte("end_date", kstToday),
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

  return (
    <div>
      {/* L 근태 — C-3 관리자: 수정 요청 인박스 */}
      {isAdmin && reviewerUserId && companyId && (
        <EditRequestInbox companyId={companyId} reviewerId={reviewerUserId} />
      )}

      {/* L 수당 — 관리자: 직원 수당 명세 임베드 (핸드오프 (a) — collapse 기본 접힘) */}
      {isAdmin && companyId && (
        <div className="mb-6 glass-card overflow-hidden">
          <button
            type="button"
            onClick={() => setAllowanceExpanded((v) => !v)}
            className="w-full p-4 flex items-center gap-2.5 hover:bg-[var(--bg-surface)] transition text-left"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center text-white text-base shadow shrink-0">💰</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text)]">
                직원 수당 명세 <span className="font-normal text-[var(--text-muted)]">· 이번 달</span>
              </div>
              <div className="text-xs text-[var(--text-muted)] truncate">
                직원별 법정·커스텀 수당 · 월 일괄 재계산 · 엑셀 export
              </div>
            </div>
            <svg
              className={`ml-auto shrink-0 w-4 h-4 text-[var(--text-muted)] transition-transform duration-200 ${allowanceExpanded ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {allowanceExpanded && (
            <div className="px-4 pb-4 border-t border-[var(--border)]">
              <AllowanceAdminTab companyId={companyId} userId={userId ?? null} />
            </div>
          )}
        </div>
      )}

      {/* 2026-05-21 사장님 요청: 직원 근태관리에서 수당 카드 (ExtraPaySummaryCard / MyAllowanceCard) 제거.
          관리자 영역 (EditRequestInbox, MonthlyRecomputeButton, AllowanceAdminTab) 은 그대로 유지. */}

      {/* Stats cards — 시안 그라데이션 톤 (값/계산 무변경) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <SiyanStatCard tone="green" label="출근률" value={`${attendanceRate}%`} icon={<span>✓</span>} />
        <SiyanStatCard tone="amber" label="지각률" value={`${lateRate}%`} icon={<span>⏰</span>} />
        <SiyanStatCard tone="blue" label="평균근무시간" value={`${avgHours}h`} icon={<span>⚡</span>} />
        <SiyanStatCard tone="indigo" label="이번 달 기록" value={`${totalRecords}건`} icon={<span>📋</span>} />
      </div>

      {/* 관리자 분기 — 지각 식별 요약 (오늘 지각자 + 이번 달 누적 Top 5) */}
      {!isEmployeeRole && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-6">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white text-base shadow shrink-0">⏰</span>
              <span className="text-sm font-semibold text-[var(--text)]">오늘 지각자</span>
              {lateAdminSummary.todayList.length > 0 && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500 font-semibold">{lateAdminSummary.todayList.length}명</span>
              )}
            </div>
            {lateAdminSummary.todayList.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">오늘 지각자 없음 ✅</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {lateAdminSummary.todayList.slice(0, 5).map((x, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">
                    {x.name} <span className="font-semibold">{x.minutes}분</span>
                  </span>
                ))}
                {lateAdminSummary.todayList.length > 5 && (
                  <span className="text-xs text-[var(--text-muted)] self-center">외 {lateAdminSummary.todayList.length - 5}명</span>
                )}
              </div>
            )}
          </div>
          {/* 2026-05-22 지각 누적 Top5 → 오늘 출퇴근 현황 */}
          {(() => {
            const total = activeEmployees.length;
            const nameMap = new Map<string, string>(activeEmployees.map((e: any) => [e.id, e.name]));
            const presentIds: string[] = todayStatus?.presentIds ?? [];
            const lateIds: string[] = todayStatus?.lateIds ?? [];
            const leaveIds: string[] = todayStatus?.leaveIds ?? [];
            const accounted = new Set<string>([...presentIds, ...lateIds, ...leaveIds]);
            const absentIds: string[] = activeEmployees.filter((e: any) => !accounted.has(e.id)).map((e: any) => e.id);
            const rate = total > 0 ? Math.round(((presentIds.length + lateIds.length) / total) * 100) : 0;
            const toNames = (ids: string[]) => ids.map((id) => nameMap.get(id) || "직원");
            const CATS: { key: "present" | "late" | "leave" | "absent"; emoji: string; label: string; ids: string[]; tile: string; txt: string }[] = [
              { key: "present", emoji: "🟢", label: "출근", ids: presentIds, tile: "bg-emerald-500/8 border-emerald-500/20", txt: "text-emerald-500" },
              { key: "late", emoji: "🟡", label: "지각", ids: lateIds, tile: "bg-yellow-500/8 border-yellow-500/20", txt: "text-yellow-500" },
              { key: "leave", emoji: "🔵", label: "휴가", ids: leaveIds, tile: "bg-sky-500/8 border-sky-500/20", txt: "text-sky-500" },
              { key: "absent", emoji: "⚪", label: "미출근", ids: absentIds, tile: "bg-[var(--bg-surface)] border-[var(--border)]", txt: "text-[var(--text-muted)]" },
            ];
            const sel = CATS.find((c) => c.key === attnDetail);
            return (
              <div className="glass-card p-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-base shadow shrink-0">📋</span>
                  <span className="text-sm font-semibold text-[var(--text)]">오늘 출퇴근 현황</span>
                  <span className="ml-auto text-[10px] text-[var(--text-dim)]">{kstToday} · 총원 {total}명</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {CATS.map((c) => {
                    const active = attnDetail === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setAttnDetail(active ? null : c.key)}
                        className={`rounded-lg border px-3 py-2 flex items-center justify-between transition ${c.tile} ${active ? "ring-2 ring-[var(--primary)]/50" : "hover:brightness-105 active:scale-[0.98]"}`}
                        aria-pressed={active}
                      >
                        <span className={`text-[11px] ${c.txt}`}>{c.emoji} {c.label}</span>
                        <span className={`text-base font-extrabold tabular-nums ${c.txt}`}>{c.ids.length}</span>
                      </button>
                    );
                  })}
                </div>
                {sel && (
                  <div className="mb-2 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-[var(--text-muted)]">{sel.emoji} {sel.label} · {sel.ids.length}명</span>
                      <button type="button" onClick={() => setAttnDetail(null)} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]">닫기 ✕</button>
                    </div>
                    {sel.ids.length === 0 ? (
                      <div className="text-[11px] text-[var(--text-dim)]">해당 직원 없음</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {toNames(sel.ids).map((nm, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)]">{nm}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="text-[10px] text-[var(--text-dim)] text-right">출근율 {rate}% · 탭을 눌러 명단 보기</div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 52-hour warnings */}
      {weeklyWarnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {weeklyWarnings.map((w) => (
            <div
              key={w.employeeId}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                w.level === "danger"
                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                  : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              }`}
            >
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shadow shrink-0 bg-gradient-to-br ${w.level === "danger" ? "from-red-500 to-rose-500" : "from-yellow-500 to-orange-500"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </span>
              <span className="text-sm font-medium">
                {w.level === "danger" ? "[52시간 초과]" : "[48시간 경고]"} {w.name} - 이번 주 {w.hours}시간 근무
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Controls: month picker + check-in/out buttons + view toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-3 items-center">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
          <div className="flex gap-1 bg-[var(--bg-surface)] rounded-full p-1 border border-[var(--border)]">
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${viewMode === "calendar" ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
            >
              캘린더
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${viewMode === "table" ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
            >
              테이블
            </button>
          </div>
          {/* L 근태 — C-3 관리자: 가산수당 재계산 (월 일괄) */}
          {isAdmin && companyId && (
            <MonthlyRecomputeButton companyId={companyId} from={monthStart} to={monthEnd} />
          )}
        </div>
        <div className="flex gap-2">
          {isEmployeeRole && myEmployeeRecord ? (
            /* 직원 역할: 본인 전용 출퇴근 버튼 */
            (() => {
              const todayStr = new Date().toISOString().slice(0, 10);
              const todayRecord = records.find((r: any) => r.employee_id === myEmployeeRecord.id && r.date === todayStr);
              const hasIn = !!todayRecord;
              const hasOut = !!todayRecord?.check_out;
              return (
                <>
                  <button
                    disabled={hasIn}
                    onClick={() => doCheckIn.mutate(myEmployeeRecord.id)}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
                  >
                    {hasIn ? "출근 완료" : "출근"}
                  </button>
                  <button
                    disabled={!hasIn || hasOut}
                    onClick={() => doCheckOut.mutate(myEmployeeRecord.id)}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
                  >
                    {hasOut ? "퇴근 완료" : "퇴근"}
                  </button>
                  {hasOut && (
                    <button
                      onClick={() => {
                        if (confirm("퇴근 기록을 취소하시겠습니까?")) {
                          doCancelCheckOut.mutate(myEmployeeRecord.id);
                        }
                      }}
                      className="px-3 py-2 bg-red-600/80 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition"
                    >
                      퇴근 취소
                    </button>
                  )}
                  {/* L 근태 — C-2: 수정 요청 (오늘 기록이 있을 때만) */}
                  {todayRecord && (
                    <button
                      onClick={() => {
                        setEditReqRecord({
                          id: todayRecord.id,
                          check_in: todayRecord.check_in,
                          check_out: todayRecord.check_out,
                          status: todayRecord.status,
                        });
                        setEditReqOpen(true);
                      }}
                      className="px-3 py-2 bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] rounded-xl text-xs font-semibold transition"
                    >
                      수정 요청
                    </button>
                  )}
                </>
              );
            })()
          ) : !isEmployeeRole && activeEmployees.length > 0 ? (
            <QuickAttendanceButtons
              employees={activeEmployees}
              records={records}
              onCheckIn={(empId: string) => doCheckIn.mutate(empId)}
              onCheckOut={(empId: string) => doCheckOut.mutate(empId)}
            />
          ) : isEmployeeRole ? (
            <div className="text-xs text-[var(--text-muted)] py-2">직원 정보가 연결되지 않았습니다</div>
          ) : null}
        </div>
      </div>

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <div className="glass-card overflow-hidden">
          {/* Calendar header: days of week */}
          <div className="grid grid-cols-7 border-b border-[var(--border)]">
            {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
              <div key={d} className={`text-center text-xs font-medium py-2 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-[var(--text-dim)]"}`}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar body */}
          <div className="grid grid-cols-7">
            {/* Empty cells before first day */}
            {Array.from({ length: calendarData.firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-[var(--border)]/30 bg-[var(--bg-surface)]/30" />
            ))}

            {/* Day cells */}
            {Array.from({ length: calendarData.daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${selectedMonth}-${String(day).padStart(2, "0")}`;
              const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
              const dayOfWeek = (calendarData.firstDayOfWeek + i) % 7;
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

              // Get all employee statuses for this day.
              //   tooltip 에 지각 분 표시를 위해 records 에서 같은 (emp,date) 행 직접 조회.
              //   typical 회사 직원 수·records 수 < 1500 이라 O(emps × records) 무시 가능.
              const dayRecords = activeEmployees.map((emp: any) => {
                const rec = records.find((r: any) => r.employee_id === emp.id && r.date === dateStr);
                const status = rec ? effectiveStatus(rec) : (calendarData.empMap[emp.id]?.[dateStr] || null);
                return {
                  name: emp.name,
                  status,
                  lateMin: rec ? Number(rec.late_minutes || 0) : 0,
                };
              }).filter((r: any) => r.status);

              return (
                <div
                  key={day}
                  className={`min-h-[80px] border-b border-r border-[var(--border)]/30 p-1.5 ${
                    isToday ? "bg-[var(--primary)]/5" : isWeekend ? "bg-[var(--bg-surface)]/30" : ""
                  }`}
                >
                  <div className={`text-xs font-medium mb-1 ${
                    isToday ? "text-[var(--primary)] font-bold" : dayOfWeek === 0 ? "text-red-400" : dayOfWeek === 6 ? "text-blue-400" : "text-[var(--text-muted)]"
                  }`}>
                    {day}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dayRecords.map((r: any, idx: number) => (
                      <span
                        key={idx}
                        title={
                          r.status === 'late'
                            ? `${r.name}: 🔴 지각 ${r.lateMin}분`
                            : `${r.name}: ${statusLabel(r.status)}`
                        }
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] leading-none"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(r.status)}`} />
                        <span className="truncate max-w-[2.5em] text-[var(--text)] font-medium">{(r.name || '').slice(0, 2)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend — 시안 pill 톤 */}
          <div className="flex gap-2 flex-wrap p-3 border-t border-[var(--border)]">
            {ATTENDANCE_STATUS.map((s) => (
              <span key={s.value} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)]">
                <span className={`w-2 h-2 rounded-full ${statusColor(s.value)}`} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="glass-card overflow-hidden">
          {records.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📊</div>
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
                  {isAdmin && <th className="th-cell text-center">관리</th>}
                </tr>
              </thead>
              <tbody>
                {records.map((r: any) => (
                  editingRecordId === r.id ? (
                    <tr key={r.id} className="border-b border-[var(--border)]/50 bg-[var(--primary)]/5">
                      <td className="px-5 py-2 text-sm font-medium">{r.employees?.name || "—"}</td>
                      <td className="px-5 py-2 text-sm text-[var(--text-muted)]">{r.date}</td>
                      <td className="px-3 py-2">
                        <input
                          type="datetime-local"
                          value={editForm.check_in}
                          onChange={(e) => setEditForm({ ...editForm, check_in: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="datetime-local"
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
                            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition disabled:opacity-50"
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
                              es === "present" ? "bg-green-500/10 text-green-400"
                              : es === "late" ? "bg-yellow-500/10 text-yellow-400"
                              : es === "absent" ? "bg-red-500/10 text-red-400"
                              : es === "half_day" ? "bg-orange-500/10 text-orange-400"
                              : es === "remote" ? "bg-blue-500/10 text-blue-400"
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
                    {isAdmin && (
                      <td className="px-5 py-3 text-center">
                        <button
                          onClick={() => startEditing(r)}
                          className="px-2.5 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition"
                        >
                          수정
                        </button>
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
        // 분 → "Nh Nm" 포맷 헬퍼 (0 은 "—")
        const fmtMin = (n: number): string => {
          const m = Math.round(Number(n) || 0);
          if (m <= 0) return "—";
          const h = Math.floor(m / 60);
          const mm = m % 60;
          return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
        };
        const fmtKRW = (n: number): string => {
          const v = Math.round(Number(n) || 0);
          return v > 0 ? `${v.toLocaleString('ko-KR')}원` : "—";
        };
        return (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--text-muted)]">직원별 월간 요약</h3>
              {isAdminForAllowance && (
                <span className="text-[11px] text-[var(--text-muted)]">수당 재계산은 위의 "월 일괄 재계산" 버튼 클릭 시 실행</span>
              )}
            </div>
            {/* 퇴근 미입력 안내 — 연장/야간/휴일 산정 불가 사유 + 입력 진입 CTA */}
            {isAdminForAllowance && missingCheckOutCount > 0 && (
              <div className="mb-3 px-4 py-3 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-300 text-xs flex items-center justify-between gap-3">
                <span>
                  <span className="font-semibold">⚠️ 퇴근 미입력 {missingCheckOutCount}건</span>
                  {" — "}
                  연장·야간·휴일 분 산정 불가, 수당 0원. 직원/관리자가 퇴근을 입력해야 자동 산출됩니다.
                </span>
                <button
                  type="button"
                  onClick={() => setShowMissingCheckOutModal(true)}
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 rounded-lg transition"
                >
                  📝 미입력 행 보기·입력
                </button>
              </div>
            )}
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[960px]">
                <thead className="sticky-bar">
                  <tr className="table-head-row">
                    <th className="th-cell text-left">직원</th>
                    <th className="th-cell text-center">출근일</th>
                    <th className="th-cell text-center">지각</th>
                    <th className="th-cell text-center">지각 합계</th>
                    <th className="th-cell text-center">연장</th>
                    <th className="th-cell text-center">야간</th>
                    <th className="th-cell text-center">휴일</th>
                    <th className="th-cell text-center">결근</th>
                    <th className="th-cell text-center">재택</th>
                    <th className="th-cell text-center">반차</th>
                    <th className="th-cell text-right">총 근무</th>
                    {isAdminForAllowance && (
                      <th className="th-cell text-right">수당 합계</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s: any) => {
                    const alw = allowanceByEmployee.get(s.employee_id);
                    const alwTitle = alw
                      ? `연장 ${alw.overtime.toLocaleString('ko-KR')}원 · 야간 ${alw.night.toLocaleString('ko-KR')}원 · 휴일 ${alw.holiday.toLocaleString('ko-KR')}원 · 당직 ${alw.on_duty.toLocaleString('ko-KR')}원 · 기타 ${alw.etc.toLocaleString('ko-KR')}원`
                      : '수당 기록 없음';
                    return (
                      <tr key={s.employee_id} className="border-b border-[var(--border)]/50">
                        <td className="px-5 py-3 text-sm font-medium">{s.name}</td>
                        <td className="px-5 py-3 text-sm text-center">{s.totalDays}일</td>
                        <td className="px-5 py-3 text-sm text-center text-yellow-400">{s.lateDays > 0 ? `${s.lateDays}회` : "—"}</td>
                        <td className="px-5 py-3 text-sm text-center text-yellow-400">{fmtMin(s.lateMinutesSum)}</td>
                        <td className="px-5 py-3 text-sm text-center text-orange-400">{fmtMin(s.overtimeMinutesSum)}</td>
                        <td className="px-5 py-3 text-sm text-center text-purple-400">{fmtMin(s.nightMinutesSum)}</td>
                        <td className="px-5 py-3 text-sm text-center text-green-400">{fmtMin(s.holidayMinutesSum)}</td>
                        <td className="px-5 py-3 text-sm text-center text-red-400">{s.absentDays > 0 ? `${s.absentDays}회` : "—"}</td>
                        <td className="px-5 py-3 text-sm text-center text-blue-400">{s.remoteDays > 0 ? `${s.remoteDays}일` : "—"}</td>
                        <td className="px-5 py-3 text-sm text-center text-orange-400">{s.halfDays > 0 ? `${s.halfDays}회` : "—"}</td>
                        <td className="px-5 py-3 text-sm text-right font-medium">{s.totalHours.toFixed(1)}h</td>
                        {isAdminForAllowance && (
                          <td className="px-5 py-3 text-sm text-right font-medium text-emerald-400" title={alwTitle}>
                            {fmtKRW(alw?.total ?? 0)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          </div>
        );
      })()}

      {/* L 근태 — C-2 직원: 수정요청 다이얼로그 */}
      {editReqOpen && editReqRecord && companyId && userId && (
        <AttendanceEditRequestDialog
          open={editReqOpen}
          onClose={() => { setEditReqOpen(false); setEditReqRecord(null); }}
          companyId={companyId}
          attendanceRecordId={editReqRecord.id}
          userId={userId}
          initial={{
            check_in: editReqRecord.check_in,
            check_out: editReqRecord.check_out,
            status: editReqRecord.status,
          }}
        />
      )}

      {/* 관리자 — 퇴근 미입력 일괄 보정 모달 */}
      {showMissingCheckOutModal && companyId && (
        <MissingCheckOutModal
          companyId={companyId}
          records={records}
          employees={employees}
          selectedMonth={selectedMonth}
          onClose={() => setShowMissingCheckOutModal(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["attendance"] });
            queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
            queryClient.invalidateQueries({ queryKey: ["allowance-entries-monthly-summary"] });
          }}
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
    () => (records || []).filter((r: any) => !r.check_out).sort((a: any, b: any) => (b.date || "").localeCompare(a.date || "")),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-sm font-bold">📝 퇴근 미입력 일괄 보정</div>
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
  const todayStr = new Date().toISOString().slice(0, 10);

  // Check if employee already checked in today
  const todayRecord = selectedEmp
    ? records.find((r: any) => r.employee_id === selectedEmp && r.date === todayStr)
    : null;
  const hasCheckedIn = !!todayRecord;
  const hasCheckedOut = !!todayRecord?.check_out;

  return (
    <div className="flex gap-2 items-center">
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
        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
      >
        출근
      </button>
      <button
        disabled={!selectedEmp || !hasCheckedIn || hasCheckedOut}
        onClick={() => selectedEmp && onCheckOut(selectedEmp)}
        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
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
  const [editValues, setEditValues] = useState<Record<string, { baseSalary: number; nonTaxable: number; extras: { type: 'allowance' | 'deduction'; name: string; amount: number }[] }>>({});
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
      const { data } = await supabase.from("companies").select("name, representative").eq("id", companyId!).maybeSingle();
      return data as { name: string; representative: string | null } | null;
    },
    enabled: !!companyId,
  });

  const { data: empMap = {} } = useQuery({
    queryKey: ["payroll-emp-meta", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, department, position, birth_date").eq("company_id", companyId!);
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
      const { data } = await (supabase as any)
        .from("allowance_entries")
        .select("employee_id, amount, allowance_types!inner(name, code, display_order, is_active)")
        .eq("company_id", companyId)
        .eq("payroll_month", periodMonth);
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
      const { data: curOv } = await (supabase as any)
        .from('payslip_overrides')
        .select('employee_id')
        .eq('company_id', companyId)
        .eq('period_month', periodMonth);
      if (!curOv || curOv.length === 0) {
        const prevKey = prevMonthKey(periodMonth);
        const { data: prevOv } = await (supabase as any)
          .from('payslip_overrides')
          .select('employee_id, base_salary, non_taxable_amount')
          .eq('company_id', companyId)
          .eq('period_month', prevKey);
        if (prevOv && prevOv.length > 0) {
          const [py, pm] = prevKey.split('-');
          const ok = window.confirm(
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
            const { error: copyErr } = await (supabase as any)
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
      const init: Record<string, { baseSalary: number; nonTaxable: number; extras: { type: 'allowance' | 'deduction'; name: string; amount: number }[] }> = {};
      result.items.forEach(it => {
        init[it.employeeId] = { baseSalary: it.baseSalary, nonTaxable: it.nonTaxableAmount, extras: it.extras ? [...it.extras] : [] };
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
        updated_at: new Date().toISOString(),
      }));
      const { error } = await (supabase as any)
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
      const label = periodLabel || `${new Date().toISOString().slice(0, 7)} 급여`;
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
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--text-muted)]">재직 직원 급여 기준 4대보험/원천세 자동 계산 미리보기</p>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs"
            title="조회할 급여 명세 월 선택"
          />
          {preview && preview.items.length > 0 && (
            <>
              {editMode ? (
                <>
                  <button onClick={loadAllowances} disabled={loadingAllowances} className="px-3 py-2 bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20 rounded-xl text-xs font-semibold transition disabled:opacity-50" title="해당 월 근태 산정 수당(야간·연장·당직 등)을 불러와 채웁니다">
                    {loadingAllowances ? "불러오는 중..." : "📥 수당 불러오기"}
                  </button>
                  <button onClick={saveEdits} disabled={savingEdit} className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
                    {savingEdit ? "저장 중..." : "💾 편집 저장"}
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
              <button onClick={() => handleSendPayslips()} disabled={sending} className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {sending ? "발송 중..." : `전 직원 발송 (${preview.items.length}명)`}
              </button>
            </>
          )}
          <button onClick={generate} disabled={loading || !companyId} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {loading ? "계산 중..." : "급여 명세 미리보기"}
          </button>
        </div>
      </div>

      {!preview ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-4">📋</div>
          <div className="text-sm text-[var(--text-muted)]">"급여 명세 미리보기" 버튼을 클릭하면 이번 달 급여 명세를 확인할 수 있습니다</div>
        </div>
      ) : preview.items.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-sm text-[var(--text-muted)]">재직 중인 직원이 없거나 급여가 설정되지 않았습니다</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 급여 (세전)</div>
              <div className="text-lg font-bold mt-1">{fmtKRW(preview.totalGross)}</div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 공제액</div>
              <div className="text-lg font-bold text-red-400 mt-1">-{fmtKRW(preview.totalDeductions)}</div>
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-[var(--text-dim)]">총 실수령액</div>
              <div className="text-lg font-bold text-green-400 mt-1">{fmtKRW(preview.totalNet)}</div>
            </div>
          </div>

          {/* Detail Table */}
          <div className="glass-card overflow-hidden">
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
                          {allowanceSum > 0 && <span className="text-blue-400">수당 +{allowanceSum.toLocaleString()}</span>}
                          {allowanceSum > 0 && deductionSum > 0 && <span className="mx-1">·</span>}
                          {deductionSum > 0 && <span className="text-red-400">공제 -{deductionSum.toLocaleString()}</span>}
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
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.nationalPension)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.healthInsurance)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.longTermCareInsurance || 0)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.employmentInsurance)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.incomeTax)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.localIncomeTax)}</td>
                    <td className="px-4 py-3 text-sm text-right text-red-400">-{fmtKRW(item.deductionsTotal)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-green-400">{fmtKRW(item.netPay)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => downloadOne(item)} title="급여명세서 PDF 다운로드" className="px-2 py-1 text-[10px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg transition">
                          ⬇ PDF
                        </button>
                        <button onClick={() => handleSendPayslips([item.employeeId])} disabled={sending}
                          title="이 직원에게만 메일로 명세서 발송 (비밀번호=생년월일)"
                          className="px-2 py-1 text-[10px] font-semibold bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded-lg transition disabled:opacity-50">
                          ✉ 발송
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
                            className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20">+ 수당</button>
                          <button type="button"
                            onClick={() => setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: [...(ev.extras || []), { type: 'deduction', name: '', amount: 0 }] } }))}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">+ 공제</button>
                        </div>
                        {(ev.extras || []).length > 0 && (
                          <div className="space-y-1">
                            {(ev.extras || []).map((ex, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <select value={ex.type} onChange={(e) => {
                                  const next = [...(ev.extras || [])];
                                  next[idx] = { ...ex, type: e.target.value as 'allowance' | 'deduction' };
                                  setEditValues(prev => ({ ...prev, [item.employeeId]: { ...ev, extras: next } }));
                                }} className={`text-[10px] px-2 py-1 rounded border ${ex.type === 'allowance' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
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
                                }} className="text-red-400/70 hover:text-red-400 text-xs">✕</button>
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
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Leave Tab ──
export function LeaveTab({ employees, companyId, userId, queryClient, isEmployee, autoNew }: any) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(!!autoNew);

  // Auto-detect current user's employee record
  const myEmployee = isEmployee ? employees.find((e: any) => e.user_id === userId) : null;

  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "annual",
    leaveUnit: "full_day" as string,
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    reason: "",
    requestedApproverId: "",
  });
  const [showPromotion, setShowPromotion] = useState(false);

  // 승인 가능한 사용자(owner/admin) 목록 — 신청자가 승인자 선택용
  const { data: approvers = [] } = useQuery({
    queryKey: ["leave-approvers", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("users")
        .select("id, name, email, role")
        .eq("company_id", companyId!)
        .in("role", ["owner", "admin"])
        .order("role", { ascending: true });
      return data || [];
    },
    enabled: !!companyId,
  });

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
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        requestedApproverId: form.requestedApproverId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setShowForm(false);
      setForm({ employeeId: "", leaveType: "annual", leaveUnit: "full_day", startDate: "", endDate: "", startTime: "", endTime: "", reason: "", requestedApproverId: "" });
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

  // Init balance mutation (수동 부여 일수)
  const initBalance = useMutation({
    mutationFn: (params: { employeeId: string; totalDays: number }) =>
      initLeaveBalance(companyId!, params.employeeId, currentYear, params.totalDays),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-balances"] }),
    onError: (err: any) => toast("휴가 잔여일 설정 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
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

  // R12: 연차 부여 방식 — 선택+저장 후 작은 요약으로 접힘 (변경 시 펼침)
  const [grantEditing, setGrantEditing] = useState(false);
  const [pendingGrant, setPendingGrant] = useState<LeaveGrantMethod | null>(null);

  // 연차 일수 인라인 편집 상태
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalanceVal, setEditingBalanceVal] = useState<string>("");

  // Build leave calendar: who's on leave on which dates
  const leaveCalendar = useMemo(() => {
    const approved = leaveRequests.filter((r: any) => r.status === "approved");
    const dateMap: Record<string, { name: string; type: string }[]> = {};

    approved.forEach((r: any) => {
      const start = new Date(r.start_date);
      const end = new Date(r.end_date);
      const name = r.employees?.name || "Unknown";
      const type = LEAVE_TYPES.find((t) => t.value === r.leave_type)?.label || r.leave_type;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (!dateMap[key]) dateMap[key] = [];
        dateMap[key].push({ name, type });
      }
    });

    return dateMap;
  }, [leaveRequests]);

  // Calendar for current month
  const today = new Date();
  const [calMonth, setCalMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const calYear = Number(calMonth.split("-")[0]);
  const calMon = Number(calMonth.split("-")[1]);
  const calDaysInMonth = new Date(calYear, calMon, 0).getDate();
  const calFirstDow = new Date(calYear, calMon - 1, 1).getDay();

  const activeEmployees = employees.filter((e: any) => e.status === "active" || e.status === "joined");

  // Track which employees have no balance yet
  const employeesWithBalance = new Set(balances.map((b: any) => b.employee_id));
  const employeesWithoutBalance = activeEmployees.filter((e: any) => !employeesWithBalance.has(e.id));

  // Calculate leave type usage summary
  const leaveTypeSummary = useMemo(() => {
    const approved = leaveRequests.filter((r: any) => r.status === "approved");
    return LEAVE_TYPES.slice(0, 8).map(lt => {
      const used = approved.filter((r: any) => r.leave_type === lt.value).reduce((s: number, r: any) => s + Number(r.days || 0), 0);
      const pending = leaveRequests.filter((r: any) => r.leave_type === lt.value && r.status === "pending").length;
      return { ...lt, used, pending };
    });
  }, [leaveRequests]);

  return (
    <div>
      {/* Flex-style Leave Type Overview Cards */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-[var(--text-muted)] mb-3">휴가 유형</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {leaveTypeSummary.map(lt => (
            <div key={lt.value} className="glass-card p-4 hover:border-[var(--primary)]/30 transition">
              <div className="text-xs text-[var(--text-dim)]">{lt.label}</div>
              <div className="flex items-end gap-1.5 mt-1">
                <span className="text-lg font-bold">{lt.defaultDays}일</span>
                {lt.used > 0 && <span className="text-[10px] text-red-400 mb-0.5">-{lt.used}일 사용</span>}
              </div>
              {lt.pending > 0 && <div className="text-[10px] text-amber-500 mt-1">{lt.pending}건 대기</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 연차 부여 방식 — R12: 저장 후 작은 요약으로 접힘, '변경' 시 펼침 */}
      {!isEmployee && (
        <div className="mb-5 glass-card p-4">
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
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition disabled:opacity-50"
                >
                  {setGrantMethodMut.isPending ? "저장 중..." : "저장"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Leave Balance Cards */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold text-[var(--text-muted)]">{currentYear}년 직원별 연차</h3>
          {!isEmployee && grantMethod === "auto" && (
            <div className="flex gap-2">
              <button
                onClick={() => bulkAutoMut.mutate()}
                disabled={bulkAutoMut.isPending}
                className="text-xs px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg hover:bg-[var(--primary)]/20 transition disabled:opacity-50"
                title="1년 미만: 1개월 만근당 1일(최대 11) · 1년 이상: 근로기준법 기본(15일+)"
              >
                {bulkAutoMut.isPending ? "처리 중..." : "입사일 기준 자동 부여"}
              </button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-dim)] mb-3">
          {grantMethod === "auto" ? (
            <>※ 1년 미만 근무자는 입사 후 <strong>1개월 만근 시 1일</strong>씩 자동 부여 (최대 11일). 1년 이상은 자동 부여 후 일수를 직접 수정할 수 있습니다.</>
          ) : (
            <>※ 직접입력 모드입니다. 아래 카드의 <strong>총 부여일수(/숫자)</strong>를 클릭해 직원별 연차를 직접 입력하세요.</>
          )}
        </p>

        {/* 아직 연차 미설정 직원 — 자동 부여 안내 (자동부여 모드 전용) */}
        {!isEmployee && grantMethod === "auto" && employeesWithoutBalance.length > 0 && (
          <div className="mb-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
            <div className="text-xs text-amber-600 font-medium mb-2">연차 미설정 {employeesWithoutBalance.length}명</div>
            <div className="flex flex-wrap gap-2">
              {employeesWithoutBalance.map((e: any) => {
                const calc = e.hire_date ? calculateAnnualLeave(e.hire_date, `${currentYear}-12-31`) : null;
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      if (e.hire_date) autoInitMut.mutate({ employeeId: e.id, hireDate: e.hire_date });
                      else initBalance.mutate({ employeeId: e.id, totalDays: 15 });
                    }}
                    className="text-[11px] px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg hover:border-amber-500/50 transition"
                    title={calc ? calc.formula : "입사일 미등록 — 기본 15일"}
                  >
                    {e.name} <span className="text-amber-600 font-semibold">{calc ? `${calc.totalDays}일` : "15일"}</span> 부여
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {visibleBalances.length === 0 ? (
          <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">
            연차 데이터가 없습니다. 위 &quot;입사일 기준 자동 부여&quot; 를 눌러주세요.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visibleBalances.map((b: any) => {
              const remaining = b.remaining_days ?? (b.total_days - b.used_days);
              const percent = b.total_days > 0 ? (remaining / b.total_days) * 100 : 0;
              const empRec = employees.find((e: any) => e.id === b.employee_id);
              const calc = empRec?.hire_date ? calculateAnnualLeave(empRec.hire_date, `${currentYear}-12-31`) : null;
              const underOneYear = calc ? calc.yearsWorked < 1 : false;
              const isEditing = editingBalanceId === b.id;
              return (
                <div key={b.id} className="glass-card p-4">
                  <div className="text-sm font-medium mb-1">{b.employees?.name || "—"}</div>
                  <div className="text-xs text-[var(--text-dim)] mb-2 flex items-center gap-1">
                    {b.employees?.department || "미배정"}
                    {calc && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${underOneYear ? "bg-amber-500/10 text-amber-600" : "bg-blue-500/10 text-blue-500"}`}>
                        {underOneYear ? `1년미만 ${calc.monthsWorked}개월` : `${calc.yearsWorked}년차`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-end gap-1 mb-2">
                    <span className={`text-xl font-bold ${
                      remaining <= 0 ? "text-red-400" : remaining <= 3 ? "text-yellow-400" : "text-green-400"
                    }`}>
                      {remaining}
                    </span>
                    {isEditing ? (
                      <span className="flex items-center gap-1 mb-0.5">
                        <span className="text-xs text-[var(--text-dim)]">/</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editingBalanceVal}
                          autoFocus
                          onChange={(e) => setEditingBalanceVal(e.target.value.replace(/[^0-9.]/g, ""))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const v = Number(editingBalanceVal);
                              if (v >= 0) initBalance.mutate({ employeeId: b.employee_id, totalDays: v });
                              setEditingBalanceId(null);
                            } else if (e.key === "Escape") setEditingBalanceId(null);
                          }}
                          className="w-12 px-1 py-0.5 text-xs text-center bg-[var(--bg)] border border-[var(--primary)]/50 rounded"
                        />
                        <button
                          onClick={() => {
                            const v = Number(editingBalanceVal);
                            if (v >= 0) initBalance.mutate({ employeeId: b.employee_id, totalDays: v });
                            setEditingBalanceId(null);
                          }}
                          className="text-[10px] text-[var(--primary)] font-semibold"
                        >저장</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { if (!isEmployee) { setEditingBalanceId(b.id); setEditingBalanceVal(String(b.total_days)); } }}
                        className={`text-xs text-[var(--text-dim)] mb-0.5 ${!isEmployee ? "hover:text-[var(--primary)] hover:underline" : ""}`}
                        title={!isEmployee ? "클릭하여 총 부여일수 수정" : ""}
                      >
                        / {b.total_days}일 {!isEmployee && <span className="text-[9px]">✏</span>}
                      </button>
                    )}
                  </div>
                  <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        remaining <= 0 ? "bg-red-400" : remaining <= 3 ? "bg-yellow-400" : "bg-green-400"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                    />
                  </div>
                  {!isEmployee && grantMethod === "auto" && calc && (
                    <button
                      onClick={() => empRec?.hire_date && autoInitMut.mutate({ employeeId: b.employee_id, hireDate: empRec.hire_date })}
                      className="mt-2 text-[10px] text-[var(--text-dim)] hover:text-[var(--primary)] transition"
                      title={calc.formula}
                    >
                      ↻ 입사일 기준 재계산 (권장 {calc.totalDays}일)
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
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
              {f.key === "pending" && leaveRequests.filter((r: any) => r.status === "pending").length > 0 && (
                <span className="ml-1 text-[10px] px-1 py-0.5 rounded-full bg-white/20">
                  {leaveRequests.filter((r: any) => r.status === "pending").length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold"
        >
          + 휴가 신청
        </button>
      </div>

      {/* Leave Request Form */}
      {showForm && (
        <div className="glass-card p-6 mb-6">
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
                {LEAVE_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
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
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="field-input" />
            </div>
            {form.leaveUnit === "full_day" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="field-input" />
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
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-[var(--text-muted)] mb-1">승인자</label>
              <select
                value={form.requestedApproverId}
                onChange={(e) => setForm({ ...form, requestedApproverId: e.target.value })}
                className="field-input w-full"
              >
                <option value="">대표·관리자 전원에게 알림</option>
                {approvers.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email} ({u.role === "owner" ? "대표" : "관리자"})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => form.employeeId && form.startDate && !(form.endDate && form.endDate < form.startDate) && createLeave.mutate()}
            disabled={!form.employeeId || !form.startDate || (!!form.endDate && form.endDate < form.startDate) || createLeave.isPending}
            className="btn-primary"
          >
            {createLeave.isPending ? "처리 중..." : `신청 (${(() => {
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
      <div className="glass-card overflow-hidden mb-6">
        {leaveRequests.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">🏖</div>
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
              {leaveRequests.map((r: any) => {
                const st = LEAVE_REQUEST_STATUS[r.status as keyof typeof LEAVE_REQUEST_STATUS] || LEAVE_REQUEST_STATUS.pending;
                const leaveLabel = LEAVE_TYPES.find((t) => t.value === r.leave_type)?.label || r.leave_type;
                return (
                  <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-5 py-3 text-sm font-medium">{r.employees?.name || "—"}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{leaveLabel}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {r.start_date}{r.start_date !== r.end_date ? ` ~ ${r.end_date}` : ""}
                      {r.leave_unit === "two_hours" && r.start_time ? ` ${r.start_time}~${r.end_time}` : ""}
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
                      {r.requested_approver?.name || r.requested_approver?.email || (
                        <span className="text-[var(--text-dim)]">전체</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        {r.status === "pending" && !isEmployee && (
                          <>
                            <button
                              onClick={() => approveMut.mutate(r.id)}
                              className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            >
                              승인
                            </button>
                            <button
                              onClick={() => rejectMut.mutate(r.id)}
                              className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
                            >
                              반려
                            </button>
                          </>
                        )}
                        {/* 취소 — 대기/승인 상태 + 시작일 미래일 때만. v4 H2: 본인 직원도 취소 가능. */}
                        {(r.status === "pending" || r.status === "approved") && (() => {
                          const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
                          const isFuture = r.start_date > todayKst;
                          const isMine = (employees as any[])?.find((emp: any) => emp.id === r.employee_id)?.user_id === userId;
                          if (isEmployee && !isMine) return null;
                          return (
                            <button
                              onClick={() => {
                                if (!isFuture) return;
                                if (confirm(r.status === "approved" ? "승인된 휴가를 취소하시겠습니까? 연차 잔여가 복구됩니다." : "이 휴가 신청을 취소하시겠습니까?")) {
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

      {/* Leave Calendar */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[var(--text-muted)]">휴가 캘린더</h3>
          <input
            type="month"
            value={calMonth}
            onChange={(e) => setCalMonth(e.target.value)}
            className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm"
          />
        </div>
        <div className="glass-card overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-7 border-b border-[var(--border)]">
            {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
              <div
                key={d}
                className={`text-center text-xs font-medium py-2 ${
                  i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-[var(--text-dim)]"
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
                    isToday ? "text-[var(--primary)] font-bold" : dow === 0 ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-[var(--text-muted)]"
                  }`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {onLeave.slice(0, 3).map((l, idx) => (
                      <div
                        key={idx}
                        className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 truncate"
                        title={`${l.name} (${l.type})`}
                      >
                        {l.name}
                      </div>
                    ))}
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
        <div className="mt-6">
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
                          {u > 0 ? <span className="text-xs font-semibold text-red-400">{u}</span> : <span className="text-[10px] text-[var(--border)]">-</span>}
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-xs text-center font-bold text-red-400">{totalUsed > 0 ? totalUsed : "-"}</td>
                      <td className={`px-2 py-2.5 text-xs text-center font-bold ${remaining <= 0 ? "text-red-400" : remaining <= 3 ? "text-yellow-400" : "text-green-400"}`}>{remaining}</td>
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
        <div className="mt-6">
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
                                className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
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
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${n.notice_type === 'first' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-400'}`}>
                              {n.notice_type === "first" ? "1차" : "2차"}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-sm text-center">{Number(n.unused_days)}일</td>
                          <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{n.sent_at ? new Date(n.sent_at).toLocaleDateString("ko-KR") : "—"}</td>
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
  );
}

// ── Certificate Tab ──
function CertificateTab({ employees, companyId, userId, queryClient }: any) {
  const { toast } = useToast();
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [certType, setCertType] = useState<"employment" | "career">("employment");
  const [purpose, setPurpose] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const db = supabase as any;

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
      const { data } = await db.from("companies").select("*").eq("id", companyId).maybeSingle();
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
        hire_date: employee.hire_date || new Date().toISOString().slice(0, 10),
        end_date: !["active", "joined"].includes(employee.status) ? employee.updated_at?.slice(0, 10) : undefined,
        employee_number: employee.employee_number,
        birth_date: employee.birth_date,
      };

      const companyData = {
        name: companyInfo?.name || "",
        representative: companyInfo?.representative,
        address: companyInfo?.address,
        business_number: companyInfo?.business_number,
        seal_url: companyInfo?.seal_url,
      };

      let result;
      if (certType === "employment") {
        result = await generateEmploymentCertificate({
          employee: empData,
          company: companyData,
          purpose: purpose || undefined,
        });
      } else {
        result = await generateCareerCertificate({
          employee: empData,
          company: companyData,
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
      });

      queryClient.invalidateQueries({ queryKey: ["certificate-logs"] });
      setPurpose("");
      toast(`증명서가 발급되었습니다.\n증명서번호: ${result.certificateNumber}`, "success");
    } catch (err: any) {
      toast("증명서 발급 실패: " + (err?.message || err), "error");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div>
      {/* 연말정산 간소화 자료 수집 */}
      <YearEndTaxSection employees={activeEmployees} companyId={companyId} />

      {/* Issue Form */}
      <div className="glass-card p-6 mb-6">
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
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">용도</label>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="제출용, 은행, 비자 등"
              className="field-input"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleIssue}
              disabled={!selectedEmpId || isGenerating}
              className="w-full px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              {isGenerating ? "발급 중..." : "발급"}
            </button>
          </div>
        </div>
      </div>

      {/* Certificate Logs */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-muted)]">발급 이력</span>
        </div>
        {certLogs.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">📜</div>
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
                        ? "bg-blue-500/10 text-blue-400"
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
                    {log.created_at ? new Date(log.created_at).toLocaleDateString("ko") : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
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
    pending: { label: "미제출", bg: "bg-red-500/10", text: "text-red-400" },
    submitted: { label: "제출완료", bg: "bg-blue-500/10", text: "text-blue-400" },
    reviewed: { label: "검토완료", bg: "bg-green-500/10", text: "text-green-400" },
  };

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            🧾 연말정산 간소화 자료 수집
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
          <button onClick={sendReminderToAll} className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-xl text-xs font-semibold transition border border-amber-500/30">
            전체 안내 발송
          </button>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-[var(--text-muted)]">제출 진행률</span>
          <span className="font-bold">{counts.submitted + counts.reviewed} / {employees.length}명 ({completedPct}%)</span>
        </div>
        <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden flex">
          <div className="bg-blue-500" style={{ width: `${(counts.submitted / total) * 100}%` }} />
          <div className="bg-green-500" style={{ width: `${(counts.reviewed / total) * 100}%` }} />
        </div>
        <div className="flex gap-4 mt-2 text-[10px]">
          <span className="text-red-400">미제출 {counts.pending}명</span>
          <span className="text-blue-400">제출완료 {counts.submitted}명</span>
          <span className="text-green-400">검토완료 {counts.reviewed}명</span>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="text-center py-8 text-xs text-[var(--text-dim)]">재직 중인 직원이 없습니다</div>
      ) : (
        <div className="overflow-x-auto -mx-2">
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
        <div className="text-[10px] font-semibold text-[var(--text-muted)] mb-1.5">📌 안내</div>
        <ul className="text-[11px] text-[var(--text-muted)] leading-relaxed space-y-0.5">
          <li>• 홈택스 일정: 매년 1월 15일부터 간소화 자료 일괄제공</li>
          <li>• 부양가족 자료는 부양가족 본인이 자료제공 동의 후 조회 가능</li>
          <li>• 의료비/기부금/월세 등은 간소화에 누락될 수 있어 별도 영수증 수집 권장</li>
        </ul>
      </div>
    </div>
  );
}
