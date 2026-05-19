"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { calculatePayroll, type PayrollItem } from "@/lib/payment-batch";

// 직원 본인 급여명세서 — 월별 이력 열람 + 더존 Smart-A 양식 PDF 다운로드.
//   대시보드 급여 카드가 요약만 보여주고 PDF 진입이 없던 문제를 해소한다.
//   본인 employees 레코드 범위 내에서만 조회 (RLS 회사·본인 격리).

type Row = {
  id: string;
  base_salary: number | null;
  deductions_total: number | null;
  net_pay: number | null;
  national_pension: number | null;
  health_insurance: number | null;
  employment_insurance: number | null;
  income_tax: number | null;
  local_income_tax: number | null;
  status: string | null;
  created_at: string | null;
  payment_batches: { name: string | null; created_at: string | null; company_id: string } | null;
};

const fmtW = (n: number | null | undefined) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;

function periodFromRow(r: Row): { ym: string; label: string } {
  const src = r.payment_batches?.created_at || r.created_at || new Date().toISOString();
  const d = new Date(src);
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  // 배치 이름에 'YYYY년 M월'이 있으면 우선 사용
  const nm = r.payment_batches?.name || "";
  const m = nm.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  const label = m ? `${m[1]}년 ${parseInt(m[2], 10)}월` : `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  return { ym, label };
}

export default function PayslipPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const [downloading, setDownloading] = useState<string | null>(null);

  // 본인 employees 레코드
  const { data: emp } = useQuery({
    queryKey: ["payslip-emp", companyId, userId, userEmail],
    queryFn: async () => {
      const db = supabase as any;
      const filters = [`user_id.eq.${userId}`];
      if (userEmail) filters.push(`email.eq.${userEmail}`);
      const { data } = await db
        .from("employees")
        .select("id, name, department, position, birth_date")
        .eq("company_id", companyId!)
        .or(filters.join(","))
        .limit(1)
        .maybeSingle();
      return data as { id: string; name: string; department: string | null; position: string | null; birth_date: string | null } | null;
    },
    enabled: !!companyId && !!userId,
  });

  const { data: company } = useQuery({
    queryKey: ["payslip-company", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("name, representative").eq("id", companyId!).maybeSingle();
      return data as { name: string; representative: string | null } | null;
    },
    enabled: !!companyId,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["payslip-rows", emp?.id],
    queryFn: async () => {
      const db = supabase as any;
      const { data } = await db
        .from("payroll_items")
        .select(
          "id, base_salary, deductions_total, net_pay, national_pension, health_insurance, employment_insurance, income_tax, local_income_tax, status, created_at, payment_batches!inner(name, created_at, company_id)",
        )
        .eq("employee_id", emp!.id)
        .eq("payment_batches.company_id", companyId!)
        .order("created_at", { ascending: false, referencedTable: "payment_batches" })
        .limit(36);
      return (data || []) as Row[];
    },
    enabled: !!emp?.id && !!companyId,
  });

  function buildItem(r: Row): PayrollItem {
    const base = calculatePayroll(Number(r.base_salary) || 0, emp?.name || "직원", emp?.id || "", { nonTaxableAmount: 0 });
    return {
      ...base,
      nationalPension: r.national_pension ?? base.nationalPension,
      healthInsurance: r.health_insurance ?? base.healthInsurance,
      employmentInsurance: r.employment_insurance ?? base.employmentInsurance,
      incomeTax: r.income_tax ?? base.incomeTax,
      localIncomeTax: r.local_income_tax ?? base.localIncomeTax,
      deductionsTotal: r.deductions_total ?? base.deductionsTotal,
      netPay: r.net_pay ?? base.netPay,
    };
  }

  async function download(r: Row) {
    if (!emp) return;
    setDownloading(r.id);
    try {
      const { downloadPayslipPDF, birthDateToPassword } = await import("@/lib/payslip-pdf");
      const { label } = periodFromRow(r);
      await downloadPayslipPDF({
        item: buildItem(r),
        companyName: company?.name || "회사",
        representative: company?.representative || undefined,
        periodLabel: label,
        department: emp.department || undefined,
        position: emp.position || undefined,
        employeeCode: emp.id ? emp.id.slice(-4).toUpperCase() : undefined,
        birthDate: emp.birth_date || undefined,
        password: birthDateToPassword(emp.birth_date),
      });
      toast(`${label} 급여명세서 PDF 다운로드 완료`, "success");
    } catch (e: any) {
      toast("PDF 생성 실패: " + (e?.message || ""), "error");
    }
    setDownloading(null);
  }

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const latest = rows[0];

  return (
    <div className="max-w-[860px]">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">급여명세서</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">월별 급여 내역 열람 및 PDF 다운로드 (PDF 비밀번호 = 생년월일 8자리)</p>
      </div>

      {!emp ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <div className="text-sm font-semibold text-[var(--text)]">내 계정이 직원 레코드와 연결돼 있지 않습니다</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">관리자에게 직원 등록·계정 연결을 요청하세요.</div>
        </div>
      ) : (
        <>
          {/* 최근 급여 요약 */}
          {latest && (
            <div className="mb-5 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">💰</span>
                  <span className="text-sm font-bold text-[var(--text)]">{periodFromRow(latest).label} 급여</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    latest.status === "paid" ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
                  }`}>
                    {latest.status === "paid" ? "지급 완료" : "처리 중"}
                  </span>
                </div>
                <button
                  onClick={() => download(latest)}
                  disabled={downloading === latest.id}
                  className="px-3 py-1.5 text-xs font-semibold bg-[var(--primary)] text-white rounded-lg hover:opacity-90 transition disabled:opacity-50"
                >
                  {downloading === latest.id ? "생성 중..." : "PDF 다운로드"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] text-[var(--text-dim)] mb-0.5">지급액(세전)</div>
                  <div className="text-sm font-bold">{fmtW(latest.base_salary)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-dim)] mb-0.5">공제 합계</div>
                  <div className="text-sm font-bold text-red-400">-{fmtW(latest.deductions_total)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-dim)] mb-0.5">실수령액</div>
                  <div className="text-lg font-black text-[var(--primary)]">{fmtW(latest.net_pay)}</div>
                </div>
              </div>
            </div>
          )}

          {/* 월별 이력 */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] text-sm font-bold text-[var(--text-muted)]">급여 이력</div>
            {isLoading ? (
              <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-[var(--text-muted)]">
                아직 발급된 급여명세서가 없습니다. 급여 지급일: 매월 25일
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {rows.map((r) => {
                  const { label } = periodFromRow(r);
                  return (
                    <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-24 shrink-0 text-sm font-semibold">{label}</div>
                      <div className="flex-1 min-w-0 grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-[var(--text-dim)]">세전 </span>
                          <span className="font-semibold">{fmtW(r.base_salary)}</span>
                        </div>
                        <div>
                          <span className="text-[var(--text-dim)]">공제 </span>
                          <span className="font-semibold text-red-400">-{fmtW(r.deductions_total)}</span>
                        </div>
                        <div>
                          <span className="text-[var(--text-dim)]">실수령 </span>
                          <span className="font-bold text-[var(--primary)]">{fmtW(r.net_pay)}</span>
                        </div>
                      </div>
                      <span className={`hidden sm:inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                        r.status === "paid" ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
                      }`}>
                        {r.status === "paid" ? "지급 완료" : "처리 중"}
                      </span>
                      <button
                        onClick={() => download(r)}
                        disabled={downloading === r.id}
                        className="px-2.5 py-1.5 text-[11px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg transition shrink-0 disabled:opacity-50"
                      >
                        {downloading === r.id ? "생성 중..." : "PDF"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-dim)] mt-3">
            ※ 명세서 금액은 등록된 급여·4대보험 요율 기준으로 산출됩니다. 실제 지급액과 차이가 있으면 인사 담당자에게 문의하세요.
          </p>
        </>
      )}
    </div>
  );
}
