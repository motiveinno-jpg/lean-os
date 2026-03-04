"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { getSalaryHistory, addSalaryRecord, getActiveContracts, createContract, CONTRACT_TYPES, updateEmployee } from "@/lib/hr";
import { getExpenseRequests, createExpenseRequest, approveExpense, rejectExpense, markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS } from "@/lib/expenses";

type Tab = "employees" | "salary" | "contracts" | "expenses";

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
    { key: "contracts", label: "계약서" },
    { key: "expenses", label: "경비청구", count: expenses.filter((e: any) => e.status === "pending").length },
  ];

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">인력 / 비용</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">직원관리 + 급여이력 + 계약서 + 경비청구</p>
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
                : "text-[var(--text-muted)] hover:text-white"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/20">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "employees" && <EmployeeTab employees={employees} companyId={companyId} queryClient={queryClient} />}
      {tab === "salary" && <SalaryTab employees={employees} selectedEmpId={selectedEmpId} setSelectedEmpId={setSelectedEmpId} salaryHistory={salaryHistory} companyId={companyId} userId={userId} queryClient={queryClient} />}
      {tab === "contracts" && <ContractTab employees={employees} contracts={contracts} companyId={companyId} queryClient={queryClient} />}
      {tab === "expenses" && <ExpenseTab expenses={expenses} companyId={companyId} userId={userId} queryClient={queryClient} />}
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
                <tr key={e.id} className="border-b border-[var(--border)]/50 hover:bg-white/[.02]">
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
