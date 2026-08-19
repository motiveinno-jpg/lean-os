"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, getInviteUrl, cancelEmployeeInvitation, cancelPartnerInvitation, sendInviteEmail } from "@/lib/invitations";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

export function TeamManagement({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const { user } = useUser();
  // 알림 클릭(/settings?tab=team&request=<id>) 시 해당 합류 요청 카드 강조
  const highlightRequestId = useSearchParams().get("request");
  const [tab, setTab] = useState<"members" | "employees" | "partners">("members");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  // (2026-08-03 역할 폐지 반영) 초대 구분은 멤버/파트너 뿐 — 멤버는 API 호환상 role="employee" 로 전송.
  //   메뉴·탭 접근은 합류 후 구성원 상세의 '탭 권한'에서 마스터가 부여한다 (관리자/직원 역할 선택 제거).
  const [inviteRole, setInviteRole] = useState<"employee" | "partner">("employee");
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
  const [joinReason, setJoinReason] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // 처리 후 결과메일 상태 — 발송 실패 건은 재전송 배너로 노출(승인은 이미 확정, 롤백 안 함).
  const [emailResults, setEmailResults] = useState<{ id: string; name: string; kind: "approved" | "rejected"; status: "sent" | "failed" }[]>([]);
  const [resendingId, setResendingId] = useState<string | null>(null);

  // 결과메일 발송 — 수신자·URL·회사명은 서버(edge)가 DB 에서 결정. 클라는 requestId 만 전달.
  const sendResultEmail = async (id: string, name: string, kind: "approved" | "rejected"): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke("send-join-result-email", { body: { requestId: id } });
      const ok = !error && (data as any)?.ok;
      setEmailResults((prev) => [{ id, name, kind, status: ok ? "sent" : "failed" }, ...prev.filter((e) => e.id !== id)]);
      return !!ok;
    } catch {
      setEmailResults((prev) => [{ id, name, kind, status: "failed" }, ...prev.filter((e) => e.id !== id)]);
      return false;
    }
  };

  const resendResultEmail = async (id: string) => {
    if (resendingId) return;
    setResendingId(id);
    const ok = await sendResultEmail(id, emailResults.find((e) => e.id === id)?.name || "", emailResults.find((e) => e.id === id)?.kind || "approved");
    toast(ok ? "안내 메일을 재전송했습니다" : "메일 재전송에 실패했습니다", ok ? "success" : "error");
    setResendingId(null);
  };

  const resolveJoin = async (id: string, action: "approve" | "reject") => {
    if (resolvingId) return; // 중복 클릭/동시 처리 방지
    const name = (joinRequests as any[]).find((r) => r.id === id)?.requester_name || (joinRequests as any[]).find((r) => r.id === id)?.requester_email || "요청자";
    if (action === "reject" && !(await appConfirm("이 합류 요청을 거절할까요?", { danger: true, confirmLabel: "거절" }))) return;
    setResolvingId(id);
    try {
      const res = await fetch("/api/join-request/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 역할 선택 폐지 — 승인하면 멤버(role 은 API 호환용 고정값). 권한은 구성원 상세에서 마스터가 부여.
        body: JSON.stringify({ requestId: id, action, role: "employee", reason: action === "reject" ? (joinReason[id] || null) : null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "처리 실패");
      queryClient.invalidateQueries({ queryKey: ["company-join-requests"] });
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      // 결과 메일 발송 — 실패해도 승인/거절은 유지, 재전송 배너로 처리.
      const mailed = await sendResultEmail(id, name, action === "approve" ? "approved" : "rejected");
      if (action === "approve") {
        toast(mailed ? "가입 승인 완료 · 안내 메일 발송" : "가입은 승인됐지만 메일 발송 실패 · 재전송하세요", mailed ? "success" : "error");
      } else {
        toast(mailed ? "요청을 거절하고 안내 메일을 보냈습니다" : "요청을 거절했지만 메일 발송 실패 · 재전송하세요", mailed ? "info" : "error");
      }
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
          role: "employee", // 역할 폐지 — 멤버 고정(API 호환값). 권한은 합류 후 마스터가 부여.
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

  // (2026-08-03 역할 폐지 반영) 배지: 마스터 / 멤버 / 파트너 3종 — 관리자·직원 구분 표기 제거.
  const memberBadge = (m: { role?: string | null; is_master?: boolean | null } | string) => {
    const isMaster = typeof m !== "string" && !!m.is_master;
    const role = typeof m === "string" ? m : m.role || "employee";
    const kind = isMaster ? "master" : role === "partner" ? "partner" : "member";
    const meta: Record<string, { label: string; cls: string }> = {
      master: { label: "마스터", cls: "bg-[#2563EB] text-white" },
      member: { label: "멤버", cls: "bg-[#059669] text-white" },
      partner: { label: "파트너", cls: "bg-[#7C3AED] text-white" },
    };
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${meta[kind].cls}`}>
        {meta[kind].label}
      </span>
    );
  };

  if (!companyId) return null;

  const allInvites = [
    ...empInvites.map((i: any) => ({ ...i, invType: "employee" as const })),
    ...partnerInvites.map((i: any) => ({ ...i, invType: "partner" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="settings-team-management stg-sec">
      <div className="stg-sec-head mb-4">
        <div>
          <h2 className="stg-sec-title">구성원</h2>
          <p className="stg-sec-desc">멤버 {members.length}명 — 초대·합류 요청 승인. 권한 부여는 구성원 상세의 탭 권한에서.</p>
        </div>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="btn-secondary btn-sm shrink-0"
        >
          + 초대하기
        </button>
      </div>

      {/* 보기 칩 — 두 층 탭 금지(2026-08-19 조회 표준): 갈래는 회사 설정 탭 한 줄, 여기는 '보기' 칩 */}
      <div className="qk-chips mb-3">
        {([
          { key: "members" as const, label: `멤버 ${members.length}` },
          { key: "employees" as const, label: `멤버 초대 ${empInvites.length}` },
          { key: "partners" as const, label: `파트너 초대 ${partnerInvites.length}` },
        ]).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={tab === t.key ? "qk-chip qk-chip-on" : "qk-chip"}>{t.label}</button>
        ))}
      </div>
      <div className="team-role-info-banner">
        <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span><strong>멤버</strong>: 오너뷰 계정이 있는 사용자 (로그인 가능) · <strong>직원</strong>: HR 관리 대상 (계정 없이도 급여·근태 관리 가능, 구성원 페이지에서 등록) · <strong>권한</strong>: 역할 구분 없이 마스터가 구성원 상세의 <strong>탭 권한</strong>에서 메뉴·기능별로 부여</span>
      </div>

      {/* 결과 메일 실패 재전송 배너 — 승인/거절은 확정됐으나 메일만 실패한 건 */}
      {emailResults.some((e) => e.status === "failed") && (
        <div className="team-join-email-fail-banner">
          {emailResults.filter((e) => e.status === "failed").map((e) => (
            <div key={e.id} className="team-join-email-fail-row">
              <span className="text-xs text-[var(--danger)]">
                {e.kind === "approved" ? "가입 승인" : "거절"} 처리됨 · <b>{e.name}</b> 안내 메일 발송 실패
              </span>
              <button onClick={() => resendResultEmail(e.id)} disabled={resendingId === e.id} className="btn-sm btn-secondary">
                {resendingId === e.id ? "재전송 중..." : "메일 재전송"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 합류 요청 — 가입 시 우리 회사 사업자번호를 입력한 사용자의 승인 대기 (승인 시 멤버로 연결) */}
      {joinRequests.length > 0 && (
        <div className="team-join-requests-panel">
          <div className="text-xs font-bold text-amber-600 mb-2">📨 합류 요청 {joinRequests.length}건 — 승인하면 우리 회사 멤버로 연결됩니다</div>
          <div className="space-y-2">
            {joinRequests.map((r: any) => (
              <div key={r.id} className={`team-join-request-card${highlightRequestId === r.id ? " team-join-request-highlight" : ""}`}>
                <div className="team-join-request-row">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text)] truncate">{r.requester_name || r.requester_email}</div>
                    <div className="text-[11px] text-[var(--text-dim)] truncate">
                      {r.requester_email} · 요청 {String(r.created_at).slice(0, 10)}
                      {r.expires_at ? ` · 만료 ${String(r.expires_at).slice(0, 10)}` : ""}
                      {r.message ? ` · "${r.message}"` : ""}
                    </div>
                  </div>
                  <button onClick={() => resolveJoin(r.id, "approve")} disabled={resolvingId === r.id}
                    className="btn-primary btn-sm">
                    {resolvingId === r.id ? "처리 중..." : "승인"}
                  </button>
                  <button onClick={() => resolveJoin(r.id, "reject")} disabled={resolvingId === r.id}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">
                    거절
                  </button>
                </div>
                <input
                  value={joinReason[r.id] || ""}
                  onChange={(e) => setJoinReason((m) => ({ ...m, [r.id]: e.target.value }))}
                  placeholder="거절 사유(선택) — 거절 시 안내 메일에 포함됩니다"
                  maxLength={200}
                  className="team-join-reason-input"
                />
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
            <span>부서/직위/연봉까지 한 번에 설정하려면 <strong>구성원</strong> 페이지에서 초대하세요. 멤버의 메뉴·기능 권한은 합류 후 구성원 상세의 <strong>탭 권한</strong>에서 마스터가 부여합니다.</span>
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
            <label className="field-label">구분</label>
            <div className="team-invite-role-picker">
              {([
                { value: "employee" as const, label: "멤버 (우리 회사 구성원)", color: "#059669" },
                { value: "partner" as const, label: "파트너 (외부 협력사)", color: "#7C3AED" },
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
            <div className="collect-empty">멤버가 없습니다</div>
          ) : (
            <table className="ev-table ev-lined team-mgmt-table">
              <thead><tr><th className="text-left">이름</th><th className="text-left">이메일</th><th>역할</th></tr></thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.id}>
                    <td className="text-left"><span className="inline-flex items-center gap-2"><span className="team-avatar">{(m.name || m.email)?.[0]?.toUpperCase()}</span><b>{m.name || m.email?.split("@")[0]}</b></span></td>
                    <td className="text-left text-[var(--text-muted)]">{m.email}</td>
                    <td className="text-center">{memberBadge(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 초대 목록 — 멤버 초대·파트너 초대 같은 표 (2026-08-19) */}
      {(tab === "employees" || tab === "partners") && (() => {
        const list = tab === "employees" ? empInvites : partnerInvites;
        const isPartner = tab === "partners";
        return (
          <div className={isPartner ? "team-partner-invites-list" : "team-employee-invites-list"}>
            {list.length === 0 ? (
              <div className="collect-empty">{isPartner ? "파트너 초대가 없습니다" : "멤버 초대가 없습니다"} — 위 '초대하기'로 보냅니다</div>
            ) : (
              <table className="ev-table ev-lined team-mgmt-table">
                <thead><tr><th className="text-left">이름</th><th className="text-left">이메일</th><th>역할</th>{isPartner && <th>프로젝트</th>}<th>상태</th><th>보낸 날</th><th>동작</th></tr></thead>
                <tbody>
                  {list.map((inv: any) => (
                    <tr key={inv.id}>
                      <td className="text-left font-semibold">{inv.name || inv.email}</td>
                      <td className="text-left text-[var(--text-muted)]">{inv.email}</td>
                      <td className="text-center">{memberBadge(isPartner ? "partner" : (inv.role || "employee"))}</td>
                      {isPartner && <td className="text-center text-[var(--text-muted)]">{inv.deals?.name || "—"}</td>}
                      <td className="text-center"><span className={`ol-sure ${inv.status === "pending" ? "ol-sure-est" : inv.status === "accepted" ? "ol-sure-ok" : ""}`}>{inv.status === "pending" ? "대기중" : inv.status === "accepted" ? "수락됨" : "취소됨"}</span></td>
                      <td className="text-center mono-number text-[var(--text-muted)]">{String(inv.created_at || "").slice(0, 10)}</td>
                      <td className="text-center">
                        {emailResult && emailResult.token === inv.invite_token && <span className={`mr-2 text-[10px] font-medium ${emailResult.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{emailResult.msg}</span>}
                        {inv.status === "pending" && (
                          <span className="inline-flex gap-1.5">
                            <button type="button" onClick={() => resendEmail(inv, isPartner ? "partner" : (inv.role || "employee"))} disabled={emailSending === inv.invite_token} className="btn-secondary btn-sm">{emailSending === inv.invite_token ? "발송중…" : "이메일"}</button>
                            <button type="button" onClick={() => copyInviteLink(inv.invite_token)} className="btn-secondary btn-sm">{copiedToken === inv.invite_token ? "복사됨" : "링크"}</button>
                            <button type="button" onClick={() => (isPartner ? cancelPartnerMut : cancelEmpMut).mutate(inv.id)} className="btn-secondary btn-sm text-[var(--danger)]">취소</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}
    </div>
  );
}
