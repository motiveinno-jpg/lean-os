"use client";

// 연장근무 승인 인박스 (관리자) — 근태관리 '연장근무' 섹션.
//   pending overtime_requests 표시 + 승인/반려(approve_overtime / reject_overtime RPC).
//   /approvals 의 연장근무 탭과 동일 RPC·소스. 결정 알림은 notifyOvertimeDecision.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { notifyOvertimeDecision } from "@/lib/notifications";

const db = supabase as any;
const hm = (t: string | null | undefined) => String(t || "").slice(0, 5);

export function OvertimeApprovalInbox({ companyId, reviewerId }: { companyId: string; reviewerId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rows = [] } = useQuery<any[]>({
    queryKey: ["overtime-pending", companyId],
    queryFn: async () => {
      const { data, error } = await db
        .from("overtime_requests")
        .select("id, requested_date, requested_end_time, reason, status, created_at, employee_id, employees(name, user_id)")
        .eq("status", "pending")
        .order("requested_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["overtime-pending"] });
    qc.invalidateQueries({ queryKey: ["overtime-pending-count"] });
    qc.invalidateQueries();
  };

  const approveMut = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await db.rpc("approve_overtime", { p_request_id: row.id });
      if (error) throw error;
      return row;
    },
    onSuccess: (row: any) => {
      toast("연장근무 승인 완료", "success");
      refresh();
      const targetUserId = row?.employees?.user_id;
      if (targetUserId) {
        void notifyOvertimeDecision({
          companyId, requestId: row.id, targetUserId, decision: "approved",
          requestedDate: row.requested_date, requestedEndTime: hm(row.requested_end_time),
        }).catch(() => {});
      }
    },
    onError: (err: any) => toast(err?.message || "승인 실패", "error"),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ row, reason }: { row: any; reason: string }) => {
      const { error } = await db.rpc("reject_overtime", { p_request_id: row.id, p_reason: reason });
      if (error) throw error;
      return { row, reason };
    },
    onSuccess: ({ row, reason }: { row: any; reason: string }) => {
      toast("연장근무 반려 완료", "info");
      refresh();
      const targetUserId = row?.employees?.user_id;
      if (targetUserId) {
        void notifyOvertimeDecision({
          companyId, requestId: row.id, targetUserId, decision: "rejected",
          requestedDate: row.requested_date, requestedEndTime: hm(row.requested_end_time), rejectedReason: reason,
        }).catch(() => {});
      }
    },
    onError: (err: any) => toast(err?.message || "반려 실패", "error"),
  });

  const onReject = (row: any) => {
    const reason = window.prompt("반려 사유를 입력하세요 (3자 이상)");
    if (reason == null) return;
    if (reason.trim().length < 3) { toast("반려 사유는 3자 이상이어야 합니다", "error"); return; }
    rejectMut.mutate({ row, reason: reason.trim() });
  };

  if (rows.length === 0) return null;

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-bold mb-3">연장근무 승인 대기 ({rows.length}건)</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--text)]">{r.employees?.name || "직원"} — {r.requested_date} {hm(r.requested_end_time)}까지</div>
              {r.reason && <div className="text-[11px] text-[var(--text-muted)] truncate">{r.reason}</div>}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => approveMut.mutate(r)} disabled={approveMut.isPending}
                className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-semibold disabled:opacity-40">승인</button>
              <button onClick={() => onReject(r)} disabled={rejectMut.isPending}
                className="px-2.5 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-[10px] font-semibold disabled:opacity-40">반려</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
