"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// 내 급여명세 — payroll_items 는 RLS(payroll_items_select_role_or_self)로 본인 행만 조회됨.
//   개인 인사기록 허브(2026-07-15): 관리자가 발송한 월별 급여명세를 마이페이지에서 직접 확인.
const won = (n: number) => "₩" + Math.round(Number(n || 0)).toLocaleString();

export function MyPayslips({ employeeId }: { employeeId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: payslips = [], isLoading } = useQuery({
    queryKey: ["mypage-payslips", employeeId],
    queryFn: async () => {
      const db = supabase as any;
      const { data } = await db
        .from("payroll_items")
        .select(
          "id, base_salary, national_pension, health_insurance, long_term_care_insurance, employment_insurance, income_tax, local_income_tax, deductions_total, net_pay, created_at, payment_batches:batch_id(name, status, created_at)",
        )
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false });
      // 배치가 승인/확정된 명세만 노출(초안 배치 숨김).
      return (data || []).filter((it: any) => it.payment_batches);
    },
    enabled: !!employeeId,
  });

  return (
    <div className="mypage-payslips-card glass-card p-6">
      <h2 className="section-title">내 급여명세</h2>
      {isLoading ? (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">불러오는 중...</div>
      ) : payslips.length === 0 ? (
        <div className="py-10 text-center">
          <div className="text-3xl mb-2">💳</div>
          <div className="text-sm font-semibold text-[var(--text-muted)]">발급된 급여명세가 없습니다</div>
          <div className="text-xs text-[var(--text-dim)] mt-1">급여가 지급되면 월별 명세가 이곳에 표시됩니다.</div>
        </div>
      ) : (
        <div className="mypage-payslips-list space-y-2.5">
          {payslips.map((p: any) => {
            const batch = p.payment_batches || {};
            const dateStr = batch.created_at ? new Date(batch.created_at).toLocaleDateString("ko-KR") : "";
            const deductions = [
              { label: "국민연금", v: p.national_pension },
              { label: "건강보험", v: p.health_insurance },
              { label: "장기요양", v: p.long_term_care_insurance },
              { label: "고용보험", v: p.employment_insurance },
              { label: "소득세", v: p.income_tax },
              { label: "지방소득세", v: p.local_income_tax },
            ];
            const open = openId === p.id;
            return (
              <div key={p.id} className="mypage-payslip-row bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : p.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{batch.name || "급여"}</div>
                    <div className="text-xs text-[var(--text-muted)]">{dateStr}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-[10px] text-[var(--text-dim)]">실수령액</div>
                      <div className="text-sm font-bold mono-number text-[var(--success)]">{won(p.net_pay)}</div>
                    </div>
                    <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 pt-1 border-t border-[var(--border)] text-xs">
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-[var(--text-muted)]">기본급(과세)</span>
                      <span className="mono-number font-medium">{won(p.base_salary)}</span>
                    </div>
                    {deductions.filter((d) => Number(d.v) > 0).map((d) => (
                      <div key={d.label} className="flex items-center justify-between py-1.5">
                        <span className="text-[var(--text-muted)]">{d.label}</span>
                        <span className="mono-number text-[var(--danger)]">-{won(d.v)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between py-1.5 border-t border-[var(--border)] mt-1">
                      <span className="text-[var(--text-muted)]">공제 합계</span>
                      <span className="mono-number text-[var(--danger)]">-{won(p.deductions_total)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-[var(--border)] mt-1">
                      <span className="font-semibold">실수령액</span>
                      <span className="mono-number font-bold text-[var(--success)]">{won(p.net_pay)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
