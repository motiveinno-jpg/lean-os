"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getBankAccounts, upsertBankAccount, deleteBankAccount, getRoutingRules, upsertRoutingRule, getDealClassifications, upsertDealClassification, deleteDealClassification } from "@/lib/queries";
import { COST_TYPES, BANK_ROLES } from "@/lib/routing";
import type { BankAccount } from "@/types/models";
import { createEmployeeInvitation, createPartnerInvitation, getEmployeeInvitations, getPartnerInvitations, getInviteUrl, cancelEmployeeInvitation, cancelPartnerInvitation } from "@/lib/invitations";
import { useUser } from "@/components/user-context";

type MainTab = "general" | "company" | "approval" | "bank" | "tax" | "certificate";

export default function SettingsPage() {
  const [mainTab, setMainTab] = useState<MainTab>("general");
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

  const mainTabs: { key: MainTab; label: string }[] = [
    { key: "general", label: "일반 설정" },
    { key: "company", label: "회사정보" },
    { key: "approval", label: "승인정책" },
    { key: "bank", label: "은행연동" },
    { key: "tax", label: "세무자동화" },
    { key: "certificate", label: "인증서" },
  ];

  return (
    <div className="max-w-[700px] space-y-6">
      <h1 className="text-2xl font-extrabold mb-2">설정</h1>

      {/* Main Tab Bar */}
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-lg p-0.5 mb-6">
        {mainTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition ${
              mainTab === t.key ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ General Tab ═══ */}
      {mainTab === "general" && (
        <>
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
    </div>
  );
}

// ═══════════════════════════════════════════
// Company Info Tab
// ═══════════════════════════════════════════
function CompanyInfoTab({ companyId }: { companyId: string | null }) {
  const db = supabase as any;
  const queryClient = useQueryClient();
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
        .single();
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
      setTimeout(() => setSaved(false), 2000);
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
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">회사 정보 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => sealInputRef.current?.click()}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      변경
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
                  <button
                    onClick={() => sealInputRef.current?.click()}
                    disabled={uploading === "seal"}
                    className="text-xs text-[var(--primary)] font-semibold hover:underline disabled:opacity-50"
                  >
                    {uploading === "seal" ? "업로드 중..." : "직인 업로드"}
                  </button>
                  <p className="text-[10px] text-[var(--text-dim)]">PNG, JPG (최대 5MB)</p>
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
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("approval_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approval-policies"] }),
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

// ═══════════════════════════════════════════
// Bank Integration Tab
// ═══════════════════════════════════════════
function BankIntegrationTab({ companyId, bankAccounts }: { companyId: string | null; bankAccounts: BankAccount[] }) {
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    auto_transfer_enabled: false, auto_transfer_limit: 5000000, transfer_schedule: "immediate",
    retry_count: 3, retry_interval_hours: 1, openbanking_api_key: "",
  });
  const { data: companySettings } = useQuery({
    queryKey: ["automation-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("automation_settings").eq("id", companyId).single(); return data?.automation_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => { if (companySettings) setSettings((prev) => ({ ...prev, ...companySettings })); }, [companySettings]);
  async function saveSettings() {
    if (!companyId) return;
    await db2.from("companies").update({ automation_settings: settings }).eq("id", companyId);
    queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">등록된 계좌</h2>
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
        </div>
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-1">API 연동</h2>
        <p className="text-xs text-[var(--text-dim)] mb-4">오픈뱅킹 또는 n8n 웹훅으로 실제 이체를 실행합니다</p>
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 mb-4"><p className="text-xs text-amber-700 font-semibold">현재 n8n 웹훅 방식으로 동작합니다. 오픈뱅킹 API 키 등록 시 직접 은행 API 이체가 가능합니다.</p></div>
        <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">오픈뱅킹 API 키</label><div className="flex gap-2"><input type="password" value={settings.openbanking_api_key} onChange={(e) => setSettings({ ...settings, openbanking_api_key: e.target.value })} placeholder="API 키를 입력하세요" className="flex-1 px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /><button className="px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition">연결 테스트</button></div></div>
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
  const [settings, setSettings] = useState({ auto_issue_on_deal_close: true, auto_issue_on_payment: false, auto_email_send: false, issue_schedule: "immediate", auto_cancel_on_refund: true, auto_cancel_on_deal_cancel: true, hometax_id: "", vat_auto_aggregate: true });
  const { data: companySettings } = useQuery({
    queryKey: ["tax-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("tax_settings").eq("id", companyId).single(); return data?.tax_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => { if (companySettings) setSettings((prev) => ({ ...prev, ...companySettings })); }, [companySettings]);
  async function saveTaxSettings() {
    if (!companyId) return;
    await db2.from("companies").update({ tax_settings: settings }).eq("id", companyId);
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
        <h2 className="text-sm font-bold mb-1">홈택스 연동</h2>
        <p className="text-xs text-[var(--text-dim)] mb-4">국세청 홈택스와 연동하여 세금계산서 자동 제출</p>
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 mb-4"><p className="text-xs text-amber-700 font-semibold">현재 수동 엑셀 업로드 방식. 홈택스 API 연동 시 자동 제출 가능.</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="block text-xs text-[var(--text-muted)] mb-1.5">홈택스 ID</label><input value={settings.hometax_id} onChange={(e) => setSettings({ ...settings, hometax_id: e.target.value })} placeholder="홈택스 로그인 ID" className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" /></div>
          <div className="flex items-end"><button className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition">연결 테스트</button></div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-xs text-[var(--text-muted)]"><input type="checkbox" checked={settings.vat_auto_aggregate} onChange={(e) => setSettings({ ...settings, vat_auto_aggregate: e.target.checked })} className="rounded" /> 부가세 자동 집계 (매 분기별)</label>
      </div>
      <button onClick={saveTaxSettings} className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">{saved ? "저장 완료" : "세무자동화 설정 저장"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════
// Certificate Management Tab
// ═══════════════════════════════════════════
function CertificateManagementTab({ companyId }: { companyId: string | null }) {
  const db2 = supabase as any;
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ issuer: "", expires_at: "", purpose_tax: true, purpose_bank: true, purpose_contract: false, password: "" });
  const certFileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const { data: certificates = [] } = useQuery({
    queryKey: ["certificates", companyId],
    queryFn: async () => { if (!companyId) return []; const { data } = await db2.from("certificates").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; },
    enabled: !!companyId,
  });
  const [autoSign, setAutoSign] = useState({ auto_sign_tax_invoice: true, auto_sign_bank_transfer: true });
  const { data: certSettings } = useQuery({
    queryKey: ["cert-settings", companyId],
    queryFn: async () => { if (!companyId) return null; const { data } = await db2.from("companies").select("cert_settings").eq("id", companyId).single(); return data?.cert_settings || {}; },
    enabled: !!companyId,
  });
  useEffect(() => { if (certSettings) setAutoSign((prev) => ({ ...prev, ...certSettings })); }, [certSettings]);

  async function handleCertUpload(file: File) {
    if (!companyId) return;
    setUploadError("");
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (![".pfx", ".p12", ".pem", ".der"].includes(ext)) { setUploadError("지원: .pfx, .p12, .pem, .der"); return; }
    if (file.size > 10 * 1024 * 1024) { setUploadError("10MB 이하만 가능"); return; }
    setUploading(true);
    try {
      const path = `${companyId}/cert_${Date.now()}${ext}`;
      const { error: e } = await supabase.storage.from("certificates").upload(path, file);
      if (e) throw e;
      const { data: u } = supabase.storage.from("certificates").getPublicUrl(path);
      await db2.from("certificates").insert({ company_id: companyId, file_url: u.publicUrl, file_name: file.name, issuer: uploadForm.issuer || null, expires_at: uploadForm.expires_at || null, purpose_tax: uploadForm.purpose_tax, purpose_bank: uploadForm.purpose_bank, purpose_contract: uploadForm.purpose_contract, is_active: true });
      queryClient.invalidateQueries({ queryKey: ["certificates"] });
      setShowUpload(false);
      setUploadForm({ issuer: "", expires_at: "", purpose_tax: true, purpose_bank: true, purpose_contract: false, password: "" });
    } catch (err: any) { setUploadError(err.message || "업로드 실패"); } finally { setUploading(false); }
  }
  async function deleteCert(id: string) { await db2.from("certificates").delete().eq("id", id); queryClient.invalidateQueries({ queryKey: ["certificates"] }); }
  async function saveCertSettings() {
    if (!companyId) return;
    await db2.from("companies").update({ cert_settings: autoSign }).eq("id", companyId);
    queryClient.invalidateQueries({ queryKey: ["cert-settings"] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  if (!companyId) return <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">등록된 인증서</h2>
          <button onClick={() => setShowUpload(!showUpload)} className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition">+ 인증서 등록</button>
        </div>
        {showUpload && (
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
            {uploadError && <div className="p-2 rounded-lg bg-red-500/10 text-red-400 text-xs">{uploadError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block text-xs text-[var(--text-muted)] mb-1">발급기관</label><input value={uploadForm.issuer} onChange={(e) => setUploadForm({ ...uploadForm, issuer: e.target.value })} placeholder="한국정보인증" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /></div>
              <div><label className="block text-xs text-[var(--text-muted)] mb-1">만료일</label><input type="date" value={uploadForm.expires_at} onChange={(e) => setUploadForm({ ...uploadForm, expires_at: e.target.value })} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /></div>
            </div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">용도</label><div className="flex gap-4">{[{ k: "purpose_tax", l: "세금계산서" }, { k: "purpose_bank", l: "계좌이체" }, { k: "purpose_contract", l: "전자계약" }].map(({ k, l }) => (<label key={k} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><input type="checkbox" checked={(uploadForm as any)[k]} onChange={(e) => setUploadForm({ ...uploadForm, [k]: e.target.checked })} className="rounded" /> {l}</label>))}</div></div>
            <div><label className="block text-xs text-[var(--text-muted)] mb-1">인증서 비밀번호</label><input type="password" value={uploadForm.password} onChange={(e) => setUploadForm({ ...uploadForm, password: e.target.value })} placeholder="비밀번호" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" /><p className="text-[10px] text-[var(--text-dim)] mt-1">자동서명에 사용. 암호화 저장.</p></div>
            <div className="flex gap-2"><button onClick={() => certFileRef.current?.click()} disabled={uploading} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">{uploading ? "업로드 중..." : "파일 선택 (.pfx/.p12)"}</button><button onClick={() => setShowUpload(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">취소</button></div>
            <input ref={certFileRef} type="file" accept=".pfx,.p12,.pem,.der" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCertUpload(f); e.target.value = ""; }} />
          </div>
        )}
        {certificates.length === 0 ? (
          <div className="text-center py-8"><div className="text-3xl mb-2">🔐</div><div className="text-sm text-[var(--text-muted)]">등록된 인증서가 없습니다</div><p className="text-xs text-[var(--text-dim)] mt-1">공인인증서 등록 시 자동서명이 가능합니다</p></div>
        ) : (
          <div className="space-y-2">{certificates.map((c: any) => { const d = c.expires_at ? daysLeft(c.expires_at) : null; return (
            <div key={c.id} className="px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${d !== null && d <= 0 ? "bg-red-100" : d !== null && d <= 30 ? "bg-amber-100" : "bg-green-100"}`}>🔐</div>
                  <div><div className="text-sm font-medium">{c.file_name}</div><div className="text-xs text-[var(--text-dim)]">{c.issuer || "발급기관 미입력"}{c.expires_at && <span className={`ml-2 ${d !== null && d <= 0 ? "text-red-500" : d !== null && d <= 30 ? "text-amber-500" : ""}`}>만료: {c.expires_at.split("T")[0]}{d !== null && d <= 0 ? " (만료)" : d !== null && d <= 30 ? ` (${d}일)` : ""}</span>}</div></div>
                </div>
                <button onClick={() => deleteCert(c.id)} className="text-xs text-red-400/60 hover:text-red-400">삭제</button>
              </div>
              <div className="flex gap-2 mt-2">
                {c.purpose_tax && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold">세금계산서</span>}
                {c.purpose_bank && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-600 font-semibold">계좌이체</span>}
                {c.purpose_contract && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 font-semibold">전자계약</span>}
              </div>
            </div>); })}</div>
        )}
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-sm font-bold mb-4">자동서명 규칙</h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer"><div><div className="text-sm font-medium">승인완료 세금계산서 자동서명</div><div className="text-xs text-[var(--text-dim)] mt-0.5">발행 시 등록된 인증서로 자동 서명</div></div><input type="checkbox" checked={autoSign.auto_sign_tax_invoice} onChange={(e) => setAutoSign({ ...autoSign, auto_sign_tax_invoice: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" /></label>
          <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] cursor-pointer"><div><div className="text-sm font-medium">자동이체 시 인증서 서명</div><div className="text-xs text-[var(--text-dim)] mt-0.5">은행 이체 실행 시 전자서명</div></div><input type="checkbox" checked={autoSign.auto_sign_bank_transfer} onChange={(e) => setAutoSign({ ...autoSign, auto_sign_bank_transfer: e.target.checked })} className="w-5 h-5 rounded accent-[var(--primary)]" /></label>
        </div>
      </div>
      <button onClick={saveCertSettings} className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">{saved ? "저장 완료" : "인증서 설정 저장"}</button>
    </div>
  );
}
