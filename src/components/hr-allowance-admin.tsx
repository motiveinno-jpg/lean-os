"use client";
import { logRead } from "@/lib/log-read";

// L 수당 — 관리자/대표 수당 명세 화면 (§C-3).
//   - 월 선택, 행=직원, 열=활성 allowance_types, 셀=entries.amount.
//   - manual 모드 셀은 인라인 수정 (source='edit', edited_by).
//   - auto 모드 셀은 클릭 시 안내(원본 근태 수정 필요) + force override 옵션.
//   - 액션: "이번 달 일괄 재계산" / "엑셀 export" / "급여배치 반영(안내)"
//   - 권한 게이트는 호출하는 상위에서(AccessDenied) 적용 — 본 컴포넌트는 admin/owner 가정.

import React, { useMemo, useState } from "react";
import { MonthField } from "@/components/month-field";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import {
  listAllowanceTypes,
  listCompanyAllowanceEntries,
  upsertAllowanceEntryManual,
  type AllowanceTypeRow,
  type AllowanceEntryRow,
} from "@/lib/hr";
import { recomputeMonthlyAllowancesForCompany } from "@/lib/allowance-calc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const fmtKRW = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type EmployeeMin = { id: string; name: string };

export default function AllowanceAdminTab({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<string>(currentYearMonth());
  const [forceOverride, setForceOverride] = useState(false);

  const { data: employees = [] } = useQuery<EmployeeMin[]>({
    queryKey: ["allowance-admin-emps", companyId],
    queryFn: async () => {
      const data = logRead('components/hr-allowance-admin:data', await db
        .from("employees")
        .select("id, name")
        .eq("company_id", companyId)
        .in("status", ["active", "joined", "invited"])
        .order("name"));
      return (data as EmployeeMin[]) || [];
    },
    enabled: !!companyId,
  });

  const { data: types = [] } = useQuery({
    queryKey: ["allowance-types", companyId],
    queryFn: () => listAllowanceTypes(companyId),
    enabled: !!companyId,
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ["allowance-entries-admin", companyId, month],
    queryFn: () => listCompanyAllowanceEntries(companyId, month),
    enabled: !!companyId && !!month,
  });

  const activeTypes = useMemo(
    () => types.filter((t) => t.is_active).sort((a, b) => a.display_order - b.display_order),
    [types],
  );

  // 직원ID × 수당typeID → entry
  const entryMap = useMemo(() => {
    const m = new Map<string, AllowanceEntryRow>();
    entries.forEach((e) => m.set(`${e.employee_id}|${e.allowance_type_id}`, e));
    return m;
  }, [entries]);

  const recomputeMut = useMutation({
    mutationFn: () =>
      recomputeMonthlyAllowancesForCompany(companyId, month, { force: forceOverride }),
    onSuccess: (res) => {
      toast(
        `재계산 완료 — ${res.ok}건 성공${res.failed > 0 ? `, ${res.failed}건 실패` : ""}`,
        res.failed > 0 ? "info" : "success",
      );
      queryClient.invalidateQueries({ queryKey: ["allowance-entries-admin", companyId, month] });
      // 회귀픽스 (2026-05-21): /attendance 표의 수당 컬럼 stale 방지.
      //   employees/page.tsx AttendanceTab 가 ["allowance-entries-monthly-summary"] 키로 별도 조회 →
      //   본 컴포넌트 일괄 재계산 후 그쪽도 invalidate.
      queryClient.invalidateQueries({ queryKey: ["allowance-entries-monthly-summary"] });
    },
    onError: (err: any) => toast(friendlyError(err, "재계산에 실패했습니다."), "error"),
  });

  const editMut = useMutation({
    mutationFn: (params: { employeeId: string; typeId: string; amount: number }) =>
      upsertAllowanceEntryManual({
        companyId,
        employeeId: params.employeeId,
        payrollMonth: month,
        allowanceTypeId: params.typeId,
        amount: params.amount,
        editedBy: userId || "",
        source: "edit",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowance-entries-admin", companyId, month] });
      queryClient.invalidateQueries({ queryKey: ["allowance-entries-monthly-summary"] });
      toast("수당이 수정되었습니다.", "success");
    },
    onError: (err: any) => toast(friendlyError(err, "수정에 실패했습니다."), "error"),
  });

  // 직원별 합계, 수당별 합계
  const empTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const emp of employees) {
      let sum = 0;
      for (const tp of activeTypes) {
        const e = entryMap.get(`${emp.id}|${tp.id}`);
        sum += Number(e?.amount || 0);
      }
      t[emp.id] = sum;
    }
    return t;
  }, [employees, activeTypes, entryMap]);

  const typeTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const tp of activeTypes) {
      let sum = 0;
      for (const emp of employees) {
        const e = entryMap.get(`${emp.id}|${tp.id}`);
        sum += Number(e?.amount || 0);
      }
      t[tp.id] = sum;
    }
    return t;
  }, [employees, activeTypes, entryMap]);

  const grandTotal = useMemo(
    () => Object.values(empTotals).reduce((s, n) => s + n, 0),
    [empTotals],
  );

  const exportCsv = () => {
    const header = ["직원", ...activeTypes.map((t) => t.name), "합계"];
    const rows = employees.map((emp) => {
      const cells = activeTypes.map((tp) => {
        const e = entryMap.get(`${emp.id}|${tp.id}`);
        return String(Math.round(Number(e?.amount || 0)));
      });
      return [emp.name, ...cells, String(Math.round(empTotals[emp.id] || 0))];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `수당명세_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="allowance-admin-tab">
      <div className="allowance-admin-toolbar">
        <div>
          <label className="block text-[10px] text-[var(--text-muted)] mb-1">대상 월</label>
          <MonthField
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
          />
        </div>
        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={forceOverride}
            onChange={(e) => setForceOverride(e.target.checked)}
          />
          <span className="text-[10px] text-[var(--text-muted)]">강제 덮어쓰기 (manual/edit 행 무시)</span>
        </label>
        <div className="ml-auto flex gap-2 mt-4">
          <button
            onClick={() => recomputeMut.mutate()}
            disabled={recomputeMut.isPending}
            className="px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-xs font-semibold disabled:opacity-40"
            title="모든 직원에 대해 attendance_records 기반으로 allowance_entries 재계산"
          >
            {recomputeMut.isPending ? "재계산 중…" : "이번 달 일괄 재계산"}
          </button>
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] rounded-lg text-xs font-semibold"
          >
            CSV Export
          </button>
        </div>
      </div>

      <div className="allowance-matrix-card glass-card">
        <div className="overflow-x-auto">
          {entriesLoading ? (
            <div className="p-6 text-xs text-[var(--text-muted)]">불러오는 중…</div>
          ) : employees.length === 0 || activeTypes.length === 0 ? (
            <div className="p-6 text-xs text-[var(--text-muted)] text-center">
              {employees.length === 0 ? "직원이 없습니다." : "활성 수당이 없습니다."}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-surface)]">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-[var(--bg-surface)] z-10 font-semibold">직원</th>
                  {activeTypes.map((t) => (
                    <th key={t.id} className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {t.is_legal_mandatory && <span title="법정" className="text-[10px]">🔒</span>}
                        <span>{t.name}</span>
                      </div>
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 font-bold whitespace-nowrap">합계</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 sticky left-0 bg-[var(--bg-card)] font-semibold">{emp.name}</td>
                    {activeTypes.map((t) => {
                      const e = entryMap.get(`${emp.id}|${t.id}`);
                      const amount = Number(e?.amount || 0);
                      const editable = t.calc_mode === "manual";
                      return (
                        <td key={t.id} className="px-3 py-2 text-right tabular-nums">
                          {editable ? (
                            <EditableCell
                              value={amount}
                              isEdited={e?.source === "edit" || e?.source === "manual"}
                              onCommit={(v) =>
                                editMut.mutate({ employeeId: emp.id, typeId: t.id, amount: v })
                              }
                            />
                          ) : (
                            <button
                              onClick={() => {
                                const msg =
                                  e?.source === "edit"
                                    ? "관리자가 수정한 값입니다. 자동 계산으로 되돌리려면 '강제 덮어쓰기' 후 재계산."
                                    : "원본 근태(분 단위)를 수정한 뒤 '재계산' 버튼을 눌러주세요.";
                                toast(msg, "info");
                              }}
                              className="text-right hover:opacity-70"
                            >
                              <span className={e?.source === "edit" ? "text-yellow-400" : ""}>
                                {fmtKRW(amount)}
                              </span>
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-[var(--primary)]">
                      {fmtKRW(empTotals[emp.id] || 0)}
                    </td>
                  </tr>
                ))}
                {/* 합계 행 */}
                <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">
                  <td className="px-3 py-2 font-bold sticky left-0 bg-[var(--bg-surface)]">합계</td>
                  {activeTypes.map((t) => (
                    <td key={t.id} className="px-3 py-2 text-right tabular-nums font-bold">
                      {fmtKRW(typeTotals[t.id] || 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-extrabold text-[var(--primary)]">
                    {fmtKRW(grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">
        · auto/시간 자동 수당은 원본 근태 분(분) 기반으로 자동 계산됩니다. 셀 클릭 시 안내가 뜹니다.<br />
        · 수동 입력 수당은 셀을 직접 클릭해 금액을 입력할 수 있습니다 (관리자 수정 = source 'edit').<br />
        · '강제 덮어쓰기' 체크 후 재계산하면 관리자 수정값도 자동 계산값으로 되돌립니다.
      </p>
    </div>
  );
}

// ── 인라인 수정 셀 ──

function EditableCell({
  value,
  isEdited,
  onCommit,
}: {
  value: number;
  isEdited: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(value)));

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(Math.round(value))); setEditing(true); }}
        className="text-right hover:underline"
      >
        <span className={isEdited ? "text-yellow-400" : ""}>{`${Math.round(value).toLocaleString("ko-KR")}원`}</span>
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      min={0}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const v = Number(draft) || 0;
        if (v !== Math.round(value)) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(String(Math.round(value))); setEditing(false); }
      }}
      className="w-24 px-2 py-1 bg-[var(--bg)] border border-[var(--primary)] rounded text-xs text-right tabular-nums"
    />
  );
}
