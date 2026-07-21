"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, getInviteUrl, cancelEmployeeInvitation, cancelPartnerInvitation, sendInviteEmail } from "@/lib/invitations";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

export function TeamManagement({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const { user } = useUser();
  const [tab, setTab] = useState<"members" | "employees" | "partners">("members");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"employee" | "admin" | "partner">("employee");
  const [inviteError, setInviteError] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState<string | null>(null);
  const [emailResult, setEmailResult] = useState<{ token: string; ok: boolean; msg: string } | null>(null);
  const queryClient = useQueryClient();

  // 회사 이름 조회 (이메일에 사용)
  const { data: companyData } = useQuery({
    queryKey: ["company-name", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const data = logRead('_components/TeamManagement:data', await supabase.from("companies").select("name").eq("id", companyId).maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["team-members", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const data = logRead('_components/TeamManagement:data', await supabase.from("users").select("*").eq("company_id", companyId).order("created_at"));
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: empInvites = [] } = useQuery({
    queryKey: ["employee-invitations", companyId],
    queryFn: () => getEmployeeInvitations(companyId!),
    enabled: !!companyId,
  });

  const { data: partnerInvites = [] } = useQuery({
    queryKey: ["partner-invitations", companyId],
    queryFn: () => getPartnerInvitations(companyId!),
    enabled: !!companyId,
  });

  // 합류 요청 — 가입 시 우리 사업자번호를 입력한 무소속 사용자의 승인 대기 목록 (RLS: owner/admin 만 조회됨)
  const { data: joinRequests = [] } = useQuery({
    queryKey: ["company-join-requests", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const data = logRead('_components/TeamManagement:data', await supabase.from("company_join_requests")
        .select("id, requester_email, requester_name, message, created_at, expires_at")
        .eq("company_id", companyId).eq("status", "pending")
        .order("created_at", { ascending: true }));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const [joinRole, setJoinRole] = useState<Record<string, "employee" | "admin">>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const resolveJoin = async (id: string, action: "approve" | "reject") => {
    if (resolvingId) return;
    if (action === "reject" && !(await appConfirm("이 합류 요청을 거절할까요?", { danger: true, confirmLabel: "거절" }))) return;
    setResolvingId(id);
    try {
      const res = await fetch("/api/join-request/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, action, role: joinRole[id] || "employee" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "처리 실패");
      toast(action === "approve" ? "합류를 승인했습니다 — 멤버로 추가됨" : "합류 요청을 거절했습니다", action === "approve" ? "success" : "info");
      queryClient.invalidateQueries({ queryKey: ["company-join-requests"] });
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    } catch (e: any) {
      toast(e?.message || "처리 실패", "error");
    } finally { setResolvingId(null); }
  };

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !user) throw new Error("인증 필요");
      if (inviteRole === "partner") {
        return createPartnerInvitation({ companyId, email: inviteEmail, name: inviteName || undefined });
      } else {
        return createEmployeeInvitation({
          companyId,
          email: inviteEmail,
          name: inviteName || undefined,
          role: inviteRole as "employee" | "admin",
          invitedBy: user.id,
        });
      }
    },
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["partner-invitations"] });
      // 이메일 자동 발송 (실패해도 초대 자체는 성공)
      if (data?.invite_token) {
        const result = await sendInviteEmail({
          email: data.email,
          name: data.name || undefined,
          role: data.role || inviteRole,
          inviteToken: data.invite_token,
          companyName: companyData?.name || undefined,
        });
        if (result.success) {
          setEmailResult({ token: data.invite_token, ok: true, msg: "이메일 발송 완료" });
        } else {
          setEmailResult({ token: data.invite_token, ok: false, msg: result.error || "이메일 발송 실패" });
        }
        setTimeout(() => setEmailResult(null), 4000);
      }
      setShowInviteForm(false);
      setInviteEmail("");
      setInviteName("");
      setInviteError("");
    },
    onError: (err: any) => {
      const msg = err.message || "초대 생성 실패";
      // Duplicate key → 이미 초대된 이메일
      if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
        setInviteError("이미 초대된 이메일입니다. 기존 초대를 취소하고 다시 시도하세요.");
      } else {
        setInviteError(msg);
      }
    },
  });

  const cancelEmpMut = useMutation({
    mutationFn: (id: string) => cancelEmployeeInvitation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-invitations"] }),
    onError: (err: any) => toast(`초대 취소 실패: ${err.message || err}`, "error"),
  });

  const cancelPartnerMut = useMutation({
    mutationFn: (id: string) => cancelPartnerInvitation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["partner-invitations"] }),
    onError: (err: any) => toast(`초대 취소 실패: ${err.message || err}`, "error"),
  });

  function copyInviteLink(token: string) {
    const url = getInviteUrl(token);
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function resendEmail(inv: any, role: string) {
    if (!inv.invite_token || emailSending) return;
    setEmailSending(inv.invite_token);
    const result = await sendInviteEmail({
      email: inv.email,
      name: inv.name || undefined,
      role,
      inviteToken: inv.invite_token,
      companyName: companyData?.name || undefined,
    });
    setEmailSending(null);
    setEmailResult({
      token: inv.invite_token,
      ok: result.success,
      msg: result.success ? "이메일 재전송 완료" : (result.error || "재전송 실패"),
    });
    setTimeout(() => setEmailResult(null), 4000);
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: "bg-[#2563EB] text-white",
      admin: "bg-[#2563EB] text-white",
      employee: "bg-[#059669] text-white",
      partner: "bg-[#7C3AED] text-white",
    };
    const labels: Record<string, string> = { owner: "대표", admin: "관리자", employee: "직원", partner: "파트너" };
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${colors[role] || "bg-gray-400 text-white"}`}>
        {labels[role] || role}
      </span>
    );
  };

  if (!companyId) return null;

  const allInvites = [
    ...empInvites.map((i: any) => ({ ...i, invType: "employee" as const })),
    ...partnerInvites.map((i: any) => ({ ...i, invType: "partner" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="settings-team-management glass-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold">팀 관리</h2>
          <p className="text-xs text-[var(--text-dim)] mt-0.5">멤버 {members.length}명</p>
        </div>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
        >
          + 초대하기
        </button>
      </div>

      {/* Tabs */}
      <div className="team-tabs-bar seg-bar">
        {([
          { key: "members" as const, label: "멤버" },
          { key: "employees" as const, label: "직원 초대" },
          { key: "partners" as const, label: "파트너 초대" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`seg-item flex-1 ${tab === t.key ? "seg-item-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="team-role-info-banner">
        <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span><strong>멤버</strong>: 오너뷰 계정이 있는 사용자 (로그인 가능) · <strong>직원</strong>: HR 관리 대상 (계정 없이도 급여·근태 관리 가능, 인력관리 페이지에서 등록)</span>
      </div>

      {/* 합류 요청 — 가입 시 우리 회사 사업자번호를 입력한 사용자의 승인 대기 (승인 시 멤버로 연결) */}
      {joinRequests.length > 0 && (
        <div className="team-join-requests-panel">
          <div className="text-xs font-bold text-amber-600 mb-2">📨 합류 요청 {joinRequests.length}건 — 승인하면 우리 회사 멤버로 연결됩니다</div>
          <div className="space-y-2">
            {joinRequests.map((r: any) => (
              <div key={r.id} className="team-join-request-row">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text)] truncate">{r.requester_name || r.requester_email}</div>
                  <div className="text-[11px] text-[var(--text-dim)] truncate">{r.requester_email} · 요청 {String(r.created_at).slice(0, 10)}{r.message ? ` · "${r.message}"` : ""}</div>
                </div>
                <select value={joinRole[r.id] || "employee"} onChange={(e) => setJoinRole((m) => ({ ...m, [r.id]: e.target.value as "employee" | "admin" }))}
                  className="px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]">
                  <option value="employee">직원</option>
                  <option value="admin">관리자</option>
                </select>
                <button onClick={() => resolveJoin(r.id, "approve")} disabled={resolvingId === r.id}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                  {resolvingId === r.id ? "처리 중..." : "승인"}
                </button>
                <button onClick={() => resolveJoin(r.id, "reject")} disabled={resolvingId === r.id}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">
                  거절
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Form */}
      {showInviteForm && (
        <div className="team-invite-form">
          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            <span>부서/직위/연봉까지 한 번에 설정하려면 <strong>인력관리</strong> 페이지에서 초대하세요.</span>
          </div>
          {inviteError && (
            <div className="p-2 rounded-lg bg-[var(--danger-dim)] text-[var(--danger)] text-xs">{inviteError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">이메일 *</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@company.com"
                className="field-input-sm"
              />
            </div>
            <div>
              <label className="field-label">이름</label>
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="홍길동"
                className="field-input-sm"
              />
            </div>
          </div>
          <div>
            <label className="field-label">역할</label>
            <div className="team-invite-role-picker">
              {([
                { value: "employee" as const, label: "직원", color: "#059669" },
                { value: "admin" as const, label: "관리자", color: "#2563EB" },
                { value: "partner" as const, label: "파트너", color: "#7C3AED" },
              ]).map((r) => (
                <button
                  key={r.value}
                  onClick={() => setInviteRole(r.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${
                    inviteRole === r.value
                      ? "text-white border-transparent"
                      : "text-[var(--text-muted)] border-[var(--border)] bg-[var(--bg)]"
                  }`}
                  style={inviteRole === r.value ? { background: r.color } : {}}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => inviteEmail && inviteMut.mutate()}
              disabled={!inviteEmail || inviteMut.isPending}
              className="btn-primary"
            >
              {inviteMut.isPending ? "전송 중..." : "초대 전송"}
            </button>
            <button onClick={() => setShowInviteForm(false)} className="btn-ghost">
              취소
            </button>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {tab === "members" && (
        <div className="team-members-list">
          {members.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-muted)]">멤버가 없습니다</div>
          ) : (
            members.map((m: any) => (
              <div key={m.id} className="team-member-row">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--primary-light)] flex items-center justify-center text-[var(--primary)] text-xs font-bold">
                    {(m.name || m.email)?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      {m.name || m.email?.split("@")[0]}
                      {roleBadge(m.role || "employee")}
                    </div>
                    <div className="text-xs text-[var(--text-dim)]">{m.email}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Employee Invites Tab */}
      {tab === "employees" && (
        <div className="team-employee-invites-list">
          {empInvites.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-muted)]">직원 초대가 없습니다</div>
          ) : (
            empInvites.map((inv: any) => (
              <div key={inv.id} className="team-invite-row">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {inv.name || inv.email}
                    {roleBadge(inv.role || "employee")}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                      inv.status === "pending" ? "bg-[var(--warning-dim)] text-[var(--warning)]" :
                      inv.status === "accepted" ? "bg-[var(--success-dim)] text-[var(--success)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                    }`}>
                      {inv.status === "pending" ? "대기중" : inv.status === "accepted" ? "수락됨" : "취소됨"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">{inv.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {emailResult && emailResult.token === inv.invite_token && (
                    <span className={`text-[10px] font-medium ${emailResult.ok ? "text-green-600" : "text-red-500"}`}>
                      {emailResult.msg}
                    </span>
                  )}
                  {inv.status === "pending" && (
                    <>
                      <button
                        onClick={() => resendEmail(inv, inv.role || "employee")}
                        disabled={emailSending === inv.invite_token}
                        className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
                      >
                        {emailSending === inv.invite_token ? "발송중..." : "이메일"}
                      </button>
                      <button
                        onClick={() => copyInviteLink(inv.invite_token)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)]"
                      >
                        {copiedToken === inv.invite_token ? "복사됨!" : "링크"}
                      </button>
                      <button
                        onClick={() => cancelEmpMut.mutate(inv.id)}
                        className="text-xs text-red-400/60 hover:text-red-400"
                      >
                        취소
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Partner Invites Tab */}
      {tab === "partners" && (
        <div className="team-partner-invites-list">
          {partnerInvites.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-muted)]">파트너 초대가 없습니다</div>
          ) : (
            partnerInvites.map((inv: any) => (
              <div key={inv.id} className="team-partner-invite-row">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {inv.name || inv.email}
                    {roleBadge("partner")}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                      inv.status === "pending" ? "bg-[var(--warning-dim)] text-[var(--warning)]" :
                      inv.status === "accepted" ? "bg-[var(--success-dim)] text-[var(--success)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                    }`}>
                      {inv.status === "pending" ? "대기중" : inv.status === "accepted" ? "수락됨" : "취소됨"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">
                    {inv.email}
                    {inv.deals?.name && <span className="ml-2 text-[var(--text-muted)]">({inv.deals.name})</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {emailResult && emailResult.token === inv.invite_token && (
                    <span className={`text-[10px] font-medium ${emailResult.ok ? "text-green-600" : "text-red-500"}`}>
                      {emailResult.msg}
                    </span>
                  )}
                  {inv.status === "pending" && (
                    <>
                      <button
                        onClick={() => resendEmail(inv, "partner")}
                        disabled={emailSending === inv.invite_token}
                        className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
                      >
                        {emailSending === inv.invite_token ? "발송중..." : "이메일"}
                      </button>
                      <button
                        onClick={() => copyInviteLink(inv.invite_token)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)]"
                      >
                        {copiedToken === inv.invite_token ? "복사됨!" : "링크"}
                      </button>
                      <button
                        onClick={() => cancelPartnerMut.mutate(inv.id)}
                        className="text-xs text-red-400/60 hover:text-red-400"
                      >
                        취소
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
