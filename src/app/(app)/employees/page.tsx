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
import {
  getExpenseRequests, createExpenseRequest, approveExpense, rejectExpense,
  markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS,
} from "@/lib/expenses";
import { previewPayroll } from "@/lib/payroll";
import { QueryErrorBanner } from "@/components/query-status";
import { generateEmploymentCertificate, generateCareerCertificate, getCertificateLogs, saveCertificateLog } from "@/lib/certificates";
import type { PayrollItem } from "@/lib/payment-batch";
import { createEmployeeInvitation, getEmployeeInvitations, getInviteUrl, sendInviteEmail, cancelEmployeeInvitation } from "@/lib/invitations";

type Tab = "employees" | "salary" | "payroll" | "contracts" | "expenses" | "attendance" | "leave" | "certificates";

// Employee 역할은 자기 관련 탭만 접근 가능
const EMPLOYEE_ROLE_TABS: Tab[] = ["attendance", "leave", "expenses", "certificates"];

export default function EmployeesPage() {
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border)]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
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

  // 초대 목록
  const { data: invitations = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId!),
    enabled: !!companyId,
  });

  // 회사명 (이메일 발송용)
  const { data: companyData } = useQuery({
    queryKey: ["company-name", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name").eq("id", companyId!).single();
      return data;
    },
    enabled: !!companyId,
  });

  // 직원 초대 mutation
  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("인증 필요");
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
      setShowForm(false);
      setForm({ email: "", name: "", role: "employee", department: "", position: "", salary: "" });
      setTimeout(() => setInviteMsg(null), 4000);
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
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">+ 직원 초대</button>
      </div>

      {inviteMsg && (
        <div className={`mb-4 p-3 rounded-xl text-sm font-medium ${inviteMsg.ok ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
          {inviteMsg.msg}
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

      {/* 직원 목록 */}
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

      {/* Employee Detail Panel */}
      {detailEmpId && <EmployeeDetailPanel employeeId={detailEmpId} companyId={companyId} onClose={() => setDetailEmpId(null)} />}
    </div>
  );
}

// ── Employee Detail Panel ──
function EmployeeDetailPanel({ employeeId, companyId, onClose }: { employeeId: string; companyId: string; onClose: () => void }) {
  const [detailTab, setDetailTab] = useState<"info" | "files" | "onboarding" | "notes" | "history" | "contracts" | "certificates" | "leave">("info");
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();

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
        <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg-surface)] rounded-lg text-[var(--text-dim)] transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
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
  const [issuing, setIssuing] = useState(false);
  async function issue() {
    setIssuing(true);
    try {
      const { data: company } = await supabase.from("companies").select("name, representative, address, business_number, seal_url").eq("id", companyId).single();
      if (!company) { alert("회사 정보를 불러올 수 없습니다"); return; }
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
      alert(err.message || "증명서 생성 실패");
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

// ── Contract Tab (전자계약 — 플렉스 스타일) ──
function ContractTab({ employees, contracts, companyId, queryClient }: any) {
  const [showCreate, setShowCreate] = useState(false);
  const [reqForm, setReqForm] = useState({ employeeId: "", title: "", templateIds: [] as string[] });
  const [sending, setSending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);

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
    onError: (err: any) => alert(err.message),
  });

  // 서명 요청 발송
  async function handleSendSignRequest(contractId: string) {
    setSending(contractId);
    try {
      const result = await sendContractPackage(contractId);
      if (!result.success) alert("발송 실패: " + (result.error || "알 수 없는 오류"));
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    } catch (err: any) {
      alert(err.message);
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
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          계약 요청
        </button>
      </div>

      {/* 계약 요청 폼 */}
      {showCreate && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h4 className="text-sm font-bold mb-4">새 계약 요청</h4>

          {/* Step 1: 대상 선택 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">구성원 선택 *</label>
              <select
                value={reqForm.employeeId}
                onChange={e => setReqForm({...reqForm, employeeId: e.target.value})}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                <option value="">구성원을 선택하세요</option>
                {allEmployees.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.name} · {e.department || "미배정"} · {e.position || "미지정"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">계약 제목</label>
              <input
                value={reqForm.title}
                onChange={e => setReqForm({...reqForm, title: e.target.value})}
                placeholder={`${new Date().getFullYear()}년 연봉계약`}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Step 2: 서식 선택 */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-2">계약서 서식 선택 *</label>
            {templates.length === 0 ? (
              <p className="text-xs text-[var(--text-dim)]">등록된 서식이 없습니다. 설정에서 계약서 템플릿을 먼저 등록하세요.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {templates.map((t: any) => {
                  const selected = reqForm.templateIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTemplate(t.id)}
                      className={`text-left px-4 py-3 rounded-xl border transition ${
                        selected
                          ? "border-[var(--primary)] bg-[var(--primary)]/5"
                          : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                          selected ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)]"
                        }`}>
                          {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                        <span className="text-sm font-medium">{t.name}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 액션 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={() => reqForm.employeeId && reqForm.templateIds.length > 0 && createContract.mutate()}
              disabled={!reqForm.employeeId || reqForm.templateIds.length === 0 || createContract.isPending}
              className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition"
            >
              {createContract.isPending ? "생성 중..." : "계약 요청하기"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setReqForm({ employeeId: "", title: "", templateIds: [] }); }}
              className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-xl transition"
            >
              취소
            </button>
          </div>
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); setShowForm(false); setForm({ title: "", amount: "", category: "general", description: "" }); },
  });

  const approve = useMutation({
    mutationFn: (expenseId: string) => approveExpense({ companyId: companyId!, expenseId, approverId: userId! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
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
    onError: (err: any) => alert(err.message),
  });

  // Check-out mutation
  const doCheckOut = useMutation({
    mutationFn: (employeeId: string) => checkOut(employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (err: any) => alert(err.message),
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
    onError: (err: any) => alert(err.message),
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
  const [preview, setPreview] = useState<{ items: PayrollItem[]; totalGross: number; totalDeductions: number; totalNet: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const result = await previewPayroll(companyId);
      setPreview(result);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fmtKRW = (n: number) => `₩${n.toLocaleString()}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--text-muted)]">재직 직원 급여 기준 4대보험/원천세 자동 계산 미리보기</p>
        <button onClick={generate} disabled={loading || !companyId} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
          {loading ? "계산 중..." : "급여 명세 미리보기"}
        </button>
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
  const currentYear = new Date().getFullYear();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
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
    onError: (err: any) => alert(err.message),
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
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">직원 *</label>
              <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                <option value="">선택...</option>
                {activeEmployees.map((e: any) => (<option key={e.id} value={e.id}>{e.name}</option>))}
              </select>
            </div>
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
      alert(`증명서가 발급되었습니다.\n증명서번호: ${result.certificateNumber}`);
    } catch (err: any) {
      alert("증명서 발급 실패: " + (err?.message || err));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div>
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
