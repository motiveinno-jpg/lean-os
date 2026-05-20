"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { encryptCredential, decryptJsonCredentials } from "@/lib/crypto";
import { getCurrentUser, getBankAccounts, upsertBankAccount, deleteBankAccount, getRoutingRules, upsertRoutingRule, getDealClassifications, upsertDealClassification, deleteDealClassification } from "@/lib/queries";
import { COST_TYPES, BANK_ROLES } from "@/lib/routing";
import type { BankAccount } from "@/types/models";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, getInviteUrl, cancelEmployeeInvitation, cancelPartnerInvitation, sendInviteEmail } from "@/lib/invitations";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { QueryErrorBanner } from "@/components/query-status";
import BulkInvite from "@/components/bulk-invite";
import { AccessDenied } from "@/components/access-denied";

type MainTab = "general" | "account" | "company" | "approval" | "bank" | "tax" | "certificate" | "invite" | "notifications" | "permissions" | "danger";

export default function SettingsPage() {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="회사 설정은 대표·관리자 전용입니다." />;
  }
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const VALID_TABS: MainTab[] = ["general", "account", "company", "approval", "bank", "tax", "certificate", "invite", "notifications", "permissions", "danger"];
  const initialTab = (() => {
    const t = searchParams?.get("tab");
    return t && (VALID_TABS as string[]).includes(t) ? (t as MainTab) : "general";
  })();
  const [mainTab, setMainTab] = useState<MainTab>(initialTab);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [balance, setBalance] = useState("");
  const [fixedCost, setFixedCost] = useState("");
  const [saved, setSaved] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: "", account_number: "", alias: "", role: "OPERATING", balance: "", is_primary: false });
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ cost_type: "default", bank_account_id: "" });
  const queryClient = useQueryClient();
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then(async (u) => {
      if (!u) { setPageLoading(false); return; }
      setCompanyId(u.company_id);
      const { data } = await supabase
        .from("cash_snapshot")
        .select("*")
        .eq("company_id", u.company_id)
        .maybeSingle();
      if (data) {
        setBalance(String(data.current_balance || 0));
        setFixedCost(String(data.monthly_fixed_cost || 0));
      }
      setPageLoading(false);
    }).catch(() => setPageLoading(false));
  }, []);

  const { data: bankAccounts = [], error: mainError, refetch: mainRefetch } = useQuery({
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
      bank_name: bankForm.bank_name.trim(),
      account_number: bankForm.account_number.trim(),
      alias: bankForm.alias.trim(),
      role: bankForm.role,
      balance: Number(bankForm.balance) || 0,
      is_primary: bankForm.is_primary,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowBankForm(false);
      setBankForm({ bank_name: "", account_number: "", alias: "", role: "OPERATING", balance: "", is_primary: false });
    },
    onError: (err: any) => toast("계좌 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteBankMut = useMutation({
    mutationFn: (id: string) => deleteBankAccount(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-accounts"] }),
    onError: (err: any) => toast(`삭제 실패: ${err.message || err}`, "error"),
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
    onError: (err: any) => toast(`규칙 저장 실패: ${err.message || err}`, "error"),
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowBankForm(false); setShowRuleForm(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function save() {
    if (!companyId) return;
    const { error } = await supabase.from("cash_snapshot").upsert({
      company_id: companyId,
      current_balance: Number(balance) || 0,
      monthly_fixed_cost: Number(fixedCost) || 0,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast(`저장 실패: ${error.message}`, "error");
      return;
    }
    setSaved(true);
    toast("현금 현황이 저장되었습니다. 대시보드에 즉시 반영됩니다.", "success");
    // 대시보드 즉시 갱신 — refetchQueries 로 캐시 무관 강제 fetch
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["cash-pulse"] }),
      queryClient.refetchQueries({ queryKey: ["real-burn"] }),
      queryClient.refetchQueries({ queryKey: ["founder-data"] }),
    ]);
    setTimeout(() => setSaved(false), 2000);
  }

  const totalBankBalance = bankAccounts.reduce((s: number, a: BankAccount) => s + Number(a.balance || 0), 0);

  const mainTabs: { key: MainTab; label: string }[] = [
    { key: "general", label: "일반 설정" },
    { key: "account", label: "계정" },
    { key: "company", label: "회사정보" },
    { key: "approval", label: "승인정책" },
    { key: "bank", label: "은행연동" },
    { key: "tax", label: "세무자동화" },
    { key: "certificate", label: "인증서" },
    { key: "notifications", label: "알림" },
    { key: "invite", label: "구성원 초대" },
    { key: "permissions", label: "권한 설정" },
    { key: "danger", label: "데이터 관리" },
  ];

  if (pageLoading) {
    return (
      <div className="max-w-[700px] flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">설정 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[700px] space-y-6">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <h1 className="text-2xl font-extrabold mb-2">설정</h1>

      {/* Main Tab Bar — horizontal scroll */}
      <div className="mb-6 -mx-6 px-6">
        <div
          className="flex gap-1 bg-[var(--bg-surface)] rounded-lg p-0.5 overflow-x-auto scrollbar-hide"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {mainTabs.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                if (el && mainTab === t.key) {
                  el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
                }
              }}
              onClick={() => setMainTab(t.key)}
              className={`whitespace-nowrap shrink-0 px-3 py-2.5 rounded-md text-xs sm:text-sm font-semibold min-h-[44px] transition ${
                mainTab === t.key
                  ? t.key === "danger"
                    ? "bg-red-500/10 text-red-500 shadow-sm"
                    : "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ General Tab ═══ */}
      {mainTab === "general" && (
        <>
          {/* Cash Snapshot */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h2 className="text-sm font-bold mb-4">현금 현황</h2>
            <div className="space-y-4">
              {/* 연동 통장 합산 (자동, read-only) */}
              <div className="p-4 rounded-xl bg-[var(--primary)]/5 border border-[var(--primary)]/20">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--primary)] uppercase tracking-wider">🔗 연동 통장 합산</div>
                    <div className="text-xs text-[var(--text-dim)] mt-0.5">통장관리에서 동기화한 모든 계좌 잔액 합산</div>
                  </div>
                  <div className="text-xl font-black mono-number">₩{totalBankBalance.toLocaleString()}</div>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] mt-2">{bankAccounts.length}개 계좌</div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">추가 현금 — 시재금 / 미연동 계좌 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={balance ? Number(balance).toLocaleString() : ""}
                  onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                />
                <p className="text-[10px] text-[var(--text-dim)] mt-1">연동되지 않은 통장이나 시재금이 있을 때만 입력. 0이면 무시.</p>
              </div>

              {/* 총 가용 현금 합계 */}
              <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--text-muted)]">💰 총 가용 현금 (대시보드 반영)</div>
                  <div className="text-2xl font-black mono-number text-[var(--primary)]">
                    ₩{(totalBankBalance + (Number(balance) || 0)).toLocaleString()}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">추가 월 고정비 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={fixedCost ? Number(fixedCost).toLocaleString() : ""}
                  onChange={(e) => setFixedCost(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                />
                <p className="text-[10px] text-[var(--text-dim)] mt-1">
                  대시보드 월 고정비 = <b>반복결제 합 + 직원급여 합 + 이 값</b>. 이미 등록된 반복결제/급여 외에 추가로 잡아둘 임대료/보험/기타 비용을 입력하세요.
                </p>
              </div>

              {(totalBankBalance + (Number(balance) || 0)) > 0 && Number(fixedCost) > 0 && (
                <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                  <div className="text-xs text-[var(--text-dim)]">예상 생존 개월수</div>
                  <div className={`text-2xl font-extrabold mt-1 ${
                    (totalBankBalance + Number(balance)) / Number(fixedCost) < 3 ? "text-red-400" : "text-green-400"
                  }`}>
                    {((totalBankBalance + Number(balance)) / Number(fixedCost)).toFixed(1)}개월
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      type="text"
                      inputMode="numeric"
                      value={bankForm.balance ? Number(bankForm.balance).toLocaleString() : ""}
                      onChange={(e) => setBankForm({ ...bankForm, balance: e.target.value.replace(/[^0-9]/g, "") })}
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
                    onClick={() => bankForm.bank_name.trim() && bankForm.account_number.trim() && addBankMut.mutate()}
                    disabled={!bankForm.bank_name.trim() || !bankForm.account_number.trim() || addBankMut.isPending}
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
              <div className="text-center py-8">
                <div className="text-2xl mb-2">🏦</div>
                <div className="text-sm text-[var(--text-muted)]">등록된 통장이 없습니다</div>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </>
      )}

      {/* ═══ Account Tab ═══ */}
      {mainTab === "account" && <AccountTab />}

      {/* ═══ Company Info Tab ═══ */}
      {mainTab === "company" && <CompanyInfoTab companyId={companyId} />}

      {/* ═══ Approval Policy Tab ═══ */}
      {mainTab === "approval" && <ApprovalPolicyTab companyId={companyId} />}

      {/* ═══ Bank Integration Tab ═══ */}
      {mainTab === "bank" && <BankIntegrationTab companyId={companyId} bankAccounts={bankAccounts} />}

      {/* ═══ Tax Automation Tab ═══ */}
      {mainTab === "tax" && <TaxAutomationTab companyId={companyId} />}

      {/* ═══ Certificate Management Tab ═══ */}
      {mainTab === "certificate" && <CertificateManagementTab companyId={companyId} />}

      {/* ═══ Notifications Tab ═══ */}
      {mainTab === "notifications" && <NotificationsTab companyId={companyId} />}

      {/* ═══ Member Invite Tab ═══ */}
      {mainTab === "invite" && companyId && <MemberInviteTab companyId={companyId} />}

      {/* ═══ Permissions Tab ═══ */}
      {mainTab === "permissions" && companyId && <PermissionsTab companyId={companyId} />}

      {/* ═══ Data Management (Danger Zone) ═══ */}
      {mainTab === "danger" && companyId && <DataResetTab companyId={companyId} />}
    </div>
  );
}

// ═══════════════════════════════════════════
// Notifications Tab — 채널별 + 이벤트별 세분화
// ═══════════════════════════════════════════
type NotifChannel = "email" | "push" | "telegram";
type NotifEvent =
  | "approval_pending"
  | "deal_status"
  | "payment_due"
  | "tax_invoice"
  | "chat_mention"
  | "weekly_report"
  | "system_alert";

interface NotifPrefs {
  email: { enabled: boolean; address: string; events: Record<NotifEvent, boolean> };
  push: { enabled: boolean; events: Record<NotifEvent, boolean> };
  telegram: { enabled: boolean; chatId: string; events: Record<NotifEvent, boolean> };
  quietHours: { enabled: boolean; start: string; end: string };
}

const NOTIF_EVENTS: { key: NotifEvent; label: string; desc: string }[] = [
  { key: "approval_pending", label: "결재 요청", desc: "내가 결재해야 할 항목이 새로 등록될 때" },
  { key: "deal_status", label: "프로젝트 상태 변경", desc: "딜이 다음 단계로 이동하거나 완료될 때" },
  { key: "payment_due", label: "결제 마감 임박", desc: "D-7 이내 결제/지급 예정" },
  { key: "tax_invoice", label: "세금계산서 발행/수신", desc: "신규 세금계산서 발행 또는 매입 수신" },
  { key: "chat_mention", label: "채팅 멘션", desc: "팀 채팅에서 @멘션 받을 때" },
  { key: "weekly_report", label: "주간 리포트", desc: "매주 월요일 오전 9시 요약 리포트" },
  { key: "system_alert", label: "시스템 경고", desc: "런웨이/현금흐름 임계치 알림" },
];

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  email: {
    enabled: true,
    address: "",
    events: {
      approval_pending: true,
      deal_status: false,
      payment_due: true,
      tax_invoice: true,
      chat_mention: false,
      weekly_report: true,
      system_alert: true,
    },
  },
  push: {
    enabled: false,
    events: {
      approval_pending: true,
      deal_status: true,
      payment_due: true,
      tax_invoice: false,
      chat_mention: true,
      weekly_report: false,
      system_alert: true,
    },
  },
  telegram: {
    enabled: false,
    chatId: "",
    events: {
      approval_pending: true,
      deal_status: false,
      payment_due: true,
      tax_invoice: false,
      chat_mention: false,
      weekly_report: true,
      system_alert: true,
    },
  },
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
};

const NOTIF_STORAGE_KEY = "leanos-notification-prefs";

function NotificationsTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unknown">("unknown");
  const [telegramTesting, setTelegramTesting] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        setPrefs({ ...DEFAULT_NOTIF_PREFS, ...stored });
      }
    } catch {}
    setLoaded(true);

    if (typeof window !== "undefined" && "Notification" in window) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }

    // Try to load user email
    getCurrentUser().then((u) => {
      if (u?.email) {
        setPrefs((p) => ({ ...p, email: { ...p.email, address: p.email.address || u.email } }));
      }
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(prefs));
      // Best-effort persist to supabase if a notification_prefs table exists
      if (companyId) {
        const u = await getCurrentUser();
        if (u) {
          await (supabase as any)
            .from("notification_prefs")
            .upsert({
              user_id: u.id,
              company_id: companyId,
              prefs,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" })
            .then(() => {}, () => {}); // ignore if table missing
        }
      }
      toast("알림 설정 저장됨", "success");
    } catch (err: any) {
      toast(`저장 실패: ${err.message || err}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function requestPushPermission() {
    if (!pushSupported) return;
    const result = await Notification.requestPermission();
    setPushPermission(result);
    if (result === "granted") {
      setPrefs((p) => ({ ...p, push: { ...p.push, enabled: true } }));
      toast("푸시 알림 권한 허용됨", "success");
    } else {
      toast("푸시 알림 권한 거부됨 — 브라우저 설정에서 허용해주세요", "error");
    }
  }

  async function testTelegram() {
    if (!prefs.telegram.chatId.trim()) {
      toast("텔레그램 Chat ID를 입력해주세요", "error");
      return;
    }
    setTelegramTesting(true);
    try {
      const res = await fetch("/api/notifications/telegram-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: prefs.telegram.chatId }),
      });
      if (res.ok) {
        toast("테스트 메시지 발송 — 텔레그램을 확인하세요", "success");
      } else {
        toast("발송 실패 — Chat ID를 확인하세요", "error");
      }
    } catch {
      toast("네트워크 오류 — 잠시 후 다시 시도하세요", "error");
    } finally {
      setTelegramTesting(false);
    }
  }

  function setEventEnabled(channel: NotifChannel, event: NotifEvent, enabled: boolean) {
    setPrefs((p) => ({
      ...p,
      [channel]: {
        ...(p[channel] as any),
        events: { ...(p[channel] as any).events, [event]: enabled },
      },
    }));
  }

  function setAllEvents(channel: NotifChannel, enabled: boolean) {
    setPrefs((p) => {
      const next = { ...((p[channel] as any).events) };
      for (const ev of NOTIF_EVENTS) next[ev.key] = enabled;
      return { ...p, [channel]: { ...(p[channel] as any), events: next } };
    });
  }

  if (!loaded) {
    return <div className="text-sm text-[var(--text-muted)] py-8 text-center">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-base font-bold mb-1">알림 설정</h2>
        <p className="text-xs text-[var(--text-muted)]">
          이메일 · 푸시 · 텔레그램 — 채널별로 받고 싶은 이벤트를 선택하세요. 변경 후 하단의 저장 버튼을 눌러주세요.
        </p>
      </div>

      {/* Email Channel */}
      <ChannelSection
        title="📧 이메일"
        desc="가장 중요한 알림 — 결재/세금계산서/주간 리포트에 권장"
        enabled={prefs.email.enabled}
        onToggle={(v) => setPrefs((p) => ({ ...p, email: { ...p.email, enabled: v } }))}
      >
        <div className="mb-4">
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">수신 이메일 주소</label>
          <input
            type="email"
            value={prefs.email.address}
            onChange={(e) => setPrefs((p) => ({ ...p, email: { ...p.email, address: e.target.value } }))}
            placeholder="you@example.com"
            disabled={!prefs.email.enabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm disabled:opacity-50"
          />
        </div>
        <EventGrid
          channel="email"
          enabled={prefs.email.enabled}
          values={prefs.email.events}
          onChange={setEventEnabled}
          onAll={setAllEvents}
        />
      </ChannelSection>

      {/* Push Channel */}
      <ChannelSection
        title="🔔 브라우저 푸시"
        desc="실시간 데스크톱 알림 — 채팅 멘션/긴급 알림에 적합"
        enabled={prefs.push.enabled}
        onToggle={(v) => {
          if (v && pushPermission !== "granted") {
            requestPushPermission();
          } else {
            setPrefs((p) => ({ ...p, push: { ...p.push, enabled: v } }));
          }
        }}
        disabled={!pushSupported}
      >
        {!pushSupported && (
          <div className="text-xs text-[var(--warning)] mb-3">
            현재 브라우저에서 푸시 알림을 지원하지 않습니다.
          </div>
        )}
        {pushSupported && pushPermission === "denied" && (
          <div className="text-xs text-[var(--danger)] mb-3">
            푸시 권한이 거부되었습니다. 브라우저 주소창 옆 자물쇠 아이콘에서 알림을 허용해주세요.
          </div>
        )}
        {pushSupported && pushPermission !== "granted" && pushPermission !== "denied" && (
          <button
            onClick={requestPushPermission}
            className="mb-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 transition"
          >
            푸시 권한 요청
          </button>
        )}
        <EventGrid
          channel="push"
          enabled={prefs.push.enabled && pushSupported}
          values={prefs.push.events}
          onChange={setEventEnabled}
          onAll={setAllEvents}
        />
      </ChannelSection>

      {/* Telegram Channel */}
      <ChannelSection
        title="✈️ 텔레그램"
        desc="모바일에서 가장 빠른 알림 — @motive_hajun_bot에게 /start 입력 후 Chat ID 발급받으세요"
        enabled={prefs.telegram.enabled}
        onToggle={(v) => setPrefs((p) => ({ ...p, telegram: { ...p.telegram, enabled: v } }))}
      >
        <div className="mb-4">
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">Telegram Chat ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={prefs.telegram.chatId}
              onChange={(e) => setPrefs((p) => ({ ...p, telegram: { ...p.telegram, chatId: e.target.value } }))}
              placeholder="예: 123456789"
              disabled={!prefs.telegram.enabled}
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm disabled:opacity-50"
            />
            <button
              onClick={testTelegram}
              disabled={!prefs.telegram.enabled || telegramTesting}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--primary-light)] text-[var(--primary)] hover:opacity-90 transition disabled:opacity-50"
            >
              {telegramTesting ? "발송중..." : "테스트"}
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-dim)] mt-1.5">
            텔레그램에서 @motive_hajun_bot에게 메시지를 보낸 뒤, Chat ID를 입력하세요.
          </p>
        </div>
        <EventGrid
          channel="telegram"
          enabled={prefs.telegram.enabled}
          values={prefs.telegram.events}
          onChange={setEventEnabled}
          onAll={setAllEvents}
        />
      </ChannelSection>

      {/* Quiet Hours */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold">방해금지 시간대</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">설정한 시간에는 긴급 알림을 제외하고 모든 알림이 보류됩니다.</p>
          </div>
          <Toggle
            checked={prefs.quietHours.enabled}
            onChange={(v) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, enabled: v } }))}
          />
        </div>
        {prefs.quietHours.enabled && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">시작</label>
              <input
                type="time"
                value={prefs.quietHours.start}
                onChange={(e) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, start: e.target.value } }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">종료</label>
              <input
                type="time"
                value={prefs.quietHours.end}
                onChange={(e) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, end: e.target.value } }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* 자금일보 카카오 알림톡 — 매일 KST 09:00 자동 발송 */}
      <DailyReportCard companyId={companyId} />

      {/* Slack 알림 — 결제/결재/큰 거래 자동 알림 (Granter 패턴) */}
      <SlackNotifyCard companyId={companyId} />

      {/* Save bar */}
      <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-[var(--bg)]/95 backdrop-blur border-t border-[var(--border)] flex justify-end gap-2">
        <button
          onClick={() => setPrefs(DEFAULT_NOTIF_PREFS)}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition"
        >
          기본값으로
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:opacity-90 transition disabled:opacity-50"
        >
          {saving ? "저장중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function DailyReportCard({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [phones, setPhones] = useState<string[]>([]);
  const [phoneInput, setPhoneInput] = useState("");
  const [sendHour, setSendHour] = useState(9);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data } = await (supabase as any).from("notification_settings")
        .select("*").eq("company_id", companyId).maybeSingle();
      if (data) {
        setEnabled(!!data.daily_report_enabled);
        setPhones(data.daily_report_phones || []);
        setSendHour(data.daily_report_send_hour ?? 9);
        setLastSentAt(data.last_sent_at);
        setLastStatus(data.last_sent_status);
      }
      setLoaded(true);
    })();
  }, [companyId]);

  const addPhone = () => {
    const cleaned = phoneInput.replace(/[^0-9]/g, "");
    if (cleaned.length < 10) { toast("전화번호 형식이 올바르지 않습니다", "error"); return; }
    if (phones.includes(cleaned)) { toast("이미 등록된 번호입니다", "info"); return; }
    setPhones([...phones, cleaned]);
    setPhoneInput("");
  };

  const removePhone = (p: string) => setPhones(phones.filter(x => x !== p));

  const save = async () => {
    if (!companyId || saving) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("notification_settings").upsert({
        company_id: companyId,
        daily_report_enabled: enabled,
        daily_report_phones: phones,
        daily_report_send_hour: sendHour,
      }, { onConflict: "company_id" });
      if (error) throw error;
      toast("자금일보 알림 설정 저장 완료", "success");
    } catch (e: any) {
      toast(`저장 실패: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    if (!companyId || testing) return;
    if (phones.length === 0) { toast("수신 번호를 먼저 등록하세요", "error"); return; }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast("세션이 만료되었습니다", "error"); return; }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/daily-report`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "send-now", companyId }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast(`발송 실패: ${result.error || res.status}`, "error");
        return;
      }
      if (result.skipped === "solapi_not_configured") {
        toast(`Solapi 키 미설정 — 검수 통과 후 환경변수 추가 필요. 데이터: ${JSON.stringify(result.report).slice(0, 100)}...`, "info");
      } else if (result.skipped) {
        toast(`발송 skip: ${result.skipped}`, "info");
      } else {
        toast(`발송 ${result.sent}/${result.total} 건 완료`, result.sent > 0 ? "success" : "error");
      }
      setLastSentAt(new Date().toISOString());
      setLastStatus(result.skipped || `sent ${result.sent}/${result.total ?? 0}`);
    } catch (e: any) {
      toast(`발송 실패: ${e.message}`, "error");
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            💰 자금일보 카카오 알림톡
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">신규</span>
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">매일 정해진 시간에 전일 자금 요약을 카톡으로 발송 (Solapi 검수 통과 후 활성화).</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="sr-only peer" />
          <div className="w-10 h-6 bg-[var(--bg-surface)] peer-checked:bg-[var(--primary)] rounded-full transition relative">
            <div className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full transition ${enabled ? "translate-x-4" : ""}`} />
          </div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-3 mt-4">
          {/* 발송 시각 */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-muted)]">발송 시각:</label>
            <select
              value={sendHour}
              onChange={(e) => setSendHour(Number(e.target.value))}
              className="px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, "0")}:00 (KST)</option>
              ))}
            </select>
          </div>

          {/* 수신 번호 */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">수신 번호 (카톡 등록된 휴대폰 번호)</label>
            <div className="flex gap-2 mb-2">
              <input
                type="tel"
                inputMode="numeric"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhone(); } }}
                placeholder="01012345678"
                className="flex-1 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm"
              />
              <button onClick={addPhone} className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">추가</button>
            </div>
            {phones.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {phones.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--bg-surface)] rounded-lg text-xs border border-[var(--border)]">
                    {p.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}
                    <button onClick={() => removePhone(p)} className="text-[var(--text-dim)] hover:text-red-400 ml-1">×</button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[var(--text-dim)]">등록된 번호 없음. 카톡 알림 받을 번호를 추가하세요.</p>
            )}
          </div>

          {/* 마지막 발송 상태 */}
          {lastSentAt && (
            <div className="p-2.5 bg-[var(--bg-surface)] rounded-lg text-[11px] text-[var(--text-dim)]">
              마지막 발송: {new Date(lastSentAt).toLocaleString("ko-KR")} · {lastStatus}
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "저장중..." : "설정 저장"}
            </button>
            <button
              onClick={testSend}
              disabled={testing || phones.length === 0}
              className="flex-1 py-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] rounded-lg text-xs font-semibold hover:bg-[var(--bg)] disabled:opacity-50"
            >
              {testing ? "발송중..." : "테스트 발송 (어제 데이터)"}
            </button>
          </div>

          <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">
            검수 진행 상태: Solapi 환경변수(SOLAPI_API_KEY/SECRET/PFID/TEMPLATE_ID) 미설정 시 데이터만 집계되고 실제 발송은 skip.
            검수 통과 후 환경변수 4개 입력하면 즉시 활성화. pg_cron 'daily-report-tick' 매시간 실행 중.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Slack 알림 카드 (Granter 벤치마킹) ──
function SlackNotifyCard({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifyPayment, setNotifyPayment] = useState(true);
  const [notifyApproval, setNotifyApproval] = useState(true);
  const [notifyLargeTx, setNotifyLargeTx] = useState(true);
  const [largeThreshold, setLargeThreshold] = useState("1000000");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data } = await (supabase as any).from("company_settings")
        .select("slack_webhook_url, slack_notify_payment, slack_notify_approval, slack_notify_large_tx, slack_large_tx_threshold")
        .eq("company_id", companyId).maybeSingle();
      if (data) {
        setWebhookUrl(data.slack_webhook_url || "");
        setNotifyPayment(data.slack_notify_payment ?? true);
        setNotifyApproval(data.slack_notify_approval ?? true);
        setNotifyLargeTx(data.slack_notify_large_tx ?? true);
        setLargeThreshold(String(data.slack_large_tx_threshold || 1000000));
      }
      setLoaded(true);
    })();
  }, [companyId]);

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("company_settings").upsert({
        company_id: companyId,
        slack_webhook_url: webhookUrl || null,
        slack_notify_payment: notifyPayment,
        slack_notify_approval: notifyApproval,
        slack_notify_large_tx: notifyLargeTx,
        slack_large_tx_threshold: Number(largeThreshold) || 1000000,
      }, { onConflict: "company_id" });
      if (error) throw error;
      toast("Slack 알림 설정이 저장되었습니다", "success");
    } catch (e: any) {
      toast(`저장 실패: ${e.message}`, "error");
    } finally { setSaving(false); }
  };

  const testSend = async () => {
    if (!companyId || !webhookUrl) { toast("webhook URL 을 먼저 입력하세요", "error"); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/slack/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          payload: {
            event: "test",
            title: "OwnerView Slack 연동 테스트",
            message: "이 메시지가 보이면 슬랙 알림이 정상 작동합니다 🎉",
            fields: [
              { label: "테스트 시각", value: new Date().toLocaleString("ko-KR") },
            ],
          },
        }),
      });
      const r = await res.json();
      if (r.ok) toast("Slack 테스트 메시지 발송 완료 — 슬랙 채널을 확인하세요", "success");
      else toast(`발송 실패: ${r.error || r.skipped || "알 수 없는 오류"}`, "error");
    } catch (e: any) {
      toast(`발송 실패: ${e.message}`, "error");
    } finally { setTesting(false); }
  };

  if (!loaded) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            💬 Slack 알림 연동
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-700 dark:text-yellow-400 font-semibold">신규</span>
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">결제 요청/결재 대기/큰 거래 발생 시 슬랙 채널에 자동 알림.</p>
        </div>
      </div>

      <div className="space-y-3 mt-4">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">Slack Incoming Webhook URL</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/T.../B.../..."
            className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
          <p className="text-[10px] text-[var(--text-dim)] mt-1">
            슬랙 워크스페이스 → Apps → "Incoming Webhooks" 추가 → 채널 선택 → URL 복사.
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="ml-1 text-[var(--primary)] underline">설정 가이드</a>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="flex items-center gap-2 p-3 bg-[var(--bg-surface)] rounded-lg cursor-pointer">
            <input type="checkbox" checked={notifyPayment} onChange={(e) => setNotifyPayment(e.target.checked)} className="accent-[var(--primary)]" />
            <span className="text-xs">결제 요청</span>
          </label>
          <label className="flex items-center gap-2 p-3 bg-[var(--bg-surface)] rounded-lg cursor-pointer">
            <input type="checkbox" checked={notifyApproval} onChange={(e) => setNotifyApproval(e.target.checked)} className="accent-[var(--primary)]" />
            <span className="text-xs">결재 대기</span>
          </label>
          <label className="flex items-center gap-2 p-3 bg-[var(--bg-surface)] rounded-lg cursor-pointer">
            <input type="checkbox" checked={notifyLargeTx} onChange={(e) => setNotifyLargeTx(e.target.checked)} className="accent-[var(--primary)]" />
            <span className="text-xs">큰 거래</span>
          </label>
        </div>

        {notifyLargeTx && (
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">큰 거래 기준 금액 (원)</label>
            <input
              type="text"
              inputMode="numeric"
              value={largeThreshold ? Number(largeThreshold).toLocaleString("ko-KR") : ""}
              onChange={(e) => setLargeThreshold(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="1,000,000"
              className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs"
            />
            <p className="text-[10px] text-[var(--text-dim)] mt-1">이 금액 이상의 거래 발생 시 슬랙 알림.</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving} className="flex-1 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50">
            {saving ? "저장중..." : "설정 저장"}
          </button>
          <button onClick={testSend} disabled={testing || !webhookUrl} className="flex-1 py-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] rounded-lg text-xs font-semibold hover:bg-[var(--bg)] disabled:opacity-50">
            {testing ? "발송중..." : "테스트 발송"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelSection({
  title,
  desc,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{desc}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
      </div>
      <div className={enabled ? "" : "opacity-50 pointer-events-none"}>{children}</div>
    </div>
  );
}

function EventGrid({
  channel,
  enabled,
  values,
  onChange,
  onAll,
}: {
  channel: NotifChannel;
  enabled: boolean;
  values: Record<NotifEvent, boolean>;
  onChange: (channel: NotifChannel, event: NotifEvent, enabled: boolean) => void;
  onAll: (channel: NotifChannel, enabled: boolean) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">이벤트별 수신</span>
        <div className="flex gap-2 text-[10px]">
          <button
            onClick={() => onAll(channel, true)}
            disabled={!enabled}
            className="text-[var(--primary)] hover:underline disabled:opacity-50"
          >
            모두 켜기
          </button>
          <span className="text-[var(--text-dim)]">·</span>
          <button
            onClick={() => onAll(channel, false)}
            disabled={!enabled}
            className="text-[var(--text-muted)] hover:underline disabled:opacity-50"
          >
            모두 끄기
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {NOTIF_EVENTS.map((ev) => (
          <label
            key={ev.key}
            className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--border)] transition cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--text)]">{ev.label}</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{ev.desc}</div>
            </div>
            <Toggle
              checked={!!values[ev.key]}
              onChange={(v) => onChange(channel, ev.key, v)}
              disabled={!enabled}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
        checked ? "bg-[var(--primary)]" : "bg-[var(--border)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ═══════════════════════════════════════════
// Company Info Tab
// ═══════════════════════════════════════════
function CompanyInfoTab({ companyId }: { companyId: string | null }) {
  const db = supabase as any;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: "",
    business_number: "",
    representative: "",
    address: "",
    phone: "",
    fax: "",
    business_type: "",
    business_category: "",
  });
  const [sealUrl, setSealUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"seal" | "logo" | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [generatingSeal, setGeneratingSeal] = useState(false);
  const [sealPreview, setSealPreview] = useState<string | null>(null);
  const [sealVariant, setSealVariant] = useState<"corporate" | "double" | "single" | "square">("corporate");
  const sealInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const { data: company, isLoading } = useQuery({
    queryKey: ["company-info", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await db
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || "",
        business_number: company.business_number || "",
        representative: company.representative || "",
        address: company.address || "",
        phone: company.phone || "",
        fax: company.fax || "",
        business_type: company.business_type || "",
        business_category: company.business_category || "",
      });
      setSealUrl(company.seal_url || null);
      setLogoUrl(company.logo_url || null);
    }
  }, [company]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("회사 ID 없음");
      const { error } = await db
        .from("companies")
        .update({
          name: form.name,
          business_number: form.business_number || null,
          representative: form.representative || null,
          address: form.address || null,
          phone: form.phone || null,
          fax: form.fax || null,
          business_type: form.business_type || null,
          business_category: form.business_category || null,
        })
        .eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-info"] });
      setSaved(true);
      toast("회사 정보가 저장되었습니다.", "success");
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: any) => {
      toast(`저장 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    },
  });

  const formatBusinessNumber = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };

  const handleFileUpload = useCallback(async (file: File, type: "seal" | "logo") => {
    if (!companyId) return;
    setUploadError("");

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("파일 크기는 5MB 이하여야 합니다.");
      return;
    }

    // Validate file type
    const validTypes = ["image/png", "image/jpg", "image/jpeg"];
    if (!validTypes.includes(file.type)) {
      setUploadError("PNG, JPG, JPEG 파일만 업로드 가능합니다.");
      return;
    }

    setUploading(type);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const filePath = `${companyId}/${type}_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("company-assets")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("company-assets")
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // Update company record
      const updateField = type === "seal" ? "seal_url" : "logo_url";
      const { error: dbErr } = await db
        .from("companies")
        .update({ [updateField]: publicUrl })
        .eq("id", companyId);

      if (dbErr) throw dbErr;

      if (type === "seal") setSealUrl(publicUrl);
      else setLogoUrl(publicUrl);

      queryClient.invalidateQueries({ queryKey: ["company-info"] });
    } catch (err: any) {
      setUploadError(err.message || "업로드 실패");
    } finally {
      setUploading(null);
    }
  }, [companyId, queryClient]);

  const handleRemoveFile = useCallback(async (type: "seal" | "logo") => {
    if (!companyId) return;
    const updateField = type === "seal" ? "seal_url" : "logo_url";
    await db
      .from("companies")
      .update({ [updateField]: null })
      .eq("id", companyId);

    if (type === "seal") setSealUrl(null);
    else setLogoUrl(null);
    queryClient.invalidateQueries({ queryKey: ["company-info"] });
  }, [companyId, queryClient]);

  // 자동 직인 생성 — Canvas 로 PNG 만든 후 storage 업로드
  async function regenerateSealPreview(variant?: "corporate" | "double" | "single" | "square") {
    if (!form.name?.trim()) {
      setUploadError("회사명을 먼저 입력하세요.");
      return;
    }
    setUploadError("");
    try {
      const { generateCompanySealDataUrl } = await import("@/lib/seal-generator");
      const dataUrl = await generateCompanySealDataUrl(form.name, {
        variant: variant || sealVariant,
        title: "대표이사",
      });
      setSealPreview(dataUrl);
    } catch (err: any) {
      setUploadError("직인 생성 실패: " + (err?.message || ""));
    }
  }

  async function handleAutoGenerateSeal() {
    if (!companyId || !form.name?.trim()) {
      setUploadError("회사명을 먼저 입력하세요.");
      return;
    }
    setUploadError("");
    setGeneratingSeal(true);
    try {
      const { generateCompanySeal } = await import("@/lib/seal-generator");
      const blob = await generateCompanySeal(form.name, { variant: sealVariant, title: "대표이사" });
      const filePath = `${companyId}/seal_auto_${Date.now()}.png`;
      const { error: uploadErr } = await supabase.storage
        .from("company-assets")
        .upload(filePath, blob, { upsert: true, contentType: "image/png" });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage
        .from("company-assets")
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;
      const { error: dbErr } = await db
        .from("companies")
        .update({ seal_url: publicUrl })
        .eq("id", companyId);
      if (dbErr) throw dbErr;
      setSealUrl(publicUrl);
      setSealPreview(null);
      queryClient.invalidateQueries({ queryKey: ["company-info"] });
    } catch (err: any) {
      setUploadError(err.message || "직인 자동 생성 실패");
    } finally {
      setGeneratingSeal(false);
    }
  }

  if (!companyId) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="text-center py-8">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <div className="text-sm text-[var(--text-muted)]">회사 정보 로딩 중...</div>
        </div>
      </div>
    );
  }

  const isNewCompany = !company || (!company.business_number && !company.representative && !company.address);

  return (
    <div className="space-y-6">
      {/* Onboarding prompt for new companies */}
      {isNewCompany && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text)] mb-1">회사 정보를 설정해주세요</p>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                견적서, 세금계산서, 계약서 등 비즈니스 문서에 사용됩니다. 사업자번호와 대표자명을 먼저 입력하시면 자동 서류 생성이 가능합니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Company Basic Info */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">기본 정보</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">회사명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="(주)모티브이노베이션"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">사업자번호</label>
              <input
                value={form.business_number}
                onChange={(e) => setForm({ ...form, business_number: formatBusinessNumber(e.target.value) })}
                placeholder="000-00-00000"
                maxLength={12}
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">대표자명</label>
              <input
                value={form.representative}
                onChange={(e) => setForm({ ...form, representative: e.target.value })}
                placeholder="홍길동"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">전화번호</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="02-1234-5678"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">팩스</label>
              <input
                value={form.fax}
                onChange={(e) => setForm({ ...form, fax: e.target.value })}
                placeholder="02-1234-5679"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">업태</label>
              <input
                value={form.business_type}
                onChange={(e) => setForm({ ...form, business_type: e.target.value })}
                placeholder="서비스업"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">업종</label>
              <input
                value={form.business_category}
                onChange={(e) => setForm({ ...form, business_category: e.target.value })}
                placeholder="소프트웨어 개발"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">주소</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="서울특별시 강남구 테헤란로 123"
              className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <button
            onClick={() => form.name && saveMut.mutate()}
            disabled={!form.name || saveMut.isPending}
            className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {saveMut.isPending ? "저장 중..." : saved ? "저장 완료" : "회사 정보 저장"}
          </button>
        </div>
      </div>

      {/* Seal & Logo Upload */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">직인 및 로고</h2>
        {uploadError && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 text-xs mb-4">{uploadError}</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Seal Upload */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-2">직인 (회사 도장)</label>
            <div className="border-2 border-dashed border-[var(--border)] rounded-xl p-4 text-center min-h-[160px] flex flex-col items-center justify-center gap-2">
              {sealUrl ? (
                <>
                  <img
                    src={sealUrl}
                    alt="직인"
                    className="max-w-[120px] max-h-[120px] object-contain rounded-lg"
                  />
                  <div className="flex gap-2 mt-2 flex-wrap justify-center">
                    <button
                      onClick={() => sealInputRef.current?.click()}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      변경
                    </button>
                    <button
                      onClick={() => regenerateSealPreview()}
                      disabled={!form.name?.trim()}
                      className="text-xs text-emerald-500 hover:underline disabled:opacity-50"
                      title={!form.name?.trim() ? "회사명을 먼저 입력하세요" : ""}
                    >
                      🪄 자동 재생성
                    </button>
                    <button
                      onClick={() => handleRemoveFile("seal")}
                      className="text-xs text-red-400/60 hover:text-red-400"
                    >
                      삭제
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-dim)]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button
                      onClick={() => sealInputRef.current?.click()}
                      disabled={uploading === "seal" || generatingSeal}
                      className="text-xs text-[var(--primary)] font-semibold hover:underline disabled:opacity-50"
                    >
                      {uploading === "seal" ? "업로드 중..." : "직접 업로드"}
                    </button>
                    <span className="text-[var(--text-dim)] text-xs">·</span>
                    <button
                      onClick={() => regenerateSealPreview()}
                      disabled={uploading === "seal" || generatingSeal || !form.name?.trim()}
                      className="text-xs text-emerald-500 font-semibold hover:underline disabled:opacity-50"
                      title={!form.name?.trim() ? "회사명을 먼저 입력하세요" : ""}
                    >
                      🪄 자동 생성
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--text-dim)]">PNG, JPG (최대 5MB) · 또는 회사명으로 법인인감 자동 생성</p>
                </>
              )}
            </div>
            <input
              ref={sealInputRef}
              type="file"
              accept=".png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file, "seal");
                e.target.value = "";
              }}
            />

            {/* 자동 생성 미리보기 + 스타일 선택 */}
            {sealPreview && (
              <div className="mt-3 p-4 bg-[var(--bg-card)] border border-emerald-500/30 rounded-xl">
                <div className="flex items-start gap-4">
                  <img src={sealPreview} alt="직인 미리보기" className="w-32 h-32 object-contain bg-white rounded-lg p-2" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[var(--text)] mb-2">직인 스타일</p>
                    <div className="flex gap-1.5 flex-wrap mb-3">
                      {[
                        { v: "corporate" as const, label: "법인인감" },
                        { v: "double" as const, label: "이중 원형" },
                        { v: "single" as const, label: "단일 원형" },
                        { v: "square" as const, label: "사각형" },
                      ].map((opt) => (
                        <button
                          key={opt.v}
                          onClick={() => { setSealVariant(opt.v); regenerateSealPreview(opt.v); }}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition ${
                            sealVariant === opt.v
                              ? "bg-emerald-500 text-white"
                              : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAutoGenerateSeal}
                        disabled={generatingSeal}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition"
                      >
                        {generatingSeal ? "저장 중..." : "이 직인 사용"}
                      </button>
                      <button
                        onClick={() => setSealPreview(null)}
                        className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:text-[var(--text)] transition"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Logo Upload */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-2">회사 로고</label>
            <div className="border-2 border-dashed border-[var(--border)] rounded-xl p-4 text-center min-h-[160px] flex flex-col items-center justify-center gap-2">
              {logoUrl ? (
                <>
                  <img
                    src={logoUrl}
                    alt="로고"
                    className="max-w-[120px] max-h-[120px] object-contain rounded-lg"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      변경
                    </button>
                    <button
                      onClick={() => handleRemoveFile("logo")}
                      className="text-xs text-red-400/60 hover:text-red-400"
                    >
                      삭제
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-dim)]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploading === "logo"}
                    className="text-xs text-[var(--primary)] font-semibold hover:underline disabled:opacity-50"
                  >
                    {uploading === "logo" ? "업로드 중..." : "로고 업로드"}
                  </button>
                  <p className="text-[10px] text-[var(--text-dim)]">PNG, JPG (최대 5MB)</p>
                </>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept=".png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file, "logo");
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Approval Policy Tab
// ═══════════════════════════════════════════

const DOCUMENT_TYPES = [
  { value: "expense", label: "경비" },
  { value: "payment", label: "지급" },
  { value: "leave", label: "휴가" },
  { value: "overtime", label: "초과근무" },
  { value: "purchase", label: "구매" },
  { value: "contract", label: "계약" },
  { value: "travel", label: "출장" },
  { value: "card_expense", label: "법인카드" },
  { value: "equipment", label: "장비" },
  { value: "custom", label: "기타" },
];

const APPROVER_ROLES = [
  { value: "owner", label: "대표" },
  { value: "admin", label: "관리자" },
  { value: "manager", label: "매니저" },
  { value: "member", label: "멤버" },
];

interface ApprovalStage {
  step: number;
  title: string;
  approver_role: string;
  min_approvers: number;
}

function ApprovalPolicyTab({ companyId }: { companyId: string | null }) {
  const db = supabase as any;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    entity_type: "expense",
    required_role: "admin",
    auto_approve: false,
    auto_approve_threshold: 0,
    min_amount: 0,
    max_amount: 0,
  });
  const [stages, setStages] = useState<ApprovalStage[]>([
    { step: 1, title: "1차 승인", approver_role: "manager", min_approvers: 1 },
  ]);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data } = await db
        .from("approval_policies")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("회사 ID 없음");
      const row: any = {
        company_id: companyId,
        entity_type: form.entity_type,
        required_role: form.required_role,
        auto_approve: form.auto_approve,
        auto_approve_threshold: form.auto_approve_threshold || null,
        min_amount: form.min_amount || null,
        max_amount: form.max_amount || null,
        stages: stages.length > 0 ? stages : null,
      };
      if (editId) {
        const { error } = await db
          .from("approval_policies")
          .update(row)
          .eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("approval_policies")
          .insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-policies"] });
      resetForm();
    },
    onError: (err: any) => toast("결재 정책 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("approval_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approval-policies"] }),
    onError: (err: any) => toast(`삭제 실패: ${err.message || err}`, "error"),
  });

  function resetForm() {
    setShowForm(false);
    setEditId(null);
    setForm({
      entity_type: "expense",
      required_role: "admin",
      auto_approve: false,
      auto_approve_threshold: 0,
      min_amount: 0,
      max_amount: 0,
    });
    setStages([{ step: 1, title: "1차 승인", approver_role: "manager", min_approvers: 1 }]);
  }

  function editPolicy(p: any) {
    setEditId(p.id);
    setForm({
      entity_type: p.entity_type || "expense",
      required_role: p.required_role || "admin",
      auto_approve: p.auto_approve || false,
      auto_approve_threshold: p.auto_approve_threshold || 0,
      min_amount: p.min_amount || 0,
      max_amount: p.max_amount || 0,
    });
    if (p.stages && Array.isArray(p.stages) && p.stages.length > 0) {
      setStages(p.stages);
    } else {
      setStages([{ step: 1, title: "1차 승인", approver_role: "manager", min_approvers: 1 }]);
    }
    setShowForm(true);
  }

  function addStage() {
    const next = stages.length + 1;
    setStages([...stages, { step: next, title: `${next}차 승인`, approver_role: "admin", min_approvers: 1 }]);
  }

  function removeStage(idx: number) {
    const updated = stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step: i + 1 }));
    setStages(updated);
  }

  function updateStage(idx: number, field: keyof ApprovalStage, value: any) {
    const updated = [...stages];
    (updated[idx] as any)[field] = value;
    setStages(updated);
  }

  if (!companyId) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Policy List */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold">승인 정책 관리</h2>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">문서 유형별 결재 정책을 설정합니다</p>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
          >
            + 정책 추가
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">문서 유형 *</label>
                <select
                  value={form.entity_type}
                  onChange={(e) => setForm({ ...form, entity_type: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">필요 권한</label>
                <select
                  value={form.required_role}
                  onChange={(e) => setForm({ ...form, required_role: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                >
                  {APPROVER_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">최소 금액 (원)</label>
                <input
                  type="number"
                  value={form.min_amount || ""}
                  onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">최대 금액 (원)</label>
                <input
                  type="number"
                  value={form.max_amount || ""}
                  onChange={(e) => setForm({ ...form, max_amount: Number(e.target.value) || 0 })}
                  placeholder="무제한"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>

            {/* Auto Approve */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={form.auto_approve}
                  onChange={(e) => setForm({ ...form, auto_approve: e.target.checked })}
                  className="rounded"
                />
                자동 승인
              </label>
              {form.auto_approve && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-dim)]">기준 금액 이하:</span>
                  <input
                    type="number"
                    value={form.auto_approve_threshold || ""}
                    onChange={(e) => setForm({ ...form, auto_approve_threshold: Number(e.target.value) || 0 })}
                    placeholder="100000"
                    className="w-32 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                  />
                  <span className="text-xs text-[var(--text-dim)]">원</span>
                </div>
              )}
            </div>

            {/* Approval Stages */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-[var(--text-muted)] font-semibold">결재 단계 설정</label>
                <button
                  onClick={addStage}
                  className="text-[10px] text-[var(--primary)] hover:underline font-semibold"
                >
                  + 단계 추가
                </button>
              </div>
              <div className="space-y-2">
                {stages.map((stage, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <span className="text-xs font-bold text-[var(--primary)] w-8 text-center shrink-0">{stage.step}</span>
                    <input
                      value={stage.title}
                      onChange={(e) => updateStage(idx, "title", e.target.value)}
                      placeholder="승인 단계명"
                      className="flex-1 px-2 py-1.5 bg-transparent text-xs focus:outline-none"
                    />
                    <select
                      value={stage.approver_role}
                      onChange={(e) => updateStage(idx, "approver_role", e.target.value)}
                      className="px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-xs focus:outline-none"
                    >
                      {APPROVER_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={stage.min_approvers}
                      onChange={(e) => updateStage(idx, "min_approvers", Number(e.target.value) || 1)}
                      min={1}
                      className="w-12 px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-xs text-center focus:outline-none"
                      title="최소 승인 인원"
                    />
                    <span className="text-[10px] text-[var(--text-dim)] shrink-0">명</span>
                    {stages.length > 1 && (
                      <button
                        onClick={() => removeStage(idx)}
                        className="text-xs text-red-400/60 hover:text-red-400 shrink-0"
                      >
                        X
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Stage Preview */}
              {stages.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-dim)] mb-2">결재 흐름 미리보기</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {stages.map((stage, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20">
                          <span className="text-[10px] font-bold text-[var(--primary)]">{stage.step}</span>
                          <span className="text-[10px] text-[var(--text)]">{stage.title}</span>
                          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">
                            {APPROVER_ROLES.find(r => r.value === stage.approver_role)?.label}
                          </span>
                        </div>
                        {idx < stages.length - 1 && (
                          <span className="text-[var(--text-dim)] text-xs mx-0.5">→</span>
                        )}
                      </div>
                    ))}
                    <span className="text-[var(--text-dim)] text-xs mx-0.5">→</span>
                    <div className="px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
                      <span className="text-[10px] text-green-500 font-semibold">완료</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => upsertMut.mutate()}
                disabled={!form.entity_type || upsertMut.isPending}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {upsertMut.isPending ? "저장 중..." : editId ? "수정" : "추가"}
              </button>
              <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-xs">
                취소
              </button>
            </div>
          </div>
        )}

        {/* Policy List */}
        {isLoading ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]">로딩 중...</div>
        ) : policies.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--text-muted)]">
            등록된 승인 정책이 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {policies.map((p: any) => {
              const docType = DOCUMENT_TYPES.find(t => t.value === p.entity_type);
              const roleLabel = APPROVER_ROLES.find(r => r.value === p.required_role)?.label;
              return (
                <div
                  key={p.id}
                  className="px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{docType?.label || p.entity_type}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                        {roleLabel || p.required_role}
                      </span>
                      {p.auto_approve && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-semibold">
                          자동승인
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => editPolicy(p)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => deleteMut.mutate(p.id)}
                        className="text-xs text-red-400/60 hover:text-red-400 transition"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-dim)]">
                    {(p.min_amount || p.max_amount) && (
                      <span>
                        금액: {p.min_amount ? `₩${Number(p.min_amount).toLocaleString()}` : "0"}
                        {" ~ "}
                        {p.max_amount ? `₩${Number(p.max_amount).toLocaleString()}` : "무제한"}
                      </span>
                    )}
                    {p.auto_approve && p.auto_approve_threshold && (
                      <span>
                        자동승인: ₩{Number(p.auto_approve_threshold).toLocaleString()} 이하
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ Team Management ═══
function TeamManagement({ companyId }: { companyId: string | null }) {
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
      const { data } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

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
      <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-dim)] mb-4 flex items-start gap-2">
        <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span><strong>멤버</strong>: 오너뷰 계정이 있는 사용자 (로그인 가능) · <strong>직원</strong>: HR 관리 대상 (계정 없이도 급여·근태 관리 가능, 인력관리 페이지에서 등록)</span>
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            <span>부서/직위/연봉까지 한 번에 설정하려면 <strong>인력관리</strong> 페이지에서 초대하세요.</span>
          </div>
          {inviteError && (
            <div className="p-2 rounded-lg bg-[var(--danger-dim)] text-[var(--danger)] text-xs">{inviteError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

// ═══ Deal Classification Manager ═══
function DealClassificationManager({ companyId }: { companyId: string | null }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: '#3b82f6' });
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    onError: (err: any) => toast("분류 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDealClassification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deal-classifications'] }),
    onError: (err: any) => toast(`삭제 실패: ${err.message || err}`, "error"),
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {(() => {
        const defaults = ['B2B', 'B2C', 'B2G'];
        const defaultColors: Record<string, string> = { B2B: '#3b82f6', B2C: '#22c55e', B2G: '#f59e0b' };
        const customNames = classifications.map((c: any) => c.name);
        const allCls = [
          ...defaults.filter(d => !customNames.includes(d)).map(d => ({ id: `default-${d}`, name: d, color: defaultColors[d], is_system: true })),
          ...classifications,
        ];
        return allCls.length === 0 ? (
        <div className="text-center py-6 text-sm text-[var(--text-muted)]">
          딜 분류가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {allCls.map((cls: any) => (
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
                  onClick={() => { setEditId(String(cls.id).startsWith('default-') ? null : cls.id); setForm({ name: cls.name, color: cls.color || '#3b82f6' }); setShowForm(true); }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                >
                  수정
                </button>
                {!String(cls.id).startsWith('default-') && (
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
      )
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════
// CODEF Account Register Component
// ═══════════════════════════════════════════

const CODEF_BANKS: Record<string, string> = {
  "0003": "기업은행", "0004": "국민은행", "0011": "농협은행",
  "0020": "우리은행", "0023": "SC제일은행", "0031": "대구은행",
  "0032": "부산은행", "0034": "광주은행", "0035": "제주은행",
  "0037": "전북은행", "0039": "경남은행", "0045": "새마을금고",
  "0048": "신협", "0071": "우체국", "0081": "하나은행",
  "0088": "신한은행", "0089": "케이뱅크", "0090": "카카오뱅크",
  "0092": "토스뱅크",
};

const CODEF_CARDS: Record<string, string> = {
  "0301": "KB국민카드", "0302": "현대카드", "0303": "삼성카드",
  "0304": "NH농협카드", "0305": "BC카드", "0306": "신한카드",
  "0309": "하나카드", "0311": "롯데카드", "0313": "우리카드",
};

// 공공기관 organization codes (CODEF API)
// 백엔드 codef-sync 의 HOMETAX_ORG 와 일치해야 함.
const CODEF_PUBLIC: Record<string, string> = {
  "0001": "국세청 홈택스",
};

function CodefAccountRegister({ companyId, onRegistered }: { companyId: string | null; onRegistered: () => void }) {
  const { toast } = useToast();
  const [accountType, setAccountType] = useState<"bank" | "card" | "hometax">("bank");
  const [clientType, setClientType] = useState<"P" | "B">("B");
  const [authMethod, setAuthMethod] = useState<"cert" | "idpw">("cert");
  const [organization, setOrganization] = useState("");
  // ID/PW states
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  // Certificate states
  const [certPassword, setCertPassword] = useState("");
  const [showCertPw, setShowCertPw] = useState(false);
  const [derFileB64, setDerFileB64] = useState("");
  const [keyFileB64, setKeyFileB64] = useState("");
  const [certFileName, setCertFileName] = useState("");
  // Hometax 전용 — 대표자 주민번호 앞 7자리 (선택)
  const [hometaxIdentity, setHometaxIdentity] = useState("");
  // Common
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const orgList = accountType === "bank" ? CODEF_BANKS : accountType === "card" ? CODEF_CARDS : CODEF_PUBLIC;

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleCertFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    let derDone = false;
    let keyDone = false;
    const names: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const b64 = await readFileAsBase64(file);
      const lower = file.name.toLowerCase();
      if (lower.includes("signcert") || lower.endsWith(".der")) {
        setDerFileB64(b64);
        derDone = true;
        names.push(file.name);
      } else if (lower.includes("signpri") || lower.endsWith(".key")) {
        setKeyFileB64(b64);
        keyDone = true;
        names.push(file.name);
      } else if (lower.endsWith(".pfx") || lower.endsWith(".p12")) {
        // PFX contains both cert and key
        setDerFileB64(b64);
        setKeyFileB64(b64);
        derDone = true;
        keyDone = true;
        names.push(file.name);
      }
    }
    setCertFileName(names.join(", ") || "");
    if (!derDone || !keyDone) {
      setResult({ ok: false, msg: "signCert.der + signPri.key 두 파일을 함께 선택하거나, .pfx 파일 하나를 선택하세요." });
    } else {
      setResult(null);
    }
  }

  async function handleRegister() {
    if (!companyId || registering || !organization) return;
    setRegistering(true);
    setResult(null);
    try {
      // ── 홈택스 (공공 0002) — register/connectedId 흐름 사용 안 함 ──
      // 인증서 파일은 storage 에 업로드, 비밀번호는 automation_credentials 에 저장.
      // verify API 로 회원 등록여부 확인.
      if (accountType === "hometax") {
        if (authMethod === "cert") {
          if (!derFileB64 || !keyFileB64 || !certPassword) {
            setResult({ ok: false, msg: "인증서 파일과 비밀번호를 모두 입력하세요" });
            setRegistering(false);
            return;
          }
          // 1. 인증서 파일을 storage 에 업로드 (codef-sync 가 거기서 가져감)
          const derBytes = Uint8Array.from(atob(derFileB64), (c) => c.charCodeAt(0));
          const keyBytes = Uint8Array.from(atob(keyFileB64), (c) => c.charCodeAt(0));
          await supabase.storage.from("certificates").upload(
            `${companyId}/signCert.der`, new Blob([derBytes]), { upsert: true },
          );
          await supabase.storage.from("certificates").upload(
            `${companyId}/signPri.key`, new Blob([keyBytes]), { upsert: true },
          );
          // 2. 인증서 비밀번호를 암호화하여 automation_credentials 에 저장 (sync 시 사용)
          const { encryptCredential } = await import("@/lib/crypto");
          const enc = await encryptCredential(certPassword);
          await (supabase as any).from("automation_credentials").upsert({
            company_id: companyId,
            service: "hometax",
            credentials: { login_method: "certificate", cert_password: enc || "" },
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,service" });
          // 3. verify API 호출 (회원 등록여부)
          const { verifyHometaxRegistration } = await import("@/lib/data-sync");
          const res = await verifyHometaxRegistration(companyId, {
            loginType: "0",
            certPassword,
            identity: hometaxIdentity || undefined,
          });
          if (res.success && res.registered) {
            setResult({ ok: true, msg: "홈택스 등록 확인 완료. 이제 세금계산서 동기화를 사용할 수 있습니다." });
            toast("홈택스 연결 완료", "success");
            setCertPassword("");
            onRegistered();
          } else if (res.success && !res.registered) {
            setResult({ ok: false, msg: "홈택스 미등록 사용자입니다. 홈택스 사이트에서 회원가입 후 다시 시도하세요." });
          } else {
            setResult({ ok: false, msg: (res.error || "검증 실패") + (res.hint ? `\n→ ${res.hint}` : "") });
          }
        } else {
          if (!loginId || !loginPw) {
            setResult({ ok: false, msg: "아이디와 비밀번호를 모두 입력하세요" });
            setRegistering(false);
            return;
          }
          // ID/PW 정보를 automation_credentials 에 저장 (sync 시 사용)
          const { encryptCredential } = await import("@/lib/crypto");
          const encPw = await encryptCredential(loginPw);
          await (supabase as any).from("automation_credentials").upsert({
            company_id: companyId,
            service: "hometax",
            credentials: { login_method: "id_pw", login_id: loginId, login_password: encPw || "" },
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,service" });
          const { verifyHometaxRegistration } = await import("@/lib/data-sync");
          const res = await verifyHometaxRegistration(companyId, {
            loginType: "1",
            id: loginId,
            userPassword: loginPw,
            identity: hometaxIdentity || undefined,
          });
          if (res.success && res.registered) {
            setResult({ ok: true, msg: "홈택스 등록 확인 완료." });
            toast("홈택스 연결 완료", "success");
            setLoginId("");
            setLoginPw("");
            onRegistered();
          } else if (res.success && !res.registered) {
            setResult({ ok: false, msg: "홈택스 미등록 사용자입니다." });
          } else {
            setResult({ ok: false, msg: (res.error || "검증 실패") + (res.hint ? `\n→ ${res.hint}` : "") });
          }
        }
        setRegistering(false);
        return;
      }

      // ── 은행/카드 — 기존 register/connectedId 흐름 ──
      if (authMethod === "cert") {
        if (!derFileB64 || !keyFileB64 || !certPassword) {
          setResult({ ok: false, msg: "인증서 파일과 비밀번호를 모두 입력하세요" });
          setRegistering(false);
          return;
        }
        const { registerCodefCertificate } = await import("@/lib/data-sync");
        const res = await registerCodefCertificate(companyId, accountType, organization, derFileB64, keyFileB64, certPassword, undefined, clientType);
        if (res.success) {
          setResult({ ok: true, msg: "금융기관 연결 성공!" });
          toast("금융기관 연결 완료", "success");
          setCertPassword("");
          onRegistered();
        } else {
          setResult({ ok: false, msg: res.error || "연결 실패" });
        }
      } else {
        if (!loginId || !loginPw) {
          setResult({ ok: false, msg: "아이디와 비밀번호를 모두 입력하세요" });
          setRegistering(false);
          return;
        }
        const { registerCodefAccount } = await import("@/lib/data-sync");
        const res = await registerCodefAccount(companyId, accountType, organization, loginId, loginPw, clientType);
        if (res.success) {
          setResult({ ok: true, msg: "금융기관 연결 성공!" });
          toast("금융기관 연결 완료", "success");
          setLoginId("");
          setLoginPw("");
          onRegistered();
        } else {
          setResult({ ok: false, msg: res.error || "연결 실패" });
        }
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message || "오류 발생" });
    }
    setRegistering(false);
  }

  const isCertReady = !!derFileB64 && !!keyFileB64 && !!certPassword && !!organization;
  const isIdPwReady = !!loginId && !!loginPw && !!organization;
  const isReady = authMethod === "cert" ? isCertReady : isIdPwReady;

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
      <h2 className="text-sm font-bold mb-1">금융기관 연결</h2>
      <p className="text-xs text-[var(--text-dim)] mb-4">공동인증서 또는 인터넷뱅킹 아이디로 계좌를 연결하면 거래내역이 자동 수집됩니다.</p>

      {/* 데모 체험 */}
      <button
        onClick={async () => {
          if (!companyId || registering) return;
          setRegistering(true);
          setResult(null);
          try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const { data: { session } } = await (await import("@/lib/supabase")).supabase.auth.getSession();
            if (!session || !supabaseUrl) throw new Error("로그인 필요");
            const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ companyId, action: "sandbox-connect" }),
            });
            const data = await res.json();
            if (data.success) {
              setResult({ ok: true, msg: `데모 연결 완료! 은행 ${data.bankAccounts || 0}개 + 카드 ${data.cardAccounts || 0}개 확인됨` });
              toast("데모 금융 데이터 연결 완료", "success");
              onRegistered();
            } else {
              setResult({ ok: false, msg: data.error || "연결 실패" });
            }
          } catch (err: any) {
            setResult({ ok: false, msg: err.message || "오류" });
          }
          setRegistering(false);
        }}
        disabled={registering}
        className="mb-4 w-full py-2.5 bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded-xl text-xs font-semibold hover:bg-blue-500/20 transition disabled:opacity-50"
      >
        {registering ? "연결 중..." : "데모 데이터로 바로 체험하기"}
      </button>

      <div className="border-t border-[var(--border)] pt-4 mb-4">
        <p className="text-xs font-semibold text-[var(--text)] mb-3">실제 금융기관 연결</p>

        {/* 은행/카드/홈택스 선택 */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => { setAccountType("bank"); setOrganization(""); }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${accountType === "bank" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]"}`}>은행</button>
          <button onClick={() => { setAccountType("card"); setOrganization(""); }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${accountType === "card" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]"}`}>카드</button>
          <button onClick={() => { setAccountType("hometax"); setOrganization("0001"); }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${accountType === "hometax" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]"}`}>홈택스</button>
        </div>

        {/* 개인/법인 선택 */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => setClientType("P")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${clientType === "P" ? "bg-orange-500/10 text-orange-600 border-orange-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            개인
          </button>
          <button onClick={() => setClientType("B")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${clientType === "B" ? "bg-orange-500/10 text-orange-600 border-orange-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            법인/기업
          </button>
        </div>

        {/* 인증 방식 선택 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setAuthMethod("cert")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${authMethod === "cert" ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            공동인증서
          </button>
          <button onClick={() => setAuthMethod("idpw")} className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition border ${authMethod === "idpw" ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)]"}`}>
            아이디/비밀번호
          </button>
        </div>

        {/* 금융기관 선택 */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">{accountType === "bank" ? "은행" : accountType === "card" ? "카드사" : "공공기관"} 선택</label>
            <select value={organization} onChange={(e) => setOrganization(e.target.value)} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
              <option value="">선택하세요</option>
              {Object.entries(orgList).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {accountType === "hometax" && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">대표자 주민번호 앞 7자리 <span className="text-[10px] text-[var(--text-dim)]">(선택, ID/PW 방식 또는 검증 필요시)</span></label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={7}
                value={hometaxIdentity}
                onChange={(e) => setHometaxIdentity(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="예: 8001011 (생년월일 6 + 성별 1)"
                className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
              <p className="text-[10px] text-[var(--text-dim)] mt-1">
                개인사업자: 본인 주민번호 앞 7자리 / 법인: 대표자 주민번호 앞 7자리.
                안전한 보관을 위해 바로 CODEF 호출 후 즉시 폐기됩니다 (DB 저장 X).
              </p>
            </div>
          )}

          {authMethod === "cert" ? (
            <>
              {/* 공동인증서 입력 */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">공동인증서 파일</label>
                <div className="relative">
                  <input
                    type="file"
                    multiple
                    onChange={(e) => handleCertFiles(e.target.files)}
                    className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary)]/10 file:text-[var(--primary)]"
                  />
                </div>
                {certFileName && <p className="text-[10px] text-green-600 mt-1">선택됨: {certFileName}</p>}
                <p className="text-[10px] text-[var(--text-dim)] mt-1">signCert.der + signPri.key 또는 .pfx 파일을 선택하세요</p>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">인증서 비밀번호</label>
                <div className="relative">
                  <input type={showCertPw ? "text" : "password"} value={certPassword} onChange={(e) => setCertPassword(e.target.value)} placeholder="인증서 비밀번호" className="w-full px-4 py-3 pr-16 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  <button type="button" onClick={() => setShowCertPw(!showCertPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">{showCertPw ? "숨기기" : "보기"}</button>
                </div>
                <p className="text-[10px] text-[var(--text-dim)] mt-1">인증서와 비밀번호는 보안 서버에서 암호화 처리됩니다. 오너뷰는 저장하지 않습니다.</p>
              </div>
            </>
          ) : (
            <>
              {/* ID/PW 입력 */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">인터넷뱅킹 아이디</label>
                <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder={accountType === "bank" ? "인터넷뱅킹 아이디" : "카드 홈페이지 아이디"} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">비밀번호</label>
                <div className="relative">
                  <input type={showPw ? "text" : "password"} value={loginPw} onChange={(e) => setLoginPw(e.target.value)} placeholder="비밀번호" className="w-full px-4 py-3 pr-16 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">{showPw ? "숨기기" : "보기"}</button>
                </div>
                <p className="text-[10px] text-[var(--text-dim)] mt-1">보안 서버를 통해 암호화 전송됩니다. 오너뷰는 비밀번호를 저장하지 않습니다.</p>
              </div>
            </>
          )}
        </div>
      </div>

      {result && (
        <div className={`mt-3 p-3 rounded-xl text-xs font-medium whitespace-pre-wrap break-all ${result.ok ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
          {result.msg}
        </div>
      )}

      <button
        onClick={handleRegister}
        disabled={registering || !isReady}
        className="mt-4 w-full py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
      >
        {registering ? "연결 중..." : `${orgList[organization] || (accountType === "bank" ? "은행" : "카드사")} 연결하기`}
      </button>
    </div>
  );
}

// P0-C: CODEF 동기화 에러 1건을 사용자 친화적으로 surface.
//   - 큼지막한 사용자 언어 hint 우선 노출 (codef-sync 의 codefErrorHint()
//     결과를 작은 회색 한 줄이 아니라 박스 내 강조 영역으로)
//   - code 별 다음 액션 버튼: 인증서 재등록 / 카드 비밀번호 재등록 / 다시 시도
function codefAction(code?: string): { label: string; tab?: string; retry?: boolean } | null {
  if (!code) return { label: "다시 시도", retry: true };
  if (code === "CF-00401") return { label: "🔑 인증서 다시 등록", tab: "certificate" };
  if (code === "CF-12838" || code === "CF-12839") return { label: "🔁 ConnectedID 재등록", tab: "bank" };
  if (code === "CF-13021") return { label: "다시 시도", retry: true }; // 외부(은행) 처리 필요 — UI에서 할 일 없음
  if (code === "NO_DEMAND_DEPOSIT") return { label: "🔁 다시 시도", retry: true };
  if (code === "CHUNK_FAIL") return { label: "🔁 다시 시도", retry: true };
  return { label: "🔁 다시 시도", retry: true };
}

function CodefErrorCard({ item, onRetry, retrying }: { item: any; onRetry: () => void; retrying: boolean }) {
  const code: string | undefined = item.code;
  const action = codefAction(code);
  const heading = item.accountNo || item.organization || "기관";
  // codef-sync 가 만들어준 hint 가 사용자 친화 텍스트 — 큰 글씨로 surface.
  const friendlyMain = item.hint || item.message || "동기화에 실패했습니다.";

  return (
    <li className="p-3 rounded-xl bg-red-500/8 border border-red-500/15">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-red-500/70 font-mono mb-0.5">
            {code || "ERROR"} · {heading}
          </div>
          <div className="text-sm text-red-600 dark:text-red-300 font-semibold leading-snug">
            {friendlyMain}
          </div>
          {item.hint && item.message && item.hint !== item.message && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">상세: {item.message}</div>
          )}
        </div>
        {action && (
          <div className="flex flex-col gap-1 shrink-0">
            {action.retry && (
              <button
                onClick={onRetry}
                disabled={retrying}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white transition whitespace-nowrap"
              >
                {retrying ? "처리 중…" : action.label}
              </button>
            )}
            {action.tab && (
              <a
                href={`/settings?tab=${action.tab}`}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition whitespace-nowrap text-center"
              >
                {action.label}
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ═══════════════════════════════════════════
// Bank Integration Tab — 사용자 친화적 금융 연결
// CODEF API 키는 서버 환경변수로만 관리 (사용자 노출 X)
// ═══════════════════════════════════════════
function BankIntegrationTab({ companyId, bankAccounts }: { companyId: string | null; bankAccounts: BankAccount[] }) {
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    auto_transfer_enabled: false, auto_transfer_limit: 5000000, transfer_schedule: "immediate",
    retry_count: 3, retry_interval_hours: 1,
    ceo_telegram_chat_id: "",
  });
  const [telegramTestResult, setTelegramTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sendingTelegramTest, setSendingTelegramTest] = useState(false);

  // 연결 상태 확인 — 은행/카드는 ConnectedID, 홈택스는 automation_credentials.hometax 존재 여부.
  const { data: connectionStatus, refetch: refetchConnection } = useQuery({
    queryKey: ["codef-connection", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const [{ data: cs }, { data: ht }] = await Promise.all([
        db2.from("company_settings").select("codef_connected_id, codef_connected_at").eq("company_id", companyId).maybeSingle(),
        db2.from("automation_credentials").select("id, updated_at, credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
      ]);
      return {
        codef_connected_id: cs?.codef_connected_id || null,
        codef_connected_at: cs?.codef_connected_at || null,
        hometax_registered: !!ht?.id,
        hometax_method: ht?.credentials?.login_method || null,
        hometax_registered_at: ht?.updated_at || null,
      };
    },
    enabled: !!companyId,
  });

  // 연결된 CODEF 계좌 목록
  const [codefAccounts, setCodefAccounts] = useState<{ bank: any[]; card: any[] }>({ bank: [], card: [] });
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string; errors?: any[]; notes?: any[] } | null>(null);
  // 기간 선택 sync (과거 데이터 채워넣기용)
  const [showRangeSync, setShowRangeSync] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [recentSyncLogs, setRecentSyncLogs] = useState<any[]>([]);

  // 은행/카드 ConnectedID 또는 홈택스 자격증명 등록 시 모두 "연결됨" 표시.
  const hasCodefConnection = !!connectionStatus?.codef_connected_id;
  const hasHometaxConnection = !!connectionStatus?.hometax_registered;
  const isConnected = hasCodefConnection || hasHometaxConnection;

  // CODEF 계좌 목록 조회 — ConnectedID 가 있을 때만 (holetax 단독 등록은 의미 없음).
  useEffect(() => {
    if (!companyId || !hasCodefConnection) return;
    setLoadingAccounts(true);
    Promise.all([
      import("@/lib/data-sync").then(m => m.listCodefAccounts(companyId, "bank")),
      import("@/lib/data-sync").then(m => m.listCodefAccounts(companyId, "card")),
    ]).then(([bankRes, cardRes]) => {
      setCodefAccounts({
        bank: bankRes.success ? (bankRes.accounts || []) : [],
        card: cardRes.success ? (cardRes.accounts || []) : [],
      });
    }).finally(() => setLoadingAccounts(false));
  }, [companyId, isConnected]);

  // 최근 CODEF 동기화 이력 로드 (오류 모니터링)
  async function loadRecentSyncLogs() {
    if (!companyId) return;
    const { getRecentCodefSyncLogs } = await import("@/lib/data-sync");
    const logs = await getRecentCodefSyncLogs(companyId, 5);
    setRecentSyncLogs(logs);
  }
  useEffect(() => { if (isConnected) loadRecentSyncLogs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, isConnected]);

  // YYYY-MM-DD → YYYYMMDD (CODEF format)
  function toCodefDate(iso: string): string { return iso.replace(/-/g, ''); }

  // 거래내역 동기화 — bank/card 와 hometax 를 분리 호출 (각자 Edge Function 150s timeout 회피).
  // 첫 sync 자동 감지 — bank_transactions 0건 이면 1년 전부터 가져옴 (default 3개월 제약 회피).
  async function handleSync() {
    if (!companyId || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const { syncCodefData } = await import("@/lib/data-sync");

      // 첫 sync 감지 — bank_transactions 0건 → 1년치 자동 가져옴 (3개월씩 4번 chunked)
      let isFirstSync = false;
      if (hasCodefConnection) {
        const { count } = await db2.from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId);
        if ((count || 0) === 0) isFirstSync = true;
      }

      // 1단계: 은행/카드만 동기화. 첫 sync 면 1년치 3개월씩 분할, 일반 sync 는 default (3개월).
      let bankCardRes: any;
      if (hasCodefConnection && isFirstSync) {
        toast('첫 동기화 — 1년치 데이터를 4구간으로 나눠 가져오는 중', 'info');
        let totalBank = 0, totalCard = 0;
        const allErrors: any[] = [], allNotes: any[] = [];
        const today = new Date();
        for (let i = 3; i >= 0; i--) {
          const cEnd = new Date(today); cEnd.setMonth(cEnd.getMonth() - i * 3);
          const cStart = new Date(cEnd); cStart.setMonth(cStart.getMonth() - 3); cStart.setDate(cStart.getDate() + 1);
          const startStr = toCodefDate(cStart.toISOString().slice(0, 10));
          const endStr = toCodefDate(cEnd.toISOString().slice(0, 10));
          const r: any = await syncCodefData(companyId, 'bank_card', startStr, endStr);
          totalBank += r.bankSynced || 0;
          totalCard += r.cardSynced || 0;
          if (r.errors) allErrors.push(...r.errors);
          if (r.notes) allNotes.push(...r.notes);
        }
        bankCardRes = {
          success: allErrors.length === 0,
          status: allErrors.length === 0 ? 'success' : 'partial',
          errors: allErrors,
          notes: allNotes,
          bankSynced: totalBank, cardSynced: totalCard,
          message: `은행 ${totalBank}건 + 카드 ${totalCard}건 (1년치)`,
        };
      } else {
        bankCardRes = hasCodefConnection
          ? await syncCodefData(companyId, 'bank_card')
          : { success: true, errors: [], status: 'success' as const, message: '은행/카드 미등록' };
      }

      // 2단계: 홈택스 동기화 (느림, 인증서 storage 필요) — 등록된 경우만
      const hometaxRes = hasHometaxConnection
        ? await syncCodefData(companyId, "hometax")
        : null;

      const allErrors = [...(bankCardRes.errors || []), ...((hometaxRes as any)?.errors || [])];
      const allNotes = [...((bankCardRes as any).notes || []), ...((hometaxRes as any)?.notes || [])];
      const totalSuccess = (bankCardRes.success ?? false) && (hometaxRes ? hometaxRes.success : true);

      if (totalSuccess && allErrors.length === 0) {
        // 진짜 에러 없음 — 성공. notes(외부 안내)가 있어도 빨간 알림 안 뜸.
        const parts = [];
        if (hasCodefConnection) parts.push(bankCardRes.message || "은행/카드 동기화 완료");
        if (hometaxRes) parts.push(hometaxRes.message || "홈택스 동기화 완료");
        setSyncResult({
          ok: true,
          msg: parts.join(" + ") || "동기화 완료",
          notes: allNotes.length > 0 ? allNotes : undefined,
        });
        toast("거래내역 동기화 완료", "success");
      } else if (allErrors.length > 0) {
        setSyncResult({
          ok: false,
          msg: `부분 동기화 (오류 ${allErrors.length}건)`,
          errors: allErrors,
          notes: allNotes.length > 0 ? allNotes : undefined,
        });
        toast("일부 동기화 실패", "info");
      } else {
        setSyncResult({ ok: false, msg: bankCardRes.error || "동기화 실패", errors: allErrors });
        toast("동기화 실패", "error");
      }
      await loadRecentSyncLogs();
    } catch (err: any) {
      setSyncResult({ ok: false, msg: err.message || "오류 발생" });
    }
    setSyncing(false);
    if (!syncResult?.errors?.length) setTimeout(() => setSyncResult((prev) => (prev?.errors?.length ? prev : null)), 5000);
  }

  const [rangeProgress, setRangeProgress] = useState<string>('');

  // 사용자가 명시한 기간으로 다시 sync — 3개월씩 분할 sequential 호출 (HTTP 546 timeout 회피)
  async function handleRangeSync() {
    if (!companyId || syncing) return;
    if (!rangeFrom || !rangeTo) { toast('기간을 지정하세요', 'error'); return; }
    if (rangeFrom > rangeTo) { toast('시작일이 종료일보다 늦습니다', 'error'); return; }
    setSyncing(true);
    setSyncResult(null);
    setRangeProgress('');
    try {
      const { syncCodefData } = await import('@/lib/data-sync');

      // 3개월(약 90일) 단위로 chunks 생성
      const chunks: Array<{ from: string; to: string }> = [];
      const startD = new Date(rangeFrom);
      const endD = new Date(rangeTo);
      let cursor = new Date(startD);
      while (cursor.getTime() <= endD.getTime()) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setMonth(chunkEnd.getMonth() + 3);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        if (chunkEnd.getTime() > endD.getTime()) chunkEnd.setTime(endD.getTime());
        chunks.push({
          from: cursor.toISOString().slice(0, 10),
          to: chunkEnd.toISOString().slice(0, 10),
        });
        cursor = new Date(chunkEnd);
        cursor.setDate(cursor.getDate() + 1);
      }

      toast(`${rangeFrom} ~ ${rangeTo} (${chunks.length}개 구간) 동기화 시작`, 'info');

      let totalBank = 0, totalCard = 0;
      const allErrors: any[] = [];
      const allNotes: any[] = [];
      const failedChunks: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        setRangeProgress(`${i + 1}/${chunks.length} — ${c.from} ~ ${c.to}`);
        try {
          const res = await syncCodefData(companyId, 'bank_card', toCodefDate(c.from), toCodefDate(c.to));
          totalBank += res.bankSynced || 0;
          totalCard += res.cardSynced || 0;
          if ((res as any).errors) allErrors.push(...(res as any).errors);
          if ((res as any).notes) allNotes.push(...(res as any).notes);
          if (!res.success && (res as any).errors?.length === 0) {
            // HTTP 546 등 timeout — 더 작은 chunk 도 고려 대상
            failedChunks.push(`${c.from} ~ ${c.to}: ${(res as any).error || 'timeout'}`);
          }
        } catch (e: any) {
          failedChunks.push(`${c.from} ~ ${c.to}: ${e.message || '오류'}`);
        }
      }

      setRangeProgress('');
      const msgParts = [`은행 ${totalBank}건 + 카드 ${totalCard}건 sync`];
      if (allNotes.length > 0) msgParts.push(`안내 ${allNotes.length}건`);
      if (allErrors.length > 0) msgParts.push(`오류 ${allErrors.length}건`);
      if (failedChunks.length > 0) msgParts.push(`timeout ${failedChunks.length}개 구간`);

      const ok = allErrors.length === 0 && failedChunks.length === 0;
      setSyncResult({
        ok,
        msg: `${rangeFrom} ~ ${rangeTo} (${chunks.length}구간 처리) — ${msgParts.join(' · ')}`,
        errors: [...allErrors, ...failedChunks.map(f => ({ message: f, code: 'CHUNK_FAIL' }))].slice(0, 50),
        notes: allNotes.length > 0 ? allNotes : undefined,
      });
      toast(ok ? '기간 동기화 완료' : `부분 완료 — 자세히는 결과 확인`, ok ? 'success' : 'info');
      await loadRecentSyncLogs();
    } catch (err: any) {
      setSyncResult({ ok: false, msg: err.message || '오류 발생' });
    }
    setSyncing(false);
    setRangeProgress('');
  }

  const { data: companySettings } = useQuery({
    queryKey: ["automation-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("automation_settings").eq("id", companyId).maybeSingle(); return data?.automation_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => { if (companySettings) setSettings((prev) => ({ ...prev, ...companySettings })); }, [companySettings]);
  async function saveSettings() {
    if (!companyId) return;
    const { error } = await db2.from("companies").update({ automation_settings: settings }).eq("id", companyId);
    if (error) { toast("설정 저장 실패: " + error.message, "error"); return; }
    queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;

  return (
    <div className="space-y-6">
      {/* 금융 연결 상태 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">금융 데이터 연동</h2>
            {isConnected ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-500">연결됨</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/10 text-gray-400">미연결</span>
            )}
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              {hasCodefConnection && (
                <button
                  onClick={() => setShowRangeSync(v => !v)}
                  disabled={syncing}
                  className="px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-xl text-xs font-semibold transition disabled:opacity-50 border border-[var(--border)]"
                  title="원하는 기간으로 과거 거래 다시 가져오기 (누락분 채워넣기)"
                >
                  📅 기간 선택 sync
                </button>
              )}
              <button onClick={handleSync} disabled={syncing} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
                {syncing ? "동기화 중..." : hasCodefConnection && hasHometaxConnection ? "전체 동기화" : hasHometaxConnection ? "홈택스 동기화" : "거래내역 동기화"}
              </button>
            </div>
          )}
        </div>

        {/* 기간 선택 sync — 펼침 */}
        {showRangeSync && hasCodefConnection && (
          <div className="mb-4 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs font-bold text-[var(--text)]">📅 기간 선택해서 다시 동기화</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                  CODEF default 는 최근 3개월만 가져옵니다. 과거 누락분이 있으면 시작일/종료일을 지정해 다시 sync 하세요.
                </div>
              </div>
              <button onClick={() => setShowRangeSync(false)}
                className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">✕</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <label className="text-xs text-[var(--text-muted)]">시작일</label>
              <input type="date" value={rangeFrom} max={rangeTo} onChange={e => setRangeFrom(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg" />
              <span className="text-xs text-[var(--text-dim)]">~</span>
              <label className="text-xs text-[var(--text-muted)]">종료일</label>
              <input type="date" value={rangeTo} min={rangeFrom} max={new Date().toISOString().slice(0,10)} onChange={e => setRangeTo(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg" />
              <div className="flex items-center gap-1 ml-2">
                {[
                  { label: '최근 6개월', months: 6 },
                  { label: '최근 1년',   months: 12 },
                  { label: '최근 2년',   months: 24 },
                ].map(p => (
                  <button key={p.label} type="button"
                    onClick={() => {
                      const d = new Date(); d.setMonth(d.getMonth() - p.months);
                      setRangeFrom(d.toISOString().slice(0, 10));
                      setRangeTo(new Date().toISOString().slice(0, 10));
                    }}
                    className="px-2 py-1 text-[10px] rounded bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)]">
                    {p.label}
                  </button>
                ))}
              </div>
              <button onClick={handleRangeSync} disabled={syncing}
                className="ml-auto px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
                {syncing ? '동기화 중...' : '이 기간 sync'}
              </button>
            </div>
            {rangeProgress && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 text-[11px] text-[var(--primary)] font-semibold">
                ⏳ {rangeProgress}
              </div>
            )}
            <div className="text-[10px] text-[var(--text-dim)] mt-2">
              ⚠ 3개월씩 분할 호출 (Edge Function 150초 timeout 회피). 1년 = 4번, 2년 = 8번 호출.
              <br />
              ⚠ 한국 은행 API 는 등록일 이전 거래를 못 가져올 수 있습니다. 누락분이 계속 있으면 은행 거래내역서를 CSV 로 직접 업로드하세요.
            </div>
          </div>
        )}

        {isConnected ? (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20">
              <p className="text-xs text-green-600 font-semibold">
                {hasCodefConnection && hasHometaxConnection
                  ? "은행/카드 + 홈택스가 모두 연결되었습니다. 거래내역과 세금계산서가 자동으로 수집됩니다."
                  : hasCodefConnection
                    ? "은행/카드가 연결되었습니다. 거래내역이 자동으로 수집됩니다."
                    : "홈택스가 연결되었습니다. 세금계산서가 자동으로 수집됩니다."}
              </p>
              {connectionStatus?.codef_connected_at && (
                <p className="text-[10px] text-[var(--text-dim)] mt-1">은행/카드 연결일: {new Date(connectionStatus.codef_connected_at).toLocaleDateString("ko-KR")}</p>
              )}
              {hasHometaxConnection && connectionStatus?.hometax_registered_at && (
                <p className="text-[10px] text-[var(--text-dim)]">
                  홈택스 연결일: {new Date(connectionStatus.hometax_registered_at).toLocaleDateString("ko-KR")}
                  {connectionStatus.hometax_method === "certificate" && " (공동인증서)"}
                  {connectionStatus.hometax_method === "id_pw" && " (ID/PW)"}
                </p>
              )}
            </div>

            {/* 연결된 계좌 목록 */}
            {loadingAccounts ? (
              <div className="text-center py-4 text-xs text-[var(--text-muted)]">계좌 정보 불러오는 중...</div>
            ) : (
              <>
                {codefAccounts.bank.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] mb-2">연결된 은행 계좌</h3>
                    <div className="space-y-1.5">
                      {codefAccounts.bank.map((acc: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">B</div>
                            <div>
                              <div className="text-sm font-medium">{acc.displayName || acc.resAccountName || acc.organization || "계좌"}</div>
                              <div className="text-xs text-[var(--text-dim)]">{acc.resAccount || acc.resAccountDisplay || acc.organization || ""}</div>
                            </div>
                          </div>
                          {acc.resAccountBalance && (
                            <div className="text-sm font-bold">{Number(acc.resAccountBalance).toLocaleString()}원</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {codefAccounts.card.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] mb-2">연결된 카드</h3>
                    <div className="space-y-1.5">
                      {codefAccounts.card.map((card: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 text-xs font-bold">C</div>
                            <div>
                              <div className="text-sm font-medium">{card.displayName || card.resCardName || card.organization || "카드"}</div>
                              <div className="text-xs text-[var(--text-dim)]">{card.resCardNo || card.organization || ""}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {codefAccounts.bank.length === 0 && codefAccounts.card.length === 0 && (
                  <p className="text-xs text-[var(--text-dim)] text-center py-2">연결된 계좌/카드 정보를 불러올 수 없습니다. 아래에서 추가로 연결하세요.</p>
                )}
              </>
            )}

            {syncResult && (
              // P0-C: CODEF 연결 에러 친절도 — code 별로 사용자 언어 안내 + 다음
              //   액션 버튼. 작은 회색 hint 한 줄에 묻혀 사용자가 "무엇을 하면 되는지"
              //   모르던 문제 해소. codefErrorHint() 가 만든 메시지를 큰 박스로 노출.
              <div className={`p-3 rounded-xl text-xs font-medium ${syncResult.ok ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
                <div>{syncResult.msg}</div>
                {syncResult.errors && syncResult.errors.length > 0 && (
                  <ul className="mt-3 space-y-2 text-xs font-normal">
                    {syncResult.errors.map((e: any, idx: number) => (
                      <CodefErrorCard key={idx} item={e} onRetry={handleSync} retrying={syncing} />
                    ))}
                  </ul>
                )}
                {syncResult.notes && syncResult.notes.length > 0 && (
                  <div className="mt-3 p-2.5 rounded-xl bg-blue-500/8 border border-blue-500/15">
                    <div className="text-xs font-semibold text-blue-600 dark:text-blue-300 mb-1.5">
                      💡 CODEF 설정 안내 {syncResult.notes.length}건
                    </div>
                    <ul className="space-y-1.5 text-[11px] font-normal text-[var(--text-muted)]">
                      {syncResult.notes.map((n: any, idx: number) => (
                        <li key={idx} className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                          <div className="font-semibold text-[var(--text)] text-xs">{n.accountNo || n.organization}</div>
                          <div className="mt-0.5">{n.hint || n.message}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {recentSyncLogs.length > 0 && (
              <div className="mt-2 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold">최근 CODEF 동기화 이력</div>
                  <button onClick={loadRecentSyncLogs} className="text-[10px] text-[var(--primary)] hover:underline">새로고침</button>
                </div>
                <ul className="space-y-1.5">
                  {recentSyncLogs.map((log) => {
                    const errorCount = Number(log.details?.errorCount ?? 0);
                    const dot =
                      log.status === "success" ? "bg-green-500" : log.status === "partial" ? "bg-yellow-500" : "bg-red-500";
                    return (
                      <li key={log.id} className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                          <span className="text-[var(--text-muted)] truncate">
                            {new Date(log.created_at).toLocaleString("ko-KR")}
                          </span>
                          <span className="text-[var(--text-dim)]">· {log.sync_type}</span>
                        </div>
                        <div className="text-[var(--text-muted)] whitespace-nowrap">
                          {log.status === "success" ? "정상" : log.status === "partial" ? `부분 (오류 ${errorCount})` : `실패 (오류 ${errorCount})`}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-dim)]">아래에서 은행 또는 카드를 연결하면 거래내역이 자동으로 수집됩니다.</p>
        )}
      </div>

      {/* 금융기관 연결 (계정 등록) — 항상 표시 */}
      <CodefAccountRegister companyId={companyId} onRegistered={() => { refetchConnection(); }} />

      {/* 수동 등록 계좌 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">수동 등록 계좌</h2>
        {bankAccounts.length === 0 ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]">등록된 계좌가 없습니다. 일반 설정에서 통장을 추가하세요.</div>
        ) : (
          <div className="space-y-2">
            {bankAccounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] text-xs font-bold">B</div>
                  <div>
                    <div className="text-sm font-medium">{acc.alias || acc.bank_name}</div>
                    <div className="text-xs text-[var(--text-dim)]">{acc.bank_name} {acc.account_number}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">{Number(acc.balance || 0).toLocaleString()}원</div>
                  <div className="text-[10px] text-[var(--text-dim)]">{BANK_ROLES.find(r => r.value === acc.role)?.label || acc.role}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이체 자동화 설정 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">이체 자동화 설정</h2>
        <div className="space-y-4">
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
            <div><div className="text-sm font-medium">승인완료 건 자동이체</div><div className="text-xs text-[var(--text-dim)] mt-0.5">결재 승인 완료 시 자동 이체 실행</div></div>
            <input type="checkbox" checked={settings.auto_transfer_enabled} onChange={(e) => setSettings({ ...settings, auto_transfer_enabled: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">자동이체 한도 (원)</label><input type="number" value={settings.auto_transfer_limit} onChange={(e) => setSettings({ ...settings, auto_transfer_limit: Number(e.target.value) || 0 })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /><p className="text-[10px] text-[var(--text-dim)] mt-1">초과 금액은 수동 확인 필요</p></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">이체 실행 시점</label><select value={settings.transfer_schedule} onChange={(e) => setSettings({ ...settings, transfer_schedule: e.target.value })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"><option value="immediate">즉시 실행</option><option value="daily_10">매일 10:00</option><option value="daily_14">매일 14:00</option><option value="weekly_mon">매주 월요일</option></select></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">실패 시 재시도</label><input type="number" value={settings.retry_count} onChange={(e) => setSettings({ ...settings, retry_count: Number(e.target.value) || 0 })} min={0} max={10} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">재시도 간격 (시간)</label><input type="number" value={settings.retry_interval_hours} onChange={(e) => setSettings({ ...settings, retry_interval_hours: Number(e.target.value) || 1 })} min={1} max={24} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
          </div>
          <div className="mt-2 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="text-sm font-medium mb-1">대표 텔레그램 승인 알림</div>
            <p className="text-[11px] text-[var(--text-dim)] mb-3">자동이체 한도 초과 결제는 여기서 등록한 텔레그램으로 승인 요청이 전송됩니다. <a href="https://t.me/motive_hajun_bot" target="_blank" rel="noreferrer" className="underline text-[var(--primary)]">@motive_hajun_bot</a>에게 <code>/start</code>를 입력하면 Chat ID가 발급됩니다.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={settings.ceo_telegram_chat_id} onChange={(e) => setSettings({ ...settings, ceo_telegram_chat_id: e.target.value })} placeholder="예: 1234567890" className="flex-1 px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              <button type="button" disabled={sendingTelegramTest || !settings.ceo_telegram_chat_id.trim()} onClick={async () => {
                setSendingTelegramTest(true); setTelegramTestResult(null);
                try {
                  const m = await import("@/lib/telegram");
                  const res = await m.sendTelegramMessage({ chatId: settings.ceo_telegram_chat_id.trim(), message: "[오너뷰] 테스트 — 자동이체 승인 알림이 이 채널로 전송됩니다." });
                  setTelegramTestResult({ ok: !!res.success, msg: res.success ? "테스트 메시지 전송됨" : (res.error || "전송 실패") });
                } finally { setSendingTelegramTest(false); }
              }} className="px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs font-semibold hover:bg-[var(--bg-surface)] disabled:opacity-50">{sendingTelegramTest ? "전송중..." : "테스트 발송"}</button>
            </div>
            {telegramTestResult && (
              <div className={`mt-2 text-xs ${telegramTestResult.ok ? "text-green-400" : "text-red-400"}`}>{telegramTestResult.ok ? "✅ " : "⚠️ "}{telegramTestResult.msg}</div>
            )}
          </div>
        </div>
      </div>
      <button onClick={saveSettings} className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">{saved ? "저장 완료" : "은행연동 설정 저장"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════
// Tax Automation Tab
// ═══════════════════════════════════════════
function TaxAutomationTab({ companyId }: { companyId: string | null }) {
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({ auto_issue_on_deal_close: true, auto_issue_on_payment: false, auto_email_send: false, issue_schedule: "immediate", auto_cancel_on_refund: true, auto_cancel_on_deal_cancel: true, vat_auto_aggregate: true, advance_ratio: 30, matching_tolerance: 1 });
  const { data: companySettings } = useQuery({
    queryKey: ["tax-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("tax_settings").eq("id", companyId).maybeSingle(); return data?.tax_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => {
    if (!companySettings) return;
    // 알려진 필드만 추려서 적용 — 죽은 hometax_* 필드는 무시
    setSettings((prev) => ({
      ...prev,
      auto_issue_on_deal_close: companySettings.auto_issue_on_deal_close ?? prev.auto_issue_on_deal_close,
      auto_issue_on_payment: companySettings.auto_issue_on_payment ?? prev.auto_issue_on_payment,
      auto_email_send: companySettings.auto_email_send ?? prev.auto_email_send,
      issue_schedule: companySettings.issue_schedule ?? prev.issue_schedule,
      auto_cancel_on_refund: companySettings.auto_cancel_on_refund ?? prev.auto_cancel_on_refund,
      auto_cancel_on_deal_cancel: companySettings.auto_cancel_on_deal_cancel ?? prev.auto_cancel_on_deal_cancel,
      vat_auto_aggregate: companySettings.vat_auto_aggregate ?? prev.vat_auto_aggregate,
      advance_ratio: companySettings.advance_ratio ?? prev.advance_ratio,
      matching_tolerance: companySettings.matching_tolerance ?? prev.matching_tolerance,
    }));
  }, [companySettings]);
  async function saveTaxSettings() {
    if (!companyId) return;
    // 기존 tax_settings 와 머지하여 다른 키(예: 외부 시스템에서 쓰는 값)는 보존
    const merged = { ...(companySettings || {}), ...settings };
    // 죽은 hometax 필드는 명시적으로 제거 (사용자 혼란 방지)
    delete (merged as any).hometax_id;
    delete (merged as any).hometax_password;
    delete (merged as any).hometax_login_method;
    delete (merged as any).hometax_cert_password;
    await db2.from("companies").update({ tax_settings: merged }).eq("id", companyId);
    queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  const Tog = ({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
      <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-[var(--text-dim)] mt-0.5">{desc}</div></div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 rounded accent-[var(--primary)]" />
    </label>
  );
  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">세금계산서 자동발행</h2>
        <div className="space-y-3">
          <Tog label="딜 완료 시 자동발행" desc="계약 완료 시 매출 세금계산서 자동 생성" checked={settings.auto_issue_on_deal_close} onChange={(v) => setSettings({ ...settings, auto_issue_on_deal_close: v })} />
          <Tog label="결제 완료 시 자동발행" desc="이체 완료 시 매입 세금계산서 자동 생성" checked={settings.auto_issue_on_payment} onChange={(v) => setSettings({ ...settings, auto_issue_on_payment: v })} />
          <Tog label="자동 이메일 발송" desc="발행된 세금계산서를 거래처에 자동 전송" checked={settings.auto_email_send} onChange={(v) => setSettings({ ...settings, auto_email_send: v })} />
          <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">발행 주기</label><select value={settings.issue_schedule} onChange={(e) => setSettings({ ...settings, issue_schedule: e.target.value })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"><option value="immediate">거래 즉시</option><option value="weekly">매주 월요일</option><option value="monthly">매월 말일</option></select></div>
        </div>
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">취소/수정 규칙</h2>
        <div className="space-y-3">
          <Tog label="환불 시 수정세금계산서" desc="환불 발생 시 수정본 자동 발행" checked={settings.auto_cancel_on_refund} onChange={(v) => setSettings({ ...settings, auto_cancel_on_refund: v })} />
          <Tog label="계약 취소 시 자동 취소" desc="딜 취소 시 관련 세금계산서 void 처리" checked={settings.auto_cancel_on_deal_cancel} onChange={(v) => setSettings({ ...settings, auto_cancel_on_deal_cancel: v })} />
        </div>
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">결제/매칭 설정</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">선금 비율 (%)</label>
            <p className="text-[10px] text-[var(--text-dim)] mb-1">계약 승인 시 선금/잔금 자동 분할 비율 (예: 30 → 선금 30%, 잔금 70%)</p>
            <input type="number" min="0" max="100" value={settings.advance_ratio} onChange={(e) => setSettings({ ...settings, advance_ratio: Number(e.target.value) || 30 })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">3-way 매칭 허용오차 (%)</label>
            <p className="text-[10px] text-[var(--text-dim)] mb-1">계약↔세금계산서↔입금 비교 시 허용할 금액 차이 비율</p>
            <input type="number" min="0" max="10" step="0.1" value={settings.matching_tolerance} onChange={(e) => setSettings({ ...settings, matching_tolerance: Number(e.target.value) || 1 })} className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
          </div>
        </div>
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-lg">🏛️</div>
          <div>
            <h2 className="text-sm font-bold">홈택스 연동</h2>
            <p className="text-xs text-[var(--text-dim)]">국세청 홈택스와 연동하여 세금계산서 자동 조회</p>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            홈택스 인증정보 등록은 <b className="text-[var(--text)]">설정 &gt; 은행연동 탭 → 금융기관 연결 → 홈택스</b>에서 통합 관리합니다.
            (공동인증서 또는 ID/PW 방식 모두 지원)
          </p>
          <a
            href="?tab=bank"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-2 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 border border-[var(--primary)]/30 rounded-lg text-xs font-semibold text-[var(--primary)] transition"
          >
            은행연동 탭으로 이동 →
          </a>
        </div>
        <label className="flex items-center gap-2 mt-4 text-xs text-[var(--text-muted)]"><input type="checkbox" checked={settings.vat_auto_aggregate} onChange={(e) => setSettings({ ...settings, vat_auto_aggregate: e.target.checked })} className="rounded" /> 부가세 자동 집계 (매 분기별)</label>
      </div>
      <button onClick={saveTaxSettings} className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">{saved ? "저장 완료" : "세무자동화 설정 저장"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════
// Certificate Finder Section — PC/USB 인증서 자동 탐색
// ═══════════════════════════════════════════

function CertFinderSection({ certDerRef, certKeyRef, certFileStatus, certUploading, onUpload }: {
  certDerRef: React.RefObject<HTMLInputElement | null>;
  certKeyRef: React.RefObject<HTMLInputElement | null>;
  certFileStatus: { der: boolean; key: boolean };
  certUploading: boolean;
  onUpload: () => void;
}) {
  const [certSource, setCertSource] = useState<"auto" | "manual" | null>(null);
  const [scanning, setScanning] = useState(false);
  const [foundCerts, setFoundCerts] = useState<{ name: string; derFile: File; keyFile: File | null }[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedCert, setSelectedCert] = useState<number | null>(null);

  // File System Access API를 사용한 인증서 자동 탐색
  async function scanForCerts() {
    setScanning(true);
    setScanError(null);
    setFoundCerts([]);
    setSelectedCert(null);

    try {
      // Check if File System Access API is available
      if (!('showDirectoryPicker' in window)) {
        setScanError("이 브라우저에서는 폴더 자동 탐색을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 사용하거나, 아래 '직접 선택' 방식을 이용해주세요.");
        setScanning(false);
        return;
      }

      const dirHandle = await (window as any).showDirectoryPicker({ mode: "read" });
      const certs: { name: string; derFile: File; keyFile: File | null }[] = [];

      async function scanDir(handle: any, depth: number, path: string) {
        if (depth > 5) return;
        try {
          const entries: { kind: string; name: string; entry: any }[] = [];
          for await (const entry of handle.values()) {
            entries.push({ kind: entry.kind, name: entry.name, entry });
          }
          for (const { kind, name, entry } of entries) {
            if (kind === "directory") {
              await scanDir(entry, depth + 1, `${path}/${name}`);
            } else if (kind === "file" && name.toLowerCase() === "signcert.der") {
              const derFile = await entry.getFile();
              let keyFile: File | null = null;
              const keyEntry = entries.find(e => e.kind === "file" && e.name.toLowerCase() === "signpri.key");
              if (keyEntry) {
                keyFile = await keyEntry.entry.getFile();
              }
              certs.push({ name: path || dirHandle.name, derFile, keyFile });
            }
          }
        } catch { /* permission denied */ }
      }

      await scanDir(dirHandle, 0, "");

      if (certs.length === 0) {
        const isMac = navigator.platform?.toLowerCase().includes("mac");
        setScanError(isMac
          ? "선택한 폴더에서 인증서 파일을 찾을 수 없습니다. macOS에서는 보안 정책으로 일부 폴더(Library 등) 접근이 제한될 수 있습니다. 인증서 파일(signCert.der, signPri.key)을 바탕화면 또는 다운로드 폴더에 복사한 뒤 다시 시도하거나, 아래 '직접 선택' 방식을 이용해주세요."
          : "선택한 폴더에서 인증서 파일(signCert.der)을 찾을 수 없습니다. 다른 폴더를 선택하거나 '직접 선택'을 이용해주세요.");
      } else {
        setFoundCerts(certs);
        if (certs.length === 1) setSelectedCert(0);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setScanError("폴더 접근 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    }
    setScanning(false);
  }

  // Apply found cert to the file inputs
  function applyFoundCert() {
    if (selectedCert === null || !foundCerts[selectedCert]) return;
    const cert = foundCerts[selectedCert];

    // Create DataTransfer to set files on input elements
    if (certDerRef.current) {
      const dt = new DataTransfer();
      dt.items.add(cert.derFile);
      certDerRef.current.files = dt.files;
    }
    if (cert.keyFile && certKeyRef.current) {
      const dt = new DataTransfer();
      dt.items.add(cert.keyFile);
      certKeyRef.current.files = dt.files;
    }
    onUpload();
  }

  return (
    <div className="space-y-4">
      {/* Step 1: 위치 선택 */}
      {!certSource && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-[var(--text)]">인증서를 어떻게 등록하시겠습니까?</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={() => { setCertSource("auto"); }}
              className="p-4 rounded-xl border-2 border-dashed border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-500/50 transition text-left">
              <div className="text-sm font-bold text-purple-400 mb-1">자동 탐색</div>
              <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                PC나 USB에서 인증서 폴더를 선택하면<br/>자동으로 인증서를 찾아줍니다
              </div>
            </button>
            <button onClick={() => setCertSource("manual")}
              className="p-4 rounded-xl border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--bg-surface)] transition text-left">
              <div className="text-sm font-bold text-[var(--text)] mb-1">직접 선택</div>
              <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                인증서 파일(.der)과 개인키 파일(.key)을<br/>직접 선택하여 업로드합니다
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Auto scan mode */}
      {certSource === "auto" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[var(--text)]">인증서 자동 탐색</div>
            <button onClick={() => { setCertSource(null); setFoundCerts([]); setScanError(null); }} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]">방식 변경</button>
          </div>

          {/* 위치 안내 */}
          <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">인증서가 저장된 폴더를 선택해주세요</div>
            <div className="space-y-1.5 text-[10px] text-[var(--text-dim)]">
              <div className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">PC</span>
                <div>
                  <div>Windows: <span className="font-mono bg-[var(--bg)] px-1 rounded">C:\Users\사용자명\AppData\LocalLow\NPKI</span></div>
                  <div>또는 <span className="font-mono bg-[var(--bg)] px-1 rounded">C:\Program Files\NPKI</span></div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">USB</span>
                <span>USB 드라이브의 <span className="font-mono bg-[var(--bg)] px-1 rounded">NPKI</span> 폴더</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber-400 mt-0.5">Mac</span>
                <span><span className="font-mono bg-[var(--bg)] px-1 rounded">~/Library/Preferences/NPKI</span></span>
              </div>
            </div>
          </div>

          <button onClick={scanForCerts} disabled={scanning}
            className="w-full py-3 rounded-xl text-xs font-bold border transition bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50">
            {scanning ? "폴더를 탐색하고 있습니다..." : "폴더 선택하여 인증서 찾기"}
          </button>

          {scanError && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="text-[11px] text-red-400">{scanError}</div>
            </div>
          )}

          {/* Found certs */}
          {foundCerts.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-green-400">{foundCerts.length}개의 인증서를 발견했습니다</div>
              {foundCerts.map((cert, idx) => (
                <button key={idx} onClick={() => setSelectedCert(idx)}
                  className={`w-full p-3 rounded-xl border text-left transition ${selectedCert === idx ? "bg-purple-500/10 border-purple-500/40" : "bg-[var(--bg-surface)] border-[var(--border)] hover:border-[var(--primary)]"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${selectedCert === idx ? "border-purple-400 bg-purple-400" : "border-[var(--border)]"}`}>
                      {selectedCert === idx && <span className="text-white text-[8px]">V</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{cert.name || "인증서"}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">
                        signCert.der {cert.keyFile ? "+ signPri.key" : "(개인키 없음)"}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              <button onClick={applyFoundCert} disabled={selectedCert === null || certUploading}
                className="w-full py-2.5 rounded-xl text-xs font-semibold border transition bg-purple-600 border-purple-500 text-white hover:bg-purple-700 disabled:opacity-50">
                {certUploading ? "업로드 중..." : "선택한 인증서 등록"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual mode */}
      {certSource === "manual" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[var(--text)]">인증서 직접 선택</div>
            <button onClick={() => setCertSource(null)} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]">방식 변경</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">인증서 파일 (.der)</div>
              <div className="flex items-center gap-2">
                <input ref={certDerRef} type="file" className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-purple-500/10 file:text-purple-400 hover:file:bg-purple-500/20 w-full" />
                {certFileStatus.der && <span className="text-green-400 text-[10px] font-semibold whitespace-nowrap">등록됨</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">개인키 파일 (.key)</div>
              <div className="flex items-center gap-2">
                <input ref={certKeyRef} type="file" className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-purple-500/10 file:text-purple-400 hover:file:bg-purple-500/20 w-full" />
                {certFileStatus.key && <span className="text-green-400 text-[10px] font-semibold whitespace-nowrap">등록됨</span>}
              </div>
            </div>
          </div>
          <button onClick={onUpload} disabled={certUploading}
            className="w-full py-2.5 rounded-xl text-xs font-semibold border transition bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50">
            {certUploading ? "업로드 중..." : "인증서 업로드"}
          </button>
        </div>
      )}

      {/* 등록 상태 */}
      {(certFileStatus.der || certFileStatus.key) && (
        <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="text-[10px] text-green-400 font-semibold">
            {certFileStatus.der && certFileStatus.key ? "인증서 + 개인키 모두 등록됨" : certFileStatus.der ? "인증서만 등록됨 (개인키 필요)" : "개인키만 등록됨 (인증서 필요)"}
          </div>
        </div>
      )}
      <p className="text-[10px] text-[var(--text-dim)]">
        인증서 파일은 암호화되어 안전하게 보관됩니다. 홈택스/은행 자동화 시 사용됩니다.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════
// Certificate Management Tab
// ═══════════════════════════════════════════

function CertificateManagementTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const BANK_LIST = [
    { value: "ibk", label: "IBK 기업은행" },
    { value: "kb", label: "KB 국민은행" },
    { value: "shinhan", label: "신한은행" },
    { value: "hana", label: "하나은행" },
    { value: "woori", label: "우리은행" },
    { value: "nh", label: "NH 농협은행" },
    { value: "kdb", label: "KDB 산업은행" },
    { value: "sc", label: "SC 제일은행" },
    { value: "daegu", label: "대구은행" },
    { value: "busan", label: "부산은행" },
    { value: "kwangju", label: "광주은행" },
    { value: "suhyup", label: "수협은행" },
  ];
  const CARD_LIST = [
    { value: "lottecard", label: "롯데카드" },
    { value: "samsung", label: "삼성카드" },
    { value: "hyundai", label: "현대카드" },
    { value: "shinhan", label: "신한카드" },
    { value: "kb", label: "KB국민카드" },
    { value: "hana", label: "하나카드" },
    { value: "woori", label: "우리카드" },
    { value: "bc", label: "BC카드" },
    { value: "nh", label: "NH농협카드" },
    { value: "ibkcard", label: "IBK기업은행카드" },
  ];
  type ServiceEntry = { company: string; login_id: string; login_password: string; cert_password?: string };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [banks, setBanks] = useState<ServiceEntry[]>([]);
  const [cards, setCards] = useState<ServiceEntry[]>([]);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [autoSign, setAutoSign] = useState({ auto_sign_tax_invoice: true, auto_sign_bank_transfer: true });
  const [hometaxMethod, setHometaxMethod] = useState<"certificate" | "id_pw">("certificate");
  const [hometaxCert, setHometaxCert] = useState("");
  const [hometaxId, setHometaxId] = useState("");
  const [hometaxPw, setHometaxPw] = useState("");

  // NPKI 인증서 파일 업로드
  const [certUploading, setCertUploading] = useState(false);
  const [certFileStatus, setCertFileStatus] = useState<{ der: boolean; key: boolean }>({ der: false, key: false });
  const certDerRef = useRef<HTMLInputElement>(null);
  const certKeyRef = useRef<HTMLInputElement>(null);

  // 인증서 파일 존재 여부 확인
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data: derList } = await supabase.storage.from("certificates").list(companyId, { search: "signCert.der" });
      const { data: keyList } = await supabase.storage.from("certificates").list(companyId, { search: "signPri.key" });
      setCertFileStatus({
        der: (derList || []).some((f: any) => f.name === "signCert.der"),
        key: (keyList || []).some((f: any) => f.name === "signPri.key"),
      });
    })();
  }, [companyId]);

  async function uploadCertFiles() {
    if (!companyId) return;
    const derFile = certDerRef.current?.files?.[0];
    const keyFile = certKeyRef.current?.files?.[0];
    if (!derFile && !keyFile) { toast("업로드할 파일을 선택해주세요.", "error"); return; }
    setCertUploading(true);
    try {
      if (derFile) {
        const { error } = await supabase.storage.from("certificates").upload(`${companyId}/signCert.der`, derFile, { upsert: true });
        if (error) throw new Error("인증서 파일 업로드 실패: " + error.message);
      }
      if (keyFile) {
        const { error } = await supabase.storage.from("certificates").upload(`${companyId}/signPri.key`, keyFile, { upsert: true });
        if (error) throw new Error("개인키 파일 업로드 실패: " + error.message);
      }
      // automation_credentials에 인증서 경로 저장
      await db2.from("automation_credentials").upsert({
        company_id: companyId,
        service: "npki_cert",
        credentials: {
          cert_path: `${companyId}/signCert.der`,
          key_path: `${companyId}/signPri.key`,
          uploaded_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,service" });
      setCertFileStatus({
        der: derFile ? true : certFileStatus.der,
        key: keyFile ? true : certFileStatus.key,
      });
      if (certDerRef.current) certDerRef.current.value = "";
      if (certKeyRef.current) certKeyRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["automation-credentials"] });
      toast("인증서 파일이 업로드되었습니다.", "success");
    } catch (err: any) {
      console.error("cert upload error:", err);
      toast(friendlyError(err, "업로드 실패"), "error");
    } finally { setCertUploading(false); }
  }

  // 인증정보 조회
  const { data: creds = [] } = useQuery({
    queryKey: ["automation-credentials", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data } = await db2.from("automation_credentials").select("*").eq("company_id", companyId);
      return data || [];
    },
    enabled: !!companyId,
  });

  // 자동서명 설정
  const { data: certSettings } = useQuery({
    queryKey: ["cert-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("cert_settings").eq("id", companyId).maybeSingle(); return data?.cert_settings || {}; },
    enabled: !!companyId,
  });

  useEffect(() => { if (certSettings) setAutoSign((prev) => ({ ...prev, ...certSettings })); }, [certSettings]);

  // 기존값 초기화 (decrypt encrypted credentials)
  useEffect(() => {
    if (creds.length === 0) return;

    async function loadDecrypted() {
      // Helper to decrypt a credentials object, falling back gracefully
      async function tryDecrypt(c: Record<string, unknown>): Promise<Record<string, any>> {
        try {
          return await decryptJsonCredentials(c) as Record<string, any>;
        } catch {
          return c as Record<string, any>;
        }
      }

      // 은행 목록
      const bankEntries = creds.filter((c: any) => c.service?.startsWith("bank_"));
      if (bankEntries.length > 0) {
        const decryptedBanks = await Promise.all(bankEntries.map(async (b: any) => {
          const dec = b.credentials ? await tryDecrypt(b.credentials) : {};
          return {
            company: b.service.replace("bank_", "").replace(/_\d+$/, ""),
            login_id: dec.login_id || "",
            login_password: dec.login_password || "",
            cert_password: dec.cert_password || "",
          };
        }));
        setBanks(decryptedBanks);
      }

      // 카드 목록
      const cardEntries = creds.filter((c: any) => c.service?.startsWith("card_"));
      if (cardEntries.length > 0) {
        const decryptedCards = await Promise.all(cardEntries.map(async (c: any) => {
          const dec = c.credentials ? await tryDecrypt(c.credentials) : {};
          return {
            company: c.service.replace("card_", "").replace(/_\d+$/, ""),
            login_id: dec.login_id || "",
            login_password: dec.login_password || "",
            cert_password: dec.cert_password || "",
          };
        }));
        setCards(decryptedCards);
      }

      // 홈택스
      const ht = creds.find((c: any) => c.service === "hometax");
      if (ht?.credentials) {
        const dec = await tryDecrypt(ht.credentials);
        if (dec.login_method) setHometaxMethod(dec.login_method);
        else if (dec.cert_password && !dec.login_id) setHometaxMethod("certificate");
        else if (dec.login_id) setHometaxMethod("id_pw");
        if (dec.cert_password) setHometaxCert(dec.cert_password);
        if (dec.login_id) setHometaxId(dec.login_id);
        if (dec.login_password) setHometaxPw(dec.login_password);
      }

      // 레거시: 기존 ibk/hometax/lottecard 데이터 마이그레이션
      const ibk = creds.find((c: any) => c.service === "ibk");
      const lc = creds.find((c: any) => c.service === "lottecard");
      if (ibk?.credentials?.cert_password && bankEntries.length === 0) {
        const dec = await tryDecrypt(ibk.credentials);
        setBanks([{ company: "ibk", login_id: "", login_password: "", cert_password: dec.cert_password || "" }]);
      }
      if (lc?.credentials?.login_id && cardEntries.length === 0) {
        const dec = await tryDecrypt(lc.credentials);
        setCards([{ company: "lottecard", login_id: dec.login_id || "", login_password: dec.login_password || "" }]);
      }
    }

    loadDecrypted();
  }, [creds]);

  function addBank() { setBanks([...banks, { company: "ibk", login_id: "", login_password: "", cert_password: "" }]); }
  function removeBank(i: number) { setBanks(banks.filter((_, idx) => idx !== i)); }
  function updateBank(i: number, field: string, val: string) { setBanks(banks.map((b, idx) => idx === i ? { ...b, [field]: val } : b)); }
  function addCard() { setCards([...cards, { company: "lottecard", login_id: "", login_password: "", cert_password: "" }]); }
  function removeCard(i: number) { setCards(cards.filter((_, idx) => idx !== i)); }
  function updateCard(i: number, field: string, val: string) { setCards(cards.map((c, idx) => idx === i ? { ...c, [field]: val } : c)); }

  async function saveAll() {
    if (!companyId) return;
    setSaving(true);
    try {
      // Supabase 에러 체크 헬퍼
      function check<T>(result: { data: T; error: any }, label: string): T {
        if (result.error) throw new Error(`${label}: ${result.error.message}`);
        return result.data;
      }

      // 기존 은행/카드 인증정보 삭제 후 다시 저장
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).like("service", "bank_%"), "은행 삭제");
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).like("service", "card_%"), "카드 삭제");
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).eq("service", "hometax"), "홈택스 삭제");
      // 레거시 데이터도 정리
      check(await db2.from("automation_credentials").delete().eq("company_id", companyId).in("service", ["ibk", "lottecard"]), "레거시 삭제");

      // 은행 저장 (encrypt sensitive fields server-side)
      for (let i = 0; i < banks.length; i++) {
        const b = banks[i];
        if (!b.cert_password && !b.login_id) continue;
        const bankCreds: Record<string, string> = { bank_name: b.company, login_id: b.login_id };
        if (b.login_password) bankCreds.login_password = (await encryptCredential(b.login_password)) || "";
        if (b.cert_password) bankCreds.cert_password = (await encryptCredential(b.cert_password)) || "";
        check(await db2.from("automation_credentials").insert({
          company_id: companyId,
          service: `bank_${b.company}_${i}`,
          credentials: bankCreds,
          updated_at: new Date().toISOString(),
        }), `은행 ${b.company} 저장`);
      }

      // 카드 저장 (encrypt sensitive fields server-side)
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (!c.login_id && !c.cert_password) continue;
        const cardCreds: Record<string, string> = { card_company: c.company, login_id: c.login_id };
        if (c.login_password) cardCreds.login_password = (await encryptCredential(c.login_password)) || "";
        if (c.cert_password) cardCreds.cert_password = (await encryptCredential(c.cert_password)) || "";
        check(await db2.from("automation_credentials").insert({
          company_id: companyId,
          service: `card_${c.company}_${i}`,
          credentials: cardCreds,
          updated_at: new Date().toISOString(),
        }), `카드 ${c.company} 저장`);
      }

      // 홈택스 독립 저장 (encrypt sensitive fields server-side)
      const hometaxCreds: Record<string, string> = { login_method: hometaxMethod };
      if (hometaxMethod === "certificate" && hometaxCert) {
        hometaxCreds.cert_password = (await encryptCredential(hometaxCert)) || "";
      } else if (hometaxMethod === "id_pw" && hometaxId) {
        hometaxCreds.login_id = hometaxId;
        if (hometaxPw) hometaxCreds.login_password = (await encryptCredential(hometaxPw)) || "";
      }
      if (hometaxCert || hometaxId) {
        check(await db2.from("automation_credentials").upsert({
          company_id: companyId, service: "hometax",
          credentials: hometaxCreds,
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,service" }), "홈택스 저장");
      }

      // 자동서명 설정
      check(await db2.from("companies").update({ cert_settings: autoSign }).eq("id", companyId), "자동서명 설정");

      queryClient.invalidateQueries({ queryKey: ["automation-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["cert-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error("credential save error:", err);
      toast("저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally { setSaving(false); }
  }

  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;

  return (
    <div className="space-y-6">
      {/* 안내 */}
      <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
        <div className="text-sm font-semibold text-[var(--text)] mb-1">인증서 & 자동화 설정</div>
        <p className="text-xs text-[var(--text-muted)]">
          은행, 홈택스, 카드 로그인 정보를 등록하면 거래내역과 세금계산서가 자동으로 수집됩니다.
          공동인증서 파일(.der, .key)을 업로드하고 비밀번호를 등록하면 자동화가 활성화됩니다.
        </p>
      </div>

      {/* 공동인증서 파일 업로드 — 위치 자동 탐색 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-lg">📜</div>
          <div>
            <div className="text-sm font-bold">공동인증서 (NPKI)</div>
            <div className="text-[11px] text-[var(--text-dim)]">홈택스, 은행 자동화에 필요한 공동인증서 파일</div>
          </div>
        </div>

        {/* 인증서 위치 안내 + 자동 탐색 */}
        <CertFinderSection
          certDerRef={certDerRef}
          certKeyRef={certKeyRef}
          certFileStatus={certFileStatus}
          certUploading={certUploading}
          onUpload={uploadCertFiles}
        />
      </div>

      {/* 은행 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-lg">🏦</div>
            <div>
              <div className="text-sm font-bold">은행 계좌</div>
              <div className="text-[11px] text-[var(--text-dim)]">거래내역 자동 수집 + 홈택스 세금계산서</div>
            </div>
          </div>
          <button onClick={addBank} className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 은행 추가</button>
        </div>
        {banks.length === 0 ? (
          <button onClick={addBank} className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition">
            은행을 추가하세요
          </button>
        ) : (
          <div className="space-y-4">
            {banks.map((b, i) => {
              const bankLoginMethod = (b as any).login_method || (b.cert_password && !b.login_id ? "certificate" : b.login_id ? "id_pw" : "certificate");
              return (
              <div key={i} className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] space-y-3">
                <div className="flex items-center gap-2">
                  <select value={b.company} onChange={(e) => updateBank(i, "company", e.target.value)}
                    className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {BANK_LIST.map((bk) => <option key={bk.value} value={bk.value}>{bk.label}</option>)}
                  </select>
                  <button onClick={() => removeBank(i)} className="px-2 py-2 text-red-400/60 hover:text-red-400 text-xs">삭제</button>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">로그인 방식</div>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => { const arr = [...banks]; (arr[i] as any).login_method = "certificate"; setBanks(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${bankLoginMethod === "certificate" ? "bg-purple-500/10 border-purple-500/50 text-purple-400" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    📜 공동인증서
                  </button>
                  <button onClick={() => { const arr = [...banks]; (arr[i] as any).login_method = "id_pw"; setBanks(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${bankLoginMethod === "id_pw" ? "bg-blue-500/10 border-blue-500/50 text-blue-400" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    🔑 아이디/비밀번호
                  </button>
                </div>
                {bankLoginMethod === "certificate" ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <input type={showPw[`bank_cert_${i}`] ? "text" : "password"} value={b.cert_password || ""} onChange={(e) => updateBank(i, "cert_password", e.target.value)}
                        placeholder="공동인증서 비밀번호" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`bank_cert_${i}`]: !p[`bank_cert_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`bank_cert_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-dim)]">상단에 등록된 공동인증서를 사용합니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input type="text" value={b.login_id} onChange={(e) => updateBank(i, "login_id", e.target.value)} placeholder="인터넷뱅킹 아이디"
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <div className="relative">
                      <input type={showPw[`bank_pw_${i}`] ? "text" : "password"} value={b.login_password} onChange={(e) => updateBank(i, "login_password", e.target.value)} placeholder="비밀번호"
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`bank_pw_${i}`]: !p[`bank_pw_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`bank_pw_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 홈택스 (레거시 — 신규 등록은 위의 "금융기관 연결" 섹션에서 "홈택스" 선택) */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-lg">🏛️</div>
          <div>
            <div className="text-sm font-bold">홈택스 (레거시 입력)</div>
            <div className="text-[11px] text-[var(--text-dim)]">세금계산서 자동 조회 · 인증서 또는 ID/PW 선택</div>
          </div>
        </div>
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700">
          ⚠️ 이 입력은 더 이상 동기화에 사용되지 않습니다. 홈택스 연동은 <b>'은행연동' 탭 → 금융기관 연결 → 홈택스</b> 버튼으로 등록하세요.
        </div>
        <div className="mb-3">
          <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-2">로그인 방식</div>
          <div className="flex gap-2">
            <button onClick={() => setHometaxMethod("certificate")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition ${hometaxMethod === "certificate" ? "bg-green-500/10 border-green-500/50 text-green-400" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
              📜 공동인증서
            </button>
            <button onClick={() => setHometaxMethod("id_pw")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition ${hometaxMethod === "id_pw" ? "bg-blue-500/10 border-blue-500/50 text-blue-400" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
              🔑 아이디/비밀번호
            </button>
          </div>
        </div>
        {hometaxMethod === "certificate" ? (
          <div className="relative">
            <input type={showPw["hometax_cert"] ? "text" : "password"} value={hometaxCert} onChange={(e) => setHometaxCert(e.target.value)}
              placeholder="공동인증서 비밀번호" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
            <button type="button" onClick={() => setShowPw((p) => ({ ...p, hometax_cert: !p.hometax_cert }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
              {showPw["hometax_cert"] ? "숨기기" : "보기"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={hometaxId} onChange={(e) => setHometaxId(e.target.value)} placeholder="홈택스 ID"
              className="px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
            <div className="relative">
              <input type={showPw["hometax_pw"] ? "text" : "password"} value={hometaxPw} onChange={(e) => setHometaxPw(e.target.value)} placeholder="비밀번호"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
              <button type="button" onClick={() => setShowPw((p) => ({ ...p, hometax_pw: !p.hometax_pw }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                {showPw["hometax_pw"] ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
        )}
        <p className="text-[10px] text-[var(--text-dim)] mt-2">세무자동화 탭에서도 동일하게 설정할 수 있습니다</p>
      </div>

      {/* 카드 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-lg">💳</div>
            <div>
              <div className="text-sm font-bold">법인카드</div>
              <div className="text-[11px] text-[var(--text-dim)]">카드 이용내역 자동 수집</div>
            </div>
          </div>
          <button onClick={addCard} className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 카드 추가</button>
        </div>
        {cards.length === 0 ? (
          <button onClick={addCard} className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition">
            카드를 추가하세요
          </button>
        ) : (
          <div className="space-y-4">
            {cards.map((c, i) => {
              const cardLoginMethod = (c as any).login_method || (c.cert_password && !c.login_id ? "certificate" : c.login_id ? "id_pw" : "certificate");
              return (
              <div key={i} className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] space-y-3">
                <div className="flex items-center gap-2">
                  <select value={c.company} onChange={(e) => updateCard(i, "company", e.target.value)}
                    className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {CARD_LIST.map((cd) => <option key={cd.value} value={cd.value}>{cd.label}</option>)}
                  </select>
                  <button onClick={() => removeCard(i)} className="px-2 py-2 text-red-400/60 hover:text-red-400 text-xs">삭제</button>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] font-semibold mb-1">로그인 방식</div>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => { const arr = [...cards]; (arr[i] as any).login_method = "certificate"; setCards(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${cardLoginMethod === "certificate" ? "bg-purple-500/10 border-purple-500/50 text-purple-400" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    📜 공동인증서
                  </button>
                  <button onClick={() => { const arr = [...cards]; (arr[i] as any).login_method = "id_pw"; setCards(arr); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${cardLoginMethod === "id_pw" ? "bg-blue-500/10 border-blue-500/50 text-blue-400" : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]"}`}>
                    🔑 아이디/비밀번호
                  </button>
                </div>
                {cardLoginMethod === "certificate" ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <input type={showPw[`card_cert_${i}`] ? "text" : "password"} value={c.cert_password || ""} onChange={(e) => updateCard(i, "cert_password", e.target.value)}
                        placeholder="공동인증서 비밀번호" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`card_cert_${i}`]: !p[`card_cert_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`card_cert_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-dim)]">상단에 등록된 공동인증서를 사용합니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input type="text" value={c.login_id} onChange={(e) => updateCard(i, "login_id", e.target.value)} placeholder="카드사 아이디"
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <div className="relative">
                      <input type={showPw[`card_pw_${i}`] ? "text" : "password"} value={c.login_password} onChange={(e) => updateCard(i, "login_password", e.target.value)} placeholder="비밀번호"
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] pr-14" />
                      <button type="button" onClick={() => setShowPw((p) => ({ ...p, [`card_pw_${i}`]: !p[`card_pw_${i}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                        {showPw[`card_pw_${i}`] ? "숨기기" : "보기"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 자동서명 규칙 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">자동서명 규칙</h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
            <div><div className="text-sm font-medium">세금계산서 자동서명</div><div className="text-xs text-[var(--text-dim)] mt-0.5">승인 완료 시 인증서로 자동 전자서명</div></div>
            <input type="checkbox" checked={autoSign.auto_sign_tax_invoice} onChange={(e) => setAutoSign({ ...autoSign, auto_sign_tax_invoice: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" />
          </label>
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer">
            <div><div className="text-sm font-medium">은행이체 자동서명</div><div className="text-xs text-[var(--text-dim)] mt-0.5">이체 실행 시 인증서 전자서명</div></div>
            <input type="checkbox" checked={autoSign.auto_sign_bank_transfer} onChange={(e) => setAutoSign({ ...autoSign, auto_sign_bank_transfer: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" />
          </label>
        </div>
      </div>

      {/* 저장 */}
      <button onClick={saveAll} disabled={saving}
        className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
        {saving ? "저장 중..." : saved ? "저장 완료" : "설정 저장"}
      </button>

      <p className="text-[10px] text-[var(--text-dim)] text-center">
        인증정보는 RLS 정책으로 보호되며, 회사 대표만 조회할 수 있습니다.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Account Tab — 비밀번호 변경, 이메일 확인
// ═══════════════════════════════════════════════════════════════
function AccountTab() {
  const { toast } = useToast();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email);
    });
  }, []);

  function pwStrength(pw: string) {
    if (!pw) return null;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-zA-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 2) return { label: "약함", color: "var(--danger)", w: "33%" };
    if (score <= 3) return { label: "보통", color: "#f59e0b", w: "66%" };
    return { label: "강함", color: "var(--success, #22c55e)", w: "100%" };
  }

  const strength = pwStrength(newPw);

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (newPw.length < 8) return setMsg({ type: "err", text: "비밀번호는 8자 이상이어야 합니다." });
    if (!/[a-zA-Z]/.test(newPw)) return setMsg({ type: "err", text: "영문자를 포함해주세요." });
    if (!/[0-9]/.test(newPw)) return setMsg({ type: "err", text: "숫자를 포함해주세요." });
    if (!/[^A-Za-z0-9]/.test(newPw)) return setMsg({ type: "err", text: "특수기호를 포함해주세요." });
    if (newPw !== confirmPw) return setMsg({ type: "err", text: "새 비밀번호가 일치하지 않습니다." });

    setSaving(true);

    // 현재 비밀번호 검증 (재로그인)
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPw,
    });
    if (signInErr) {
      setSaving(false);
      return setMsg({ type: "err", text: "현재 비밀번호가 올바르지 않습니다." });
    }

    // 새 비밀번호 설정
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setSaving(false);

    if (error) {
      const errMsg = error.message.includes("same_password") || error.message.includes("should be different")
        ? "새 비밀번호는 기존과 달라야 합니다."
        : error.message;
      return setMsg({ type: "err", text: errMsg });
    }

    setMsg({ type: "ok", text: "비밀번호가 변경되었습니다." });
    toast("비밀번호가 변경되었습니다.", "success");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  }

  return (
    <div className="space-y-6">
      {/* 계정 정보 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-lg">👤</div>
          <div>
            <div className="text-sm font-bold text-[var(--text)]">계정 정보</div>
            <div className="text-xs text-[var(--text-muted)]">{userEmail}</div>
          </div>
        </div>
      </div>

      {/* 비밀번호 변경 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-lg">🔑</div>
          <div>
            <div className="text-sm font-bold text-[var(--text)]">비밀번호 변경</div>
            <div className="text-xs text-[var(--text-muted)]">영문+숫자+특수기호 조합 8자 이상</div>
          </div>
        </div>

        {msg && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${msg.type === "ok" ? "bg-green-500/10 border border-green-500/20 text-green-600" : "bg-red-500/10 border border-red-500/20 text-red-500"}`}>
            {msg.text}
          </div>
        )}

        <form onSubmit={handleChangePw} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">현재 비밀번호</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="현재 비밀번호를 입력하세요"
              className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">새 비밀번호</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="영문+숫자+특수기호 8자 이상"
              className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
              required
            />
            {strength && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[var(--text-muted)]">비밀번호 강도</span>
                  <span className="text-xs font-semibold" style={{ color: strength.color }}>{strength.label}</span>
                </div>
                <div className="h-1.5 bg-[var(--bg-surface,#f1f5f9)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: strength.w, backgroundColor: strength.color }} />
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="새 비밀번호를 다시 입력하세요"
              className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
              required
            />
            {confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-red-500 mt-1.5">비밀번호가 일치하지 않습니다</p>
            )}
          </div>
          <button
            type="submit"
            disabled={saving || !currentPw || !newPw || newPw !== confirmPw}
            className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
          >
            {saving ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Member Invite Tab — 개별 초대 + 초대현황
// ═══════════════════════════════════════════

function MemberInviteTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<"individual" | "bulk" | "status" | "members">("individual");
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

  // 회사 멤버 (users + employees 등록 여부)
  const { data: members = [], refetch: refetchMembers } = useQuery({
    queryKey: ["company-members-mgmt", companyId],
    queryFn: async () => {
      const db = supabase as any;
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
          { key: "bulk" as const, label: "대량 초대 (CSV)" },
          { key: "status" as const, label: `초대 현황 (${allInvites.length})` },
          { key: "members" as const, label: `멤버 관리 (${members.length})` },
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

      {/* Bulk invite (CSV) */}
      {subTab === "bulk" && <BulkInvite companyId={companyId} />}

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

      {/* ── 멤버 관리 (회사 소속 user) ── */}
      {subTab === "members" && (
        <div className="space-y-3">
          {members.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-xl p-8 text-center border border-[var(--border)]">
              <p className="text-[var(--text-muted)] text-sm">회사 멤버가 없습니다</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                <strong>역할</strong>: OwnerView 로그인 권한 (대표/관리자/직원/파트너) ·
                <strong className="ml-2">인사파일</strong>: 직원/급여 관리 대상 등록 여부
              </p>
              {members.map((m: any) => (
                <div key={m.id} className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] flex flex-wrap items-center gap-3">
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
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Permissions Tab — 플렉스 스타일 권한 관리
// ═══════════════════════════════════════════

import {
  getPermissionGroups,
  getPermissionGroupDetail,
  getAllPermissionDefinitions,
  getCompanyMembersWithPermissions,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
  setGroupPermissions,
  addGroupMember,
  removeGroupMember,
  initializeCompanyPermissions,
  MODULE_LABELS,
  SYSTEM_GROUPS,
  type PermissionGroup,
  type PermissionDefinition,
} from "@/lib/permissions";

function PermissionsTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { user } = useUser();
  const [subTab, setSubTab] = useState<"groups" | "members">("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [initialized, setInitialized] = useState(false);

  // 초기 셋업
  useEffect(() => {
    if (companyId && user?.id && !initialized) {
      initializeCompanyPermissions(companyId, user.id).then(() => {
        setInitialized(true);
      });
    }
  }, [companyId, user?.id, initialized]);

  // 권한 그룹 목록
  const { data: groups = [], refetch: refetchGroups } = useQuery({
    queryKey: ["permission-groups", companyId, initialized],
    queryFn: () => getPermissionGroups(companyId),
    enabled: !!companyId && initialized,
  });

  // 선택된 그룹 상세
  const { data: groupDetail, refetch: refetchDetail } = useQuery({
    queryKey: ["permission-group-detail", selectedGroupId],
    queryFn: () => getPermissionGroupDetail(selectedGroupId!),
    enabled: !!selectedGroupId,
  });

  // 전체 권한 정의
  const { data: permDefs = {} } = useQuery({
    queryKey: ["permission-definitions"],
    queryFn: () => getAllPermissionDefinitions(),
  });

  // 구성원별 권한
  const { data: membersWithPerms = [], refetch: refetchMembers } = useQuery({
    queryKey: ["members-permissions", companyId, initialized],
    queryFn: () => getCompanyMembersWithPermissions(companyId),
    enabled: !!companyId && initialized,
  });

  // 회사 유저 (멤버 추가용)
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: async () => {
      const { data } = await (supabase as ReturnType<typeof import("@supabase/supabase-js").createClient>)
        .from("users")
        .select("id, name, email, role, avatar_url")
        .eq("company_id", companyId)
        .order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createPermissionGroup({
        companyId,
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
      });
      toast("권한 그룹이 생성되었습니다", "success");
      setNewGroupName("");
      setNewGroupDesc("");
      setShowNewGroupForm(false);
      refetchGroups();
    } catch (err) {
      toast(`생성 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("이 권한 그룹을 삭제하시겠습니까?")) return;
    try {
      await deletePermissionGroup(groupId);
      toast("권한 그룹이 삭제되었습니다", "success");
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      refetchGroups();
    } catch (err) {
      toast(`삭제 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleTogglePermission = async (permId: string) => {
    if (!groupDetail) return;
    const currentIds = (groupDetail.permissions || []).map((p) => p.id);
    const newIds = currentIds.includes(permId)
      ? currentIds.filter((id) => id !== permId)
      : [...currentIds, permId];
    try {
      await setGroupPermissions(groupDetail.id, newIds);
      refetchDetail();
    } catch (err) {
      toast(`권한 변경 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedGroupId) return;
    try {
      await addGroupMember(selectedGroupId, userId, companyId);
      refetchDetail();
      refetchMembers();
      toast("구성원이 추가되었습니다", "success");
    } catch (err) {
      toast(`추가 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedGroupId) return;
    try {
      await removeGroupMember(selectedGroupId, userId);
      refetchDetail();
      refetchMembers();
      toast("구성원이 제거되었습니다", "success");
    } catch (err) {
      toast(`제거 실패: ${(err as Error).message}`, "error");
    }
  };

  const groupIcon = (icon: string, name: string) => {
    if (name === SYSTEM_GROUPS.SUPER_ADMIN) return <span className="text-lg">👑</span>;
    if (name === SYSTEM_GROUPS.TEAM_LEAD) return <span className="text-lg">🚩</span>;
    if (name === SYSTEM_GROUPS.DEFAULT) return <span className="text-lg">👥</span>;
    return <span className="text-lg">🛡️</span>;
  };

  const getInitials = (name: string) => {
    return name ? name.slice(0, 2) : "?";
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">권한 설정</h2>

      {/* Sub tabs */}
      <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
        <button
          onClick={() => setSubTab("groups")}
          className={`flex-1 py-3 text-sm font-semibold transition min-h-[44px] ${
            subTab === "groups" ? "bg-[var(--bg-card)] text-[var(--text)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}
        >
          권한 그룹
        </button>
        <button
          onClick={() => setSubTab("members")}
          className={`flex-1 py-3 text-sm font-semibold transition min-h-[44px] border-l border-[var(--border)] ${
            subTab === "members" ? "bg-[var(--bg-card)] text-[var(--text)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}
        >
          구성원 권한
        </button>
      </div>

      {/* ── 권한 그룹 탭 ── */}
      {subTab === "groups" && !selectedGroupId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">권한 그룹</h3>
              <p className="text-xs text-[var(--text-muted)]">그룹별 권한을 설정하고 구성원을 추가해 보세요.</p>
            </div>
            <button
              onClick={() => setShowNewGroupForm(true)}
              className="px-4 py-2 text-sm font-semibold border border-[var(--border)] rounded-lg hover:bg-[var(--bg-surface)] transition min-h-[44px]"
            >
              + 권한 그룹 추가
            </button>
          </div>

          {/* New group form */}
          {showNewGroupForm && (
            <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--primary)] space-y-3">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="그룹 이름"
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] outline-none"
                autoFocus
              />
              <input
                type="text"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder="설명 (선택)"
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] outline-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowNewGroupForm(false); setNewGroupName(""); setNewGroupDesc(""); }}
                  className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition disabled:opacity-50 min-h-[44px]"
                >
                  생성
                </button>
              </div>
            </div>
          )}

          {/* Group list */}
          <div className="space-y-2">
            {groups.map((g: PermissionGroup & { member_count?: number }) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className="w-full bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] hover:border-[var(--primary)]/50 transition text-left flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  {groupIcon(g.icon, g.name)}
                  <div>
                    <div className="font-semibold text-sm">{g.name}</div>
                    <div className="text-xs text-[var(--text-muted)]">{g.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {(g.member_count || 0) > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">{g.member_count}명</span>
                  )}
                  {!g.is_system && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id); }}
                      className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition px-2 min-h-[44px]"
                    >
                      ···
                    </button>
                  )}
                  <span className="text-[var(--text-muted)]">›</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 그룹 상세 (권한 편집 + 멤버 관리) ── */}
      {subTab === "groups" && selectedGroupId && groupDetail && (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedGroupId(null)}
            className="text-sm text-[var(--primary)] hover:underline min-h-[44px]"
          >
            ← 목록으로
          </button>

          <div className="flex items-center gap-3">
            {groupIcon(groupDetail.icon, groupDetail.name)}
            <div>
              <h3 className="text-lg font-bold">{groupDetail.name}</h3>
              <p className="text-xs text-[var(--text-muted)]">{groupDetail.description}</p>
            </div>
          </div>

          {/* 멤버 섹션 */}
          <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] space-y-3">
            <h4 className="font-semibold text-sm">구성원 ({groupDetail.members?.length || 0}명)</h4>
            <div className="space-y-2">
              {(groupDetail.members || []).map((m) => (
                <div key={m.user_id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                      {getInitials(m.user?.name || "")}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{m.user?.name || m.user?.email}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{m.user?.email}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(m.user_id)}
                    className="text-xs text-red-400 hover:text-red-300 transition px-2 min-h-[44px]"
                  >
                    제거
                  </button>
                </div>
              ))}
            </div>

            {/* 멤버 추가 */}
            <div className="pt-2 border-t border-[var(--border)]">
              <select
                onChange={(e) => { if (e.target.value) handleAddMember(e.target.value); e.target.value = ""; }}
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm outline-none"
                defaultValue=""
              >
                <option value="" disabled>+ 구성원 추가...</option>
                {companyUsers
                  .filter((u: { id: string }) => !(groupDetail.members || []).some((m) => m.user_id === u.id))
                  .map((u: { id: string; name: string; email: string }) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* 권한 편집 섹션 */}
          <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] space-y-4">
            <h4 className="font-semibold text-sm">모듈별 권한</h4>
            {Object.entries(permDefs).map(([module, perms]) => {
              const activePermIds = new Set((groupDetail.permissions || []).map((p) => p.id));
              const allChecked = (perms as PermissionDefinition[]).every((p) => activePermIds.has(p.id));
              return (
                <div key={module} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{MODULE_LABELS[module] || module}</span>
                    <button
                      onClick={async () => {
                        const currentIds = (groupDetail.permissions || []).map((p) => p.id);
                        const modulePermIds = (perms as PermissionDefinition[]).map((p) => p.id);
                        let newIds: string[];
                        if (allChecked) {
                          newIds = currentIds.filter((id) => !modulePermIds.includes(id));
                        } else {
                          newIds = [...new Set([...currentIds, ...modulePermIds])];
                        }
                        await setGroupPermissions(groupDetail.id, newIds);
                        refetchDetail();
                      }}
                      className="text-[10px] text-[var(--primary)] hover:underline"
                    >
                      {allChecked ? "전체 해제" : "전체 선택"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(perms as PermissionDefinition[]).map((p) => {
                      const isActive = activePermIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleTogglePermission(p.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition min-h-[44px] ${
                            isActive
                              ? "bg-[var(--primary)] text-white"
                              : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 구성원 권한 탭 ── */}
      {subTab === "members" && (
        <div className="space-y-4">
          <div>
            <h3 className="font-bold">구성원 권한</h3>
            <p className="text-xs text-[var(--text-muted)]">각 구성원이 속한 권한 그룹을 확인하세요.</p>
          </div>

          <div className="space-y-2">
            {membersWithPerms.map((m) => (
              <div
                key={m.user.id}
                className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-sm font-bold text-[var(--primary)]">
                    {getInitials(m.user.name || "")}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{m.user.name || m.user.email}</span>
                      {m.isSuperAdmin && <span className="text-xs">👑</span>}
                    </div>
                    {m.user.department && (
                      <span className="text-xs text-[var(--text-muted)]">{m.user.department}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {m.groups.map((g) => (
                    <span
                      key={g.id}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        g.name === SYSTEM_GROUPS.SUPER_ADMIN
                          ? "bg-yellow-500/10 text-yellow-400"
                          : g.name === SYSTEM_GROUPS.TEAM_LEAD
                            ? "bg-purple-500/10 text-purple-400"
                            : g.name === SYSTEM_GROUPS.DEFAULT
                              ? "bg-gray-500/10 text-gray-400"
                              : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {g.name === SYSTEM_GROUPS.SUPER_ADMIN ? "👑 " : g.name === SYSTEM_GROUPS.TEAM_LEAD ? "🚩 " : "👥 "}
                      {g.name}
                    </span>
                  ))}
                  {m.groups.length === 0 && (
                    <span className="text-xs text-[var(--text-muted)]">그룹 없음</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Data Reset Tab — 전체 데이터 초기화
// ═══════════════════════════════════════════

// ── FK 토폴로지 순서: 자식(leaf) → 부모(root) ──
// company_id로 직접 삭제 가능한 테이블만 포함
// tax_invoice_monthly_summary = VIEW이므로 제외
const DIRECT_DELETE_TABLES = [
  // ── Layer 1: 최하위 자식 (다른 테이블을 참조만 함) ──
  "deal_files", "deal_classifications",
  "certificate_logs",
  "tax_invoice_queue",
  "expense_approvals",
  "document_notifications",
  "billing_events", "feedback", "finance_access_logs",
  "audit_logs", "auto_discovery_results",
  "ai_pending_actions", "ai_interactions",
  "growth_targets",

  // ── Layer 2: bank_transactions/card_transactions (→ deals, bank_accounts, tax_invoices 참조) ──
  "bank_transactions", "card_transactions",
  "bank_classification_rules",
  "payment_queue",
  "deal_cost_schedule",
  "expense_requests",
  "financial_items",
  "vault_docs",

  // ── Layer 3: documents 자식 (signature_requests, quote_tracking → documents 참조) ──
  "quote_tracking", "signature_requests",
  "document_shares",

  // ── Layer 4: tax_invoices (→ deals, partners 참조 + 자기참조) ──
  "tax_invoices",

  // ── Layer 5: documents, chat_channels (→ deals 참조) ──
  "documents",
  "chat_channels",
  "partner_invitations",

  // ── Layer 6: deals (→ partners, bank_accounts, programs 참조) ──
  "deals",

  // ── Layer 7: bank_accounts 자식 ──
  "loans", "recurring_payments", "routing_rules",
  "payment_batches",
  "contract_archives",
  "hr_contract_packages",
  "closing_checklists",

  // ── Layer 8: 핵심 엔티티 ──
  "partners",
  "bank_accounts", "corporate_cards",

  // ── Layer 9: approval (requests → policies) ──
  "approval_requests", "approval_policies",

  // ── Layer 10: 독립 테이블 ──
  "automation_credentials", "automation_logs", "automation_runs",
  "sync_jobs", "hometax_sync_log", "company_integrations",
  "monthly_financials", "treasury_positions",
  "vault_assets", "vault_accounts",
  "invoices", "transactions",
  "doc_templates", "programs",
  "notifications",
  "vendors", "cash_snapshot",
] as const;

// company_id 없이 부모 FK로 삭제해야 하는 테이블
const CHILD_DELETE_GROUPS: { parent: string; parentKey: string; children: { table: string; fk: string }[] }[] = [
  {
    parent: "deals",
    parentKey: "deal_id",
    children: [
      { table: "deal_milestones", fk: "deal_id" },
      { table: "deal_assignments", fk: "deal_id" },
      { table: "deal_revenue_schedule", fk: "deal_id" },
      { table: "deal_nodes", fk: "deal_id" },
      { table: "sub_deals", fk: "parent_deal_id" },
    ],
  },
  {
    parent: "approval_requests",
    parentKey: "request_id",
    children: [{ table: "approval_steps", fk: "request_id" }],
  },
  {
    parent: "documents",
    parentKey: "document_id",
    children: [
      { table: "doc_revisions", fk: "document_id" },
      { table: "doc_approvals", fk: "document_id" },
      { table: "hr_contract_package_items", fk: "document_id" },
    ],
  },
  {
    parent: "document_shares",
    parentKey: "share_id",
    children: [
      { table: "document_share_feedback", fk: "share_id" },
      { table: "document_share_views", fk: "share_id" },
    ],
  },
  {
    parent: "chat_channels",
    parentKey: "channel_id",
    children: [
      { table: "chat_mentions", fk: "channel_id" },
      { table: "chat_files", fk: "channel_id" },
      { table: "chat_action_cards", fk: "channel_id" },
      { table: "chat_messages", fk: "channel_id" },
      { table: "chat_events", fk: "channel_id" },
      { table: "chat_members", fk: "channel_id" },
      { table: "chat_participants", fk: "channel_id" },
    ],
  },
  {
    parent: "loans",
    parentKey: "loan_id",
    children: [{ table: "loan_payments", fk: "loan_id" }],
  },
  {
    parent: "closing_checklists",
    parentKey: "checklist_id",
    children: [{ table: "closing_checklist_items", fk: "checklist_id" }],
  },
  {
    parent: "treasury_positions",
    parentKey: "position_id",
    children: [{ table: "treasury_transactions", fk: "position_id" }],
  },
  {
    parent: "payment_batches",
    parentKey: "batch_id",
    children: [{ table: "payroll_items", fk: "batch_id" }],
  },
  {
    parent: "transactions",
    parentKey: "transaction_id",
    children: [{ table: "transaction_matches", fk: "transaction_id" }],
  },
];

function DataResetTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"idle" | "confirm" | "processing" | "done">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTable: "" });
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.name) setCompanyName(data.name);
      });
  }, [companyId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  async function fetchIds(table: string, col: string = "id"): Promise<string[]> {
    const { data } = await db.from(table).select(col).eq("company_id", companyId);
    if (!data || data.length === 0) return [];
    return data.map((r: Record<string, string>) => r[col]);
  }

  async function deleteByIds(table: string, fk: string, ids: string[]): Promise<string | null> {
    if (ids.length === 0) return null;
    // .in()은 URL 길이 제한이 있으므로 100개씩 배치
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { error } = await db.from(table).delete().in(fk, batch);
      if (error) return `${table}: ${error.message}`;
    }
    return null;
  }

  async function handleReset() {
    setStep("processing");
    setErrors([]);
    const totalSteps = 2 + CHILD_DELETE_GROUPS.length + DIRECT_DELETE_TABLES.length + 1;
    let current = 0;
    const failedTables: string[] = [];

    function tick(label: string) {
      current++;
      setProgress({ current, total: totalSteps, currentTable: label });
    }

    // ── Phase 1: 순환 FK NULL 처리 ──
    tick("순환 FK 해제");
    await db.from("partners").update({ source_deal_id: null }).eq("company_id", companyId);
    await db.from("tax_invoices").update({ original_invoice_id: null }).eq("company_id", companyId);
    await db.from("deals").update({ partner_id: null, bank_account_id: null }).eq("company_id", companyId);
    await db.from("deal_cost_schedule").update({ sub_deal_id: null }).eq("company_id", companyId);

    // ── Phase 1.5: chat_reactions는 message_id로만 삭제 가능 ──
    tick("chat_reactions");
    const chatChannelIds = await fetchIds("chat_channels");
    if (chatChannelIds.length > 0) {
      const allMsgIds: string[] = [];
      for (let i = 0; i < chatChannelIds.length; i += 100) {
        const batch = chatChannelIds.slice(i, i + 100);
        const { data: msgs } = await db.from("chat_messages").select("id").in("channel_id", batch);
        if (msgs) allMsgIds.push(...msgs.map((m: { id: string }) => m.id));
      }
      const reactErr = await deleteByIds("chat_reactions", "message_id", allMsgIds);
      if (reactErr) failedTables.push(reactErr);
    }

    // ── Phase 2: 부모 ID 조회 후 자식 테이블 삭제 ──
    for (const group of CHILD_DELETE_GROUPS) {
      tick(group.parent + " 자식");
      const parentIds = await fetchIds(group.parent);
      for (const child of group.children) {
        const err = await deleteByIds(child.table, child.fk, parentIds);
        if (err) failedTables.push(err);
      }
    }

    // ── Phase 3: company_id로 직접 삭제 (토폴로지 순서) ──
    for (const table of DIRECT_DELETE_TABLES) {
      tick(table);
      const { error } = await db.from(table).delete().eq("company_id", companyId);
      if (error) failedTables.push(`${table}: ${error.message}`);
    }

    // ── Phase 2.5: 멤버 정리 — employees / employee_invitations / 회사 소속 끊기 ──
    // users 직접 삭제는 chat_participants/messages 등 FK 위반 가능 → company_id=NULL 로 detach.
    // owner/admin 은 보존 (회사 운영 주체). 본인은 어쨌든 owner/admin 라 자동 보존.
    tick("멤버 + 초대 정리");
    try {
      await db.from("employees").delete().eq("company_id", companyId);
      await db.from("employee_invitations").delete().eq("company_id", companyId);
      await db.from("partner_invitations").delete().eq("company_id", companyId);
      const { error: uErr } = await db
        .from("users")
        .update({ company_id: null })
        .eq("company_id", companyId)
        .in("role", ["employee", "partner"]);
      if (uErr) failedTables.push(`users detach: ${uErr.message}`);
    } catch (e: any) {
      failedTables.push(`멤버 정리: ${e?.message || e}`);
    }

    // ── Phase 3: companies 레코드 부가 필드 초기화 ──
    tick("companies");
    await db
      .from("companies")
      .update({
        business_number: null,
        representative: null,
        address: null,
        phone: null,
        fax: null,
        business_type: null,
        business_category: null,
        seal_url: null,
        logo_url: null,
        tax_settings: null,
        cert_settings: null,
      })
      .eq("id", companyId);

    // CODEF connectedId도 초기화 (stale CF-04019 방지)
    await db
      .from("company_settings")
      .update({ codef_connected_id: null, codef_connected_at: null })
      .eq("company_id", companyId);

    // localStorage 온보딩 상태 초기화
    if (typeof window !== "undefined") {
      localStorage.removeItem("leanos-onboarding-done");
      localStorage.removeItem("leanos-onboarding-dismissed");
    }

    queryClient.clear();
    setErrors(failedTables);
    setStep("done");

    if (failedTables.length === 0) {
      toast("모든 데이터가 초기화되었습니다.", "success");
    } else {
      toast(`초기화 완료 (${failedTables.length}개 테이블 오류)`, "error");
    }
  }

  return (
    <div className="space-y-6">
      {/* 경고 배너 */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-lg shrink-0">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-red-500">위험 구역</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              이 작업은 되돌릴 수 없습니다. 신중하게 진행해주세요.
            </p>
          </div>
        </div>
      </div>

      {/* 전체 데이터 초기화 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-red-500/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-lg">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">전체 데이터 초기화</h3>
            <p className="text-xs text-[var(--text-muted)]">설정 및 업무 데이터를 모두 삭제합니다</p>
          </div>
        </div>

        {/* 삭제 대상 목록 */}
        <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-5">
          <p className="text-xs font-semibold text-[var(--text)] mb-3">삭제되는 데이터:</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              "통장 / 법인카드",
              "거래처",
              "딜 / 프로젝트",
              "세금계산서",
              "은행·카드 거래내역",
              "승인정책 / 결재",
              "문서 / 계약",
              "CODEF 인증서 연동",
              "은행연동 자격증명",
              "알림 설정 / 내역",
              "회사 부가정보",
            ].map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <span className="text-red-400 text-xs">x</span>
                <span className="text-xs text-[var(--text-muted)]">{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--text)] mb-1.5">유지되는 데이터:</p>
            <div className="flex flex-wrap gap-3">
              {["계정 (이메일/비밀번호)", "회사명", "직원 / 관리자 정보", "구독/결제 정보"].map((item) => (
                <div key={item} className="flex items-center gap-1.5">
                  <span className="text-green-400 text-xs">o</span>
                  <span className="text-xs text-[var(--text-muted)]">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {step === "idle" && (
          <button
            onClick={() => setStep("confirm")}
            className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl font-semibold text-sm transition border border-red-500/20"
          >
            데이터 초기화 시작
          </button>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
              <p className="text-sm font-bold text-red-500 mb-2">
                정말 모든 데이터를 삭제하시겠습니까?
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                확인을 위해 회사명 <span className="font-bold text-[var(--text)]">&ldquo;{companyName}&rdquo;</span>을 입력해주세요.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={companyName}
                className="w-full px-4 py-3 bg-[var(--bg)] border border-red-500/30 rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-red-500 transition"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setStep("idle"); setConfirmText(""); }}
                className="flex-1 py-3 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] rounded-xl font-semibold text-sm transition border border-[var(--border)]"
              >
                취소
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== companyName}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-sm transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                초기화 실행
              </button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-semibold text-[var(--text)]">초기화 진행 중...</span>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--text-muted)]">{progress.currentTable}</span>
                <span className="text-xs text-[var(--text-muted)]">{progress.current} / {progress.total}</span>
              </div>
              <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-[var(--text-dim)]">브라우저를 닫지 마세요. 잠시만 기다려주세요.</p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className={`p-4 rounded-xl border ${errors.length === 0 ? "bg-green-500/10 border-green-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
              <div className="flex items-center gap-2 mb-2">
                {errors.length === 0 ? (
                  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c-.866 1.5.217 3.374 1.948 3.374H2.697c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                )}
                <span className={`text-sm font-bold ${errors.length === 0 ? "text-green-600" : "text-amber-600"}`}>
                  {errors.length === 0 ? "초기화가 완료되었습니다" : `초기화 완료 (${errors.length}개 항목 오류)`}
                </span>
              </div>
              {errors.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">모든 데이터가 삭제되었습니다. 온보딩부터 다시 시작할 수 있습니다.</p>
              ) : (
                <div className="mt-2">
                  <p className="text-xs text-[var(--text-muted)] mb-2">일부 테이블 삭제 중 오류가 발생했습니다 (데이터가 없거나 권한 문제):</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {errors.map((err, i) => (
                      <p key={i} className="text-[10px] text-amber-600 font-mono">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => window.location.href = "/dashboard"}
              className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition"
            >
              대시보드로 이동
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
