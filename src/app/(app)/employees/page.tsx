"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";

export default function EmployeesPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", salary: "", hire_date: "" });
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => u && setCompanyId(u.company_id));
  }, []);

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

  const addEmployee = useMutation({
    mutationFn: async () => {
      await supabase.from("employees").insert({
        company_id: companyId!,
        name: form.name,
        salary: Number(form.salary) || 0,
        hire_date: form.hire_date || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setShowForm(false);
      setForm({ name: "", salary: "", hire_date: "" });
    },
  });

  const totalSalary = employees.reduce((s, e) => s + Number(e.salary || 0), 0);
  const totalRetirement = employees.reduce((s, e) => s + Number(e.retirement_accrual || 0), 0);

  return (
    <div className="max-w-[900px]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">인력 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">직원 급여 + 퇴직충당금 관리</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
        >
          + 직원 추가
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">총 인원</div>
          <div className="text-lg font-bold mt-1">{employees.filter(e => e.status === 'active').length}명</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">월 급여 합계</div>
          <div className="text-lg font-bold text-red-400 mt-1">₩{totalSalary.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">퇴직충당금 합계</div>
          <div className="text-lg font-bold text-[var(--warning)] mt-1">₩{totalRetirement.toLocaleString()}</div>
        </div>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">이름 *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">월급 (원)</label>
              <input type="number" value={form.salary} onChange={e => setForm({...form, salary: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">입사일</label>
              <input type="date" value={form.hire_date} onChange={e => setForm({...form, hire_date: e.target.value})} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <button onClick={() => form.name && addEmployee.mutate()} disabled={!form.name} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">추가</button>
        </div>
      )}

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {employees.length === 0 ? (
          <div className="p-16 text-center"><div className="text-4xl mb-4">👥</div><div className="text-sm text-[var(--text-muted)]">등록된 직원이 없습니다</div></div>
        ) : (
          <table className="w-full">
            <thead><tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left px-5 py-3 font-medium">이름</th>
              <th className="text-right px-5 py-3 font-medium">월급</th>
              <th className="text-left px-5 py-3 font-medium">입사일</th>
              <th className="text-right px-5 py-3 font-medium">퇴직충당금</th>
              <th className="text-center px-5 py-3 font-medium">상태</th>
            </tr></thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id} className="border-b border-[var(--border)]/50 hover:bg-white/[.02]">
                  <td className="px-5 py-3 text-sm font-medium">{e.name}</td>
                  <td className="px-5 py-3 text-sm text-right">₩{Number(e.salary).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.hire_date || "—"}</td>
                  <td className="px-5 py-3 text-sm text-right text-[var(--warning)]">₩{Number(e.retirement_accrual).toLocaleString()}</td>
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
