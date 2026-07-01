"use client";

// 연장근무 신청 카드 — 직원 본인이 work_end_time 이후 출근/잔류 사유와 종료시각을 사전 신청.
//   본 카드는 /attendance 페이지의 직원 역할 진입 시 AttendanceTab 위에 렌더된다.
//   AttendanceTab 본문 6342줄 무수정 가드(handoff)에 따라 페이지 래퍼 레벨에서만 호출.
//
// RPC:
//   request_overtime(date, time, text) → uuid
//   ALREADY_REQUESTED_FOR_DATE (23505) / REASON_TOO_SHORT (22023) / EMPLOYEE_NOT_FOUND (P0002)
//   취소: from('overtime_requests').update({ status: 'cancelled' }).eq('id', id) — RLS update_self 정책
//
// 시안 토큰: glass-card + var(--bg-card)/--text/--border.

import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { notifyOvertimeRequest } from "@/lib/notifications";

const db = supabase as any;

// KST 오늘 (YYYY-MM-DD)
function kstTodayStr(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDaysStr(base: string, days: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// HH:MM[:SS] → HH:MM (input[type=time] value 형식)
function toHhmm(t: string | null | undefined): string {
  if (!t) return "";
  const s = String(t).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : "";
}
// HH:MM + hours → HH:MM (24h 클램프)
function addHoursToHhmm(hhmm: string, plusHours: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  h = Math.min(23, h + plusHours);
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: "대기",   cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  approved:  { label: "승인",   cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  rejected:  { label: "반려",   cls: "bg-red-500/10 text-red-500 border-red-500/30" },
  cancelled: { label: "취소",   cls: "bg-gray-500/10 text-gray-400 border-gray-500/30" },
};

export function OvertimeRequestCard({ companyId, userId }: { companyId: string; userId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // 본인 employee 레코드 (RLS 안에서 본인만)
  const { data: emp } = useQuery({
    queryKey: ["ot-my-emp", companyId, userId],
    queryFn: async () => {
      // user_id 매칭 우선, 실패 시 이메일 폴백(관리자 등 user_id 미연결 직원 레코드 대비)
      let { data } = await db
        .from("employees")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) {
        const { data: u } = await db.from("users").select("email").eq("id", userId).maybeSingle();
        if (u?.email) {
          const { data: byEmail } = await db
            .from("employees")
            .select("id, name")
            .eq("company_id", companyId)
            .eq("email", u.email)
            .maybeSingle();
          data = byEmail;
        }
      }
      return data as { id: string; name: string } | null;
    },
    enabled: !!companyId && !!userId,
  });
  const employeeId = emp?.id ?? null;

  // 회사 work_end_time → 기본 종료시각 = +2h (없으면 20:00)
  const { data: cs } = useQuery({
    queryKey: ["ot-company-settings", companyId],
    queryFn: async () => {
      const { data } = await db
        .from("company_settings")
        .select("work_end_time")
        .eq("company_id", companyId)
        .maybeSingle();
      return data as { work_end_time: string | null } | null;
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
  const defaultEndTime = useMemo(() => {
    const wet = toHhmm(cs?.work_end_time);
    return wet ? addHoursToHhmm(wet, 2) : "20:00";
  }, [cs?.work_end_time]);

  // 본인 신청 최근 5건
  const { data: history = [], refetch: refetchHistory } = useQuery<any[]>({
    queryKey: ["ot-my-history", employeeId],
    queryFn: async () => {
      const { data } = await db
        .from("overtime_requests")
        .select("id, requested_date, requested_end_time, reason, status, rejected_reason, created_at, approver_id, approved_by")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!employeeId,
    staleTime: 30_000,
  });

  // 승인자 후보 — 회사 admin/owner (지정용 + 이름 해석)
  const { data: approvers = [] } = useQuery<{ id: string; name: string | null; role: string }[]>({
    queryKey: ["ot-approvers", companyId],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name, role").eq("company_id", companyId).in("role", ["admin", "owner"]).order("name");
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 300_000,
  });
  const nameById = (id: string | null | undefined) => (id ? (approvers.find((a) => a.id === id)?.name || "관리자") : null);

  // 폼 상태
  const today = kstTodayStr();
  const maxDate = useMemo(() => addDaysStr(today, 14), [today]);
  const [date, setDate] = useState(today);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState("");
  // 기본 종료시각 회사 설정 로드 후 1회 반영
  useEffect(() => {
    setEndTime((prev) => (prev ? prev : defaultEndTime));
  }, [defaultEndTime]);

  const reasonLen = reason.trim().length;
  const canSubmit = !!employeeId && !!date && !!endTime && reasonLen >= 5;

  const submitMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("request_overtime", {
        p_requested_date: date,
        p_requested_end_time: endTime,
        p_reason: reason.trim(),
        p_approver_id: approverId || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (requestId: string) => {
      toast("연장근무 신청이 접수되었습니다", "success");
      setReason(""); setApproverId("");
      qc.invalidateQueries({ queryKey: ["ot-my-history"] });
      refetchHistory();
      // 회사 admin/owner 알림 — 실패해도 신청 자체는 성공이라 fire-and-forget.
      void notifyOvertimeRequest({
        companyId,
        requestId,
        employeeName: emp?.name || "직원",
        requestedDate: date,
        requestedEndTime: endTime,
        reason: reason.trim(),
      }).catch(() => { /* 알림 실패는 silent */ });
    },
    onError: (err: any) => {
      const code = err?.code || "";
      const msgRaw = String(err?.message || "");
      let msg = friendlyError(err, "신청 처리 실패");
      if (code === "23505" || /ALREADY_REQUESTED_FOR_DATE/i.test(msgRaw)) {
        msg = "이미 신청한 날짜입니다";
      } else if (/REASON_TOO_SHORT/i.test(msgRaw)) {
        msg = "사유는 5자 이상 입력해 주세요";
      } else if (/EMPLOYEE_NOT_FOUND/i.test(msgRaw)) {
        msg = "직원 등록이 안 되어 있어 신청할 수 없습니다 — 관리자에게 문의하세요";
      } else if (/AUTH_REQUIRED/i.test(msgRaw)) {
        msg = "로그인 세션이 만료되었습니다. 다시 로그인해 주세요";
      }
      toast(msg, "error");
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("overtime_requests")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("신청을 취소했습니다", "success");
      qc.invalidateQueries({ queryKey: ["ot-my-history"] });
      refetchHistory();
    },
    onError: (err: any) => {
      toast(friendlyError(err, "취소 처리 실패"), "error");
    },
  });

  return (
    <div className="glass-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">연장근무 신청</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            퇴근시간 이후 잔류·출근이 필요할 때 사전 신청 후 승인이 필요합니다
          </p>
        </div>
      </div>

      {/* 폼 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">예정일</label>
          <DateField
            value={date}
            min={today}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">예정 종료시각</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-[11px] text-[var(--text-muted)] mb-1">
          사유 <span className={`ml-1 ${reasonLen >= 5 ? "text-emerald-500" : "text-[var(--text-dim)]"}`}>({reasonLen}/5+)</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="예: 마감 처리, 긴급 대응 등"
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] resize-none"
        />
      </div>
      <div className="mb-3">
        <label className="block text-[11px] text-[var(--text-muted)] mb-1">승인자 지정 <span className="text-[var(--text-dim)]">(선택 · 미지정 시 관리자 누구나 승인)</span></label>
        <select value={approverId} onChange={(e) => setApproverId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]">
          <option value="">미지정</option>
          {approvers.map((a) => <option key={a.id} value={a.id}>{a.name || "관리자"}{a.role === "owner" ? " (대표)" : ""}</option>)}
        </select>
      </div>
      <div className="flex justify-end mb-5">
        <button
          type="button"
          disabled={!canSubmit || submitMut.isPending}
          onClick={() => submitMut.mutate()}
          className="px-5 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-semibold transition disabled:opacity-50"
        >
          {submitMut.isPending ? "신청 중..." : "신청"}
        </button>
      </div>

      {/* 본인 신청 이력 — 최근 5건 */}
      <div>
        <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">최근 신청</div>
        {history.length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] py-3 text-center bg-[var(--bg-surface)] rounded-lg border border-[var(--border)]">
            신청 이력이 없습니다
          </div>
        ) : (
          <div className="space-y-1.5">
            {history.map((row) => {
              const badge = STATUS_BADGE[row.status] || STATUS_BADGE.pending;
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]"
                >
                  <div className="text-xs font-mono text-[var(--text)] shrink-0 w-[88px]">{row.requested_date}</div>
                  <div className="text-xs font-mono text-[var(--text-muted)] shrink-0 w-[52px]">
                    ~{toHhmm(row.requested_end_time)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[var(--text-muted)] truncate" title={row.reason}>{row.reason}</div>
                    {row.status === "approved" && row.approved_by ? (
                      <div className="text-[10px] text-emerald-500/80">승인: {nameById(row.approved_by)}</div>
                    ) : row.status === "pending" && row.approver_id ? (
                      <div className="text-[10px] text-[var(--text-dim)]">승인예정: {nameById(row.approver_id)}</div>
                    ) : null}
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${badge.cls}`}>
                    {badge.label}
                  </span>
                  {row.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => cancelMut.mutate(row.id)}
                      disabled={cancelMut.isPending}
                      className="text-[10px] px-2 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition disabled:opacity-50"
                    >
                      취소
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
