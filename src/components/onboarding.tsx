"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const ONBOARDING_KEY = "leanos-onboarding-done";
const ONBOARDING_DISMISS_KEY = "leanos-onboarding-dismissed";

export function shouldShowOnboarding(dealCount: number): boolean {
  if (typeof window === "undefined") return false;
  // Permanently completed (finished all steps)
  if (localStorage.getItem(ONBOARDING_KEY)) return false;
  // Temporarily dismissed for this session
  if (sessionStorage.getItem(ONBOARDING_DISMISS_KEY)) return false;
  return dealCount === 0;
}

/** Re-trigger onboarding by clearing dismiss flags */
export function resetOnboardingDismiss(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ONBOARDING_KEY);
  sessionStorage.removeItem(ONBOARDING_DISMISS_KEY);
}

// ── Step Definitions ──
const STEPS = [
  { num: 1, label: "회사정보", icon: "building", desc: "사업자 정보를 등록하세요" },
  { num: 2, label: "통장 등록", icon: "bank", desc: "법인통장을 연결하세요" },
  { num: 3, label: "직원 등록", icon: "people", desc: "팀원을 추가하세요" },
  { num: 4, label: "첫 프로젝트", icon: "sparkles", desc: "첫 거래를 만드세요" },
  { num: 5, label: "완료", icon: "check", desc: "준비 완료!" },
];

interface CompletionStatus {
  companyInfo: boolean;
  bankAccount: boolean;
  employee: boolean;
  deal: boolean;
}

interface OnboardingWizardProps {
  companyId: string;
  companyName: string;
  onComplete: () => void;
}

// ═══════════════════════════════════════════
// OnboardingWizard — 5-step Company Setup
// ═══════════════════════════════════════════
export function OnboardingWizard({ companyId, companyName, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Completion status from DB
  const [status, setStatus] = useState<CompletionStatus>({
    companyInfo: false,
    bankAccount: false,
    employee: false,
    deal: false,
  });

  // Step 1: Company
  const [company, setCompany] = useState({
    companyName: companyName || "",
    businessNumber: "",
    representative: "",
    address: "",
    industry: "",
    phone: "",
  });

  // Step 2: Bank accounts
  const [banks, setBanks] = useState<Array<{
    bank_name: string; account_number: string; alias: string; balance: string; role: string;
  }>>([]);
  const [bankForm, setBankForm] = useState({
    bank_name: "", account_number: "", alias: "", balance: "", role: "OPERATING",
  });

  // Step 3: Employees
  const [employees, setEmployees] = useState<Array<{
    name: string; position: string; department: string; email: string;
  }>>([]);
  const [empForm, setEmpForm] = useState({
    name: "", position: "", department: "", email: "",
  });

  // Step 4: Deal creation
  const [dealName, setDealName] = useState("");
  const [dealType, setDealType] = useState<"REVENUE" | "EXPENSE">("REVENUE");
  const [dealAmount, setDealAmount] = useState("");
  const [dealPartner, setDealPartner] = useState("");

  // ── Check completion status on mount ──
  useEffect(() => {
    async function checkStatus() {
      const db = supabase as any;
      try {
        // Check company info
        const { data: comp } = await db
          .from("companies")
          .select("name, business_number")
          .eq("id", companyId)
          .single();
        const hasCompany = !!(comp?.name && comp?.business_number);

        // Check bank accounts
        const { count: bankCount } = await db
          .from("bank_accounts")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        const hasBank = (bankCount ?? 0) > 0;

        // Check employees
        const { count: empCount } = await db
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        const hasEmployee = (empCount ?? 0) > 0;

        // Check deals
        const { count: dealCount } = await db
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        const hasDeal = (dealCount ?? 0) > 0;

        const newStatus = {
          companyInfo: hasCompany,
          bankAccount: hasBank,
          employee: hasEmployee,
          deal: hasDeal,
        };
        setStatus(newStatus);

        // Pre-fill company info if it exists
        if (comp?.name) {
          setCompany(prev => ({
            ...prev,
            companyName: comp.name || prev.companyName,
            businessNumber: comp.business_number || prev.businessNumber,
          }));
        }

        // Auto-advance to first incomplete step
        if (hasCompany && hasBank && hasEmployee && hasDeal) {
          // All done — go to completion
          setStep(5);
        } else if (hasCompany && hasBank && hasEmployee) {
          setStep(4);
        } else if (hasCompany && hasBank) {
          setStep(3);
        } else if (hasCompany) {
          setStep(2);
        } else {
          setStep(1);
        }
      } catch (err) {
        console.error("Status check error:", err);
      }
      setLoading(false);
    }
    checkStatus();
  }, [companyId]);

  // ── Save step data ──
  const saveStep = useCallback(async (currentStep: number) => {
    setSaving(true);
    setSaveError(null);
    const db = supabase as any;
    try {
      if (currentStep === 1) {
        // Save company info
        await db.from("companies").update({
          name: company.companyName || companyName,
          business_number: company.businessNumber || undefined,
          representative: company.representative || undefined,
          address: company.address || undefined,
          industry: company.industry || undefined,
          phone: company.phone || undefined,
        }).eq("id", companyId);
        setStatus(prev => ({ ...prev, companyInfo: true }));
      } else if (currentStep === 2) {
        // Save bank accounts
        for (const bank of banks) {
          await db.from("bank_accounts").insert({
            company_id: companyId,
            bank_name: bank.bank_name,
            account_number: bank.account_number,
            alias: bank.alias,
            role: bank.role,
            balance: parseInt(bank.balance.replace(/[^0-9]/g, ""), 10) || 0,
            is_primary: banks.indexOf(bank) === 0,
          });
        }
        if (banks.length > 0) setStatus(prev => ({ ...prev, bankAccount: true }));
      } else if (currentStep === 3) {
        // Save employees
        for (const emp of employees) {
          await db.from("employees").insert({
            company_id: companyId,
            name: emp.name,
            position: emp.position || null,
            department: emp.department || null,
            email: emp.email || null,
            hire_date: new Date().toISOString().split("T")[0],
            status: "active",
          });
        }
        if (employees.length > 0) setStatus(prev => ({ ...prev, employee: true }));
      } else if (currentStep === 4) {
        // Create first deal
        if (dealName) {
          await db.from("deals").insert({
            company_id: companyId,
            name: dealName,
            type: dealType,
            amount: parseInt(dealAmount.replace(/[^0-9]/g, ""), 10) || 0,
            partner_name: dealPartner || null,
            status: "active",
            stage: "lead",
          });
          setStatus(prev => ({ ...prev, deal: true }));
        }
      }
    } catch (err) {
      console.error("Step save error:", err);
      setSaveError("저장 중 오류가 발생했습니다. 다시 시도해주세요.");
      setSaving(false);
      return false;
    }
    setSaving(false);
    return true;
  }, [company, banks, employees, dealName, dealType, dealAmount, dealPartner, companyId, companyName]);

  const handleNext = useCallback(async () => {
    if (step < 5) {
      // Save current step data before advancing
      const stepHasData = (
        (step === 1 && company.companyName && company.businessNumber) ||
        (step === 2 && banks.length > 0) ||
        (step === 3 && employees.length > 0) ||
        (step === 4 && dealName)
      );
      if (stepHasData) {
        const ok = await saveStep(step);
        if (!ok) return;
      }
      setStep(step + 1);
    }
  }, [step, company, banks, employees, dealName, saveStep]);

  const handleBack = () => { if (step > 1) setStep(step - 1); };

  const handleSkip = () => {
    if (step < 5) setStep(step + 1);
  };

  const handleFinish = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    onComplete();
  }, [onComplete]);

  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(ONBOARDING_DISMISS_KEY, "true");
    onComplete();
  }, [onComplete]);

  // ESC key to dismiss
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleDismiss]);

  // Add helpers
  const addBank = () => {
    if (!bankForm.bank_name || !bankForm.account_number) return;
    setBanks([...banks, { ...bankForm }]);
    setBankForm({ bank_name: "", account_number: "", alias: "", balance: "", role: "OPERATING" });
  };
  const removeBank = (i: number) => setBanks(banks.filter((_, idx) => idx !== i));

  const addEmployee = () => {
    if (!empForm.name) return;
    setEmployees([...employees, { ...empForm }]);
    setEmpForm({ name: "", position: "", department: "", email: "" });
  };
  const removeEmployee = (i: number) => setEmployees(employees.filter((_, idx) => idx !== i));

  // Completed step count for progress
  const completedSteps = [status.companyInfo, status.bankAccount, status.employee, status.deal].filter(Boolean).length;

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-[600px] mx-4 rounded-2xl shadow-lg p-10 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
          <div className="animate-spin w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">설정 상태를 확인하는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={handleDismiss}>
      <div
        className="w-full max-w-[600px] mx-4 rounded-2xl shadow-lg overflow-hidden relative"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 닫기 버튼 */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
          aria-label="닫기"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>

        {/* ── Progress Bar ── */}
        <div className="px-6 pt-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--text)]">초기 설정</span>
            <span className="text-xs text-[var(--text-dim)]">{step} / {STEPS.length} 단계</span>
          </div>
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.num} className="flex items-center flex-1">
                <button
                  onClick={() => setStep(s.num)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-all shrink-0 cursor-pointer"
                  style={{
                    background: s.num === step ? "var(--primary)" : s.num < step || (s.num === 1 && status.companyInfo) || (s.num === 2 && status.bankAccount) || (s.num === 3 && status.employee) || (s.num === 4 && status.deal) ? "var(--primary)" : "var(--bg-surface)",
                    color: s.num <= step || (s.num === 1 && status.companyInfo) || (s.num === 2 && status.bankAccount) || (s.num === 3 && status.employee) || (s.num === 4 && status.deal) ? "#fff" : "var(--text-dim)",
                    border: s.num <= step || (s.num === 1 && status.companyInfo) || (s.num === 2 && status.bankAccount) || (s.num === 3 && status.employee) || (s.num === 4 && status.deal) ? "2px solid var(--primary)" : "2px solid var(--border)",
                    opacity: s.num === step ? 1 : 0.7,
                  }}
                  title={s.label}
                >
                  {(s.num < step || (s.num === 1 && status.companyInfo && step !== 1) || (s.num === 2 && status.bankAccount && step !== 2) || (s.num === 3 && status.employee && step !== 3) || (s.num === 4 && status.deal && step !== 4)) ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : s.num}
                </button>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-[2px] mx-1 rounded-full transition-all" style={{ background: s.num < step ? "var(--primary)" : "var(--border)" }} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-[var(--text-dim)] font-medium mt-1.5 px-0.5">
            {STEPS.map(s => (
              <span key={s.num} className="text-center" style={{ width: `${100/STEPS.length}%`, color: s.num === step ? "var(--primary)" : undefined, fontWeight: s.num === step ? 700 : undefined }}>
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="px-6 py-4 min-h-[360px] max-h-[60vh] overflow-y-auto flex flex-col">
          {step === 1 && (
            <StepCompanyInfo
              data={company}
              set={setCompany}
              isCompleted={status.companyInfo}
            />
          )}
          {step === 2 && (
            <StepBankSetup
              banks={banks}
              form={bankForm}
              setForm={setBankForm}
              add={addBank}
              remove={removeBank}
              isCompleted={status.bankAccount}
            />
          )}
          {step === 3 && (
            <StepEmployeeSetup
              employees={employees}
              form={empForm}
              setForm={setEmpForm}
              add={addEmployee}
              remove={removeEmployee}
              isCompleted={status.employee}
            />
          )}
          {step === 4 && (
            <StepFirstDeal
              dealName={dealName}
              setDealName={setDealName}
              dealType={dealType}
              setDealType={setDealType}
              dealAmount={dealAmount}
              setDealAmount={setDealAmount}
              dealPartner={dealPartner}
              setDealPartner={setDealPartner}
              isCompleted={status.deal}
            />
          )}
          {step === 5 && (
            <StepComplete status={status} />
          )}
          {saveError && (
            <div className="mt-3 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
              {saveError}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <div>
            {step > 1 && step < 5 && (
              <button onClick={handleBack} className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition">
                이전
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <button onClick={handleDismiss} className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] transition">
                나중에 하기
              </button>
            )}
            {step >= 1 && step <= 4 && (
              <button onClick={handleSkip} className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] transition">
                건너뛰기
              </button>
            )}
            {step < 5 && (
              <button
                onClick={handleNext}
                disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-bold text-white transition disabled:opacity-60"
                style={{ background: "var(--primary)" }}
              >
                {saving ? "저장 중..." : "다음"}
              </button>
            )}
            {step === 5 && (
              <button
                onClick={handleFinish}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition"
                style={{ background: "var(--primary)" }}
              >
                대시보드로 시작하기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 1: Company Info (회사정보)
// ═══════════════════════════════════════════
function StepCompanyInfo({ data, set, isCompleted }: { data: any; set: (d: any) => void; isCompleted: boolean }) {
  return (
    <div className="flex-1">
      <StepHeader
        title="회사 기본 정보"
        desc="사업자 정보를 입력하세요. 세금계산서, 문서 생성에 사용됩니다."
        icon="building"
        whyItMatters="정확한 사업자 정보는 세금계산서 발행, 계약서 작성 등 모든 공식 문서의 기반이 됩니다."
      />
      {isCompleted && (
        <CompletedBadge message="이미 회사 정보가 등록되어 있습니다. 수정하거나 다음 단계로 넘어가세요." />
      )}
      <div className="space-y-3">
        <Field label="회사명 *" value={data.companyName} onChange={(v) => set({ ...data, companyName: v })} placeholder="주식회사 예시" />
        <Field label="사업자등록번호 *" value={data.businessNumber} onChange={(v) => set({ ...data, businessNumber: v })} placeholder="000-00-00000" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="대표자명" value={data.representative} onChange={(v) => set({ ...data, representative: v })} placeholder="홍길동" />
          <Field label="업종" value={data.industry} onChange={(v) => set({ ...data, industry: v })} placeholder="IT/소프트웨어" />
        </div>
        <Field label="사업장 주소" value={data.address} onChange={(v) => set({ ...data, address: v })} placeholder="서울시 강남구..." />
        <Field label="대표 전화" value={data.phone} onChange={(v) => set({ ...data, phone: v })} placeholder="02-1234-5678" />
      </div>
      <LinkHint href="/settings" label="설정 페이지에서 더 상세한 회사 정보를 관리할 수 있습니다" />
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 2: Bank Account (통장 등록)
// ═══════════════════════════════════════════
function StepBankSetup({ banks, form, setForm, add, remove, isCompleted }: {
  banks: any[]; form: any; setForm: (f: any) => void; add: () => void; remove: (i: number) => void; isCompleted: boolean;
}) {
  const BANKS = ["국민", "신한", "우리", "하나", "기업", "농협", "카카오뱅크", "토스뱅크", "SC제일", "대구", "부산", "기타"];
  const ROLES = [
    { value: "OPERATING", label: "운영" },
    { value: "TAX", label: "세금" },
    { value: "RESERVE", label: "예비" },
    { value: "SALARY", label: "급여" },
  ];

  return (
    <div className="flex-1">
      <StepHeader
        title="법인통장 등록"
        desc="회사 통장을 등록하면 잔고 현황과 거래 내역을 관리할 수 있습니다."
        icon="bank"
        whyItMatters="통장을 등록하면 자금 흐름(캐시플로우)을 자동 추적하고 런웨이를 계산할 수 있습니다."
      />
      {isCompleted && (
        <CompletedBadge message="통장이 이미 등록되어 있습니다. 추가 등록하거나 다음으로 넘어가세요." />
      )}

      {/* Added banks */}
      {banks.length > 0 && (
        <div className="space-y-2 mb-4">
          {banks.map((b, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text)]">{b.alias || b.bank_name}</div>
                <div className="text-xs text-[var(--text-dim)]">{b.bank_name} {b.account_number}</div>
              </div>
              <div className="flex items-center gap-3">
                {b.balance && <span className="text-sm font-bold text-[var(--text)]">{parseInt(b.balance).toLocaleString()}원</span>}
                <button onClick={() => remove(i)} className="text-xs text-red-400 hover:text-red-500">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-[var(--text-dim)] mb-1">은행 *</label>
            <select
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-card)] border border-[var(--border)] outline-none focus:border-[var(--primary)]"
            >
              <option value="">선택</option>
              {BANKS.map(b => <option key={b} value={b}>{b}은행</option>)}
            </select>
          </div>
          <Field label="계좌번호 *" value={form.account_number} onChange={(v) => setForm({ ...form, account_number: v })} placeholder="123-456-789012" small />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="별칭" value={form.alias} onChange={(v) => setForm({ ...form, alias: v })} placeholder="메인 운영통장" small />
          <Field label="현재 잔고 (원)" value={form.balance} onChange={(v) => setForm({ ...form, balance: v.replace(/[^0-9]/g, "") })} placeholder="50,000,000" small />
          <div>
            <label className="block text-[10px] font-semibold text-[var(--text-dim)] mb-1">용도</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-card)] border border-[var(--border)] outline-none focus:border-[var(--primary)]"
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={add}
          disabled={!form.bank_name || !form.account_number}
          className="w-full py-2 rounded-lg text-xs font-semibold text-[var(--primary)] bg-[var(--primary-light)] hover:bg-[var(--primary)]/20 transition disabled:opacity-40"
        >
          + 통장 추가
        </button>
      </div>
      <LinkHint href="/settings" label="설정 > 통장/카드 탭에서 더 상세하게 관리할 수 있습니다" />
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 3: Employee Setup (직원 등록)
// ═══════════════════════════════════════════
function StepEmployeeSetup({ employees, form, setForm, add, remove, isCompleted }: {
  employees: any[]; form: any; setForm: (f: any) => void; add: () => void; remove: (i: number) => void; isCompleted: boolean;
}) {
  return (
    <div className="flex-1">
      <StepHeader
        title="직원 등록"
        desc="팀원을 등록하면 근태, 급여, 경비 관리를 바로 시작할 수 있습니다."
        icon="people"
        whyItMatters="직원 등록은 급여 관리, 4대보험 처리, 근태 관리의 첫 단계입니다."
      />
      {isCompleted && (
        <CompletedBadge message="직원이 이미 등록되어 있습니다. 추가 등록하거나 다음으로 넘어가세요." />
      )}

      {employees.length > 0 && (
        <div className="space-y-2 mb-4">
          {employees.map((emp, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <div>
                <div className="text-sm font-medium text-[var(--text)]">{emp.name}</div>
                <div className="text-xs text-[var(--text-dim)]">{[emp.department, emp.position].filter(Boolean).join(" · ") || "미지정"}</div>
              </div>
              <button onClick={() => remove(i)} className="text-xs text-red-400 hover:text-red-500">삭제</button>
            </div>
          ))}
        </div>
      )}

      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름 *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="홍길동" small />
          <Field label="직급" value={form.position} onChange={(v) => setForm({ ...form, position: v })} placeholder="사원/대리/과장..." small />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="부서" value={form.department} onChange={(v) => setForm({ ...form, department: v })} placeholder="개발팀" small />
          <Field label="이메일" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="name@company.com" small />
        </div>
        <button
          onClick={add}
          disabled={!form.name}
          className="w-full py-2 rounded-lg text-xs font-semibold text-[var(--primary)] bg-[var(--primary-light)] hover:bg-[var(--primary)]/20 transition disabled:opacity-40"
        >
          + 직원 추가
        </button>
      </div>
      <LinkHint href="/employees" label="직원 관리 페이지에서 급여, 근태까지 상세 설정할 수 있습니다" />
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 4: First Deal (첫 프로젝트)
// ═══════════════════════════════════════════
function StepFirstDeal({ dealName, setDealName, dealType, setDealType, dealAmount, setDealAmount, dealPartner, setDealPartner, isCompleted }: {
  dealName: string; setDealName: (v: string) => void;
  dealType: "REVENUE" | "EXPENSE"; setDealType: (v: "REVENUE" | "EXPENSE") => void;
  dealAmount: string; setDealAmount: (v: string) => void;
  dealPartner: string; setDealPartner: (v: string) => void;
  isCompleted: boolean;
}) {
  return (
    <div className="flex-1">
      <StepHeader
        title="첫 프로젝트(거래) 만들기"
        desc="매출이든 비용이든, 첫 번째 거래를 등록하면 대시보드가 활성화됩니다."
        icon="sparkles"
        whyItMatters="거래(딜)는 OwnerView의 핵심 단위입니다. 매출/비용 추적, 문서 관리가 모두 딜 기반으로 동작합니다."
      />
      {isCompleted && (
        <CompletedBadge message="거래가 이미 등록되어 있습니다. 추가하거나 완료로 넘어가세요." />
      )}

      <div className="space-y-4">
        {/* Deal type toggle */}
        <div>
          <label className="block text-xs font-semibold text-[var(--text-dim)] mb-2">거래 유형</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "REVENUE" as const, label: "매출 (수익)", icon: "+" },
              { value: "EXPENSE" as const, label: "비용 (지출)", icon: "-" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDealType(opt.value)}
                className="p-3 rounded-xl text-center transition border"
                style={{
                  background: dealType === opt.value ? "var(--primary)" : "var(--bg-surface)",
                  color: dealType === opt.value ? "#fff" : "var(--text)",
                  borderColor: dealType === opt.value ? "var(--primary)" : "var(--border)",
                }}
              >
                <div className="text-lg font-bold">{opt.icon}</div>
                <div className="text-xs font-semibold mt-0.5">{opt.label}</div>
              </button>
            ))}
          </div>
        </div>

        <Field label="거래(프로젝트)명 *" value={dealName} onChange={setDealName} placeholder="예: A사 웹사이트 개발 프로젝트" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="거래처" value={dealPartner} onChange={setDealPartner} placeholder="거래 상대방 이름" />
          <Field label="예상 금액 (원)" value={dealAmount} onChange={(v) => setDealAmount(v.replace(/[^0-9]/g, ""))} placeholder="10,000,000" />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 5: Complete (완료)
// ═══════════════════════════════════════════
function StepComplete({ status }: { status: CompletionStatus }) {
  const items = [
    { label: "회사 정보", done: status.companyInfo, icon: "building" },
    { label: "통장 등록", done: status.bankAccount, icon: "bank" },
    { label: "직원 등록", done: status.employee, icon: "people" },
    { label: "첫 프로젝트", done: status.deal, icon: "sparkles" },
  ];
  const doneCount = items.filter(i => i.done).length;

  return (
    <div className="flex-1 flex flex-col items-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: "var(--primary)" }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-[var(--text)] mb-1">
        {doneCount === 4 ? "모든 설정 완료!" : "초기 설정 진행 중"}
      </h2>
      <p className="text-sm text-[var(--text-muted)] mb-6 text-center">
        {doneCount === 4
          ? "OwnerView가 준비되었습니다. 대시보드에서 바로 시작하세요!"
          : `${doneCount}/4 단계를 완료했습니다. 나머지는 나중에 설정할 수 있습니다.`
        }
      </p>

      <div className="w-full space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <SectionIcon type={item.icon} />
            <span className="flex-1 text-sm font-medium text-[var(--text)]">{item.label}</span>
            {item.done ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-600 font-bold">완료</span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 font-bold">건너뜀</span>
            )}
          </div>
        ))}
      </div>

      {doneCount < 4 && (
        <p className="mt-4 text-xs text-[var(--text-dim)] text-center">
          건너뛴 항목은 설정 페이지에서 언제든 완료할 수 있습니다.
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════
function StepHeader({ title, desc, icon, whyItMatters }: { title: string; desc: string; icon: string; whyItMatters?: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-start gap-3">
        <SectionIcon type={icon} size="lg" />
        <div>
          <h2 className="text-base font-bold text-[var(--text)]">{title}</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>
        </div>
      </div>
      {whyItMatters && (
        <div className="mt-3 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
          <div className="flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="text-[11px] text-blue-700 leading-relaxed">{whyItMatters}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CompletedBadge({ message }: { message: string }) {
  return (
    <div className="mb-4 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200 flex items-start gap-2">
      <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <span className="text-xs text-green-700">{message}</span>
    </div>
  );
}

function LinkHint({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-4 text-center">
      <a
        href={href}
        className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--primary)] transition"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        {label}
      </a>
    </div>
  );
}

function SectionIcon({ type, size = "sm" }: { type: string; size?: "sm" | "lg" }) {
  const s = size === "lg" ? "w-10 h-10" : "w-7 h-7";
  const iconS = size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5";
  const svgProps = {
    className: `${iconS} text-[var(--primary)]`,
    fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24",
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };

  const icon = (() => {
    switch (type) {
      case "building":
        return <svg {...svgProps}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>;
      case "bank":
        return <svg {...svgProps}><path d="M3 21h18" /><path d="M3 10h18" /><path d="M12 3l9 7H3l9-7z" /><path d="M5 10v8" /><path d="M19 10v8" /><path d="M9 10v8" /><path d="M15 10v8" /></svg>;
      case "card":
        return <svg {...svgProps}><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>;
      case "tax":
        return <svg {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>;
      case "people":
        return <svg {...svgProps}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>;
      case "sparkles":
        return <svg {...svgProps}><path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" /><path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5L5 3z" /><path d="M19 17l.5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5L19 17z" /></svg>;
      case "check":
        return <svg {...svgProps}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
      default:
        return null;
    }
  })();

  return (
    <div className={`${s} rounded-xl bg-[var(--primary-light)] flex items-center justify-center shrink-0`}>
      {icon}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", small }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; small?: boolean;
}) {
  return (
    <div>
      <label className={`block font-semibold text-[var(--text-dim)] mb-1 ${small ? "text-[10px]" : "text-xs"}`}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 rounded-xl outline-none transition bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] focus:border-[var(--primary)] ${small ? "py-2 text-xs" : "py-2.5 text-sm"}`}
      />
    </div>
  );
}
