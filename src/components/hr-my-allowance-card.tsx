"use client";

// L 수당 — 직원 본인 이번 달 수당 카드 (§C-2).
//   - attendance/my 페이지 + payslip 페이지에서 마운트.
//   - allowance_entries WHERE employee_id=본인, payroll_month=YYYY-MM (RLS 자동 제한).
//   - 표 행: 이름 · 금액 · 계산근거 1줄. 합산행 표시.

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listAllowanceTypes,
  listMyAllowanceEntries,
  type AllowanceTypeRow,
  type AllowanceEntryRow,
} from "@/lib/hr";

const fmtKRW = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
const minToH = (m: number) => `${(m / 60).toFixed(1)}h`;

function reasonText(t: AllowanceTypeRow, e: AllowanceEntryRow, hourly: number): string {
  if (t.calc_mode === "auto_time") {
    const min = e.calculated_minutes || 0;
    if (t.rate_type === "hourly_multiplier") {
      return `${minToH(min)} × 시급 ${fmtKRW(hourly)} × ${t.rate_amount}`;
    }
    return `${minToH(min)} × ${fmtKRW(t.rate_amount)}/분`;
  }
  if (t.calc_mode === "per_count") {
    return `${e.count || 0}회 × ${fmtKRW(t.rate_amount)}`;
  }
  if (t.calc_mode === "fixed_per_month") {
    return `월 정액 ${fmtKRW(t.rate_amount)}`;
  }
  if (t.calc_mode === "manual") {
    return e.source === "auto" ? "관리자 입력 대기" : "관리자 직접 입력";
  }
  return "";
}

export default function MyAllowanceCard({
  companyId,
  employeeId,
  yyyymm,
  hourly,
}: {
  companyId: string;
  employeeId: string;
  yyyymm: string;
  /** 통상시급 (계산근거 표시용). 없으면 산식만 표시. */
  hourly?: number;
}) {
  const { data: types = [] } = useQuery({
    queryKey: ["allowance-types", companyId],
    queryFn: () => listAllowanceTypes(companyId),
    enabled: !!companyId,
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["my-allowance-entries", employeeId, yyyymm],
    queryFn: () => listMyAllowanceEntries(employeeId, yyyymm),
    enabled: !!employeeId && !!yyyymm,
  });

  const typeById = new Map(types.map((t) => [t.id, t]));
  const activeTypes = types.filter((t) => t.is_active).sort((a, b) => a.display_order - b.display_order);

  // 활성 type 순서대로 entry 매칭. 없으면 0원으로 표시 (auto_time 인 경우).
  const rows = activeTypes
    .map((t) => {
      const e = entries.find((x) => x.allowance_type_id === t.id);
      return { type: t, entry: e };
    })
    // manual 인데 entry 없는 행은 표시 생략
    .filter(({ type, entry }) => !(type.calc_mode === "manual" && !entry));

  const total = rows.reduce((s, r) => s + Number(r.entry?.amount || 0), 0);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold">이번 달 수당 ({yyyymm})</h3>
        <span className="text-[10px] text-[var(--text-dim)]">예상 — 실제 지급은 명세서 확인</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--text-muted)]">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">활성 수당이 없습니다.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(({ type, entry }) => {
            const amount = Number(entry?.amount || 0);
            const fallbackEntry: AllowanceEntryRow = {
              id: "",
              company_id: companyId,
              employee_id: employeeId,
              payroll_month: yyyymm,
              allowance_type_id: type.id,
              calculated_minutes: 0,
              count: 0,
              amount: 0,
              source: "auto",
              edited_by: null,
              edited_at: null,
              note: null,
            };
            const reason = reasonText(type, entry || fallbackEntry, hourly || 0);
            return (
              <div key={type.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    {type.is_legal_mandatory && <span title="법정" className="text-[10px]">🔒</span>}
                    <span>{type.name}</span>
                    {entry?.source === "edit" && (
                      <span className="text-[9px] px-1 rounded bg-yellow-500/15 text-yellow-400">관리자 수정</span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">{reason}</div>
                </div>
                <div className="text-sm font-bold tabular-nums">{fmtKRW(amount)}</div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2 mt-1 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30">
            <span className="text-xs font-bold">수당 합계</span>
            <span className="text-sm font-extrabold text-[var(--primary)] tabular-nums">{fmtKRW(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
