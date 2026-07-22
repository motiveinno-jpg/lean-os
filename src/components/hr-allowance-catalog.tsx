"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// L 수당 카탈로그 — 회사 설정 패널 (§C-1).
//   - settings/page.tsx 의 '근태/가산수당' 탭에서 마운트.
//   - 법정 4종(+휴일 8h 초과 분리) + 회사 커스텀 수당 관리.
//   - 법정행: 자물쇠 표시. 이름/코드 비활성, 단가·is_active 만 수정 가능, 삭제 차단.
//   - 모달: 신규 수당 추가 — 계산방식 분기 (auto_time / per_count / fixed_per_month / manual).

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import {
  listAllowanceTypes,
  createAllowanceType,
  updateAllowanceType,
  deleteAllowanceType,
  type AllowanceTypeRow,
} from "@/lib/hr";
import { useModalKeys } from "@/hooks/use-modal-keys";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

const fmtKRW = (n: number) => `${(n || 0).toLocaleString("ko-KR")}원`;

type CalcMode = AllowanceTypeRow["calc_mode"];

const CALC_MODE_LABEL: Record<CalcMode, string> = {
  auto_time: "시간 자동",
  per_count: "회당 정액",
  fixed_per_month: "월정액",
  manual: "수동 입력",
};

const BASE_FIELD_LABEL: Record<string, string> = {
  overtime_minutes: "연장근로",
  night_minutes: "야간근로",
  holiday_minutes: "휴일근로(8h이내)",
  holiday_over_8h_minutes: "휴일근로(8h초과)",
};

function rateSummary(t: AllowanceTypeRow): string {
  if (t.calc_mode === "manual") return "관리자 입력";
  if (t.calc_mode === "auto_time") {
    const baseLabel = BASE_FIELD_LABEL[t.base_field || ""] || t.base_field || "";
    if (t.rate_type === "hourly_multiplier") return `시급 × ${t.rate_amount}${baseLabel ? ` · ${baseLabel}` : ""}`;
    if (t.rate_type === "fixed_per_minute") return `${fmtKRW(t.rate_amount)}/분${baseLabel ? ` · ${baseLabel}` : ""}`;
  }
  if (t.calc_mode === "per_count") return `${fmtKRW(t.rate_amount)}/회`;
  if (t.calc_mode === "fixed_per_month") return `${fmtKRW(t.rate_amount)}/월`;
  return "—";
}

export default function HrAllowanceCatalogPanel({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AllowanceTypeRow | null>(null);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ["allowance-types", companyId],
    queryFn: () => listAllowanceTypes(companyId),
    enabled: !!companyId,
  });

  const toggleActive = useMutation({
    mutationFn: (params: { id: string; is_active: boolean }) =>
      updateAllowanceType(params.id, { is_active: params.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allowance-types", companyId] }),
    onError: (err: any) => toast(friendlyError(err, "변경에 실패했습니다."), "error"),
  });

  const updateRate = useMutation({
    mutationFn: (params: { id: string; rate_amount: number }) =>
      updateAllowanceType(params.id, { rate_amount: params.rate_amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowance-types", companyId] });
      toast("단가가 변경되었습니다.", "success");
    },
    onError: (err: any) => toast(friendlyError(err, "단가 변경에 실패했습니다."), "error"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteAllowanceType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowance-types", companyId] });
      toast("수당이 삭제되었습니다.", "success");
    },
    onError: (err: any) => toast(friendlyError(err, "삭제에 실패했습니다."), "error"),
  });

  return (
    <div className="allowance-catalog glass-card">
      <div className="allowance-catalog-header">
        <h2 className="text-sm font-bold">수당 관리</h2>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold"
        >
          + 수당 추가
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-dim)] mb-3">
        법정 수당(연장·야간·휴일·당직)은 자동 생성됩니다. 단가만 회사 정책에 맞춰 조정하세요.
        커스텀 수당은 자유롭게 추가/삭제할 수 있습니다.
      </p>

      {isLoading ? (
        <p className="text-xs text-[var(--text-muted)]">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)] text-[11px]">
                <th className="text-left px-2 py-2 font-semibold">표시명</th>
                <th className="text-left px-2 py-2 font-semibold">계산방식</th>
                <th className="text-left px-2 py-2 font-semibold">단가·근거</th>
                <th className="text-center px-2 py-2 font-semibold">활성</th>
                <th className="text-right px-2 py-2 font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="allowance-row">
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      {t.is_legal_mandatory && <span title="법정 수당" className="text-[10px]">🔒</span>}
                      <span className="font-semibold">{t.name}</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{t.code}</div>
                  </td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">{CALC_MODE_LABEL[t.calc_mode]}</td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">{rateSummary(t)}</td>
                  <td className="px-2 py-2 text-center">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={t.is_active}
                        onChange={(e) => toggleActive.mutate({ id: t.id, is_active: e.target.checked })}
                      />
                    </label>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => { setEditing(t); setModalOpen(true); }}
                        className="px-2 py-1 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded text-[10px] hover:opacity-80"
                      >
                        수정
                      </button>
                      {!t.is_legal_mandatory && (
                        <button
                          onClick={async () => {
                            if (await appConfirm(`'${t.name}' 수당을 삭제하시겠습니까?`, { danger: true })) {
                              delMut.mutate(t.id);
                            }
                          }}
                          className="px-2 py-1 bg-[var(--danger)] hover:brightness-110 text-white rounded text-[10px]"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {types.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-[var(--text-muted)]">
                    등록된 수당이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <AllowanceTypeModal
          companyId={companyId}
          initial={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["allowance-types", companyId] });
            setModalOpen(false);
            setEditing(null);
          }}
          onRateChange={(id, amt) => updateRate.mutate({ id, rate_amount: amt })}
        />
      )}
    </div>
  );
}

// ── 모달 — 수당 추가/수정 ──

function AllowanceTypeModal({
  companyId,
  initial,
  onClose,
  onSaved,
  onRateChange,
}: {
  companyId: string;
  initial: AllowanceTypeRow | null;
  onClose: () => void;
  onSaved: () => void;
  onRateChange: (id: string, amount: number) => void;
}) {
  const { toast } = useToast();
  const isLegal = !!initial?.is_legal_mandatory;
  const isEdit = !!initial;

  const [form, setForm] = useState<{
    name: string;
    calc_mode: CalcMode;
    base_field: string;
    rate_type: AllowanceTypeRow["rate_type"];
    rate_amount: number;
    applies_to: "all" | "employees";
    target_employee_ids: string[];
    display_order: number;
    is_active: boolean;
  }>(() => ({
    name: initial?.name || "",
    calc_mode: initial?.calc_mode || "auto_time",
    base_field: initial?.base_field || "overtime_minutes",
    rate_type: initial?.rate_type || "hourly_multiplier",
    rate_amount: Number(initial?.rate_amount ?? 0),
    applies_to: initial?.applies_to || "all",
    target_employee_ids: initial?.target_employee_ids || [],
    display_order: Number(initial?.display_order ?? 100),
    is_active: initial?.is_active ?? true,
  }));

  // 직원 다중 선택용 (applies_to=employees)
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-min", companyId],
    queryFn: async () => {
      const data = logRead('components/hr-allowance-catalog:data', await db
        .from("employees")
        .select("id, name")
        .eq("company_id", companyId)
        .in("status", ["active", "joined", "invited"])
        .order("name"));
      return (data as { id: string; name: string }[]) || [];
    },
    enabled: !!companyId,
  });

  // calc_mode 변경 시 rate_type/base_field 자동 보정
  useEffect(() => {
    setForm((f) => {
      let rate_type: AllowanceTypeRow["rate_type"] = f.rate_type;
      if (f.calc_mode === "per_count") rate_type = "fixed_per_count";
      else if (f.calc_mode === "fixed_per_month") rate_type = "fixed_per_month";
      else if (f.calc_mode === "auto_time" && rate_type !== "hourly_multiplier" && rate_type !== "fixed_per_minute") {
        rate_type = "hourly_multiplier";
      }
      return { ...f, rate_type };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.calc_mode]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isEdit && initial) {
        // 법정행은 단가/활성/표시순서/적용대상만 변경 가능
        if (isLegal) {
          // rate_amount 변경은 부모의 mutation 으로 즉시 invalidate 처리 — 모달은 close 만.
          if (form.rate_amount !== Number(initial.rate_amount)) {
            onRateChange(initial.id, form.rate_amount);
          }
          await updateAllowanceType(initial.id, {
            is_active: form.is_active,
            display_order: form.display_order,
            applies_to: form.applies_to,
            target_employee_ids: form.target_employee_ids,
          });
        } else {
          await updateAllowanceType(initial.id, {
            name: form.name,
            calc_mode: form.calc_mode,
            base_field: form.calc_mode === "auto_time" ? form.base_field : null,
            rate_type: form.rate_type,
            rate_amount: form.rate_amount,
            applies_to: form.applies_to,
            target_employee_ids: form.target_employee_ids,
            display_order: form.display_order,
            is_active: form.is_active,
          });
        }
      } else {
        await createAllowanceType({
          companyId,
          name: form.name,
          calc_mode: form.calc_mode,
          base_field: form.calc_mode === "auto_time" ? form.base_field : null,
          rate_type: form.rate_type,
          rate_amount: form.rate_amount,
          applies_to: form.applies_to,
          target_employee_ids: form.target_employee_ids,
          display_order: form.display_order,
          is_active: form.is_active,
        });
      }
    },
    onSuccess: () => {
      toast(isEdit ? "수당이 수정되었습니다." : "수당이 추가되었습니다.", "success");
      onSaved();
    },
    onError: (err: any) => toast(friendlyError(err, "저장에 실패했습니다."), "error"),
  });

  const canSubmit = useMemo(() => {
    if (!form.name.trim()) return false;
    if (form.rate_amount < 0) return false;
    return true;
  }, [form.name, form.rate_amount]);

  // ESC 닫기 · Enter 확인(저장 — 미충족/저장 중이면 비활성)
  useModalKeys(true, onClose, saveMut.isPending || !canSubmit ? undefined : () => saveMut.mutate());

  return (
    <div className="allowance-modal-overlay fixed inset-0">
      <div
        className="allowance-modal glass-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="section-title">{isEdit ? "수당 수정" : "수당 추가"}</h3>
        {isLegal && (
          <div className="allowance-legal-notice">
            🔒 법정 수당입니다. 단가·활성·적용대상·표시순서만 수정할 수 있습니다.
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">표시명</label>
            <input
              type="text"
              value={form.name}
              disabled={isLegal}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs disabled:opacity-60"
              placeholder="예: 식대"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">계산방식</label>
            <select
              value={form.calc_mode}
              disabled={isLegal}
              onChange={(e) => setForm({ ...form, calc_mode: e.target.value as CalcMode })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs disabled:opacity-60"
            >
              <option value="auto_time">시간 자동 (근태 분 합산 × 단가)</option>
              <option value="per_count">회당 정액 (당직·출장 등 횟수 × 단가)</option>
              <option value="fixed_per_month">월정액 (식대·직책 등)</option>
              <option value="manual">수동 입력 (관리자가 직접 금액 입력)</option>
            </select>
          </div>

          {form.calc_mode === "auto_time" && (
            <>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">집계 대상 (base)</label>
                <select
                  value={form.base_field}
                  disabled={isLegal}
                  onChange={(e) => setForm({ ...form, base_field: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs disabled:opacity-60"
                >
                  <option value="overtime_minutes">연장근로 분</option>
                  <option value="night_minutes">야간근로 분</option>
                  <option value="holiday_minutes">휴일근로 분(8h 이내)</option>
                  <option value="holiday_over_8h_minutes">휴일근로 분(8h 초과)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">단가 방식</label>
                <select
                  value={form.rate_type}
                  disabled={isLegal}
                  onChange={(e) => setForm({ ...form, rate_type: e.target.value as AllowanceTypeRow["rate_type"] })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs disabled:opacity-60"
                >
                  <option value="hourly_multiplier">통상시급 배수 (예: 1.5)</option>
                  <option value="fixed_per_minute">분당 정액 (원/분)</option>
                </select>
              </div>
            </>
          )}

          {(form.calc_mode !== "manual") && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {form.rate_type === "hourly_multiplier" ? "배수" :
                 form.rate_type === "fixed_per_minute" ? "원/분" :
                 form.rate_type === "fixed_per_count" ? "원/회" : "원/월"}
              </label>
              <input
                type="number" min={0} step={form.rate_type === "hourly_multiplier" ? 0.1 : 1}
                value={form.rate_amount}
                onChange={(e) => setForm({ ...form, rate_amount: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">적용 대상</label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setForm({ ...form, applies_to: "all" })}
                className={`px-3 py-1.5 rounded text-[11px] ${form.applies_to === "all" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg)] border border-[var(--border)]"}`}
              >전체</button>
              <button
                onClick={() => setForm({ ...form, applies_to: "employees" })}
                className={`px-3 py-1.5 rounded text-[11px] ${form.applies_to === "employees" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg)] border border-[var(--border)]"}`}
              >특정 직원</button>
            </div>
            {form.applies_to === "employees" && (
              <div className="allowance-employee-picker">
                {employees.length === 0 && <span className="caption">직원 없음</span>}
                {employees.map((e) => {
                  const selected = form.target_employee_ids.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      onClick={() => setForm({
                        ...form,
                        target_employee_ids: selected
                          ? form.target_employee_ids.filter((id) => id !== e.id)
                          : [...form.target_employee_ids, e.id],
                      })}
                      className={`px-2 py-1 rounded text-[10px] ${selected ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"}`}
                    >
                      {e.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">명세서 표시 순서</label>
              <input
                type="number" min={0} max={9999}
                value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <span className="text-xs">활성</span>
              </label>
            </div>
          </div>
        </div>

        <div className="allowance-modal-actions">
          <button onClick={onClose} className="flex-1 py-2 bg-[var(--bg)] text-[var(--text-muted)] rounded-lg text-xs">
            취소
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !canSubmit}
            className="flex-1 btn-primary btn-sm"
          >
            {saveMut.isPending ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
