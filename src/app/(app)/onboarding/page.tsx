"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

// ── Constants ──

const STEPS = [
  { num: 1, label: "회사 정보", icon: "building" },
  { num: 2, label: "금융 연결", icon: "bank" },
  { num: 3, label: "첫 직원", icon: "people" },
  { num: 4, label: "첫 딜", icon: "sparkles" },
  { num: 5, label: "완료", icon: "check" },
] as const;

const TOTAL_STEPS = STEPS.length;

const KOREAN_BANKS = [
  "KB 국민은행",
  "신한은행",
  "하나은행",
  "우리은행",
  "IBK 기업은행",
  "NH 농협은행",
  "KDB 산업은행",
  "SC 제일은행",
  "카카오뱅크",
  "토스뱅크",
  "케이뱅크",
  "대구은행",
  "부산은행",
  "광주은행",
  "수협은행",
  "전북은행",
  "경남은행",
  "제주은행",
];

const INDUSTRIES = [
  "IT/소프트웨어",
  "제조업",
  "유통/물류",
  "건설/부동산",
  "금융/보험",
  "교육",
  "의료/바이오",
  "미디어/콘텐츠",
  "외식/F&B",
  "기타",
];

const BUSINESS_NUMBER_REGEX = /^\d{3}-\d{2}-\d{5}$/;

const DEPARTMENTS = ["경영지원", "개발", "디자인", "마케팅", "영업", "인사", "재무", "기획", "기타"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

type StepNumber = 1 | 2 | 3 | 4 | 5;

interface CompanyForm {
  name: string;
  businessNumber: string;
  industry: string;
  address: string;
  representative: string;
  phone: string;
}

interface BankForm {
  bankName: string;
  accountNumber: string;
  accountAlias: string;
  role: string;
}

interface EmployeeForm {
  name: string;
  position: string;
  department: string;
  email: string;
  startDate: string;
}

interface DealForm {
  name: string;
  clientName: string;
  expectedAmount: string;
  expectedCloseDate: string;
  type: "REVENUE" | "EXPENSE";
}

interface CompletionStatus {
  companyInfo: boolean;
  bankAccount: boolean;
  employee: boolean;
  deal: boolean;
}

// ── Main Component ──

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { toast } = useToast();

  const [step, setStep] = useState<StepNumber>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);

  const companyId = user?.company_id ?? null;

  // Completion tracking
  const [status, setStatus] = useState<CompletionStatus>({
    companyInfo: false,
    bankAccount: false,
    employee: false,
    deal: false,
  });

  // Step 1: Company
  const [company, setCompany] = useState<CompanyForm>({
    name: "",
    businessNumber: "",
    industry: "",
    address: "",
    representative: "",
    phone: "",
  });

  // Step 2: Bank
  const [bank, setBank] = useState<BankForm>({
    bankName: "",
    accountNumber: "",
    accountAlias: "",
    role: "OPERATING",
  });

  // Step 3: Employee
  const [employee, setEmployee] = useState<EmployeeForm>({
    name: "",
    position: "",
    department: "",
    email: "",
    startDate: new Date().toISOString().split("T")[0],
  });

  // Step 4: Deal
  const [deal, setDeal] = useState<DealForm>({
    name: "",
    clientName: "",
    expectedAmount: "",
    expectedCloseDate: "",
    type: "REVENUE",
  });

  // ── Validation ──

  const companyValidation = useCallback(() => {
    const errors: string[] = [];
    if (!company.name.trim()) errors.push("회사명을 입력해주세요");
    if (!company.businessNumber.trim()) {
      errors.push("사업자번호를 입력해주세요");
    } else if (!BUSINESS_NUMBER_REGEX.test(company.businessNumber)) {
      errors.push("사업자번호 형식이 올바르지 않습니다 (XXX-XX-XXXXX)");
    }
    if (!company.representative.trim()) errors.push("대표자명을 입력해주세요");
    return errors;
  }, [company]);

  const employeeValidation = useCallback(() => {
    const errors: string[] = [];
    if (!employee.name.trim()) errors.push("직원 이름을 입력해주세요");
    if (employee.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) {
      errors.push("이메일 형식이 올바르지 않습니다");
    }
    return errors;
  }, [employee]);

  const dealValidation = useCallback(() => {
    const errors: string[] = [];
    if (!deal.name.trim()) errors.push("딜 이름을 입력해주세요");
    return errors;
  }, [deal]);

  // ── Initialize: check existing data ──

  useEffect(() => {
    if (userLoading || !companyId) return;

    async function checkStatus() {
      try {
        const { data: comp } = await db
          .from("companies")
          .select("name, business_number, representative, industry, address, phone")
          .eq("id", companyId)
          .single();

        const hasCompany = !!(comp?.name && comp?.business_number);
        if (comp) {
          setCompany({
            name: comp.name || "",
            businessNumber: comp.business_number || "",
            industry: comp.industry || "",
            address: comp.address || "",
            representative: comp.representative || "",
            phone: comp.phone || "",
          });
        }

        const { count: bankCount } = await db
          .from("bank_accounts")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        const hasBank = (bankCount ?? 0) > 0;

        const { count: empCount } = await db
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        const hasEmployee = (empCount ?? 0) > 0;

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

        // Auto-advance to first incomplete step
        if (hasCompany && hasBank && hasEmployee && hasDeal) {
          setStep(5);
        } else if (hasCompany && hasBank && hasEmployee) {
          setStep(4);
        } else if (hasCompany && hasBank) {
          setStep(3);
        } else if (hasCompany) {
          setStep(2);
        }
      } catch (err) {
        console.error("Status check error:", err);
      }
      setIsInitialized(true);
    }

    checkStatus();
  }, [userLoading, companyId]);

  // ── Save handlers ──

  async function saveCompanyInfo() {
    const errors = companyValidation();
    if (errors.length > 0) {
      setError(errors[0]);
      return false;
    }
    setSaving(true);
    setError("");
    try {
      const { error: e } = await db.from("companies").update({
        name: company.name.trim(),
        business_number: company.businessNumber.trim(),
        industry: company.industry || null,
        address: company.address || null,
        representative: company.representative.trim(),
        phone: company.phone || null,
      }).eq("id", companyId);

      if (e) throw e;
      setStatus((prev) => ({ ...prev, companyInfo: true }));
      toast("회사 정보가 저장되었습니다", "success");
      setStep(2);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "저장 실패";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveBankInfo() {
    if (!bank.bankName || !bank.accountNumber.trim()) {
      // Allow skip
      setStep(3);
      return true;
    }
    setSaving(true);
    setError("");
    try {
      const { error: e } = await db.from("bank_accounts").insert({
        company_id: companyId,
        bank_name: bank.bankName,
        account_number: bank.accountNumber.replace(/[^0-9]/g, ""),
        alias: bank.accountAlias || bank.bankName,
        role: bank.role,
        balance: 0,
        is_primary: true,
      });

      if (e) throw e;
      setStatus((prev) => ({ ...prev, bankAccount: true }));
      toast("계좌가 등록되었습니다", "success");
      setStep(3);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "저장 실패";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveEmployee() {
    const errors = employeeValidation();
    if (errors.length > 0) {
      setError(errors[0]);
      return false;
    }
    if (!employee.name.trim()) {
      setStep(4);
      return true;
    }
    setSaving(true);
    setError("");
    try {
      const { error: e } = await db.from("employees").insert({
        company_id: companyId,
        name: employee.name.trim(),
        position: employee.position || null,
        department: employee.department || null,
        email: employee.email || null,
        hire_date: employee.startDate || new Date().toISOString().split("T")[0],
        status: "active",
      });

      if (e) throw e;
      setStatus((prev) => ({ ...prev, employee: true }));
      toast("직원이 등록되었습니다", "success");
      setStep(4);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "저장 실패";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveDeal() {
    const errors = dealValidation();
    if (errors.length > 0) {
      setError(errors[0]);
      return false;
    }
    if (!deal.name.trim()) {
      setStep(5);
      return true;
    }
    setSaving(true);
    setError("");
    try {
      const amount = parseInt(deal.expectedAmount.replace(/[^0-9]/g, ""), 10) || 0;
      const { error: e } = await db.from("deals").insert({
        company_id: companyId,
        name: deal.name.trim(),
        type: deal.type,
        amount,
        partner_name: deal.clientName || null,
        expected_close_date: deal.expectedCloseDate || null,
        status: "active",
        stage: "lead",
      });

      if (e) throw e;
      setStatus((prev) => ({ ...prev, deal: true }));
      toast("딜이 등록되었습니다", "success");
      setStep(5);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "저장 실패";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    setError("");
    if (step === 1) saveCompanyInfo();
    else if (step === 2) saveBankInfo();
    else if (step === 3) saveEmployee();
    else if (step === 4) saveDeal();
  }

  function handleSkip() {
    setError("");
    if (step < 5) setStep((step + 1) as StepNumber);
  }

  function handleBack() {
    setError("");
    if (step > 1) setStep((step - 1) as StepNumber);
  }

  function handleComplete() {
    router.replace("/dashboard");
  }

  // ── Keyboard: Enter to submit ──

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (step < 5) handleNext();
      else handleComplete();
    }
  }

  // ── Loading ──

  if (userLoading || !isInitialized) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-[var(--text-muted)]">설정 상태를 확인하는 중...</p>
        </div>
      </div>
    );
  }

  const completedCount = [status.companyInfo, status.bankAccount, status.employee, status.deal].filter(Boolean).length;
  const progressPercent = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-8" onKeyDown={handleKeyDown}>
      <div className="w-full max-w-[640px]">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-bold mb-3">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
            </svg>
            초기 설정
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">
            OwnerView에 오신 것을 환영합니다
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1.5">
            5단계 설정을 완료하면 대시보드를 바로 사용할 수 있습니다
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => {
              const isActive = step === s.num;
              const isDone = step > s.num || (s.num === 1 && status.companyInfo) || (s.num === 2 && status.bankAccount) || (s.num === 3 && status.employee) || (s.num === 4 && status.deal);
              return (
                <div key={s.num} className="flex items-center flex-1">
                  <button
                    onClick={() => setStep(s.num as StepNumber)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    style={{
                      background: isActive || isDone ? "var(--primary)" : "var(--bg-surface)",
                      color: isActive || isDone ? "#fff" : "var(--text-dim)",
                      border: isActive || isDone ? "2px solid var(--primary)" : "2px solid var(--border)",
                    }}
                    aria-label={`${s.num}단계: ${s.label}`}
                    aria-current={isActive ? "step" : undefined}
                  >
                    {isDone && !isActive ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      s.num
                    )}
                  </button>
                  {i < STEPS.length - 1 && (
                    <div
                      className="flex-1 h-[2px] mx-1.5 rounded-full transition-all"
                      style={{ background: s.num < step ? "var(--primary)" : "var(--border)" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between px-0.5">
            {STEPS.map((s) => (
              <span
                key={s.num}
                className="text-[10px] font-medium text-center"
                style={{
                  width: `${100 / TOTAL_STEPS}%`,
                  color: s.num === step ? "var(--primary)" : "var(--text-dim)",
                  fontWeight: s.num === step ? 700 : 500,
                }}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            className="mb-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2"
            style={{ background: "var(--danger)/10", border: "1px solid var(--danger)/20" }}
            role="alert"
          >
            <svg className="w-4 h-4 text-[var(--danger)] mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span className="text-[var(--danger)]">{error}</span>
          </div>
        )}

        {/* Step content */}
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="p-6 min-h-[380px] sm:min-h-[360px]">
            {step === 1 && (
              <Step1Company data={company} onChange={setCompany} isCompleted={status.companyInfo} />
            )}
            {step === 2 && (
              <Step2Bank data={bank} onChange={setBank} isCompleted={status.bankAccount} />
            )}
            {step === 3 && (
              <Step3Employee data={employee} onChange={setEmployee} isCompleted={status.employee} />
            )}
            {step === 4 && (
              <Step4Deal data={deal} onChange={setDeal} isCompleted={status.deal} />
            )}
            {step === 5 && (
              <Step5Complete status={status} />
            )}
          </div>

          {/* Footer */}
          <div
            className="px-6 py-4 flex items-center justify-between"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}
          >
            <div>
              {step > 1 && step < 5 && (
                <button
                  onClick={handleBack}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-card)] transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  이전
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step >= 2 && step <= 4 && (
                <button
                  onClick={handleSkip}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  건너뛰기
                </button>
              )}
              {step < 5 && (
                <button
                  onClick={handleNext}
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  style={{ background: "var(--primary)" }}
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      저장 중...
                    </span>
                  ) : (
                    step === 1 ? "저장하고 다음" : "다음"
                  )}
                </button>
              )}
              {step === 5 && (
                <button
                  onClick={handleComplete}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  style={{ background: "var(--primary)" }}
                >
                  대시보드로 시작하기
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Skip all link */}
        {step < 5 && (
          <div className="mt-4 text-center">
            <button
              onClick={() => router.replace("/dashboard")}
              className="text-xs text-[var(--text-dim)] hover:text-[var(--text-muted)] transition underline underline-offset-2"
            >
              나중에 설정하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 1: Company Info (회사 정보)
// ═══════════════════════════════════════════

function Step1Company({
  data,
  onChange,
  isCompleted,
}: {
  data: CompanyForm;
  onChange: (d: CompanyForm) => void;
  isCompleted: boolean;
}) {
  function formatBusinessNumber(value: string) {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  return (
    <div className="space-y-5">
      <StepHeader
        icon="building"
        title="회사 기본 정보"
        description="세금계산서, 계약서 등 공식 문서에 사용되는 사업자 정보를 등록하세요."
      />
      {isCompleted && (
        <CompletedBadge message="회사 정보가 이미 등록되어 있습니다. 수정하거나 다음 단계로 넘어가세요." />
      )}

      <div className="space-y-4">
        <FormField
          label="회사명"
          required
          value={data.name}
          onChange={(v) => onChange({ ...data, name: v })}
          placeholder="주식회사 모티브이노베이션"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label="사업자등록번호"
            required
            value={data.businessNumber}
            onChange={(v) => onChange({ ...data, businessNumber: formatBusinessNumber(v) })}
            placeholder="000-00-00000"
            maxLength={12}
            hint="하이픈(-) 포함 10자리"
          />
          <FormField
            label="대표자명"
            required
            value={data.representative}
            onChange={(v) => onChange({ ...data, representative: v })}
            placeholder="홍길동"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormSelect
            label="업종"
            value={data.industry}
            onChange={(v) => onChange({ ...data, industry: v })}
            placeholder="업종을 선택하세요"
            options={INDUSTRIES}
          />
          <FormField
            label="대표 전화"
            value={data.phone}
            onChange={(v) => onChange({ ...data, phone: v })}
            placeholder="02-1234-5678"
          />
        </div>
        <FormField
          label="사업장 주소"
          value={data.address}
          onChange={(v) => onChange({ ...data, address: v })}
          placeholder="서울특별시 강남구 테헤란로 123"
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 2: Bank/Card Setup (금융 연결)
// ═══════════════════════════════════════════

function Step2Bank({
  data,
  onChange,
  isCompleted,
}: {
  data: BankForm;
  onChange: (d: BankForm) => void;
  isCompleted: boolean;
}) {
  const ROLES = [
    { value: "OPERATING", label: "운영 계좌" },
    { value: "TAX", label: "세금 계좌" },
    { value: "SALARY", label: "급여 계좌" },
    { value: "RESERVE", label: "예비 계좌" },
  ];

  return (
    <div className="space-y-5">
      <StepHeader
        icon="bank"
        title="법인 계좌 등록"
        description="회사 통장을 등록하면 자금 현황을 한눈에 파악할 수 있습니다."
      />
      {isCompleted && (
        <CompletedBadge message="계좌가 이미 등록되어 있습니다. 추가 등록하거나 다음으로 넘어가세요." />
      )}

      <div className="p-4 rounded-xl bg-[var(--bg)]/50 border border-[var(--border)] space-y-1.5">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-[var(--primary)] mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            통장을 등록하면 캐시플로우 추적, 런웨이 계산 등 재무 기능이 활성화됩니다.
            이 단계는 건너뛸 수 있으며 나중에 설정에서 추가할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <FormSelect
          label="은행 선택"
          value={data.bankName}
          onChange={(v) => onChange({ ...data, bankName: v })}
          placeholder="은행을 선택하세요"
          options={KOREAN_BANKS}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label="계좌번호"
            value={data.accountNumber}
            onChange={(v) => onChange({ ...data, accountNumber: v.replace(/[^0-9-]/g, "") })}
            placeholder="- 없이 숫자만 입력"
          />
          <FormField
            label="계좌 별칭"
            value={data.accountAlias}
            onChange={(v) => onChange({ ...data, accountAlias: v })}
            placeholder="메인 운영통장"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">계좌 용도</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ROLES.map((role) => (
              <button
                key={role.value}
                type="button"
                onClick={() => onChange({ ...data, role: role.value })}
                className="px-3 py-2.5 rounded-xl text-xs font-semibold text-center transition border focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                style={{
                  background: data.role === role.value ? "var(--primary)" : "var(--bg)",
                  color: data.role === role.value ? "#fff" : "var(--text)",
                  borderColor: data.role === role.value ? "var(--primary)" : "var(--border)",
                }}
              >
                {role.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 3: First Employee (첫 직원 등록)
// ═══════════════════════════════════════════

function Step3Employee({
  data,
  onChange,
  isCompleted,
}: {
  data: EmployeeForm;
  onChange: (d: EmployeeForm) => void;
  isCompleted: boolean;
}) {
  return (
    <div className="space-y-5">
      <StepHeader
        icon="people"
        title="첫 직원 등록"
        description="팀원을 등록하면 근태, 급여, 경비 관리를 바로 시작할 수 있습니다."
      />
      {isCompleted && (
        <CompletedBadge message="직원이 이미 등록되어 있습니다. 추가하거나 다음으로 넘어가세요." />
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label="이름"
            required
            value={data.name}
            onChange={(v) => onChange({ ...data, name: v })}
            placeholder="홍길동"
          />
          <FormField
            label="직급/직책"
            value={data.position}
            onChange={(v) => onChange({ ...data, position: v })}
            placeholder="사원/대리/과장..."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormSelect
            label="부서"
            value={data.department}
            onChange={(v) => onChange({ ...data, department: v })}
            placeholder="부서를 선택하세요"
            options={DEPARTMENTS}
          />
          <FormField
            label="이메일"
            value={data.email}
            onChange={(v) => onChange({ ...data, email: v })}
            placeholder="name@company.com"
            type="email"
          />
        </div>
        <FormField
          label="입사일"
          value={data.startDate}
          onChange={(v) => onChange({ ...data, startDate: v })}
          type="date"
        />
      </div>

      <div className="p-4 rounded-xl bg-[var(--bg)]/50 border border-[var(--border)]">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-[var(--primary)] mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            직원 관리 페이지에서 급여 정보, 4대보험, 근태 설정을 추가할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 4: First Deal (첫 딜 등록)
// ═══════════════════════════════════════════

function Step4Deal({
  data,
  onChange,
  isCompleted,
}: {
  data: DealForm;
  onChange: (d: DealForm) => void;
  isCompleted: boolean;
}) {
  function formatCurrency(value: string) {
    const digits = value.replace(/[^0-9]/g, "");
    if (!digits) return "";
    return parseInt(digits, 10).toLocaleString("ko-KR");
  }

  return (
    <div className="space-y-5">
      <StepHeader
        icon="sparkles"
        title="첫 딜(거래) 등록"
        description="매출이든 비용이든, 첫 번째 거래를 등록하면 대시보드가 활성화됩니다."
      />
      {isCompleted && (
        <CompletedBadge message="딜이 이미 등록되어 있습니다. 추가하거나 완료로 넘어가세요." />
      )}

      <div className="space-y-4">
        {/* Deal type toggle */}
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2">거래 유형</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: "REVENUE" as const, label: "매출 (수익)", desc: "고객으로부터의 수입", color: "var(--success)" },
              { value: "EXPENSE" as const, label: "비용 (지출)", desc: "업체에 지불하는 비용", color: "var(--warning)" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...data, type: opt.value })}
                className="p-4 rounded-xl text-left transition border focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                style={{
                  background: data.type === opt.value ? "var(--primary)" : "var(--bg)",
                  color: data.type === opt.value ? "#fff" : "var(--text)",
                  borderColor: data.type === opt.value ? "var(--primary)" : "var(--border)",
                }}
              >
                <div className="text-sm font-bold">{opt.label}</div>
                <div className="text-[11px] mt-0.5" style={{ opacity: 0.7 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <FormField
          label="딜(프로젝트)명"
          required
          value={data.name}
          onChange={(v) => onChange({ ...data, name: v })}
          placeholder="예: A사 웹사이트 개발 프로젝트"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label="거래처"
            value={data.clientName}
            onChange={(v) => onChange({ ...data, clientName: v })}
            placeholder="거래 상대방 이름"
          />
          <FormField
            label="예상 금액 (원)"
            value={data.expectedAmount}
            onChange={(v) => onChange({ ...data, expectedAmount: formatCurrency(v) })}
            placeholder="10,000,000"
          />
        </div>
        <FormField
          label="예상 마감일"
          value={data.expectedCloseDate}
          onChange={(v) => onChange({ ...data, expectedCloseDate: v })}
          type="date"
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 5: Complete (완료)
// ═══════════════════════════════════════════

function Step5Complete({ status }: { status: CompletionStatus }) {
  const items = [
    { label: "회사 정보", done: status.companyInfo },
    { label: "계좌 등록", done: status.bankAccount },
    { label: "직원 등록", done: status.employee },
    { label: "첫 딜 등록", done: status.deal },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const isAllDone = doneCount === items.length;

  // Confetti particles
  const particles = useRef(
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 2 + Math.random() * 2,
      size: 4 + Math.random() * 6,
      color: ["var(--primary)", "var(--success)", "var(--warning)", "#a855f7", "#ec4899"][Math.floor(Math.random() * 5)],
    }))
  ).current;

  return (
    <div className="flex flex-col items-center text-center relative overflow-hidden">
      {/* Confetti animation */}
      {isAllDone && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {particles.map((p) => (
            <div
              key={p.id}
              className="absolute rounded-full animate-confetti"
              style={{
                left: `${p.left}%`,
                top: "-10px",
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
              }}
            />
          ))}
          <style>{`
            @keyframes confetti {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(500px) rotate(720deg); opacity: 0; }
            }
            .animate-confetti {
              animation-name: confetti;
              animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
              animation-fill-mode: forwards;
            }
          `}</style>
        </div>
      )}

      {/* Icon */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-5 relative z-10"
        style={{ background: isAllDone ? "var(--primary)" : "var(--bg-surface)", border: isAllDone ? "none" : "2px solid var(--border)" }}
      >
        {isAllDone ? (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
          </svg>
        ) : (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
      </div>

      {/* Title */}
      <h2 className="text-xl font-bold text-[var(--text)] mb-2 relative z-10">
        {isAllDone ? "모든 설정이 완료되었습니다!" : "초기 설정 진행 중"}
      </h2>
      <p className="text-sm text-[var(--text-muted)] mb-6 relative z-10">
        {isAllDone
          ? "OwnerView가 준비되었습니다. 대시보드에서 경영의 모든 것을 관리하세요."
          : `${doneCount}/${items.length}단계를 완료했습니다. 나머지는 나중에 설정할 수 있습니다.`}
      </p>

      {/* Checklist */}
      <div className="w-full space-y-2 relative z-10">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border"
            style={{
              background: "var(--bg)",
              borderColor: "var(--border)",
            }}
          >
            {item.done ? (
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--success)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            ) : (
              <div
                className="w-6 h-6 rounded-full border-2 shrink-0"
                style={{ borderColor: "var(--border)" }}
              />
            )}
            <span className="flex-1 text-sm font-medium text-left" style={{ color: item.done ? "var(--text)" : "var(--text-dim)" }}>
              {item.label}
            </span>
            {item.done ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "var(--success)/15", color: "var(--success)" }}>
                완료
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "var(--bg-surface)", color: "var(--text-dim)" }}>
                건너뜀
              </span>
            )}
          </div>
        ))}
      </div>

      {!isAllDone && (
        <p className="mt-4 text-xs text-[var(--text-dim)] relative z-10">
          건너뛴 항목은 설정 페이지에서 언제든 완료할 수 있습니다.
        </p>
      )}

      {/* Quick links */}
      {isAllDone && (
        <div className="mt-6 flex flex-wrap gap-3 justify-center relative z-10">
          <QuickLink href="/dashboard" label="대시보드" />
          <QuickLink href="/deals" label="딜 관리" />
          <QuickLink href="/employees" label="직원 관리" />
          <QuickLink href="/settings" label="상세 설정" />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Shared UI Components
// ═══════════════════════════════════════════

function StepHeader({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-1">
      <StepIcon type={icon} />
      <div>
        <h2 className="text-lg font-bold text-[var(--text)]">{title}</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function CompletedBadge({ message }: { message: string }) {
  return (
    <div className="px-3 py-2.5 rounded-xl flex items-start gap-2" style={{ background: "var(--success)/10", border: "1px solid var(--success)/20" }}>
      <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--success)" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <span className="text-xs" style={{ color: "var(--success)" }}>{message}</span>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
        {label}
        {required && <span className="text-[var(--danger)] ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
      />
      {hint && <p className="text-[10px] text-[var(--text-dim)] mt-1">{hint}</p>}
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  placeholder,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: string[];
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
        {label}
        {required && <span className="text-[var(--danger)] ml-0.5">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
      >
        <option value="">{placeholder || "선택하세요"}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function StepIcon({ type, size = "lg" }: { type: string; size?: "sm" | "lg" }) {
  const s = size === "lg" ? "w-10 h-10" : "w-7 h-7";
  const iconS = size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5";

  const iconElement = (() => {
    const props = {
      className: `${iconS} text-[var(--primary)]`,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      viewBox: "0 0 24 24",
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
    };
    switch (type) {
      case "building":
        return (
          <svg {...props}>
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <path d="M9 22v-4h6v4" />
            <path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" />
          </svg>
        );
      case "bank":
        return (
          <svg {...props}>
            <path d="M3 21h18" /><path d="M3 10h18" /><path d="M12 3l9 7H3l9-7z" />
            <path d="M5 10v8" /><path d="M19 10v8" /><path d="M9 10v8" /><path d="M15 10v8" />
          </svg>
        );
      case "people":
        return (
          <svg {...props}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        );
      case "sparkles":
        return (
          <svg {...props}>
            <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
            <path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5L5 3z" />
          </svg>
        );
      case "check":
        return (
          <svg {...props}>
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      default:
        return null;
    }
  })();

  return (
    <div className={`${s} rounded-xl flex items-center justify-center shrink-0`} style={{ background: "var(--primary)/10" }}>
      {iconElement}
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition border border-[var(--border)]"
    >
      {label}
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </a>
  );
}
