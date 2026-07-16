"use client";

// 구성원 권한 관리 — 회사 설정 "멤버 관리"에서 구성원 탭으로 이동 (2026-06-08).
// 회사 소속 user 의 역할(대표/관리자/직원/파트너) 변경 + 인사파일 등록 토글 + 회사 제외.
// /api/employee/manage 사용 (기존 로직 그대로).

import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { Avatar } from "@/components/avatar";

export function MemberRoleManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();

  const { data: members = [], refetch: refetchMembers } = useQuery({
    queryKey: ["company-members-mgmt", companyId],
    queryFn: async () => {
      const db = supabase;
      const [usersRes, empRes] = await Promise.all([
        db.from("users").select("id, email, name, role, avatar_url").eq("company_id", companyId).order("role").order("name"),
        db.from("employees").select("id, user_id").eq("company_id", companyId).not("user_id", "is", null),
      ]);
      const empUserIds = new Set((empRes.data || []).map((e: any) => e.user_id));
      return (usersRes.data || []).map((u: any) => ({ ...u, hasHr: empUserIds.has(u.id) }));
    },
    enabled: !!companyId,
  });

  const memberMut = useMutation({
    mutationFn: async (payload: { action: string; userId: string; role?: string }) => {
      const res = await fetch("/api/employee/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...payload }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "처리 실패");
      return result;
    },
    onSuccess: (r) => {
      toast(friendlyError(r, "변경되었습니다"), "success");
      refetchMembers();
    },
    onError: (e: any) => toast(`실패: ${e.message}`, "error"),
  });

  return (
    <div className="space-y-3">
      <div className="member-role-header">
        <h3 className="text-sm font-bold text-[var(--text)]">구성원 권한 관리</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          <strong>역할</strong>: OwnerView 로그인 권한 (대표/관리자/직원/파트너) ·
          <strong className="ml-2">인사파일</strong>: 직원/급여 관리 대상 등록 여부
        </p>
      </div>
      {members.length === 0 ? (
        <div className="member-role-empty">
          <p className="text-[var(--text-muted)] text-sm">회사 멤버가 없습니다</p>
        </div>
      ) : (
        members.map((m: any) => (
          <div key={m.id} className="member-role-row">
            <Avatar name={m.name || m.email} src={m.avatar_url} size={36} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-sm">{m.name || m.email}</span>
                {m.hasHr && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    인사파일 ✓
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] truncate">{m.email}</p>
            </div>

            {/* 역할 dropdown */}
            <select
              value={m.role}
              onChange={(e) => memberMut.mutate({ action: "update-role", userId: m.id, role: e.target.value })}
              disabled={memberMut.isPending}
              className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg"
              title="OwnerView 로그인 역할"
            >
              <option value="owner">대표 (owner)</option>
              <option value="admin">관리자 (admin)</option>
              <option value="employee">직원 (employee)</option>
              <option value="partner">파트너 (partner)</option>
            </select>

            {/* HR 토글 */}
            <button
              onClick={() => memberMut.mutate({ action: m.hasHr ? "unregister-hr" : "register-hr", userId: m.id })}
              disabled={memberMut.isPending}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition border ${
                m.hasHr
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--bg)]"
              } disabled:opacity-50`}
              title={m.hasHr ? "인사파일에서 제거" : "인사/급여 관리 대상으로 등록"}
            >
              {m.hasHr ? "✓ 인사파일 등록됨" : "+ 인사파일 등록"}
            </button>

            {/* 회사 제외 */}
            <button
              onClick={() => {
                if (confirm(`${m.name || m.email} 을 회사에서 제외하시겠습니까? (계정은 유지, 회사 소속만 끊김)`)) {
                  memberMut.mutate({ action: "remove-from-company", userId: m.id });
                }
              }}
              disabled={memberMut.isPending}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-red-500 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition disabled:opacity-50"
            >
              회사 제외
            </button>
          </div>
        ))
      )}
    </div>
  );
}
