"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { encryptCredential, decryptJsonCredentials } from "@/lib/crypto";
import { getCurrentUser, getBankAccounts, upsertBankAccount, deleteBankAccount, getRoutingRules, upsertRoutingRule, getDealClassifications, upsertDealClassification, deleteDealClassification } from "@/lib/queries";
import { COST_TYPES, BANK_ROLES } from "@/lib/routing";
import { ChartOfAccountsManager } from "@/components/chart-of-accounts-manager";
import type { BankAccount } from "@/types/models";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, getInviteUrl, cancelEmployeeInvitation, cancelPartnerInvitation, sendInviteEmail } from "@/lib/invitations";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { QueryErrorBanner } from "@/components/query-status";
import { AccessDenied } from "@/components/access-denied";
import HrAttendanceSettingsPanel from "@/components/hr-attendance-settings";
import { TaxAutomationTab } from "./_components/TaxAutomationTab";
import { CertificateManagementTab } from "./_components/CertificateManagementTab";
import { BankIntegrationTab } from "./_components/BankIntegrationTab";
import { ApprovalPolicyTab } from "./_components/ApprovalPolicyTab";
import { TeamManagement } from "./_components/TeamManagement";
import { DepartmentsTab } from "./_components/DepartmentsTab";
import { FormTemplateManager } from "@/components/form-template-manager";
import { DealClassificationManager } from "./_components/DealClassificationManager";
import { DataResetTab } from "./_components/DataResetTab";
import { CompanyInfoTab } from "./_components/CompanyInfoTab";
import { AccountingClosingTab } from "./_components/AccountingClosingTab";
// 계정·알림(개인)은 마이페이지로 이관됨(2026-07-08) — 여기선 import/렌더 제거.

// ── 2026-07-08 회사 설정 IA 재편 — 6개 그룹 × 세부탭(2단 네비). 잡동사니였던 "일반 설정" 해체,
//    계정과목·회계마감을 회계 그룹으로 노출, 개인(계정·알림)은 마이페이지로 분리. ──
type LeafKey =
  | "company-info" | "team"                       // 회사 기본
  | "cash" | "chart" | "closing" | "tax"          // 회계·세무
  | "bank" | "certificate"                        // 연동·인증
  | "departments" | "attendance"                  // 인사·근태
  | "approval" | "deal" | "forms"                 // 업무 규칙
  | "data";                                       // 시스템

const SETTINGS_GROUPS: { key: string; label: string; icon: string; tabs: { key: LeafKey; label: string }[] }[] = [
  { key: "basic", label: "회사 기본", icon: "M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2", tabs: [
    { key: "company-info", label: "회사정보" },
    { key: "team", label: "팀·권한" },
  ] },
  { key: "accounting", label: "회계·세무", icon: "M9 7h6m-6 4h6m-6 4h4M5 3h14a1 1 0 011 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 011-1z", tabs: [
    { key: "cash", label: "자금·통장" },
    { key: "chart", label: "계정과목" },
    { key: "closing", label: "회계마감" },
    { key: "tax", label: "세무자동화" },
  ] },
  { key: "integration", label: "연동·인증", icon: "M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5", tabs: [
    { key: "bank", label: "은행연동" },
    { key: "certificate", label: "인증서" },
  ] },
  { key: "hr", label: "인사·근태", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", tabs: [
    { key: "departments", label: "부서" },
    { key: "attendance", label: "근태·가산수당" },
  ] },
  { key: "rules", label: "업무 규칙", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", tabs: [
    { key: "approval", label: "승인·결재" },
    { key: "deal", label: "딜 분류" },
    { key: "forms", label: "회사 양식" },
  ] },
  { key: "system", label: "시스템", icon: "M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m-1 0v14a1 1 0 01-1 1H9a1 1 0 01-1-1V6", tabs: [
    { key: "data", label: "데이터 관리" },
  ] },
];
const ALL_LEAVES: LeafKey[] = SETTINGS_GROUPS.flatMap((g) => g.tabs.map((t) => t.key));
// 옛 ?tab= 딥링크 호환 — 재편 전 키를 새 leaf 로 매핑("mypage"=마이페이지로 이관돼 리다이렉트).
const TAB_COMPAT: Record<string, LeafKey | "mypage"> = {
  general: "team",          // 합류요청 알림이 팀관리(승인 UI)로 연결되던 링크
  account: "mypage", notifications: "mypage",
  company: "company-info", approval: "approval", bank: "bank", tax: "tax",
  certificate: "certificate", hr_attendance: "attendance", danger: "data",
};
function groupOfLeaf(leaf: LeafKey): string {
  return SETTINGS_GROUPS.find((g) => g.tabs.some((t) => t.key === leaf))?.key || "basic";
}

export default function SettingsPage() {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="회사 설정은 대표·관리자 전용입니다." />;
  }
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams?.get("tab") || "";
  // 옛 키가 마이페이지로 이관된 경우(계정·알림) → 마이페이지로 리다이렉트
  useEffect(() => {
    if (rawTab && TAB_COMPAT[rawTab] === "mypage") router.replace("/mypage");
  }, [rawTab, router]);
  const initialTab: LeafKey = (() => {
    if (ALL_LEAVES.includes(rawTab as LeafKey)) return rawTab as LeafKey;
    const mapped = TAB_COMPAT[rawTab];
    if (mapped && mapped !== "mypage") return mapped;
    return "company-info";
  })();
  const [tab, setTabState] = useState<LeafKey>(initialTab);
  // 탭 변경 시 URL ?tab= 동기화(북마크·뒤로가기 유지, 페이지 리로드 없음)
  const setTab = (next: LeafKey) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    }
  };
  const activeGroup = groupOfLeaf(tab);
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

  const currentGroup = SETTINGS_GROUPS.find((g) => g.key === activeGroup) || SETTINGS_GROUPS[0];

  return (
    <div className="space-y-6">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

      {/* 상단 그룹 탭(1단) — 아이콘 + 라벨. 클릭 시 해당 그룹 첫 세부탭으로 이동 */}
      <div className="page-sticky-header mb-4">
        <div className="seg-bar flex w-full overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: "touch" }}>
          {SETTINGS_GROUPS.map((g) => {
            const active = activeGroup === g.key;
            const danger = g.key === "system";
            return (
              <button
                key={g.key}
                ref={(el) => { if (el && active) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }}
                onClick={() => setTab(g.tabs[0].key)}
                className={`seg-item group inline-flex items-center justify-center gap-1.5 shrink-0 md:grow md:basis-0 min-h-[44px] ${
                  active ? `seg-item-active ${danger ? "!bg-[var(--danger)]" : ""}` : danger ? "hover:!text-[var(--danger)]" : ""
                }`}
              >
                <svg
                  className={`w-4 h-4 shrink-0 transition-colors ${active ? "text-white" : "text-[var(--text-dim)] group-hover:text-[var(--text-muted)]"}`}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d={g.icon} />
                </svg>
                <span>{g.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 하위 세부 탭(2단) — 현재 그룹의 탭들. 그룹에 탭이 2개 이상일 때만 표시 */}
      {currentGroup.tabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5 -mt-2">
          {currentGroup.tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition ${
                  active
                    ? "bg-[var(--primary)] text-white shadow-sm"
                    : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ═══ 자금·통장 (구 일반설정: 현금현황 + 법인통장 + 비용라우팅) ═══ */}
      {tab === "cash" && (
        <>
          {/* Cash Snapshot */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">현금 현황</h3>
            </div>
            <div className="space-y-4">
              {/* 연동 통장 합산 (자동, read-only) */}
              <div className="p-4 rounded-xl bg-[var(--primary)]/5 border border-[var(--primary)]/20 shadow-sm">
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
                <label className="field-label">추가 현금 — 시재금 / 미연동 계좌 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={balance ? Number(balance).toLocaleString() : ""}
                  onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  className="field-input"
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
                <label className="field-label">추가 월 고정비 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={fixedCost ? Number(fixedCost).toLocaleString() : ""}
                  onChange={(e) => setFixedCost(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  className="field-input"
                />
                <p className="text-[10px] text-[var(--text-dim)] mt-1">
                  대시보드 월 고정비 = <b>반복결제 합 + 직원급여 합 + 이 값</b>. 이미 등록된 반복결제/급여 외에 추가로 잡아둘 임대료/보험/기타 비용을 입력하세요.
                </p>
              </div>

              {(totalBankBalance + (Number(balance) || 0)) > 0 && Number(fixedCost) > 0 && (
                <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                  <div className="text-xs text-[var(--text-dim)]">예상 생존 개월수</div>
                  <div className={`text-2xl font-extrabold mt-1 ${
                    (totalBankBalance + Number(balance)) / Number(fixedCost) < 3 ? "text-[var(--danger)]" : "text-[var(--success)]"
                  }`}>
                    {((totalBankBalance + Number(balance)) / Number(fixedCost)).toFixed(1)}개월
                  </div>
                </div>
              )}
              <button
                onClick={save}
                className="btn-primary w-full"
              >
                {saved ? "저장 완료" : "저장"}
              </button>
            </div>
          </div>

          {/* Bank Accounts */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold">법인 통장 관리</h3>
                <p className="text-xs text-[var(--text-dim)] mt-0.5">
                  총 잔고: ₩{totalBankBalance.toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setShowBankForm(!showBankForm)}
                className="btn-secondary btn-sm"
              >
                + 통장 추가
              </button>
            </div>

            {showBankForm && (
              <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">은행명 *</label>
                    <input
                      value={bankForm.bank_name}
                      onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                      placeholder="국민은행"
                      className="field-input-sm"
                    />
                  </div>
                  <div>
                    <label className="field-label">계좌번호 *</label>
                    <input
                      value={bankForm.account_number}
                      onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })}
                      placeholder="123-456-789012"
                      className="field-input-sm"
                    />
                  </div>
                  <div>
                    <label className="field-label">별칭</label>
                    <input
                      value={bankForm.alias}
                      onChange={(e) => setBankForm({ ...bankForm, alias: e.target.value })}
                      placeholder="메인 운영통장"
                      className="field-input-sm"
                    />
                  </div>
                  <div>
                    <label className="field-label">용도</label>
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
                    <label className="field-label">잔고 (원)</label>
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
                    className="btn-primary"
                  >
                    추가
                  </button>
                  <button onClick={() => setShowBankForm(false)} className="btn-ghost">
                    취소
                  </button>
                </div>
              </div>
            )}

            {bankAccounts.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-3">🏦</div>
                <div className="text-sm font-semibold text-[var(--text-muted)]">등록된 통장이 없습니다</div>
                <div className="text-xs text-[var(--text-dim)] mt-1">우측 상단 &quot;+ 통장 추가&quot;로 첫 계좌를 등록하세요.</div>
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
                        onClick={async () => {
                          const { ok } = await confirm({ title: "통장 연결 삭제", desc: "기존 거래내역은 유지됩니다.", danger: true });
                          if (ok) deleteBankMut.mutate(acc.id);
                        }}
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

          {/* Routing Rules */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold">비용 라우팅 규칙</h3>
                <p className="text-xs text-[var(--text-dim)] mt-0.5">비용 유형별 지급 통장 자동 매칭</p>
              </div>
              <button
                onClick={() => setShowRuleForm(!showRuleForm)}
                className="btn-secondary btn-sm"
              >
                + 규칙 추가
              </button>
            </div>

            {showRuleForm && bankAccounts.length > 0 && (
              <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">비용 유형</label>
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
                    <label className="field-label">지급 통장</label>
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
                    className="btn-primary"
                  >
                    추가
                  </button>
                  <button onClick={() => setShowRuleForm(false)} className="btn-ghost">
                    취소
                  </button>
                </div>
              </div>
            )}

            {routingRules.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-3">🧭</div>
                <div className="text-sm font-semibold text-[var(--text-muted)]">라우팅 규칙이 없습니다. 기본 통장으로 지급됩니다.</div>
                <div className="text-xs text-[var(--text-dim)] mt-1">우측 상단 &quot;+ 규칙 추가&quot;로 비용 유형별 지급 통장을 지정할 수 있습니다.</div>
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

      {/* ═══ 회사 기본 — 회사정보 ═══ */}
      {tab === "company-info" && <CompanyInfoTab companyId={companyId} />}

      {/* ═══ 회사 기본 — 팀·권한 ═══ */}
      {tab === "team" && <TeamManagement companyId={companyId} />}

      {/* ═══ 회계·세무 — 계정과목 ═══ */}
      {tab === "chart" && companyId && <ChartOfAccountsManager companyId={companyId} />}

      {/* ═══ 회계·세무 — 회계마감 ═══ */}
      {tab === "closing" && <AccountingClosingTab companyId={companyId} />}

      {/* ═══ 회계·세무 — 세무자동화 ═══ */}
      {tab === "tax" && <TaxAutomationTab companyId={companyId} />}

      {/* ═══ 연동·인증 — 은행연동 ═══ */}
      {tab === "bank" && <BankIntegrationTab companyId={companyId} bankAccounts={bankAccounts} />}

      {/* ═══ 연동·인증 — 인증서 ═══ */}
      {tab === "certificate" && <CertificateManagementTab companyId={companyId} />}

      {/* ═══ 인사·근태 — 부서 ═══ */}
      {tab === "departments" && <DepartmentsTab companyId={companyId} />}

      {/* ═══ 인사·근태 — 근태·가산수당 ═══ */}
      {tab === "attendance" && companyId && <HrAttendanceSettingsPanel companyId={companyId} />}

      {/* ═══ 업무 규칙 — 승인·결재 정책 ═══ */}
      {tab === "approval" && <ApprovalPolicyTab companyId={companyId} />}

      {/* ═══ 업무 규칙 — 딜 분류 ═══ */}
      {tab === "deal" && <DealClassificationManager companyId={companyId} />}

      {/* ═══ 업무 규칙 — 회사 양식 PDF ═══ */}
      {tab === "forms" && <FormTemplateManager companyId={companyId} />}

      {/* ═══ 시스템 — 데이터 관리 ═══ */}
      {tab === "data" && companyId && <DataResetTab companyId={companyId} />}

      {confirmElement}
    </div>
  );
}