"use client";

import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const ONBOARDING_KEY = "leanos-onboarding-done";

// ── Helper: check if onboarding should be shown ──
export function shouldShowOnboarding(dealCount: number): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(ONBOARDING_KEY)) return false;
  return dealCount === 0;
}

// ── Types ──
interface CompanyFormData {
  companyName: string;
  businessNumber: string;
  representative: string;
  address: string;
}

interface DealFormData {
  dealName: string;
  classification: "B2B" | "B2C" | "B2G";
  expectedAmount: string;
}

interface OnboardingWizardProps {
  companyId: string;
  companyName: string;
  onComplete: () => void;
}

// ═══════════════════════════════════════════
// OnboardingWizard Component
// ═══════════════════════════════════════════
export function OnboardingWizard({ companyId, companyName, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [skippedDeal, setSkippedDeal] = useState(false);

  // Step 1: Company info
  const [company, setCompany] = useState<CompanyFormData>({
    companyName: companyName || "",
    businessNumber: "",
    representative: "",
    address: "",
  });

  // Step 2: First deal
  const [deal, setDeal] = useState<DealFormData>({
    dealName: "",
    classification: "B2B",
    expectedAmount: "",
  });

  // ── Save company info to Supabase ──
  const saveCompany = useCallback(async () => {
    const db = supabase as any;
    await db
      .from("companies")
      .update({
        name: company.companyName || companyName,
        industry: company.businessNumber
          ? `BN:${company.businessNumber}`
          : undefined,
      })
      .eq("id", companyId);
  }, [company, companyId, companyName]);

  // ── Save deal to Supabase ──
  const saveDeal = useCallback(async () => {
    if (skippedDeal || !deal.dealName.trim()) return null;
    const db = supabase as any;
    const { data } = await db
      .from("deals")
      .insert({
        name: deal.dealName.trim(),
        company_id: companyId,
        classification: deal.classification,
        contract_total: deal.expectedAmount
          ? parseInt(deal.expectedAmount.replace(/[^0-9]/g, ""), 10) || 0
          : 0,
        status: "active",
      })
      .select()
      .single();
    return data;
  }, [deal, companyId, skippedDeal]);

  // ── Handle final completion ──
  const handleComplete = useCallback(async () => {
    setSaving(true);
    try {
      await saveCompany();
      await saveDeal();
      localStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    } catch (err) {
      console.error("Onboarding save error:", err);
      // Still mark complete to avoid blocking user
      localStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    }
    setSaving(false);
  }, [saveCompany, saveDeal, onComplete]);

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };
  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };
  const handleSkipDeal = () => {
    setSkippedDeal(true);
    setStep(3);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-[520px] mx-4 rounded-2xl shadow-lg overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        {/* ── Progress Bar ── */}
        <div className="px-8 pt-6 pb-2">
          <div className="flex items-center justify-between mb-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center flex-1">
                <div className="flex items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                    style={{
                      background:
                        s <= step ? "var(--primary)" : "var(--bg-surface)",
                      color: s <= step ? "#fff" : "var(--text-muted)",
                      border:
                        s <= step
                          ? "2px solid var(--primary)"
                          : "2px solid var(--border)",
                    }}
                  >
                    {s < step ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      s
                    )}
                  </div>
                </div>
                {s < 3 && (
                  <div
                    className="flex-1 h-[2px] mx-2 rounded-full transition-all duration-300"
                    style={{
                      background:
                        s < step ? "var(--primary)" : "var(--border)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-[var(--text-dim)] font-medium px-1">
            <span>회사 정보</span>
            <span>첫 프로젝트</span>
            <span>완료</span>
          </div>
        </div>

        {/* ── Step Content ── */}
        <div className="px-8 py-5 min-h-[320px] flex flex-col">
          {step === 1 && (
            <StepCompanyInfo company={company} setCompany={setCompany} />
          )}
          {step === 2 && <StepFirstDeal deal={deal} setDeal={setDeal} />}
          {step === 3 && (
            <StepComplete
              company={company}
              deal={deal}
              skippedDeal={skippedDeal}
            />
          )}
        </div>

        {/* ── Footer Buttons ── */}
        <div
          className="px-8 py-4 flex items-center justify-between"
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <div>
            {step > 1 && step < 3 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition hover:bg-[var(--bg-elevated)]"
                style={{ color: "var(--text-muted)" }}
              >
                이전
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                onClick={handleSkipDeal}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition hover:bg-[var(--bg-elevated)]"
                style={{ color: "var(--text-dim)" }}
              >
                건너뛰기
              </button>
            )}
            {step < 3 && (
              <button
                onClick={handleNext}
                className="px-5 py-2 rounded-xl text-sm font-bold text-white transition"
                style={{
                  background: "var(--primary)",
                }}
              >
                다음
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleComplete}
                disabled={saving}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition disabled:opacity-60"
                style={{
                  background: "var(--primary)",
                }}
              >
                {saving ? "저장 중..." : "시작하기"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 1: Company Info
// ═══════════════════════════════════════════
function StepCompanyInfo({
  company,
  setCompany,
}: {
  company: CompanyFormData;
  setCompany: (c: CompanyFormData) => void;
}) {
  return (
    <div className="flex-1">
      <h2
        className="text-lg font-bold mb-1"
        style={{ color: "var(--text)" }}
      >
        회사 정보 설정
      </h2>
      <p
        className="text-xs mb-6"
        style={{ color: "var(--text-muted)" }}
      >
        LeanOS에서 사용할 회사 기본 정보를 입력하세요.
      </p>

      <div className="space-y-4">
        <FormField
          label="회사명"
          value={company.companyName}
          onChange={(v) => setCompany({ ...company, companyName: v })}
          placeholder="주식회사 예시"
        />
        <FormField
          label="사업자등록번호"
          value={company.businessNumber}
          onChange={(v) => setCompany({ ...company, businessNumber: v })}
          placeholder="000-00-00000"
        />
        <FormField
          label="대표자명"
          value={company.representative}
          onChange={(v) => setCompany({ ...company, representative: v })}
          placeholder="홍길동"
        />
        <FormField
          label="사업장 주소"
          value={company.address}
          onChange={(v) => setCompany({ ...company, address: v })}
          placeholder="서울시 강남구..."
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 2: First Deal
// ═══════════════════════════════════════════
function StepFirstDeal({
  deal,
  setDeal,
}: {
  deal: DealFormData;
  setDeal: (d: DealFormData) => void;
}) {
  const classifications: { value: "B2B" | "B2C" | "B2G"; label: string; desc: string }[] = [
    { value: "B2B", label: "B2B", desc: "기업 간 거래" },
    { value: "B2C", label: "B2C", desc: "소비자 직접" },
    { value: "B2G", label: "B2G", desc: "정부/공공기관" },
  ];

  return (
    <div className="flex-1">
      <h2
        className="text-lg font-bold mb-1"
        style={{ color: "var(--text)" }}
      >
        첫 프로젝트 생성
      </h2>
      <p
        className="text-xs mb-6"
        style={{ color: "var(--text-muted)" }}
      >
        진행 중인 딜이나 프로젝트를 등록하세요. 나중에 추가할 수도 있습니다.
      </p>

      <div className="space-y-4">
        <FormField
          label="딜/프로젝트명"
          value={deal.dealName}
          onChange={(v) => setDeal({ ...deal, dealName: v })}
          placeholder="예: 2026 상반기 웹 개발"
        />

        <div>
          <label
            className="block text-xs font-semibold mb-2"
            style={{ color: "var(--text-muted)" }}
          >
            분류
          </label>
          <div className="grid grid-cols-3 gap-2">
            {classifications.map((c) => (
              <button
                key={c.value}
                onClick={() => setDeal({ ...deal, classification: c.value })}
                className="p-3 rounded-xl text-center transition border"
                style={{
                  background:
                    deal.classification === c.value
                      ? "var(--primary)"
                      : "var(--bg-surface)",
                  color:
                    deal.classification === c.value
                      ? "#fff"
                      : "var(--text)",
                  borderColor:
                    deal.classification === c.value
                      ? "var(--primary)"
                      : "var(--border)",
                }}
              >
                <div className="text-sm font-bold">{c.label}</div>
                <div
                  className="text-[10px] mt-0.5"
                  style={{
                    color:
                      deal.classification === c.value
                        ? "rgba(255,255,255,0.8)"
                        : "var(--text-dim)",
                  }}
                >
                  {c.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <FormField
          label="예상 금액 (원)"
          value={deal.expectedAmount}
          onChange={(v) =>
            setDeal({
              ...deal,
              expectedAmount: v.replace(/[^0-9]/g, ""),
            })
          }
          placeholder="50000000"
          type="text"
          formatValue={(v) =>
            v ? `${parseInt(v, 10).toLocaleString()}` : ""
          }
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 3: Complete
// ═══════════════════════════════════════════
function StepComplete({
  company,
  deal,
  skippedDeal,
}: {
  company: CompanyFormData;
  deal: DealFormData;
  skippedDeal: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
        style={{ background: "var(--primary)", opacity: 0.9 }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2
        className="text-xl font-bold mb-2"
        style={{ color: "var(--text)" }}
      >
        준비 완료!
      </h2>
      <p
        className="text-sm mb-6"
        style={{ color: "var(--text-muted)" }}
      >
        LeanOS가 설정되었습니다. 지금 바로 시작할 수 있습니다.
      </p>

      {/* Summary */}
      <div
        className="w-full rounded-xl p-4 text-left space-y-3"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
        }}
      >
        <SummaryRow
          label="회사명"
          value={company.companyName || "-"}
        />
        {company.businessNumber && (
          <SummaryRow
            label="사업자번호"
            value={company.businessNumber}
          />
        )}
        {company.representative && (
          <SummaryRow
            label="대표자"
            value={company.representative}
          />
        )}
        {company.address && (
          <SummaryRow
            label="주소"
            value={company.address}
          />
        )}

        <div
          className="my-2"
          style={{
            borderTop: "1px solid var(--border)",
          }}
        />

        {skippedDeal ? (
          <div className="flex items-center gap-2">
            <span
              className="text-xs"
              style={{ color: "var(--text-dim)" }}
            >
              첫 프로젝트: 건너뜀
            </span>
          </div>
        ) : deal.dealName ? (
          <>
            <SummaryRow label="프로젝트" value={deal.dealName} />
            <SummaryRow label="분류" value={deal.classification} />
            {deal.expectedAmount && (
              <SummaryRow
                label="예상 금액"
                value={`${parseInt(deal.expectedAmount, 10).toLocaleString()}원`}
              />
            )}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className="text-xs"
              style={{ color: "var(--text-dim)" }}
            >
              첫 프로젝트: 미입력
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Shared Sub-components
// ═══════════════════════════════════════════
function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  formatValue,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  formatValue?: (v: string) => string;
}) {
  const displayValue = formatValue ? formatValue(value) : value;
  return (
    <div>
      <label
        className="block text-xs font-semibold mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
        onFocus={(e) => {
          (e.target as HTMLInputElement).style.borderColor = "var(--primary)";
        }}
        onBlur={(e) => {
          (e.target as HTMLInputElement).style.borderColor = "var(--border)";
        }}
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span
        className="text-xs"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </span>
      <span
        className="text-xs font-semibold"
        style={{ color: "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}
