"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import {
  getSalaryHistory, addSalaryRecord, getActiveContracts, createContract,
  CONTRACT_TYPES, updateEmployee,
  // Attendance & Leave
  checkIn, checkOut, getAttendanceRecords, getMonthlyAttendanceSummary,
  calculateWeeklyHours,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  getLeaveBalances, initLeaveBalance,
  LEAVE_TYPES, ATTENDANCE_STATUS, LEAVE_REQUEST_STATUS,
} from "@/lib/hr";
import {
  getExpenseRequests, createExpenseRequest, approveExpense, rejectExpense,
  markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS,
} from "@/lib/expenses";
import { previewPayroll } from "@/lib/payroll";
import type { PayrollItem } from "@/lib/payment-batch";

type Tab = "employees" | "salary" | "payroll" | "contracts" | "expenses" | "attendance" | "leave";

export default function EmployeesPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("employees");
  const [showForm, setShowForm] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  // ── Employees ──
  const { data: employees = [] } = useQuery({
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

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "employees", label: "인력관리", count: activeCount },
    { key: "salary", label: "급여이력" },
    { key: "payroll", label: "급여 명세" },
    { key: "contracts", label: "계약서" },
    { key: "expenses", label: "경비청구", count: expenses.filter((e: any) => e.status === "pending").length },
    { key: "attendance", label: "근태" },
    { key: "leave", label: "휴가" },
  ];

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">인력 / 비용</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">직원관리 + 급여이력 + 계약서 + 경비청구 + 근태 + 휴가</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">재직 인원</div>
          <div className="text-lg font-bold mt-1">{activeCount}명</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">월 급여</div>
          <div className="text-lg font-bold text-red-400 mt-1">₩{totalSalary.toLocaleString()}</div>
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
      {tab === "employees" && <EmployeeTab employees={employees} companyId={companyId} queryClient={queryClient} />}
      {tab === "salary" && <SalaryTab employees={employees} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId} salaryHistory={salaryHistory} companyId={companyId} userId={userId} queryClient={queryClient} />}
      {tab === "payroll" && <PayrollPreviewTab companyId={companyId} />}
      {tab === "contracts" && <ContractTab employees={employees} contracts={contracts} companyId={companyId} queryClient={queryClient} />}
      {tab === "expenses" && <ExpenseTab expenses={expenses} companyId={companyId} userId={userId} queryClient={queryClient} />}
      {tab === "attendance" && <AttendanceTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} />}
      {tab === "leave" && <LeaveTab employees={employees} companyId={companyId} userId={userId} queryClient={queryClient} />}
    </div>
  );
}

// ── Employee Tab ──
function EmployeeTab({ employees, companyId, queryClient }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", salary: "", hire_date: "", department: "", position: "", email: "", phone: "" });

  const addEmployee = useMutation({
    mutationFn: async () => {
      await supabase.from("employees").insert({
        company_id: companyId,
        name: form.name,
        salary: Number(form.salary) || 0,
        hire_date: form.hire_date || null,
        department: form.department || null,
        position: form.position || null,
        email: form.email || null,
        phone: form.phone || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setShowForm(false);
      setForm({ name: "", salary: "", hire_date: "", department: "", position: "", email: "", phone: "" });
    },
  });

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">+ 직원 추가</button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이름 *</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">부서</label><input value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">직위</label><input value={form.position} onChange={e => setForm({...form, position: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">월급</label><input type="number" value={form.salary} onChange={e => setForm({...form, salary: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">이메일</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">전화번호</label><input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">입사일</label><input type="date" value={form.hire_date} onChange={e => setForm({...form, hire_date: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div className="flex items-end"><button onClick={() => form.name && addEmployee.mutate()} disabled={!form.name} className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 w-full">추가</button></div>
          </div>
        </div>
      )}

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {employees.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">👥</div><div className="text-sm text-[var(--text-muted)]">등록된 직원이 없습니다</div></div>
        ) : (
          <table className="w-full">
            <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left px-5 py-3 font-medium">이름</th>
              <th className="text-left px-5 py-3 font-medium">부서</th>
              <th className="text-left px-5 py-3 font-medium">직위</th>
              <th className="text-right px-5 py-3 font-medium">월급</th>
              <th className="text-left px-5 py-3 font-medium">입사일</th>
              <th className="text-right px-5 py-3 font-medium">퇴직충당금</th>
              <th className="text-center px-5 py-3 font-medium">상태</th>
            </tr></thead>
            <tbody>
              {employees.map((e: any) => (
                <tr key={e.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-sm font-medium">{e.name}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.department || "—"}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.position || "—"}</td>
                  <td className="px-5 py-3 text-sm text-right">₩{Number(e.salary).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.hire_date || "—"}</td>
                  <td className="px-5 py-3 text-sm text-right text-[var(--warning)]">₩{Number(e.retirement_accrual || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${e.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>
                      {e.status === 'active' ? '재직' : '퇴직'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
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
          <div className="grid grid-cols-3 gap-4 mb-4">
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
            <table className="w-full">
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
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Contract Tab ──
function ContractTab({ employees, contracts, companyId, queryClient }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employeeId: "", contractType: "full_time", startDate: "", endDate: "", salary: "" });

  const addContract = useMutation({
    mutationFn: () => createContract({
      companyId, employeeId: form.employeeId, contractType: form.contractType,
      startDate: form.startDate, endDate: form.endDate || undefined,
      salary: form.salary ? Number(form.salary) : undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["contracts"] }); setShowForm(false); },
  });

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold">+ 계약서 등록</button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <div className="grid grid-cols-5 gap-4 mb-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">직원 *</label>
              <select value={form.employeeId} onChange={e => setForm({...form, employeeId: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                <option value="">선택...</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">계약유형</label>
              <select value={form.contractType} onChange={e => setForm({...form, contractType: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {CONTRACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">시작일 *</label><input type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label><input type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">급여</label><input type="number" value={form.salary} onChange={e => setForm({...form, salary: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" /></div>
          </div>
          <button onClick={() => form.employeeId && form.startDate && addContract.mutate()} disabled={!form.employeeId || !form.startDate} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">등록</button>
        </div>
      )}

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {contracts.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">📋</div><div className="text-sm text-[var(--text-muted)]">등록된 계약서가 없습니다</div></div>
        ) : (
          <table className="w-full">
            <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left px-5 py-3 font-medium">직원</th>
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
          </table>
        )}
      </div>
    </div>
  );
}

// ── Expense Tab ──
function ExpenseTab({ expenses, companyId, userId, queryClient }: any) {
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
          <div className="grid grid-cols-4 gap-4 mb-4">
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
          <table className="w-full">
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
                      {e.status === "pending" && (
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
          </table>
        )}
      </div>
    </div>
  );
}

// ── Attendance Tab ──
function AttendanceTab({ employees, companyId, userId, queryClient }: any) {
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
      <div className="grid grid-cols-4 gap-4 mb-6">
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
            <table className="w-full">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">직원</th>
                  <th className="text-left px-5 py-3 font-medium">날짜</th>
                  <th className="text-left px-5 py-3 font-medium">출근</th>
                  <th className="text-left px-5 py-3 font-medium">퇴근</th>
                  <th className="text-right px-5 py-3 font-medium">근무시간</th>
                  <th className="text-right px-5 py-3 font-medium">연장</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r: any) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Monthly Summary per Employee */}
      {summary.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold mb-3 text-[var(--text-muted)]">직원별 월간 요약</h3>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <table className="w-full">
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
            </table>
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
          <div className="grid grid-cols-3 gap-4 mb-6">
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
            <table className="w-full">
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
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Leave Tab ──
function LeaveTab({ employees, companyId, userId, queryClient }: any) {
  const currentYear = new Date().getFullYear();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "annual",
    startDate: "",
    endDate: "",
    reason: "",
  });

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

  // Create leave request mutation
  const createLeave = useMutation({
    mutationFn: () => {
      // Calculate days between start and end
      const start = new Date(form.startDate);
      const end = new Date(form.endDate);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      return createLeaveRequest({
        companyId: companyId!,
        employeeId: form.employeeId,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        days,
        reason: form.reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      setShowForm(false);
      setForm({ employeeId: "", leaveType: "annual", startDate: "", endDate: "", reason: "" });
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

  return (
    <div>
      {/* Leave Balance Cards */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[var(--text-muted)]">{currentYear}년 휴가 잔여</h3>
          {employeesWithoutBalance.length > 0 && (
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
          <div className="grid grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">직원 *</label>
              <select
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm"
              >
                <option value="">선택...</option>
                {activeEmployees.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">휴가 유형</label>
              <select
                value={form.leaveType}
                onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm"
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">시작일 *</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">종료일 *</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="개인 사유, 병원 등"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <button
            onClick={() => form.employeeId && form.startDate && form.endDate && createLeave.mutate()}
            disabled={!form.employeeId || !form.startDate || !form.endDate}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            신청
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
          <table className="w-full">
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
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.start_date} ~ {r.end_date}</td>
                    <td className="px-5 py-3 text-sm text-center font-medium">{r.days}일</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.reason || "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {r.status === "pending" && (
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
          </table>
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
    </div>
  );
}
