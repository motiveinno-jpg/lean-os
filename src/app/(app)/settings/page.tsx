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
import { AccessDenied } from "@/components/access-denied";
import HrAttendanceSettingsPanel from "@/components/hr-attendance-settings";
import ContractTemplatesManager from "@/components/contract-templates-manager";
import { TaxAutomationTab } from "./_components/TaxAutomationTab";
import { CertificateManagementTab } from "./_components/CertificateManagementTab";
import { BankIntegrationTab } from "./_components/BankIntegrationTab";
import { NotificationsTab } from "./_components/NotificationsTab";
import { ApprovalPolicyTab } from "./_components/ApprovalPolicyTab";
import { TeamManagement } from "./_components/TeamManagement";
import { DepartmentsTab } from "./_components/DepartmentsTab";
import { DealClassificationManager } from "./_components/DealClassificationManager";
import { AccountTab } from "./_components/AccountTab";
import { DataResetTab } from "./_components/DataResetTab";
import { CompanyInfoTab } from "./_components/CompanyInfoTab";

type MainTab = "general" | "account" | "company" | "approval" | "bank" | "tax" | "certificate" | "notifications" | "danger" | "hr_attendance";

export default function SettingsPage() {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="회사 설정은 대표·관리자 전용입니다." />;
  }
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const VALID_TABS: MainTab[] = ["general", "account", "company", "approval", "bank", "tax", "certificate", "notifications", "danger", "hr_attendance"];
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
    { key: "hr_attendance", label: "근태/가산수당" },
    { key: "bank", label: "은행연동" },
    { key: "tax", label: "세무자동화" },
    { key: "certificate", label: "인증서" },
    { key: "notifications", label: "알림" },
    { key: "danger", label: "데이터 관리" },
  ];

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">설정 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="page-sticky-header">
        <h1 className="text-2xl font-extrabold mb-1">설정</h1>
      </div>

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
              className={`whitespace-nowrap shrink-0 md:grow md:basis-0 px-3 py-2.5 rounded-md text-xs sm:text-sm font-semibold min-h-[44px] transition ${
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
          <div className="glass-card p-6">
            <h2 className="section-title">현금 현황</h2>
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
          <div className="glass-card p-6">
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
                      className="field-input-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">계좌번호 *</label>
                    <input
                      value={bankForm.account_number}
                      onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })}
                      placeholder="123-456-789012"
                      className="field-input-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">별칭</label>
                    <input
                      value={bankForm.alias}
                      onChange={(e) => setBankForm({ ...bankForm, alias: e.target.value })}
                      placeholder="메인 운영통장"
                      className="field-input-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">용도</label>
                    <select
                      value={bankForm.role}
                      onChange={(e) => setBankForm({ ...bankForm, role: e.target.value })}
                      className="field-input-sm"
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
                      className="field-input-sm"
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

          {/* Departments */}
          <DepartmentsTab companyId={companyId} />

          {/* Deal Classifications */}
          <DealClassificationManager companyId={companyId} />

          {/* Routing Rules */}
          <div className="glass-card p-6">
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
                      className="field-input-sm"
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
                      className="field-input-sm"
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
      {mainTab === "company" && (
        <div className="space-y-6">
          <CompanyInfoTab companyId={companyId} />
          {/* L 견적/계약: 계약서 양식 관리 — 시스템 양식 3종 + 회사 자체 양식 CRUD */}
          {companyId && <ContractTemplatesManager companyId={companyId} />}
        </div>
      )}

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

      {/* ═══ Data Management (Danger Zone) ═══ */}
      {mainTab === "danger" && companyId && <DataResetTab companyId={companyId} />}

      {mainTab === "hr_attendance" && companyId && <HrAttendanceSettingsPanel companyId={companyId} />}
    </div>
  );
}

// ═══════════════════════════════════════════
// Notifications Tab — 채널별 + 이벤트별 세분화
// ═══════════════════════════════════════════