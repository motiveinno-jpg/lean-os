"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import {
  getSalaryHistory, addSalaryRecord, getActiveContracts, createContract,
  CONTRACT_TYPES, updateEmployee,
  // Attendance & Leave
  checkIn, checkOut, getAttendanceRecords, getMonthlyAttendanceSummary,
  calculateWeeklyHours,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  getLeaveBalances, initLeaveBalance, correctAttendanceRecord,
  LEAVE_TYPES, LEAVE_UNITS, ATTENDANCE_STATUS, LEAVE_REQUEST_STATUS,
  // Leave Promotion
  getLeavePromotionCandidates, sendLeavePromotionNotice, getLeavePromotionNotices,
} from "@/lib/hr";
import {
  getContractPackages, createContractPackage, sendContractPackage,
  getContractTemplates, cancelContractPackage, PACKAGE_STATUS,
} from "@/lib/hr-contracts";
import { applyCompanySeal } from "@/lib/signatures";
import {
  getExpenseRequests, createExpenseRequest, approveExpense, rejectExpense,
  markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS,
} from "@/lib/expenses";
import { uploadEmployeeFile } from "@/lib/file-storage";
import { previewPayroll } from "@/lib/payroll";
import { generateInsuranceEDI, downloadEDIFile, LOSS_REASONS } from "@/lib/insurance-edi";
import { QueryErrorBanner } from "@/components/query-status";
import { useToast } from "@/components/toast";
import { generateEmploymentCertificate, generateCareerCertificate, getCertificateLogs, saveCertificateLog } from "@/lib/certificates";
import { calculateRetirementPay, type PayrollItem } from "@/lib/payment-batch";
import { createEmployeeInvitation, getEmployeeInvitations, getInviteUrl, sendInviteEmail, cancelEmployeeInvitation } from "@/lib/invitations";
import dynamic from "next/dynamic";
const RichEditor = dynamic(() => import("@/components/rich-editor").then(m => ({ default: m.RichEditor })), { ssr: false, loading: () => <div className="h-48 bg-[var(--bg-surface)] rounded-xl animate-pulse" /> });

type Tab = "employees" | "salary" | "payroll" | "contracts" | "expenses" | "attendance" | "leave" | "certificates";

// Employee 역할은 자기 관련 탭만 접근 가능
const EMPLOYEE_ROLE_TABS: Tab[] = ["attendance", "leave", "expenses", "certificates"];

export default function EmployeesPage() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("employees");
  const [showForm, setShowForm] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { role } = useUser();
  const isEmployee = role === "employee";

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  // Employee 역할이면 허용 탭으로 강제 이동
  useEffect(() => {
    if (isEmployee && !EMPLOYEE_ROLE_TABS.includes(tab)) {
      setTab("attendance");
    }
  }, [isEmployee, tab]);

  // ── Employees ──
  const { data: employees = [], error: mainError, refetch: mainRefetch } = useQuery({
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

  // ── Salary History ──
  const { data: salaryHistory = [] } = useQuery({
    queryKey: ["salary-history", selectedEmpId],
    queryFn: () => getSalaryHistory(selectedEmpId!),
    enabled: !!selectedEmpId && tab === "salary",
  });

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
  const activeCount = employees.filter((e: any) => e.status === "active").length;

  const allTabs: { key: Tab; label: string; count?: number }[] = [
    { key: "employees", label: "인력관리", count: activeCount },
    { key: "salary", label: "급여이력" },
    { key: "payroll", label: "급여 명세" },
    { key: "contracts", label: "계약서" },
    { key: "expenses", label: "경비청구", count: expenses.filter((e: any) => e.status === "pending").length },
    { key: "attendance", label: "근태" },
    { key: "leave", label: "휴가" },
    { key: "certificates", label: "증명서 발급" },
  ];
  const tabs = isEmployee ? allTabs.filter(t => EMPLOYEE_ROLE_TABS.includes(t.key)) : allTabs;

  return (
    <div className="max-w-[1000px]">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">{isEmployee ? "근태 / 급여" : "인력 / 비용"}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{isEmployee ? "출퇴근 + 휴가 + 경비 + 증명서" : "직원관리 + 급여이력 + 계약서 + 경비청구 + 근태 + 휴가"}</p>
        </div>
      </div>

      {/* Summary — Employee 역할에게는 급여/인원/퇴직충당금 숨김 */}
      {!isEmployee && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-[var(--text-dim)]">재직 인원</div>
            <div className="text-lg font-bold mt-1">{activeCount}명</div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-[var(--text-dim)]">연 인건비</div>
            <div className="text-lg font-bold text-red-400 mt-1">₩{(totalSalary * 12).toLocaleString()}</div>
            <div className="text-[10px] text-[var(--text-dim)] mt-0.5">월 ₩{totalSalary.toLocaleString()}</div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-[var(--text-dim)]">퇴직충당금</div>
            <div className="text-lg font-bold text-[var(--warning)] mt-1">₩{totalRetirement.toLocaleString()}</div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-xs text-[var(--text-dim)]">미결 경비</div>
            <div className="text-lg font-bold text-yellow-400 mt-1">
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
              tab === t.key
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

      {/* Tab Content */}
      {tab === "employees" && <EmployeeTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} />}
      {tab === "salary" && <SalaryTab employees={employees} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId} salaryHistory={salaryHistory} companyId={companyId} userId={userId} queryClient={queryClient} />}
      {tab === "payroll" && <PayrollPreviewTab companyId={companyId} />}
      {tab === "contracts" && <ContractTab employees={employees} contracts={contracts} companyId={companyId} queryClient={queryClient} />}
      {tab === "expenses" && <ExpenseTab expenses={expenses} companyId={companyId} userId={userId} queryClient={queryClient} isEmployee={isEmployee} />}
      {tab === "attendance" && <AttendanceTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} role={role} />}
      {tab === "leave" && <LeaveTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} isEmployee={isEmployee} />}
      {tab === "certificates" && <CertificateTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} />}
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
};

function EmployeeTab({ employees, companyId, userId, queryClient }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "employee" as "employee" | "admin", department: "", position: "", salary: "" });
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [detailEmpId, setDetailEmpId] = useState<string | null>(null);
  const [showFlexSync, setShowFlexSync] = useState(false);
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
    leaveBalanceMap[b.employee_id] = b.remaining_days ?? (b.total_days - b.used_days);
  });

  // Flex 직원 데이터 (DB에서 조회)
  const { data: FLEX_EMPLOYEES = [] } = useQuery({
    queryKey: ["flex-employees", companyId],
    queryFn: async () => {
      // Try flex_sync_employees table first, fallback to showing current employees as preview
      const { data: flexData } = await (supabase as any)
        .from('employees')
        .select('name, position, department, employee_number, hire_date')
        .eq('company_id', companyId)
        .order('employee_number', { ascending: true });
      return (flexData || []).map((e: any) => ({
        name: e.name || '',
        position: e.position || '',
        department: e.department || '',
        employeeNumber: e.employee_number || '',
        hireDate: e.hire_date || '',
      }));
    },
    enabled: !!companyId && showFlexSync,
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
      const { data } = await supabase.from("companies").select("name, representative, address, business_number").eq("id", companyId!).single();
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
        hire_date: new Date().toISOString().slice(0, 10),
        status: "invited",
      });
      return invitation;
    },
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
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
      setForm({ email: "", name: "", role: "employee", department: "", position: "", salary: "" });
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

  // 초대 취소
  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelEmployeeInvitation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-invitations"] }),
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
          <button onClick={() => setShowFlexSync(!showFlexSync)} className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Flex 직원 동기화
          </button>
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
          <div className="grid grid-cols-4 gap-2 mb-3 text-[10px]">
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

      {/* Flex 직원 동기화 패널 */}
      {showFlexSync && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-purple-500/20 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-purple-600 text-white flex items-center justify-center text-[10px] font-bold">F</span>
                Flex 직원 동기화
              </h4>
              <p className="text-xs text-[var(--text-dim)] mt-0.5">Flex에서 가져온 구성원 데이터를 미리봅니다</p>
            </div>
            <button onClick={() => setShowFlexSync(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>
          <div className="space-y-2 mb-4">
            {FLEX_EMPLOYEES.map((fe: any) => (
              <div key={fe.employeeNumber} className="flex items-center justify-between px-4 py-3 rounded-xl bg-purple-500/5 border border-purple-500/10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-600/10 flex items-center justify-center text-purple-400 font-bold text-sm">{fe.name.charAt(0)}</div>
                  <div>
                    <div className="text-sm font-medium">{fe.name}</div>
                    <div className="text-[10px] text-[var(--text-dim)]">{fe.department} · {fe.position} · 사번{fe.employeeNumber}</div>
                  </div>
                </div>
                <div className="text-xs text-[var(--text-muted)]">입사 {fe.hireDate}</div>
              </div>
            ))}
          </div>
          <button
            disabled
            className="px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold opacity-50 cursor-not-allowed"
          >
            동기화 실행 (준비 중)
          </button>
          <p className="text-[10px] text-[var(--text-dim)] mt-2">Flex API 연동이 완료되면 자동으로 직원 데이터를 동기화합니다.</p>
        </div>
      )}

      {/* 초대 폼 */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h4 className="text-sm font-bold mb-4">직원 초대</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이메일 *</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="user@company.com" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이름</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="홍길동" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">역할</label>
              <div className="flex gap-2">
                <button onClick={() => setForm({...form, role: "employee"})} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition ${form.role === "employee" ? "bg-green-600 text-white border-green-600" : "text-[var(--text-muted)] border-[var(--border)]"}`}>직원</button>
                <button onClick={() => setForm({...form, role: "admin"})} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition ${form.role === "admin" ? "bg-blue-600 text-white border-blue-600" : "text-[var(--text-muted)] border-[var(--border)]"}`}>관리자</button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">부서</label><input value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">직위</label><input value={form.position} onChange={e => setForm({...form, position: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">연봉</label><input type="number" value={form.salary} onChange={e => setForm({...form, salary: e.target.value})} placeholder="36000000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div className="flex items-end gap-2">
              <button onClick={() => form.email && inviteMut.mutate()} disabled={!form.email || inviteMut.isPending} className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {inviteMut.isPending ? "전송중..." : "초대 전송"}
              </button>
              <button onClick={() => setShowForm(false)} className="px-3 py-2.5 text-[var(--text-muted)] text-sm">취소</button>
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-dim)]">초대 이메일이 발송되며, 직원이 가입 후 계약서 서명까지 완료하면 급여가 자동 반영됩니다.</p>
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {employees.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">👥</div><div className="text-sm text-[var(--text-muted)]">등록된 직원이 없습니다<br/><span className="text-xs">위 "직원 초대" 버튼으로 팀원을 초대하세요</span></div></div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
            <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left px-5 py-3 font-medium">이름</th>
              <th className="text-left px-5 py-3 font-medium">부서</th>
              <th className="text-left px-5 py-3 font-medium">직위</th>
              <th className="text-right px-5 py-3 font-medium">연봉</th>
              <th className="text-left px-5 py-3 font-medium">입사일</th>
              <th className="text-center px-5 py-3 font-medium">잔여연차</th>
              <th className="text-right px-5 py-3 font-medium">퇴직충당금</th>
              <th className="text-center px-5 py-3 font-medium">상태</th>
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
                          {leaveBalanceMap[e.id]}일
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--text-dim)]">미설정</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-right text-[var(--warning)]">₩{Number(e.retirement_accrual || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
      )}

      {/* Employee Detail Panel */}
      {detailEmpId && <EmployeeDetailPanel employeeId={detailEmpId} companyId={companyId} onClose={() => setDetailEmpId(null)} />}
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
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
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)]">
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

// ── Employee Detail Panel ──
function EmployeeDetailPanel({ employeeId, companyId, onClose }: { employeeId: string; companyId: string; onClose: () => void }) {
  const [detailTab, setDetailTab] = useState<"info" | "files" | "onboarding" | "docs" | "notes" | "history" | "contracts" | "certificates" | "leave">("info");
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();

  // Termination workflow state
  const [showTermModal, setShowTermModal] = useState(false);
  const [termDate, setTermDate] = useState(new Date().toISOString().slice(0, 10));
  const [termChecklist, setTermChecklist] = useState({ equipment: false, systemAccess: false, handover: false, insurance: false });
  const [terminating, setTerminating] = useState(false);
  const [termLossReason, setTermLossReason] = useState("11");
  const [ediGenerated, setEdiGenerated] = useState(false);

  // Retirement pay calculation state
  const [retirementEndDate, setRetirementEndDate] = useState(new Date().toISOString().slice(0, 10));

  // Company data for EDI generation
  const { data: companyInfo } = useQuery({
    queryKey: ["company-info-edi", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name, representative, address, business_number").eq("id", companyId).single();
      return data;
    },
    enabled: !!companyId,
  });

  // Fetch employee details
  const { data: emp } = useQuery({
    queryKey: ["employee-detail", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employees").select("*").eq("id", employeeId).single();
      return data;
    },
    enabled: !!employeeId,
  });

  // Fetch employee files
  const { data: files = [] } = useQuery({
    queryKey: ["employee-files", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employee_files").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!employeeId && detailTab === "files",
  });

  // Fetch onboarding checklist
  const { data: checklist = [] } = useQuery({
    queryKey: ["onboarding-checklist", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("onboarding_checklist_items").select("*").eq("employee_id", employeeId).order("item_key");
      return data || [];
    },
    enabled: !!employeeId && detailTab === "onboarding",
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

  // Fetch signature requests for this employee's contracts
  const { data: empSignatures = [] } = useQuery({
    queryKey: ["emp-signatures", employeeId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("signature_requests").select("*").eq("signer_email", emp?.email).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!employeeId && !!emp?.email && detailTab === "contracts",
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
      const { data } = await (supabase as any).from("leave_balances").select("*").eq("employee_id", employeeId).eq("year", currentYear).single();
      return data;
    },
    enabled: !!employeeId && detailTab === "leave",
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

  const FILE_CAT_LABELS: Record<string, string> = {
    resume: "이력서", id_copy: "신분증 사본", bank_copy: "통장 사본",
    resident_reg: "주민등록등본", portfolio: "포트폴리오", other: "기타",
  };

  if (!emp) return null;

  return (
    <div className="mt-4 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] font-bold text-lg">
            {emp.name?.charAt(0)}
          </div>
          <div>
            <div className="text-sm font-bold">{emp.name}</div>
            <div className="text-xs text-[var(--text-dim)]">{emp.department || ""} {emp.position || ""}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {emp.status !== "resigned" && (
            <button onClick={() => setShowTermModal(true)} className="px-3 py-1.5 text-[10px] font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition">
              퇴사 처리
            </button>
          )}
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg-surface)] rounded-lg text-[var(--text-dim)] transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Detail Tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
        {[
          { key: "info", label: "정보" },
          { key: "contracts", label: "계약서" },
          { key: "certificates", label: "증명서" },
          { key: "leave", label: "휴가" },
          { key: "files", label: "서류" },
          { key: "onboarding", label: "온보딩" },
          { key: "docs", label: "입사서류" },
          { key: "notes", label: "노트" },
          { key: "history", label: "발령" },
        ].map((t) => (
          <button key={t.key} onClick={() => setDetailTab(t.key as any)}
            className={`px-3 py-2 rounded-t-lg text-xs font-semibold transition whitespace-nowrap ${detailTab === t.key ? "bg-[var(--bg-surface)] text-[var(--text)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5 bg-[var(--bg-surface)] rounded-b-xl">
        {/* Info Tab — Flex-style sections */}
        {detailTab === "info" && (
          <div className="space-y-5">
            {/* 인사 정보 */}
            <div>
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                인사 정보
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="사번" value={emp.employee_number} />
                <InfoRow label="부서" value={emp.department} />
                <InfoRow label="직책" value={emp.position} />
                <InfoRow label="직급" value={emp.job_grade} />
                <InfoRow label="입사일" value={emp.hire_date} />
                <InfoRow label="근속기간" value={emp.hire_date ? (() => {
                  const d = new Date(emp.hire_date);
                  const now = new Date();
                  const years = now.getFullYear() - d.getFullYear();
                  const months = now.getMonth() - d.getMonth() + (years * 12);
                  const y = Math.floor(months / 12);
                  const m = months % 12;
                  return y > 0 ? `${y}년 ${m}개월` : `${m}개월`;
                })() : undefined} />
                <InfoRow label="고용형태" value={emp.employment_type === "regular" ? "정규직" : emp.employment_type === "contract" ? "계약직" : emp.employment_type === "parttime" ? "파트타임" : emp.employment_type === "intern" ? "인턴" : emp.employment_type || ""} />
                <InfoRow label="4대보험" value={emp.is_4_insurance ? "가입" : "미가입"} />
              </div>
            </div>
            {/* 기본 정보 */}
            <div>
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                기본 정보
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="이메일" value={emp.email} />
                <InfoRow label="전화번호" value={emp.phone} />
                <InfoRow label="생년월일" value={emp.birth_date} />
                <InfoRow label="주소" value={emp.address} />
                <InfoRow label="비상연락처" value={emp.emergency_contact ? `${emp.emergency_contact} (${emp.emergency_phone || ""})` : undefined} />
                <InfoRow label="전자서명" value={emp.saved_signature ? "등록됨" : "미등록"} />
              </div>
            </div>
            {/* 급여/계좌 정보 */}
            <div>
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
                급여 · 계좌
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="월 급여" value={emp.salary ? `₩${Number(emp.salary).toLocaleString()}` : undefined} />
                <InfoRow label="퇴직충당금" value={emp.retirement_accrual ? `₩${Number(emp.retirement_accrual).toLocaleString()}` : undefined} />
                <InfoRow label="급여 은행" value={BANK_LABELS[emp.bank_name] || emp.bank_name} />
                <InfoRow label="계좌번호" value={emp.bank_account} />
                <InfoRow label="예금주" value={emp.bank_holder} />
              </div>
            </div>
            {/* 퇴직금 계산 */}
            {emp.hire_date && emp.salary && (() => {
              const retCalcResult = calculateRetirementPay({
                startDate: emp.hire_date,
                endDate: retirementEndDate,
                last3MonthsSalary: Number(emp.salary) * 3,
              });
              const hireDate = new Date(emp.hire_date);
              const endDate = new Date(retirementEndDate);
              const diffMs = endDate.getTime() - hireDate.getTime();
              const totalDaysRaw = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              const tenureYears = Math.floor(totalDaysRaw / 365);
              const tenureMonths = Math.floor((totalDaysRaw % 365) / 30);
              const tenureDays = totalDaysRaw % 365 % 30;

              return (
                <div>
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    퇴직금 계산
                  </div>
                  <div className="bg-[var(--bg)] rounded-xl border border-[var(--border)] p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-[10px] text-[var(--text-dim)] mb-0.5">입사일</div>
                        <div className="font-medium">{emp.hire_date}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-dim)] mb-0.5">퇴직일 (예상)</div>
                        <input
                          type="date"
                          value={retirementEndDate}
                          onChange={(e) => setRetirementEndDate(e.target.value)}
                          className="w-full px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-dim)] mb-0.5">근속기간</div>
                        <div className="font-medium">
                          {tenureYears > 0 && `${tenureYears}년 `}{tenureMonths > 0 && `${tenureMonths}개월 `}{tenureDays}일
                          <span className="text-[var(--text-dim)] ml-1">({totalDaysRaw}일)</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-dim)] mb-0.5">월 평균임금</div>
                        <div className="font-medium">{`₩${Number(emp.salary).toLocaleString("ko-KR")}`}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-dim)] mb-0.5">1일 평균임금</div>
                        <div className="font-medium">{`₩${retCalcResult.dailyAvgWage.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-dim)] mb-0.5">수급 자격</div>
                        <div className={`font-medium ${retCalcResult.eligible ? "text-green-400" : "text-amber-500"}`}>
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
        {detailTab === "files" && (
          <div className="space-y-2">
            {files.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--text-dim)]">제출된 서류가 없습니다</div>
            ) : (
              files.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between px-4 py-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                  <div className="flex items-center gap-3 min-w-0">
                    <svg className="w-4 h-4 text-[var(--primary)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{f.file_name}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">{FILE_CAT_LABELS[f.category] || f.category} · {(f.file_size / 1024).toFixed(0)}KB</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.verified ? (
                      <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full">확인됨</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded-full">미확인</span>
                    )}
                    <a href={f.file_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--primary)] hover:underline">보기</a>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Onboarding Tab */}
        {detailTab === "onboarding" && (
          <div className="space-y-2">
            {emp.onboarding_completed_at ? (
              <div className="text-center py-4">
                <div className="text-green-500 text-sm font-semibold mb-1">온보딩 완료</div>
                <div className="text-xs text-[var(--text-dim)]">{new Date(emp.onboarding_completed_at).toLocaleDateString("ko-KR")}</div>
              </div>
            ) : (
              <div className="text-center py-2 mb-3">
                <span className="text-xs px-3 py-1 bg-amber-500/10 text-amber-500 rounded-full font-medium">온보딩 진행 중</span>
              </div>
            )}
            {checklist.length === 0 && !emp.onboarding_completed_at ? (
              <div className="text-center py-4 text-sm text-[var(--text-dim)]">아직 온보딩을 시작하지 않았습니다</div>
            ) : (
              checklist.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                  {item.completed ? (
                    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg className="w-4 h-4 text-[var(--text-dim)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                  )}
                  <span className={`text-xs ${item.completed ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{item.label}</span>
                  {item.completed_at && <span className="ml-auto text-[10px] text-[var(--text-dim)]">{new Date(item.completed_at).toLocaleDateString("ko-KR")}</span>}
                </div>
              ))
            )}
          </div>
        )}

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

        {/* Contracts Tab — Flex-style 계약서 목록 */}
        {detailTab === "contracts" && (
          <div className="space-y-2">
            {empContracts.length === 0 && empSignatures.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--text-dim)]">계약서가 없습니다</div>
            ) : (
              <>
                {empContracts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-[var(--text-muted)] mb-1">근로 계약</div>
                    {empContracts.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                        <div className="min-w-0">
                          <div className="text-xs font-medium">{c.contract_type === "regular" ? "정규직 근로계약서" : c.contract_type === "contract" ? "계약직 근로계약서" : c.contract_type || "근로계약서"}</div>
                          <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{c.start_date}{c.end_date ? ` ~ ${c.end_date}` : " ~ 현재"}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.status === "active" ? "bg-green-500/10 text-green-400" : "bg-gray-500/10 text-gray-400"}`}>
                          {c.status === "active" ? "유효" : "종료"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {empSignatures.length > 0 && (
                  <div className="space-y-2 mt-3">
                    <div className="text-xs font-bold text-[var(--text-muted)] mb-1">전자서명 요청</div>
                    {empSignatures.map((s: any) => {
                      const SIG_STATUS: Record<string, { label: string; color: string }> = {
                        pending: { label: "대기", color: "text-amber-500 bg-amber-500/10" },
                        sent: { label: "발송", color: "text-blue-400 bg-blue-500/10" },
                        viewed: { label: "열람", color: "text-blue-400 bg-blue-500/10" },
                        signed: { label: "서명완료", color: "text-green-400 bg-green-500/10" },
                        rejected: { label: "거절", color: "text-red-400 bg-red-500/10" },
                        expired: { label: "만료", color: "text-gray-400 bg-gray-500/10" },
                      };
                      const st = SIG_STATUS[s.status] || SIG_STATUS.pending;
                      return (
                        <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{s.title || "서명 요청"}</div>
                            <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                              {s.created_at ? new Date(s.created_at).toLocaleDateString("ko-KR") : ""}
                              {s.signed_at ? ` · 서명: ${new Date(s.signed_at).toLocaleDateString("ko-KR")}` : ""}
                            </div>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Certificates Tab — 증명서 발급/이력 */}
        {detailTab === "certificates" && (
          <div className="space-y-4">
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
                    <div key={log.id} className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                      <div>
                        <div className="text-xs font-medium">{log.certificate_type}</div>
                        <div className="text-[10px] text-[var(--text-dim)]">{log.certificate_number} · {new Date(log.created_at).toLocaleDateString("ko-KR")}</div>
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
          <div className="space-y-4">
            {/* Leave balance summary */}
            {empLeaveBalance ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 text-center">
                  <div className="text-[10px] text-[var(--text-dim)]">총 부여</div>
                  <div className="text-lg font-bold text-[var(--text)] mt-0.5">{empLeaveBalance.total_days}일</div>
                </div>
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 text-center">
                  <div className="text-[10px] text-[var(--text-dim)]">사용</div>
                  <div className="text-lg font-bold text-red-400 mt-0.5">{empLeaveBalance.used_days}일</div>
                </div>
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 text-center">
                  <div className="text-[10px] text-[var(--text-dim)]">잔여</div>
                  <div className={`text-lg font-bold mt-0.5 ${(empLeaveBalance.remaining_days ?? empLeaveBalance.total_days - empLeaveBalance.used_days) <= 3 ? "text-yellow-400" : "text-green-400"}`}>
                    {empLeaveBalance.remaining_days ?? (empLeaveBalance.total_days - empLeaveBalance.used_days)}일
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 text-center text-xs text-[var(--text-dim)]">
                {currentYear}년 연차가 아직 설정되지 않았습니다
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
                      <div className="text-[10px] text-[var(--text-dim)]">{lt.label}</div>
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
                      pending: "text-amber-500 bg-amber-500/10",
                      approved: "text-green-400 bg-green-500/10",
                      rejected: "text-red-400 bg-red-500/10",
                    };
                    return (
                      <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
                        <div>
                          <div className="text-xs font-medium">{typeLabel} · {r.days}일</div>
                          <div className="text-[10px] text-[var(--text-dim)]">{r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[r.status] || "text-gray-400 bg-gray-500/10"}`}>
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
              last3MonthsSalary: Number(emp.salary) * 3,
            })
          : null;
        const allChecked = termChecklist.equipment && termChecklist.systemAccess && termChecklist.handover && termChecklist.insurance;

        async function confirmTermination() {
          setTerminating(true);
          try {
            await (supabase as any).from("employees").update({
              status: "resigned",
              resignation_date: termDate,
            }).eq("id", employeeId);
            queryClient.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
            queryClient.invalidateQueries({ queryKey: ["employees"] });
            setShowTermModal(false);
          } finally {
            setTerminating(false);
          }
        }

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowTermModal(false)}>
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div className="text-sm font-bold text-red-400">퇴사 처리</div>
                <button onClick={() => setShowTermModal(false)} className="p-1 hover:bg-[var(--bg-surface)] rounded-lg text-[var(--text-dim)]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-5 space-y-4">
                {/* Employee name */}
                <div className="text-xs text-[var(--text-dim)]">
                  대상: <span className="font-semibold text-[var(--text)]">{emp.name}</span> ({emp.department || ""} {emp.position || ""})
                </div>

                {/* 퇴사일 */}
                <div>
                  <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1.5">퇴사일</label>
                  <input
                    type="date"
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
                      <div><span className="text-[var(--text-dim)]">수급 자격:</span> <span className={`font-medium ${retCalc.eligible ? "text-green-400" : "text-red-400"}`}>{retCalc.eligible ? "해당" : "미해당 (1년 미만)"}</span></div>
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
                    {ediGenerated && <span className="text-[10px] text-green-400 font-medium">생성 완료</span>}
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
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition"
                  >
                    {ediGenerated ? "EDI 파일 다운로드 완료" : "EDI 파일 생성 (4건 다운로드)"}
                  </button>
                </div>

                {/* 확정 버튼 */}
                <button
                  onClick={confirmTermination}
                  disabled={!allChecked || terminating}
                  className="w-full py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition"
                >
                  {terminating ? "처리 중..." : "퇴사 확정"}
                </button>
                {!allChecked && (
                  <div className="text-[10px] text-center text-[var(--text-dim)]">모든 체크리스트를 완료해야 퇴사를 확정할 수 있습니다</div>
                )}
              </div>
            </div>
          </div>
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
  const saved: Record<string, { completed: boolean; fileUrl?: string; fileName?: string; uploadedAt?: string }> =
    (emp?.onboarding_docs && typeof emp.onboarding_docs === "object") ? emp.onboarding_docs : {};

  const items: OnboardingDocItem[] = ONBOARDING_DOC_DEFAULTS.map((d) => ({
    ...d,
    completed: saved[d.key]?.completed || false,
    fileUrl: saved[d.key]?.fileUrl,
    fileName: saved[d.key]?.fileName,
    uploadedAt: saved[d.key]?.uploadedAt,
  }));

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
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
      });
      toast("파일이 업로드되었습니다", "success");
    } catch (err: any) {
      toast(err.message || "업로드 실패", "error");
    } finally {
      setUploading(null);
    }
  }

  async function toggleCheck(key: string, checked: boolean) {
    await saveDocState(key, { completed: checked, uploadedAt: checked ? new Date().toISOString() : undefined });
  }

  return (
    <div className="space-y-4">
      {/* Progress summary */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
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
            <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full font-medium">필수 완료</span>
          )}
        </div>
      </div>

      {/* Document checklist */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${item.completed ? "bg-green-500/5 border-green-500/20" : "bg-[var(--bg-card)] border-[var(--border)]"}`}>
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
                  <span className="text-[9px] px-1.5 py-0.5 bg-gray-500/10 text-[var(--text-dim)] rounded-full">선택</span>
                )}
                {item.autoGen && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded-full font-medium">자동생성</span>
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
              {item.fileUrl && (
                <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--primary)] hover:underline">
                  보기
                </a>
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
    <div className="space-y-3">
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
            <div key={i} className="px-4 py-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
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
    <div className="space-y-3">
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
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
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
              <input
                type="date"
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

// ── Certificate Quick Issue Button ──
function CertQuickIssue({ type, label, emp, companyId, queryClient }: { type: "employment" | "career"; label: string; emp: any; companyId: string; queryClient: any }) {
  const { toast } = useToast();
  const [issuing, setIssuing] = useState(false);
  async function issue() {
    setIssuing(true);
    try {
      const { data: company } = await supabase.from("companies").select("name, representative, address, business_number, seal_url").eq("id", companyId).single();
      if (!company) { toast("회사 정보를 불러올 수 없습니다", "error"); return; }
      const empData = { name: emp.name, department: emp.department || "", position: emp.position || "", hire_date: emp.hire_date, employee_number: emp.employee_number, birth_date: emp.birth_date };
      const companyData = { name: company.name, representative: company.representative || "", address: company.address || "", business_number: company.business_number || "", seal_url: company.seal_url || "" };

      let result: { pdf: Blob; certificateNumber: string };
      if (type === "employment") {
        result = await generateEmploymentCertificate({ employee: empData, company: companyData, purpose: "제출용" });
      } else {
        result = await generateCareerCertificate({
          employee: { ...empData, end_date: emp.end_date },
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
      toast(err.message || "증명서 생성 실패", "error");
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

// ── Salary Tab ──
function SalaryTab({ employees, selectedEmpId, setSelectedEmpId, salaryHistory, companyId, userId, queryClient }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ effectiveDate: "", salary: "", reason: "" });

  const addSalary = useMutation({
    mutationFn: () => addSalaryRecord({
      companyId, employeeId: selectedEmpId!, effectiveDate: form.effectiveDate,
      salary: Number(form.salary), changeReason: form.reason, approvedBy: userId,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["salary-history"] }); setShowForm(false); setForm({ effectiveDate: "", salary: "", reason: "" }); },
  });

  return (
    <div>
      <div className="flex gap-4 mb-6">
        <select value={selectedEmpId || ""} onChange={e => setSelectedEmpId(e.target.value || null)} className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
          <option value="">직원 선택...</option>
          {employees.filter((e: any) => e.status === 'active').map((e: any) => (
            <option key={e.id} value={e.id}>{e.name} ({e.department || '미배정'})</option>
          ))}
        </select>
        {selectedEmpId && <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">+ 급여 변경</button>}
      </div>

      {showForm && selectedEmpId && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">적용일 *</label><input type="date" value={form.effectiveDate} onChange={e => setForm({...form, effectiveDate: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">변경 급여 *</label><input type="number" value={form.salary} onChange={e => setForm({...form, salary: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">사유</label><input value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="승진, 연봉협상 등" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
          </div>
          <button onClick={() => form.effectiveDate && form.salary && addSalary.mutate()} disabled={!form.effectiveDate || !form.salary} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">등록</button>
        </div>
      )}

      {!selectedEmpId ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
          <div className="text-4xl mb-4">💰</div>
          <div className="text-sm text-[var(--text-muted)]">직원을 선택하면 급여이력이 표시됩니다</div>
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {salaryHistory.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--text-muted)]">급여 변경 이력이 없습니다</div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">적용일</th>
                <th className="text-right px-5 py-3 font-medium">급여</th>
                <th className="text-right px-5 py-3 font-medium">이전 급여</th>
                <th className="text-left px-5 py-3 font-medium">사유</th>
                <th className="text-left px-5 py-3 font-medium">승인자</th>
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

// ── HR 기본 서식 정의 ──
const HR_TEMPLATES = [
  { key: "comprehensive_labor", label: "포괄근로계약서", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { key: "salary_contract", label: "연봉계약서", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "nda", label: "비밀유지서약서", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { key: "non_compete", label: "겸업금지서약서", icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" },
  { key: "personal_info_consent", label: "개인정보이용동의서", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
];

// ── Contract Tab (전자계약 — 플렉스 스타일) ──
function ContractTab({ employees, contracts, companyId, queryClient }: any) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [reqForm, setReqForm] = useState({ employeeId: "", title: "", templateIds: [] as string[] });
  const [sending, setSending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);
  const [selectedHrTemplate, setSelectedHrTemplate] = useState<string | null>(null);
  const [sealApplying, setSealApplying] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] = useState<{
    salary: string;
    workHours: string;
    duty: string;
    includeMealAllowance: boolean;
  }>({ salary: "", workHours: "09:00~18:00", duty: "", includeMealAllowance: false });
  const [wizardStep, setWizardStep] = useState(1); // 1: 대상 선택, 2: 서식 선택, 3: 미리보기/확인
  const [contractSubTab, setContractSubTab] = useState<"contracts" | "company_docs">("contracts");
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // 계약 내역
  const { data: contractList = [] } = useQuery({
    queryKey: ["contract-packages", companyId],
    queryFn: () => getContractPackages(companyId!),
    enabled: !!companyId,
  });

  // 계약서 서식
  const { data: templates = [] } = useQuery({
    queryKey: ["contract-templates", companyId],
    queryFn: () => getContractTemplates(companyId!),
    enabled: !!companyId,
  });

  // 계약 요청 생성
  const createContract = useMutation({
    mutationFn: async () => {
      const emp = employees.find((e: any) => e.id === reqForm.employeeId);
      return createContractPackage({
        companyId: companyId!,
        employeeId: reqForm.employeeId,
        title: reqForm.title || `${emp?.name || ""} ${new Date().getFullYear()}년 계약`,
        templateIds: reqForm.templateIds,
        createdBy: "system",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
      setShowCreate(false);
      setReqForm({ employeeId: "", title: "", templateIds: [] });
    },
    onError: (err: any) => toast(err.message, "error"),
  });

  // 서명 요청 발송
  async function handleSendSignRequest(contractId: string) {
    setSending(contractId);
    try {
      const result = await sendContractPackage(contractId);
      if (!result.success) toast("발송 실패: " + (result.error || "알 수 없는 오류"), "error");
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setSending(null);
    }
  }

  // 계약 취소
  const cancelContract = useMutation({
    mutationFn: cancelContractPackage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contract-packages"] }),
  });

  // 일괄 발송
  async function handleBatchSend() {
    const draftIds = Array.from(selectedIds).filter(id =>
      contractList.find((c: any) => c.id === id && c.status === "draft")
    );
    if (draftIds.length === 0) return;
    setBatchSending(true);
    for (const id of draftIds) {
      try {
        await sendContractPackage(id);
      } catch (_) { /* skip failures */ }
    }
    queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    setSelectedIds(new Set());
    setBatchSending(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allEmployees = employees.filter((e: any) => ["active", "joined", "contract_pending"].includes(e.status));

  // 선택된 직원 데이터로 템플릿 미리보기 자동 채움
  const selectedEmployee = employees.find((e: any) => e.id === reqForm.employeeId);

  // 직인 적용 핸들러
  async function handleApplySeal(contractId: string) {
    if (!companyId) return;
    setSealApplying(contractId);
    try {
      await applyCompanySeal({ documentId: contractId, companyId, appliedBy: "system" });
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
      toast("직인이 적용되었습니다.", "success");
    } catch (err: any) {
      toast("직인 적용 실패: " + (err.message || "알 수 없는 오류"), "error");
    } finally {
      setSealApplying(null);
    }
  }

  function toggleTemplate(id: string) {
    setReqForm(prev => ({
      ...prev,
      templateIds: prev.templateIds.includes(id)
        ? prev.templateIds.filter(t => t !== id)
        : [...prev.templateIds, id],
    }));
  }

  // 상태 필터링
  const filteredContracts = statusFilter === "all"
    ? contractList
    : contractList.filter((c: any) => c.status === statusFilter);

  // 상태별 카운트
  const statusCounts = {
    all: contractList.length,
    draft: contractList.filter((c: any) => c.status === "draft").length,
    sent: contractList.filter((c: any) => c.status === "sent" || c.status === "partially_signed").length,
    completed: contractList.filter((c: any) => c.status === "completed").length,
    cancelled: contractList.filter((c: any) => c.status === "cancelled").length,
  };

  return (
    <div>
      {/* 상단 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-bold text-[var(--text)]">전자계약</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">구성원에게 계약서를 발송하고 전자서명을 받습니다</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplateEditor(!showTemplateEditor)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            + 계약서식 추가
          </button>
          <button
            onClick={() => { setShowCreate(!showCreate); setWizardStep(1); }}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            계약 요청
          </button>
        </div>
      </div>

      {/* 서식 에디터 (WYSIWYG) */}
      {showTemplateEditor && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-emerald-500/20 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-emerald-600 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                계약서식 에디터
              </h4>
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">서식을 작성하고 저장하면 계약 요청 시 사용할 수 있습니다. {"{{직원명}}, {{부서}}, {{직위}}, {{연봉}}"} 등의 변수를 사용하세요.</p>
            </div>
            <button onClick={() => setShowTemplateEditor(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">서식 이름 *</label>
            <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="예: 2026년 정규직 근로계약서" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">서식 내용 *</label>
            <RichEditor content={newTemplateBody} onChange={setNewTemplateBody} placeholder="계약서 내용을 입력하세요... {{직원명}}, {{부서}} 등의 변수를 사용할 수 있습니다." />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                if (!newTemplateName.trim() || !newTemplateBody.trim() || !companyId) return;
                setSavingTemplate(true);
                try {
                  await (supabase as any).from("doc_templates").insert({
                    company_id: companyId,
                    name: newTemplateName.trim(),
                    body: newTemplateBody,
                    variables: (newTemplateBody.match(/\{\{[^}]+\}\}/g) || []).map((v: string) => v.replace(/[{}]/g, "")),
                  });
                  queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
                  toast("서식이 저장되었습니다.", "success");
                  setNewTemplateName("");
                  setNewTemplateBody("");
                  setShowTemplateEditor(false);
                } catch (err: any) { toast("저장 실패: " + (err.message || ""), "error"); }
                setSavingTemplate(false);
              }}
              disabled={!newTemplateName.trim() || !newTemplateBody.trim() || savingTemplate}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition"
            >
              {savingTemplate ? "저장 중..." : "서식 저장"}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {["{{직원명}}", "{{부서}}", "{{직위}}", "{{연봉}}", "{{입사일}}", "{{회사명}}", "{{대표자}}"].map(v => (
                <button key={v} type="button" onClick={() => setNewTemplateBody(prev => prev + v)} className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition">{v}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 서브탭: 계약 관리 / 회사 문서 */}
      <div className="flex gap-1 mb-5 bg-[var(--bg-surface)] rounded-lg p-0.5 w-fit">
        <button onClick={() => setContractSubTab("contracts")} className={`px-4 py-2 rounded-md text-xs font-semibold transition ${contractSubTab === "contracts" ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>계약 관리</button>
        <button onClick={() => setContractSubTab("company_docs")} className={`px-4 py-2 rounded-md text-xs font-semibold transition ${contractSubTab === "company_docs" ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>회사 문서</button>
      </div>

      {/* 회사 문서 관리 */}
      {contractSubTab === "company_docs" && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {[
              { key: "business_reg", label: "사업자등록증", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", desc: "사업자등록증 사본" },
              { key: "employment_rules", label: "취업규칙", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253", desc: "회사 취업규칙/사규" },
              { key: "corporate_reg", label: "법인등기부등본", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", desc: "법인 등기부등본" },
              { key: "seal_cert", label: "인감증명서", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", desc: "법인 인감증명서" },
              { key: "bank_cert", label: "통장사본", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z", desc: "법인 통장 사본" },
              { key: "etc_docs", label: "기타 문서", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z", desc: "기타 회사 필수 문서" },
            ].map(doc => (
              <div key={doc.key} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 hover:border-[var(--primary)]/30 transition group">
                <div className="flex items-start justify-between mb-3">
                  <svg className="w-6 h-6 text-[var(--text-dim)] group-hover:text-[var(--primary)] transition" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={doc.icon} /></svg>
                  <label className="px-2.5 py-1 bg-[var(--primary)]/10 text-[var(--primary)] text-[10px] font-semibold rounded-lg cursor-pointer hover:bg-[var(--primary)]/20 transition">
                    업로드
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={async (ev) => {
                      const file = ev.target.files?.[0];
                      if (!file || !companyId) return;
                      try {
                        const path = `company-docs/${companyId}/${doc.key}_${Date.now()}.${file.name.split('.').pop()}`;
                        await supabase.storage.from("documents").upload(path, file, { upsert: true });
                        toast(`${doc.label} 업로드 완료`, "success");
                      } catch (err: any) { toast("업로드 실패: " + (err.message || ""), "error"); }
                    }} />
                  </label>
                </div>
                <div className="text-sm font-semibold mb-0.5">{doc.label}</div>
                <div className="text-[10px] text-[var(--text-dim)]">{doc.desc}</div>
              </div>
            ))}
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-xs text-[var(--text-muted)]">
            <p>회사 필수 문서를 관리합니다. 업로드된 문서는 계약서 발송, 증명서 발급 등에 활용됩니다.</p>
          </div>
        </div>
      )}

      {contractSubTab === "contracts" && <>
      {/* 기본 HR 서식 */}
      <div className="mb-6">
        <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          기본 HR 서식
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {HR_TEMPLATES.map((ht) => (
            <button
              key={ht.key}
              onClick={() => {
                setSelectedHrTemplate(selectedHrTemplate === ht.key ? null : ht.key);
                if (selectedHrTemplate !== ht.key) setShowCreate(true);
              }}
              className={`text-left px-4 py-3 rounded-xl border transition group ${
                selectedHrTemplate === ht.key
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--primary)]/40"
              }`}
            >
              <svg className={`w-5 h-5 mb-1.5 ${selectedHrTemplate === ht.key ? "text-[var(--primary)]" : "text-[var(--text-dim)] group-hover:text-[var(--primary)]"}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={ht.icon} />
              </svg>
              <div className={`text-xs font-medium ${selectedHrTemplate === ht.key ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{ht.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 인라인 서식 미리보기/편집 */}
      {selectedHrTemplate && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--primary)]/20 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-[var(--primary)]">
              {HR_TEMPLATES.find(t => t.key === selectedHrTemplate)?.label} 미리보기
            </h4>
            <button onClick={() => setSelectedHrTemplate(null)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>

          {/* 직원 자동 채움 필드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직원명</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.name || "(직원 선택 필요)"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직급</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.job_grade || selectedEmployee?.position || "—"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직책</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.position || "—"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">부서</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.department || "—"}
              </div>
            </div>
          </div>

          {/* 편집 가능 필드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">연봉</label>
              <input
                type="text"
                value={templatePreview.salary || (selectedEmployee ? String(Number(selectedEmployee.salary || 0) * 12) : "")}
                onChange={(e) => setTemplatePreview({ ...templatePreview, salary: e.target.value })}
                placeholder="36000000"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">근무시간</label>
              <input
                type="text"
                value={templatePreview.workHours}
                onChange={(e) => setTemplatePreview({ ...templatePreview, workHours: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직무</label>
              <input
                type="text"
                value={templatePreview.duty}
                onChange={(e) => setTemplatePreview({ ...templatePreview, duty: e.target.value })}
                placeholder="소프트웨어 개발"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-2">
                <input
                  type="checkbox"
                  checked={templatePreview.includeMealAllowance}
                  onChange={(e) => setTemplatePreview({ ...templatePreview, includeMealAllowance: e.target.checked })}
                  className="rounded border-[var(--border)]"
                />
                <span className="text-xs text-[var(--text)]">식대포함</span>
              </label>
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4 text-xs text-[var(--text-muted)] leading-relaxed">
            <p className="font-semibold text-[var(--text)] mb-2">{HR_TEMPLATES.find(t => t.key === selectedHrTemplate)?.label}</p>
            <p>상기 {selectedHrTemplate === "nda" ? "비밀유지서약" : selectedHrTemplate === "non_compete" ? "겸업금지서약" : selectedHrTemplate === "personal_info_consent" ? "개인정보 이용 동의" : "근로계약"}에 관하여, 아래와 같이 체결합니다.</p>
            <div className="mt-2 space-y-1">
              <p>성명: {selectedEmployee?.name || "________"}</p>
              <p>부서: {selectedEmployee?.department || "________"} / 직책: {selectedEmployee?.position || "________"}</p>
              {(selectedHrTemplate === "comprehensive_labor" || selectedHrTemplate === "salary_contract") && (
                <>
                  <p>연봉: {templatePreview.salary ? `₩${Number(templatePreview.salary).toLocaleString()}` : "________"}{templatePreview.includeMealAllowance ? " (식대 포함)" : ""}</p>
                  <p>근무시간: {templatePreview.workHours || "________"}</p>
                  <p>직무: {templatePreview.duty || "________"}</p>
                </>
              )}
            </div>
            <p className="mt-3 text-[10px] text-[var(--text-dim)]">* 위 내용은 미리보기이며, 최종 계약서는 서식에 따라 생성됩니다.</p>
          </div>
        </div>
      )}

      {/* 계약 요청 스텝 위저드 */}
      {showCreate && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          {/* 스텝 인디케이터 */}
          <div className="flex items-center gap-2 mb-6">
            {[{ n: 1, label: "대상 선택" }, { n: 2, label: "서식 선택" }, { n: 3, label: "확인 및 발송" }].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${wizardStep >= s.n ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-dim)] border border-[var(--border)]"}`}>{s.n}</div>
                <span className={`text-xs font-medium ${wizardStep >= s.n ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{s.label}</span>
                {i < 2 && <div className={`w-8 h-px ${wizardStep > s.n ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: 대상 선택 */}
          {wizardStep === 1 && (
            <div>
              <h4 className="text-sm font-bold mb-4">Step 1: 구성원 선택</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">구성원 *</label>
                  <select value={reqForm.employeeId} onChange={e => setReqForm({...reqForm, employeeId: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                    <option value="">구성원을 선택하세요</option>
                    {allEmployees.map((e: any) => (<option key={e.id} value={e.id}>{e.name} · {e.department || "미배정"} · {e.position || "미지정"}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">계약 제목</label>
                  <input value={reqForm.title} onChange={e => setReqForm({...reqForm, title: e.target.value})} placeholder={`${new Date().getFullYear()}년 연봉계약`} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
              </div>
              {reqForm.employeeId && selectedEmployee && (
                <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] font-bold">{(selectedEmployee.name || "?")[0]}</div>
                    <div>
                      <div className="text-sm font-semibold">{selectedEmployee.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">{selectedEmployee.department || "미배정"} · {selectedEmployee.position || "미지정"} · {selectedEmployee.email || ""}</div>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => reqForm.employeeId && setWizardStep(2)} disabled={!reqForm.employeeId} className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">다음</button>
                <button onClick={() => { setShowCreate(false); setWizardStep(1); setReqForm({ employeeId: "", title: "", templateIds: [] }); }} className="px-4 py-2.5 text-sm text-[var(--text-muted)]">취소</button>
              </div>
            </div>
          )}

          {/* Step 2: 서식 선택 */}
          {wizardStep === 2 && (
            <div>
              <h4 className="text-sm font-bold mb-4">Step 2: 계약서 서식 선택</h4>
              {templates.length === 0 ? (
                <p className="text-xs text-[var(--text-dim)] mb-4">등록된 서식이 없습니다. HR 서식을 사용해주세요.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                  {templates.map((t: any) => {
                    const selected = reqForm.templateIds.includes(t.id);
                    return (
                      <button key={t.id} onClick={() => toggleTemplate(t.id)} className={`text-left px-4 py-3 rounded-xl border transition ${selected ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]/50"}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${selected ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)]"}`}>
                            {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                          <span className="text-sm font-medium">{t.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setWizardStep(1)} className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-xl">이전</button>
                <button onClick={() => reqForm.templateIds.length > 0 && setWizardStep(3)} disabled={reqForm.templateIds.length === 0} className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">다음</button>
              </div>
            </div>
          )}

          {/* Step 3: 확인 및 발송 */}
          {wizardStep === 3 && (
            <div>
              <h4 className="text-sm font-bold mb-4">Step 3: 확인 및 발송</h4>
              <div className="bg-[var(--bg-surface)] rounded-xl p-5 mb-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-muted)]">대상</span>
                  <span className="font-semibold">{selectedEmployee?.name || "—"} ({selectedEmployee?.department || "미배정"})</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-muted)]">제목</span>
                  <span className="font-semibold">{reqForm.title || `${selectedEmployee?.name || ""} ${new Date().getFullYear()}년 계약`}</span>
                </div>
                <div className="text-sm">
                  <span className="text-[var(--text-muted)]">선택된 서식 ({reqForm.templateIds.length}건)</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {reqForm.templateIds.map(tid => {
                      const t = templates.find((tt: any) => tt.id === tid);
                      return <span key={tid} className="text-xs px-2.5 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-medium">{t?.name || tid}</span>;
                    })}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setWizardStep(2)} className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-xl">이전</button>
                <button onClick={() => { createContract.mutate(); setWizardStep(1); }} disabled={createContract.isPending} className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition">
                  {createContract.isPending ? "생성 중..." : "계약 요청 발송"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 상태 필터 탭 + 일괄 발송 */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 overflow-x-auto">
          {[
            { key: "all", label: "전체" },
            { key: "draft", label: "임시저장" },
            { key: "sent", label: "진행 중" },
            { key: "completed", label: "완료" },
            { key: "cancelled", label: "취소" },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => { setStatusFilter(f.key); setSelectedIds(new Set()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition ${
                statusFilter === f.key
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              {f.label} {(statusCounts as any)[f.key] > 0 && <span className="ml-1 opacity-70">{(statusCounts as any)[f.key]}</span>}
            </button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <button
            onClick={handleBatchSend}
            disabled={batchSending}
            className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition whitespace-nowrap"
          >
            {batchSending ? "발송 중..." : `일괄 발송 (${selectedIds.size}건)`}
          </button>
        )}
      </div>

      {/* 계약 내역 리스트 */}
      <div className="space-y-3 mb-8">
        {filteredContracts.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-12 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <div className="text-sm text-[var(--text-muted)]">계약 내역이 없습니다</div>
            <div className="text-xs text-[var(--text-dim)] mt-1">상단의 &quot;계약 요청&quot; 버튼으로 구성원에게 계약서를 발송하세요</div>
          </div>
        ) : (
          <>
            {/* 전체선택 체크박스 */}
            {filteredContracts.some((c: any) => c.status === "draft") && (
              <div className="flex items-center gap-2 px-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={filteredContracts.filter((c: any) => c.status === "draft").every((c: any) => selectedIds.has(c.id))}
                    onChange={(e) => {
                      const draftIds = filteredContracts.filter((c: any) => c.status === "draft").map((c: any) => c.id);
                      if (e.target.checked) {
                        setSelectedIds(new Set([...selectedIds, ...draftIds]));
                      } else {
                        const next = new Set(selectedIds);
                        draftIds.forEach((id: string) => next.delete(id));
                        setSelectedIds(next);
                      }
                    }}
                    className="rounded border-[var(--border)]"
                  />
                  전체선택 (임시저장 {filteredContracts.filter((c: any) => c.status === "draft").length}건)
                </label>
              </div>
            )}
          {filteredContracts.map((p: any) => {
            const st = PACKAGE_STATUS[p.status as keyof typeof PACKAGE_STATUS] || PACKAGE_STATUS.draft;
            return (
              <div key={p.id} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {p.status === "draft" && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 rounded border-[var(--border)]"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold truncate">{p.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span>{p.employees?.name || "미지정"}</span>
                        {p.employees?.department && <span>{p.employees.department}</span>}
                        {p.created_at && <span>생성: {new Date(p.created_at).toLocaleDateString("ko-KR")}</span>}
                        {p.sent_at && <span>발송: {new Date(p.sent_at).toLocaleDateString("ko-KR")}</span>}
                        {p.completed_at && <span>완료: {new Date(p.completed_at).toLocaleDateString("ko-KR")}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    {p.status === "draft" && (
                      <>
                        <button
                          onClick={() => handleSendSignRequest(p.id)}
                          disabled={sending === p.id}
                          className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition"
                        >
                          {sending === p.id ? "발송 중..." : "서명 요청"}
                        </button>
                        <button
                          onClick={() => { if (confirm("이 계약을 취소하시겠습니까?")) cancelContract.mutate(p.id); }}
                          className="px-3 py-2 text-xs text-[var(--text-dim)] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                        >
                          삭제
                        </button>
                      </>
                    )}
                    {(p.status === "sent" || p.status === "partially_signed") && (
                      <button
                        onClick={() => handleSendSignRequest(p.id)}
                        disabled={sending === p.id}
                        className="px-3 py-2 text-xs font-medium text-blue-400 rounded-lg hover:bg-blue-500/10 transition"
                      >
                        {sending === p.id ? "발송 중..." : "재발송"}
                      </button>
                    )}
                    {p.status === "completed" && (
                      <span className="px-3 py-2 text-xs text-green-400">서명 완료</span>
                    )}
                    {/* 직인 적용 버튼 — 모든 상태에서 사용 가능 */}
                    <button
                      onClick={() => handleApplySeal(p.id)}
                      disabled={sealApplying === p.id}
                      className="px-3 py-2 text-xs font-medium text-orange-500 rounded-lg hover:bg-orange-500/10 transition disabled:opacity-50 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                      {sealApplying === p.id ? "적용 중..." : "직인 적용"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>

      {/* 기존 계약 이력 */}
      {contracts.length > 0 && (
        <>
          <h3 className="text-sm font-bold text-[var(--text-muted)] mb-3">계약 이력</h3>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">구성원</th>
                <th className="text-left px-5 py-3 font-medium">계약유형</th>
                <th className="text-left px-5 py-3 font-medium">기간</th>
                <th className="text-right px-5 py-3 font-medium">급여</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
              </tr></thead>
              <tbody>
                {contracts.map((c: any) => (
                  <tr key={c.id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{c.employees?.name || "—"}</td>
                    <td className="px-5 py-3 text-xs">{CONTRACT_TYPES.find(t => t.value === c.contract_type)?.label || c.contract_type}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{c.start_date} ~ {c.end_date || "무기한"}</td>
                    <td className="px-5 py-3 text-sm text-right">{c.salary ? `₩${Number(c.salary).toLocaleString()}` : "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{c.status === 'active' ? '유효' : c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
      </>}
    </div>
  );
}

// ── Expense Tab ──
function ExpenseTab({ expenses, companyId, userId, queryClient, isEmployee }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", amount: "", category: "general", description: "" });

  const addExpense = useMutation({
    mutationFn: () => createExpenseRequest({
      companyId: companyId!, requesterId: userId!, title: form.title,
      amount: Number(form.amount), category: form.category, description: form.description,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); queryClient.invalidateQueries({ queryKey: ["approval"] }); setShowForm(false); setForm({ title: "", amount: "", category: "general", description: "" }); },
  });

  const approve = useMutation({
    mutationFn: (expenseId: string) => approveExpense({ companyId: companyId!, expenseId, approverId: userId! }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); queryClient.invalidateQueries({ queryKey: ["payment-queue"] }); },
  });

  const reject = useMutation({
    mutationFn: (expenseId: string) => rejectExpense({ companyId: companyId!, expenseId, approverId: userId! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">+ 경비 청구</button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">제목 *</label><input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">금액 *</label><input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">분류</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">설명</label><input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
          </div>
          <button onClick={() => form.title && form.amount && addExpense.mutate()} disabled={!form.title || !form.amount} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">청구</button>
        </div>
      )}

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {expenses.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">🧾</div><div className="text-sm text-[var(--text-muted)]">경비 청구 내역이 없습니다</div></div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
            <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left px-5 py-3 font-medium">제목</th>
              <th className="text-left px-5 py-3 font-medium">청구자</th>
              <th className="text-left px-5 py-3 font-medium">분류</th>
              <th className="text-right px-5 py-3 font-medium">금액</th>
              <th className="text-center px-5 py-3 font-medium">상태</th>
              <th className="text-center px-5 py-3 font-medium">액션</th>
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
                    <td className="px-5 py-3 text-sm text-right font-medium">₩{Number(e.amount).toLocaleString()}</td>
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
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

// ── Attendance Tab ──
function AttendanceTab({ employees, companyId, userId, queryClient, role }: any) {
  const { toast } = useToast();
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const [viewMode, setViewMode] = useState<"calendar" | "table">("calendar");

  // Get month start/end for queries
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = `${selectedMonth}-31`;

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

  // Check-in mutation
  const doCheckIn = useMutation({
    mutationFn: (employeeId: string) => checkIn(companyId!, employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (err: any) => toast(err.message, "error"),
  });

  // Check-out mutation
  const doCheckOut = useMutation({
    mutationFn: (employeeId: string) => checkOut(employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (err: any) => toast(err.message, "error"),
  });

  // Admin attendance correction
  const isAdmin = role === "owner" || role === "admin";
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ check_in: "", check_out: "", status: "" });

  const doCorrectAttendance = useMutation({
    mutationFn: ({ recordId, updates }: { recordId: string; updates: { check_in?: string; check_out?: string; status?: string } }) =>
      correctAttendanceRecord(recordId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
      setEditingRecordId(null);
    },
    onError: (err: any) => toast(err.message, "error"),
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
      empMap[r.employee_id][r.date] = r.status;
    });

    return { year, month, daysInMonth, firstDayOfWeek, empMap };
  }, [selectedMonth, records]);

  // Stats
  const totalRecords = records.length;
  const presentCount = records.filter((r: any) => r.status === "present" || r.status === "remote").length;
  const lateCount = records.filter((r: any) => r.status === "late").length;
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

  const activeEmployees = employees.filter((e: any) => e.status === "active");

  return (
    <div>
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-xs text-[var(--text-dim)]">출근률</span>
          </div>
          <div className="text-lg font-bold text-green-400">{attendanceRate}%</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-xs text-[var(--text-dim)]">지각률</span>
          </div>
          <div className="text-lg font-bold text-yellow-400">{lateRate}%</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span className="text-xs text-[var(--text-dim)]">평균근무시간</span>
          </div>
          <div className="text-lg font-bold text-blue-400">{avgHours}h</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="text-xs text-[var(--text-dim)]">이번 달 기록</span>
          </div>
          <div className="text-lg font-bold">{totalRecords}건</div>
        </div>
      </div>

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
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
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
          <div className="flex gap-1 bg-[var(--bg-card)] rounded-lg p-0.5 border border-[var(--border)]">
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${viewMode === "calendar" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}
            >
              캘린더
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${viewMode === "table" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}
            >
              테이블
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          {activeEmployees.length > 0 && (
            <QuickAttendanceButtons
              employees={activeEmployees}
              records={records}
              onCheckIn={(empId: string) => doCheckIn.mutate(empId)}
              onCheckOut={(empId: string) => doCheckOut.mutate(empId)}
            />
          )}
        </div>
      </div>

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
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
              const isToday = dateStr === today.toISOString().slice(0, 10);
              const dayOfWeek = (calendarData.firstDayOfWeek + i) % 7;
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

              // Get all employee statuses for this day
              const dayRecords = activeEmployees.map((emp: any) => ({
                name: emp.name,
                status: calendarData.empMap[emp.id]?.[dateStr] || null,
              })).filter((r: any) => r.status);

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
                  <div className="flex flex-wrap gap-0.5">
                    {dayRecords.map((r: any, idx: number) => (
                      <div
                        key={idx}
                        title={`${r.name}: ${statusLabel(r.status)}`}
                        className={`w-2.5 h-2.5 rounded-full ${statusColor(r.status)}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex gap-4 p-3 border-t border-[var(--border)]">
            {ATTENDANCE_STATUS.map((s) => (
              <div key={s.value} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <div className={`w-2.5 h-2.5 rounded-full ${statusColor(s.value)}`} />
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {records.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📊</div>
              <div className="text-sm text-[var(--text-muted)]">해당 월에 근태 기록이 없습니다</div>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">직원</th>
                  <th className="text-left px-5 py-3 font-medium">날짜</th>
                  <th className="text-left px-5 py-3 font-medium">출근</th>
                  <th className="text-left px-5 py-3 font-medium">퇴근</th>
                  <th className="text-right px-5 py-3 font-medium">근무시간</th>
                  <th className="text-right px-5 py-3 font-medium">연장</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                  {isAdmin && <th className="text-center px-5 py-3 font-medium">관리</th>}
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
                      {r.overtime_hours > 0 ? `+${Number(r.overtime_hours).toFixed(1)}h` : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                        r.status === "present" ? "bg-green-500/10 text-green-400"
                        : r.status === "late" ? "bg-yellow-500/10 text-yellow-400"
                        : r.status === "absent" ? "bg-red-500/10 text-red-400"
                        : r.status === "half_day" ? "bg-orange-500/10 text-orange-400"
                        : r.status === "remote" ? "bg-blue-500/10 text-blue-400"
                        : "bg-gray-500/10 text-gray-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusColor(r.status)}`} />
                        {statusLabel(r.status)}
                      </span>
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
      {summary.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold mb-3 text-[var(--text-muted)]">직원별 월간 요약</h3>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">직원</th>
                  <th className="text-center px-5 py-3 font-medium">출근일</th>
                  <th className="text-center px-5 py-3 font-medium">지각</th>
                  <th className="text-center px-5 py-3 font-medium">결근</th>
                  <th className="text-center px-5 py-3 font-medium">재택</th>
                  <th className="text-center px-5 py-3 font-medium">반차</th>
                  <th className="text-right px-5 py-3 font-medium">총 근무시간</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s: any) => (
                  <tr key={s.employee_id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-sm text-center">{s.totalDays}일</td>
                    <td className="px-5 py-3 text-sm text-center text-yellow-400">{s.lateDays > 0 ? `${s.lateDays}회` : "—"}</td>
                    <td className="px-5 py-3 text-sm text-center text-red-400">{s.absentDays > 0 ? `${s.absentDays}회` : "—"}</td>
                    <td className="px-5 py-3 text-sm text-center text-blue-400">{s.remoteDays > 0 ? `${s.remoteDays}일` : "—"}</td>
                    <td className="px-5 py-3 text-sm text-center text-orange-400">{s.halfDays > 0 ? `${s.halfDays}회` : "—"}</td>
                    <td className="px-5 py-3 text-sm text-right font-medium">{s.totalHours.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}
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
  const [preview, setPreview] = useState<{ items: PayrollItem[]; totalGross: number; totalDeductions: number; totalNet: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [periodLabel, setPeriodLabel] = useState(() => `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`);

  const { data: companyMeta } = useQuery({
    queryKey: ["company-meta-payroll", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name, representative").eq("id", companyId!).single();
      return data as { name: string; representative: string | null } | null;
    },
    enabled: !!companyId,
  });

  const { data: empMap = {} } = useQuery({
    queryKey: ["payroll-emp-meta", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, department, position").eq("company_id", companyId!);
      const m: Record<string, { department: string | null; position: string | null }> = {};
      (data || []).forEach((e: any) => { m[e.id] = { department: e.department, position: e.position }; });
      return m;
    },
    enabled: !!companyId,
  });

  const downloadOne = async (item: PayrollItem) => {
    try {
      const { downloadPayslipPDF } = await import("@/lib/payslip-pdf");
      const meta = (empMap as Record<string, { department: string | null; position: string | null }>)[item.employeeId] || {};
      downloadPayslipPDF({
        item,
        companyName: companyMeta?.name || "회사",
        representative: companyMeta?.representative || undefined,
        periodLabel,
        department: meta.department || undefined,
        position: meta.position || undefined,
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

  const generate = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const result = await previewPayroll(companyId);
      setPreview(result);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSendPayslips = async () => {
    if (!companyId || !preview) return;
    setSending(true);
    try {
      const { sendPayslipEmails } = await import("@/lib/payment-batch");
      const result = await sendPayslipEmails("preview", companyId, `${new Date().toISOString().slice(0, 7)} 급여명세`);
      toast(`급여명세서 발송 완료: ${result.sent}건 성공, ${result.failed}건 실패`, result.failed > 0 ? "error" : "success");
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
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            placeholder="2026년 4월"
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs w-28"
          />
          {preview && preview.items.length > 0 && (
            <>
              <button onClick={downloadAll} className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] rounded-xl text-xs font-semibold transition">
                전체 PDF 다운로드
              </button>
              <button onClick={handleSendPayslips} disabled={sending} className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {sending ? "발송 중..." : `전 직원 명세서 발송 (${preview.items.length}명)`}
              </button>
            </>
          )}
          <button onClick={generate} disabled={loading || !companyId} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {loading ? "계산 중..." : "급여 명세 미리보기"}
          </button>
        </div>
      </div>

      {!preview ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
          <div className="text-4xl mb-4">📋</div>
          <div className="text-sm text-[var(--text-muted)]">"급여 명세 미리보기" 버튼을 클릭하면 이번 달 급여 명세를 확인할 수 있습니다</div>
        </div>
      ) : preview.items.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
          <div className="text-sm text-[var(--text-muted)]">재직 중인 직원이 없거나 급여가 설정되지 않았습니다</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">총 급여 (세전)</div>
              <div className="text-lg font-bold mt-1">{fmtKRW(preview.totalGross)}</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">총 공제액</div>
              <div className="text-lg font-bold text-red-400 mt-1">-{fmtKRW(preview.totalDeductions)}</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">총 실수령액</div>
              <div className="text-lg font-bold text-green-400 mt-1">{fmtKRW(preview.totalNet)}</div>
            </div>
          </div>

          {/* Detail Table */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 font-medium">직원</th>
                <th className="text-right px-4 py-3 font-medium">기본급</th>
                <th className="text-right px-4 py-3 font-medium">국민연금</th>
                <th className="text-right px-4 py-3 font-medium">건강보험</th>
                <th className="text-right px-4 py-3 font-medium">고용보험</th>
                <th className="text-right px-4 py-3 font-medium">소득세</th>
                <th className="text-right px-4 py-3 font-medium">지방소득세</th>
                <th className="text-right px-4 py-3 font-medium">공제합계</th>
                <th className="text-right px-4 py-3 font-medium">실수령</th>
                <th className="text-center px-4 py-3 font-medium">PDF</th>
              </tr></thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.employeeId} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-4 py-3 text-sm font-medium">{item.employeeName}</td>
                    <td className="px-4 py-3 text-sm text-right">{fmtKRW(item.baseSalary)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.nationalPension)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.healthInsurance)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.employmentInsurance)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.incomeTax)}</td>
                    <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">{fmtKRW(item.localIncomeTax)}</td>
                    <td className="px-4 py-3 text-sm text-right text-red-400">-{fmtKRW(item.deductionsTotal)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-green-400">{fmtKRW(item.netPay)}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => downloadOne(item)} title="급여명세서 PDF 다운로드" className="px-2 py-1 text-[10px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg transition">
                        ⬇ PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Leave Tab ──
function LeaveTab({ employees, companyId, userId, queryClient, isEmployee }: any) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);

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
  });
  const [showPromotion, setShowPromotion] = useState(false);

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
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      setShowForm(false);
      setForm({ employeeId: "", leaveType: "annual", leaveUnit: "full_day", startDate: "", endDate: "", startTime: "", endTime: "", reason: "" });
    },
    onError: (err: any) => toast(err.message, "error"),
  });

  // Send promotion notice
  const sendPromotion = useMutation({
    mutationFn: (params: { employeeId: string; noticeType: "first" | "second"; unusedDays: number; email: string; employeeName: string }) =>
      sendLeavePromotionNotice({ companyId: companyId!, ...params, year: currentYear }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-promotion-notices"] });
      queryClient.invalidateQueries({ queryKey: ["leave-promotion-candidates"] });
    },
  });

  // Approve mutation
  const approveMut = useMutation({
    mutationFn: (id: string) => approveLeaveRequest(id, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
  });

  // Reject mutation
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectLeaveRequest(id, userId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
  });

  // Init balance mutation
  const initBalance = useMutation({
    mutationFn: (params: { employeeId: string; totalDays: number }) =>
      initLeaveBalance(companyId!, params.employeeId, currentYear, params.totalDays),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-balances"] }),
  });

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

  const activeEmployees = employees.filter((e: any) => e.status === "active");

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
            <div key={lt.value} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)]/30 transition">
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

      {/* Leave Balance Cards */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[var(--text-muted)]">{currentYear}년 직원별 잔여</h3>
          {employeesWithoutBalance.length > 0 && !isEmployee && (
            <button
              onClick={() => {
                // Auto-init 15 days for all employees without balance
                employeesWithoutBalance.forEach((e: any) => {
                  initBalance.mutate({ employeeId: e.id, totalDays: 15 });
                });
              }}
              className="text-xs px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg hover:bg-[var(--primary)]/20 transition"
            >
              미설정 직원 일괄 부여 (15일)
            </button>
          )}
        </div>
        {balances.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
            연차 잔여 데이터가 없습니다. 직원별 휴가일수를 설정해주세요.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {balances.map((b: any) => {
              const remaining = b.remaining_days ?? (b.total_days - b.used_days);
              const percent = b.total_days > 0 ? (remaining / b.total_days) * 100 : 0;
              return (
                <div key={b.id} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
                  <div className="text-sm font-medium mb-1">{b.employees?.name || "—"}</div>
                  <div className="text-xs text-[var(--text-dim)] mb-2">{b.employees?.department || "미배정"}</div>
                  <div className="flex items-end gap-1 mb-2">
                    <span className={`text-xl font-bold ${
                      remaining <= 0 ? "text-red-400" : remaining <= 3 ? "text-yellow-400" : "text-green-400"
                    }`}>
                      {remaining}
                    </span>
                    <span className="text-xs text-[var(--text-dim)] mb-0.5">/ {b.total_days}일</span>
                  </div>
                  <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        remaining <= 0 ? "bg-red-400" : remaining <= 3 ? "bg-yellow-400" : "bg-green-400"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                    />
                  </div>
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
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h4 className="text-sm font-bold mb-4">휴가 신청</h4>
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
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            {form.leaveUnit === "full_day" && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
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
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="개인 사유" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <button
            onClick={() => form.employeeId && form.startDate && createLeave.mutate()}
            disabled={!form.employeeId || !form.startDate || createLeave.isPending}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {createLeave.isPending ? "처리 중..." : `신청 (${LEAVE_UNITS.find(u => u.value === form.leaveUnit)?.days || 1}일)`}
          </button>
        </div>
      )}

      {/* Leave Requests List */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mb-6">
        {leaveRequests.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">🏖</div>
            <div className="text-sm text-[var(--text-muted)]">휴가 신청 내역이 없습니다</div>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">직원</th>
                <th className="text-left px-5 py-3 font-medium">유형</th>
                <th className="text-left px-5 py-3 font-medium">기간</th>
                <th className="text-center px-5 py-3 font-medium">일수</th>
                <th className="text-left px-5 py-3 font-medium">사유</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
                <th className="text-center px-5 py-3 font-medium">액션</th>
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
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {r.status === "pending" && !isEmployee && (
                        <div className="flex gap-1 justify-center">
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
                        </div>
                      )}
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
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
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
              const isToday = dateStr === today.toISOString().slice(0, 10);
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
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
              <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
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
                <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
                  <div className="px-5 py-3 border-b border-[var(--border)] bg-yellow-500/5">
                    <span className="text-xs font-semibold text-[var(--warning)]">미사용 연차 보유 직원 ({promotionCandidates.length}명)</span>
                  </div>
                  <div className="overflow-x-auto"><table className="w-full min-w-[600px]">
                    <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
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
                <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
                  <div className="px-5 py-3 border-b border-[var(--border)]">
                    <span className="text-xs font-semibold text-[var(--text-muted)]">촉진 통보 이력</span>
                  </div>
                  <div className="overflow-x-auto"><table className="w-full min-w-[500px]">
                    <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
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
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
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
      const { data } = await db.from("companies").select("*").eq("id", companyId).single();
      return data;
    },
    enabled: !!companyId,
  });

  const activeEmployees = employees.filter((e: any) => e.status === "active");
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
        end_date: employee.status !== "active" ? employee.updated_at?.slice(0, 10) : undefined,
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
        <h3 className="text-sm font-bold mb-4">증명서 발급</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">직원 선택 *</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            >
              <option value="">직원을 선택하세요</option>
              {allEmployees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.department || "미배정"}) {e.status !== "active" ? "[퇴직]" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">증명서 유형 *</label>
            <select
              value={certType}
              onChange={(e) => setCertType(e.target.value as "employment" | "career")}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
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
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
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
          <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">증명서번호</th>
                <th className="text-left px-5 py-3 font-medium">유형</th>
                <th className="text-left px-5 py-3 font-medium">직원</th>
                <th className="text-left px-5 py-3 font-medium">소속/직위</th>
                <th className="text-left px-5 py-3 font-medium">용도</th>
                <th className="text-left px-5 py-3 font-medium">발급자</th>
                <th className="text-left px-5 py-3 font-medium">발급일</th>
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
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
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
