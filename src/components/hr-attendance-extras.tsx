"use client";

// L 근태 — 화면 (C-2 직원 / C-3 관리자) 보조 컴포넌트.
//   - ExtraPaySummaryCard: 본인 이번 달 연장/야간/휴일/예상 가산수당
//   - AttendanceEditRequestDialog: 직원 → 관리자 수정 요청
//   - EditRequestInbox: 관리자 — pending 요청 승인/반려 + 관리액션 패널
//   - WeeklyCapBanner: 주 12h 연장 cap 초과 직원 표시 (관리자만)

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import {
  recomputeAttendance,
  recomputeMonthlyExtraPay,
  createAttendanceEditRequest,
  listAttendanceEditRequests,
  reviewAttendanceEditRequest,
  type MonthlyPayResult,
} from "@/lib/hr";

const fmtKRW = (n: number) => `${(n || 0).toLocaleString("ko-KR")}원`;
const minToH = (m: number) => `${(m / 60).toFixed(1)}h`;

// ── C-2: 직원 본인 — 이번 달 가산수당 요약 카드 ──

export function ExtraPaySummaryCard({
  companyId,
  employeeId,
  monthlyBaseSalary,
  yearMonth, // 'YYYY-MM'
}: {
  companyId: string;
  employeeId: string;
  monthlyBaseSalary: number;
  yearMonth: string;
}) {
  const [y, m] = yearMonth.split("-").map(Number);
  const { data: result, isLoading } = useQuery<MonthlyPayResult>({
    queryKey: ["extra-pay", companyId, employeeId, yearMonth, monthlyBaseSalary],
    queryFn: () =>
      recomputeMonthlyExtraPay({
        companyId,
        employeeId,
        year: y,
        month: m,
        monthlyBaseSalary,
        onDutyCount: 0,
      }),
    enabled: !!companyId && !!employeeId,
  });

  if (isLoading || !result) {
    return (
      <div className="glass-card p-4">
        <p className="text-xs text-[var(--text-muted)]">가산수당 산정 중…</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold">이번 달 가산수당 (예상)</h3>
        {result.cap_exceeded && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">
            주 12h 초과
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 mb-2">
        <Cell label="연장" value={`${minToH(result.overtime_pay > 0 ? result.overtime_pay : 0)}`} hint={fmtKRW(result.overtime_pay)} />
        <Cell label="야간" value={fmtKRW(result.night_pay)} />
        <Cell label="휴일" value={fmtKRW(result.holiday_pay)} />
        <Cell label="당직" value={fmtKRW(result.on_duty_pay)} />
      </div>
      <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">예상 가산수당 합계</span>
        <span className="text-sm font-bold text-[var(--primary)]">{fmtKRW(result.total_extra_pay)}</span>
      </div>
      {result.notes.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {result.notes.map((n, i) => (
            <li key={i} className="text-[10px] text-yellow-400">• {n}</li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-[var(--text-dim)] mt-2">
        실제 지급액은 회사 정책에 따라 달라질 수 있습니다. 정확한 산정은 급여 명세서를 확인하세요.
      </p>
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
      <div className="text-[10px] text-[var(--text-dim)]">{label}</div>
      <div className="text-xs font-bold mt-0.5">{value}</div>
      {hint && <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

// ── C-2: 수정 요청 다이얼로그 ──

export function AttendanceEditRequestDialog({
  open,
  onClose,
  companyId,
  attendanceRecordId,
  userId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  attendanceRecordId: string;
  userId: string;
  initial?: { check_in?: string; check_out?: string; status?: string };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    check_in: initial?.check_in?.slice(0, 16) || "",
    check_out: initial?.check_out?.slice(0, 16) || "",
    status: initial?.status || "",
    reason: "",
  });

  const mut = useMutation({
    mutationFn: () =>
      createAttendanceEditRequest({
        companyId,
        attendanceRecordId,
        requestedBy: userId,
        requestedChanges: {
          ...(form.check_in ? { check_in: new Date(form.check_in).toISOString() } : {}),
          ...(form.check_out ? { check_out: new Date(form.check_out).toISOString() } : {}),
          ...(form.status ? { status: form.status } : {}),
        },
        reason: form.reason || undefined,
      }),
    onSuccess: () => {
      toast("수정 요청을 보냈습니다. 관리자 승인 후 반영됩니다.", "success");
      queryClient.invalidateQueries({ queryKey: ["attendance-edit-requests"] });
      onClose();
    },
    onError: (err: any) =>
      toast(friendlyError(err, "요청 전송에 실패했습니다."), "error"),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="glass-card p-6 w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold mb-4">근태 수정 요청</h3>
        <p className="text-[10px] text-[var(--text-dim)] mb-4">
          잘못 찍은 출퇴근 기록의 변경을 관리자에게 요청합니다. 본인이 직접 수정할 수 없습니다.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">출근 시각 (변경)</label>
            <input
              type="datetime-local"
              value={form.check_in}
              onChange={(e) => setForm({ ...form, check_in: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">퇴근 시각 (변경)</label>
            <input
              type="datetime-local"
              value={form.check_out}
              onChange={(e) => setForm({ ...form, check_out: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs resize-none"
              placeholder="예: 출근 버튼을 깜빡 누르지 못했습니다."
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 bg-[var(--bg)] text-[var(--text-muted)] rounded-lg text-xs">
            취소
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || (!form.check_in && !form.check_out && !form.status)}
            className="flex-1 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-40"
          >
            {mut.isPending ? "전송 중…" : "요청 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── C-3: 관리자 — 수정 요청 인박스 ──

export function EditRequestInbox({ companyId, reviewerId }: { companyId: string; reviewerId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: requests = [], refetch } = useQuery({
    queryKey: ["attendance-edit-requests", companyId, "pending"],
    queryFn: () => listAttendanceEditRequests(companyId, "pending"),
    enabled: !!companyId,
  });

  const reviewMut = useMutation({
    mutationFn: (params: { requestId: string; decision: "approved" | "rejected"; applyChanges: boolean }) =>
      reviewAttendanceEditRequest({
        requestId: params.requestId,
        reviewerId,
        decision: params.decision,
        applyChanges: params.applyChanges,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-edit-requests"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      refetch();
    },
    onError: (err: any) =>
      toast(friendlyError(err, "처리에 실패했습니다."), "error"),
  });

  if (requests.length === 0) return null;

  return (
    <div className="glass-card p-4 mb-4">
      <h3 className="text-sm font-bold mb-3">근태 수정 요청 ({requests.length}건)</h3>
      <div className="space-y-2">
        {requests.map((r: any) => {
          const rec = r.attendance_records;
          const changes = r.requested_changes || {};
          return (
            <div key={r.id} className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold">
                  {rec?.employees?.name || "직원"} — {rec?.date}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => reviewMut.mutate({ requestId: r.id, decision: "approved", applyChanges: true })}
                    disabled={reviewMut.isPending}
                    className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-semibold disabled:opacity-40"
                  >
                    승인+적용
                  </button>
                  <button
                    onClick={() => reviewMut.mutate({ requestId: r.id, decision: "rejected", applyChanges: false })}
                    disabled={reviewMut.isPending}
                    className="px-2.5 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-[10px] font-semibold disabled:opacity-40"
                  >
                    반려
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                기존: {rec?.check_in ? new Date(rec.check_in).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {" / "}
                {rec?.check_out ? new Date(rec.check_out).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {" → 요청: "}
                {changes.check_in ? new Date(changes.check_in as string).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {" / "}
                {changes.check_out ? new Date(changes.check_out as string).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}
              </div>
              {r.reason && <div className="text-[10px] text-[var(--text-dim)] mt-1">"{r.reason}"</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── C-3: 관리자 — 월 일괄 재계산 액션 ──

export function MonthlyRecomputeButton({ companyId, from, to }: { companyId: string; from: string; to: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mut = useMutation({
    mutationFn: () => recomputeAttendance({ companyId, from, to }),
    onSuccess: (res) => {
      toast(`재계산 완료 (${res.updated}/${res.total}건)`, "success");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-summary"] });
    },
    onError: (err: any) =>
      toast(friendlyError(err, "재계산에 실패했습니다."), "error"),
  });

  return (
    <button
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-40"
      title="해당 기간 attendance_records 의 가산수당 분(分) 컬럼을 회사 정책·휴일 기반으로 재산정합니다."
    >
      {mut.isPending ? "재계산 중…" : "가산수당 재계산"}
    </button>
  );
}
