"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getBankAccounts, upsertBankAccount, deleteBankAccount, getRoutingRules, upsertRoutingRule, getDealClassifications, upsertDealClassification, deleteDealClassification } from "@/lib/queries";
import { COST_TYPES, BANK_ROLES } from "@/lib/routing";
import type { BankAccount } from "@/types/database";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, getInviteUrl, cancelEmployeeInvitation, cancelPartnerInvitation } from "@/lib/invitations";
import { useUser } from "@/components/user-context";

export default function SettingsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [balance, setBalance] = useState("");
  const [fixedCost, setFixedCost] = useState("");
  const [saved, setSaved] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: "", account_number: "", alias: "", role: "OPERATING", balance: "", is_primary: false });
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ cost_type: "default", bank_account_id: "" });
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then(async (u) => {
      if (!u) return;
      setCompanyId(u.company_id);
      const { data } = await supabase
        .from("cash_snapshot")
        .select("*")
        .eq("company_id", u.company_id)
        .single();
      if (data) {
        setBalance(String(data.current_balance || 0));
        setFixedCost(String(data.monthly_fixed_cost || 0));
      }
    });
  }, []);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId!),
    enabled: !!companyId,
  });

  const { data: routingRules = [] } = useQuery({
    queryKey: ["routing-rules", companyId],
    queryFn: () => getRoutingRules(companyId!),
    enabled: !!companyId,
  });

  const addBankMut = useMutation({
    mutationFn: () => upsertBankAccount({
      company_id: companyId!,
      bank_name: bankForm.bank_name,
      account_number: bankForm.account_number,
      alias: bankForm.alias,
      role: bankForm.role,
      balance: Number(bankForm.balance) || 0,
      is_primary: bankForm.is_primary,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowBankForm(false);
      setBankForm({ bank_name: "", account_number: "", alias: "", role: "OPERATING", balance: "", is_primary: false });
    },
  });

  const deleteBankMut = useMutation({
    mutationFn: (id: string) => deleteBankAccount(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-accounts"] }),
  });

  const addRuleMut = useMutation({
    mutationFn: () => upsertRoutingRule({
      company_id: companyId!,
      cost_type: ruleForm.cost_type,
      bank_account_id: ruleForm.bank_account_id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      setShowRuleForm(false);
      setRuleForm({ cost_type: "default", bank_account_id: "" });
    },
  });

  async function save() {
    if (!companyId) return;
    await supabase.from("cash_snapshot").upsert({
      company_id: companyId,
      current_balance: Number(balance) || 0,
      monthly_fixed_cost: Number(fixedCost) || 0,
      updated_at: new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const totalBankBalance = bankAccounts.reduce((s: number, a: BankAccount) => s + Number(a.balance || 0), 0);

  return (
    <div className="max-w-[700px] space-y-6">
      <h1 className="text-2xl font-extrabold mb-8">설정</h1>

      {/* Cash Snapshot */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">현금 현황</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">현재 계좌 잔고 (원)</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="50000000"
              className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">월 고정비 (원)</label>
            <input
              type="number"
              value={fixedCost}
              onChange={(e) => setFixedCost(e.target.value)}
              placeholder="8000000"
              className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
            <p className="text-xs text-[var(--text-dim)] mt-1">임대료 + 급여 + 보험 + 기타 고정 지출</p>
          </div>
          {Number(balance) > 0 && Number(fixedCost) > 0 && (
            <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="text-xs text-[var(--text-dim)]">예상 생존 개월수</div>
              <div className={`text-2xl font-extrabold mt-1 ${
                Number(balance) / Number(fixedCost) < 3 ? "text-red-400" : "text-green-400"
              }`}>
                {(Number(balance) / Number(fixedCost)).toFixed(1)}개월
              </div>
            </div>
          )}
          <button
            onClick={save}
            className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
          >
            {saved ? "저장 완료" : "저장"}
          </button>
        </div>
      </div>

      {/* Bank Accounts */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold">법인 통장 관리</h2>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">
              총 잔고: ₩{totalBankBalance.toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => setShowBankForm(!showBankForm)}
            className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
          >
            + 통장 추가
          </button>
        </div>

        {showBankForm && (
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">은행명 *</label>
                <input
                  value={bankForm.bank_name}
                  onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                  placeholder="국민은행"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">계좌번호 *</label>
                <input
                  value={bankForm.account_number}
                  onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })}
                  placeholder="123-456-789012"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">별칭</label>
                <input
                  value={bankForm.alias}
                  onChange={(e) => setBankForm({ ...bankForm, alias: e.target.value })}
                  placeholder="메인 운영통장"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">용도</label>
                <select
                  value={bankForm.role}
                  onChange={(e) => setBankForm({ ...bankForm, role: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                >
                  {BANK_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">잔고 (원)</label>
                <input
                  type="number"
                  value={bankForm.balance}
                  onChange={(e) => setBankForm({ ...bankForm, balance: e.target.value })}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={bankForm.is_primary}
                    onChange={(e) => setBankForm({ ...bankForm, is_primary: e.target.checked })}
                    className="rounded"
                  />
                  주 통장
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => bankForm.bank_name && bankForm.account_number && addBankMut.mutate()}
                disabled={!bankForm.bank_name || !bankForm.account_number || addBankMut.isPending}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                추가
              </button>
              <button onClick={() => setShowBankForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">
                취소
              </button>
            </div>
          </div>
        )}

        {bankAccounts.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--text-muted)]">
            등록된 통장이 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {bankAccounts.map((acc: BankAccount) => (
              <div
                key={acc.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{acc.alias || acc.bank_name}</span>
                    {acc.is_primary && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">주</span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">
                      {BANK_ROLES.find(r => r.value === acc.role)?.label || acc.role}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)] mt-0.5">
                    {acc.bank_name} {acc.account_number}
                  </div>
                </div>
                <div className="text-right flex items-center gap-3">
                  <span className="text-sm font-bold">₩{Number(acc.balance || 0).toLocaleString()}</span>
                  <button
                    onClick={() => deleteBankMut.mutate(acc.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team Management */}
      <TeamManagement companyId={companyId} />

      {/* Deal Classifications */}
      <DealClassificationManager companyId={companyId} />

      {/* Routing Rules */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold">비용 라우팅 규칙</h2>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">비용 유형별 지급 통장 자동 매칭</p>
          </div>
          <button
            onClick={() => setShowRuleForm(!showRuleForm)}
            className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
          >
            + 규칙 추가
          </button>
        </div>

        {showRuleForm && bankAccounts.length > 0 && (
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">비용 유형</label>
                <select
                  value={ruleForm.cost_type}
                  onChange={(e) => setRuleForm({ ...ruleForm, cost_type: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                >
                  {COST_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">지급 통장</label>
                <select
                  value={ruleForm.bank_account_id}
                  onChange={(e) => setRuleForm({ ...ruleForm, bank_account_id: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value="">선택</option>
                  {bankAccounts.map((acc: BankAccount) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.alias || acc.bank_name} ({acc.account_number})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => ruleForm.bank_account_id && addRuleMut.mutate()}
                disabled={!ruleForm.bank_account_id || addRuleMut.isPending}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                추가
              </button>
              <button onClick={() => setShowRuleForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">
                취소
              </button>
            </div>
          </div>
        )}

        {routingRules.length === 0 ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]">
            라우팅 규칙이 없습니다. 기본 통장으로 지급됩니다.
          </div>
        ) : (
          <div className="space-y-2">
            {routingRules.map((rule: any) => (
              <div
                key={rule.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
              >
                <span className="text-sm font-medium">
                  {COST_TYPES.find(t => t.value === rule.cost_type)?.label || rule.cost_type}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  → {rule.bank_accounts?.alias || rule.bank_accounts?.bank_name || "미지정"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ Team Management ═══
function TeamManagement({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const [tab, setTab] = useState<"members" | "employees" | "partners">("members");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"employee" | "admin" | "partner">("employee");
  const [inviteError, setInviteError] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ["team-members", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data } = await supabase.from("users").select("*").eq("company_id", companyId).order("created_at");
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["partner-invitations"] });
      setShowInviteForm(false);
      setInviteEmail("");
      setInviteName("");
      setInviteError("");
    },
    onError: (err: any) => setInviteError(err.message),
  });

  const cancelEmpMut = useMutation({
    mutationFn: (id: string) => cancelEmployeeInvitation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-invitations"] }),
  });

  const cancelPartnerMut = useMutation({
    mutationFn: (id: string) => cancelPartnerInvitation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["partner-invitations"] }),
  });

  function copyInviteLink(token: string) {
    const url = getInviteUrl(token);
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
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
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
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
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-lg p-0.5 mb-4">
        {([
          { key: "members" as const, label: "멤버" },
          { key: "employees" as const, label: "직원 초대" },
          { key: "partners" as const, label: "파트너 초대" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition ${
              tab === t.key ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
          {inviteError && (
            <div className="p-2 rounded-lg bg-[var(--danger-dim)] text-[var(--danger)] text-xs">{inviteError}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">이메일 *</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">이름</label>
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="홍길동"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">역할</label>
            <div className="flex gap-2">
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
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {inviteMut.isPending ? "전송 중..." : "초대 전송"}
            </button>
            <button onClick={() => setShowInviteForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">
              취소
            </button>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {tab === "members" && (
        <div className="space-y-2">
          {members.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-muted)]">멤버가 없습니다</div>
          ) : (
            members.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
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
        <div className="space-y-2">
          {empInvites.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-muted)]">직원 초대가 없습니다</div>
          ) : (
            empInvites.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {inv.name || inv.email}
                    {roleBadge(inv.role || "employee")}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                      inv.status === "pending" ? "bg-amber-100 text-amber-700" :
                      inv.status === "accepted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}>
                      {inv.status === "pending" ? "대기중" : inv.status === "accepted" ? "수락됨" : "취소됨"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">{inv.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {inv.status === "pending" && (
                    <>
                      <button
                        onClick={() => copyInviteLink(inv.invite_token)}
                        className="text-xs text-[var(--primary)] hover:underline"
                      >
                        {copiedToken === inv.invite_token ? "복사됨!" : "링크 복사"}
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
        <div className="space-y-2">
          {partnerInvites.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-muted)]">파트너 초대가 없습니다</div>
          ) : (
            partnerInvites.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {inv.name || inv.email}
                    {roleBadge("partner")}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                      inv.status === "pending" ? "bg-amber-100 text-amber-700" :
                      inv.status === "accepted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
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
                  {inv.status === "pending" && (
                    <>
                      <button
                        onClick={() => copyInviteLink(inv.invite_token)}
                        className="text-xs text-[var(--primary)] hover:underline"
                      >
                        {copiedToken === inv.invite_token ? "복사됨!" : "링크 복사"}
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

// ═══ Deal Classification Manager ═══
function DealClassificationManager({ companyId }: { companyId: string | null }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: '#3b82f6' });
  const queryClient = useQueryClient();

  const { data: classifications = [] } = useQuery({
    queryKey: ['deal-classifications', companyId],
    queryFn: () => getDealClassifications(companyId!),
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: () => upsertDealClassification({
      id: editId || undefined,
      companyId: companyId!,
      name: form.name,
      color: form.color,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-classifications'] });
      setShowForm(false);
      setEditId(null);
      setForm({ name: '', color: '#3b82f6' });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDealClassification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deal-classifications'] }),
  });

  if (!companyId) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold">딜 분류 관리</h2>
          <p className="text-xs text-[var(--text-dim)] mt-0.5">B2B/B2C/B2G + 커스텀 카테고리</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: '', color: '#3b82f6' }); }}
          className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
        >
          + 분류 추가
        </button>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: Enterprise"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">색상</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-dim)] font-mono">{form.color}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => form.name && upsertMut.mutate()}
              disabled={!form.name || upsertMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {editId ? '수정' : '추가'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-xs">
              취소
            </button>
          </div>
        </div>
      )}

      {classifications.length === 0 ? (
        <div className="text-center py-6 text-sm text-[var(--text-muted)]">
          딜 분류가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {classifications.map((cls: any) => (
            <div
              key={cls.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
            >
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cls.color || '#3b82f6' }} />
                <span className="text-sm font-medium">{cls.name}</span>
                {cls.is_system && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">시스템</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditId(cls.id); setForm({ name: cls.name, color: cls.color || '#3b82f6' }); setShowForm(true); }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                >
                  수정
                </button>
                {!cls.is_system && (
                  <button
                    onClick={() => deleteMut.mutate(cls.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
