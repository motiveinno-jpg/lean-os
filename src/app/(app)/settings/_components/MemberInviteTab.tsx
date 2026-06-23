"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, cancelEmployeeInvitation, cancelPartnerInvitation, sendInviteEmail } from "@/lib/invitations";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

export function MemberInviteTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<"individual" | "status">("individual");
  const [inviteForm, setInviteForm] = useState({ email: "", name: "", role: "employee" as "employee" | "admin" | "partner" });
  const [sending, setSending] = useState(false);

  const { data: empInvites = [], refetch: refetchEmp } = useQuery({
    queryKey: ["emp-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId),
    enabled: !!companyId,
  });

  const { data: partnerInvites = [], refetch: refetchPartner } = useQuery({
    queryKey: ["partner-invitations", companyId],
    queryFn: () => getPartnerInvitations(companyId),
    enabled: !!companyId,
  });

  const allInvites = [
    ...empInvites.map((i: Record<string, unknown>) => ({ ...i, type: "employee" })),
    ...partnerInvites.map((i: Record<string, unknown>) => ({ ...i, type: "partner" })),
  ].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
    new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
  );

  const handleSendInvite = async () => {
    if (!inviteForm.email.trim()) return;
    setSending(true);
    try {
      // 1) 직원/관리자 초대 — 먼저 quick-add 시도 (이미 가입된 사용자면 자동 회사 연결)
      if (inviteForm.role !== "partner") {
        try {
          const qRes = await fetch("/api/employee/quick-add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              email: inviteForm.email.trim(),
              name: inviteForm.name.trim() || undefined,
              role: inviteForm.role,
              invitedBy: user?.id || "",
            }),
          });
          const q = await qRes.json();
          if (qRes.ok) {
            if (q.status === "auto_added") {
              toast(friendlyError(q, "이미 가입된 사용자라서 자동으로 등록했습니다."), "success");
              setInviteForm({ email: "", name: "", role: "employee" });
              refetchEmp();
              refetchPartner();
              return;
            }
            if (q.status === "already_member") {
              toast("이미 이 회사의 멤버입니다.", "info");
              return;
            }
            // needs_invitation — 일반 invitation 흐름으로 계속 진행
          } else if (qRes.status === 409 && q.status === "conflict") {
            toast(friendlyError(q, "이미 다른 회사에 소속된 이메일입니다."), "error");
            return;
          } else {
            // quick-add 실패 — 일반 invitation 으로 fallback (조용히)
          }
        } catch {
          // quick-add 네트워크 실패 — 일반 invitation 으로 fallback
        }
      }

      // 2) 일반 invitation 흐름 — 미가입 사용자에게 가입 안내 메일 발송
      let invite: { id?: string; invite_token?: string } | null = null;
      if (inviteForm.role === "partner") {
        invite = await createPartnerInvitation({
          companyId,
          email: inviteForm.email.trim(),
          name: inviteForm.name.trim() || undefined,
        } as Parameters<typeof createPartnerInvitation>[0]);
      } else {
        invite = await createEmployeeInvitation({
          companyId,
          email: inviteForm.email.trim(),
          name: inviteForm.name.trim() || undefined,
          role: inviteForm.role as "employee" | "admin",
          invitedBy: user?.id || "",
        } as Parameters<typeof createEmployeeInvitation>[0]);
      }

      if (invite?.id && invite?.invite_token) {
        await sendInviteEmail({
          email: inviteForm.email.trim(),
          name: inviteForm.name.trim() || undefined,
          role: inviteForm.role,
          inviteToken: invite.invite_token as string,
          companyName: "(주)모티브이노베이션",
        });
      }

      toast("초대 메일을 발송했습니다", "success");
      setInviteForm({ email: "", name: "", role: "employee" });
      refetchEmp();
      refetchPartner();
    } catch (err) {
      toast(`초대 실패: ${(err as Error).message}`, "error");
    } finally {
      setSending(false);
    }
  };

  const handleCancelInvite = async (id: string, type: string) => {
    try {
      if (type === "partner") {
        await cancelPartnerInvitation(id);
      } else {
        await cancelEmployeeInvitation(id);
      }
      toast("초대가 취소되었습니다", "success");
      refetchEmp();
      refetchPartner();
    } catch (err) {
      toast(`취소 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleResend = async (invite: Record<string, unknown>) => {
    try {
      await sendInviteEmail({
        email: invite.email as string,
        name: (invite.name as string) || undefined,
        role: (invite.role as string) || "employee",
        inviteToken: invite.invite_token as string,
        companyName: "(주)모티브이노베이션",
      });
      toast("초대 메일을 재발송했습니다", "success");
    } catch (err) {
      toast(`재발송 실패: ${(err as Error).message}`, "error");
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "pending": return { text: "대기 중", cls: "bg-yellow-500/10 text-yellow-400" };
      case "accepted": return { text: "수락됨", cls: "bg-green-500/10 text-green-400" };
      case "cancelled": return { text: "취소됨", cls: "bg-red-500/10 text-red-400" };
      case "expired": return { text: "만료됨", cls: "bg-gray-500/10 text-gray-400" };
      default: return { text: s, cls: "bg-gray-500/10 text-gray-400" };
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">구성원 초대</h2>

      {/* Sub tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "individual" as const, label: "개별 초대" },
          { key: "status" as const, label: `초대 현황 (${allInvites.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition min-h-[44px] ${
              subTab === t.key
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Individual invite */}
      {subTab === "individual" && (
        <div className="bg-[var(--bg-card)] rounded-xl p-6 border border-[var(--border)] space-y-4">
          <p className="text-sm text-[var(--text-muted)]">이메일 주소로 구성원을 초대합니다. 초대 링크가 포함된 이메일이 발송됩니다.</p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">이메일 *</label>
              <input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="name@company.com"
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">이름 (선택)</label>
              <input
                type="text"
                value={inviteForm.name}
                onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                placeholder="홍길동"
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">역할</label>
              <select
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as "employee" | "admin" | "partner" })}
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none"
              >
                <option value="employee">구성원</option>
                <option value="admin">관리자</option>
                <option value="partner">거래처 (파트너)</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleSendInvite}
            disabled={sending || !inviteForm.email.trim()}
            className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 min-h-[44px]"
          >
            {sending ? "발송 중..." : "초대 메일 보내기"}
          </button>
        </div>
      )}

      {/* Invitation status */}
      {subTab === "status" && (
        <div className="space-y-3">
          {allInvites.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-xl p-8 text-center border border-[var(--border)]">
              <p className="text-[var(--text-muted)] text-sm">발송된 초대가 없습니다</p>
            </div>
          ) : (
            allInvites.map((invite: Record<string, unknown>) => {
              const st = statusLabel(invite.status as string);
              return (
                <div
                  key={invite.id as string}
                  className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate">{(invite.name as string) || (invite.email as string)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.text}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400">
                        {invite.type === "partner" ? "파트너" : (invite.role as string) === "admin" ? "관리자" : "구성원"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">{invite.email as string}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {new Date(invite.created_at as string).toLocaleDateString("ko-KR")} 발송
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {invite.status === "pending" && (
                      <>
                        <button
                          onClick={() => handleResend(invite)}
                          className="px-3 py-1.5 text-xs font-semibold text-[var(--primary)] bg-[var(--primary)]/10 rounded-lg hover:bg-[var(--primary)]/20 transition min-h-[44px]"
                        >
                          재발송
                        </button>
                        <button
                          onClick={() => handleCancelInvite(invite.id as string, invite.type as string)}
                          className="px-3 py-1.5 text-xs font-semibold text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition min-h-[44px]"
                        >
                          취소
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

    </div>
  );
}
