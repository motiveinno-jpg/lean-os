"use client";
import { logRead } from "@/lib/log-read";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
// 설정 > 연동·인증의 금융기관 등록 폼을 그대로 재사용 — 온보딩과 설정이 같은 코드를 본다 (2026-08-10)
import { CodefAccountRegister } from "@/app/(app)/settings/_components/BankIntegrationTab";
import { useSampleStatus, sampleErrorText } from "@/components/sample-data-banner";

// ── Constants ──
// 2026-08-10 개편(사장님): 첫 직원·첫 프로젝트·완료 단계 제거 — 회사 정보(+사업자등록증 첨부) →
//   인증서 등록(통장·카드·홈택스 자동 수집) 2단계로 압축. 등록을 마치면 대시보드로 이동해
//   첫 가입자에게 탭 투어(AppTour)를 보여준다.

const STEPS = [
  { num: 1, label: "회사 정보", icon: "building" },
  { num: 2, label: "금융 연결", icon: "bank" },
  // 3단계는 별도 입력 없이 탭 투어(AppTour)로 이어주는 안내 화면 — 진행바가 2개뿐이라 어색하던 것 보완 (2026-08-10 사장님)
  { num: 3, label: "화면 둘러보기", icon: "compass" },
] as const;

const TOTAL_STEPS = STEPS.length;

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

// ── 인트로 단계 (2026-07-20 도입 — 역할 → 페인포인트 → 맞춤 가치제안 3화면 후 기존 위저드 진입).
//    선택 결과는 companies.automation_settings.onboarding_profile 에 저장 (스키마 무변경).
type IntroStep = "role" | "pain" | "value";

const INTRO_ROLES = [
  { key: "ceo", label: "대표 · 경영진", desc: "회사 전체 현황과 자금 흐름을 한눈에 보고 싶어요" },
  { key: "finance", label: "재무 · 회계 담당", desc: "자금 관리와 증빙·세금계산서 업무를 맡고 있어요" },
  { key: "hr", label: "인사 · 총무 담당", desc: "직원 관리와 계약·근태 업무를 맡고 있어요" },
] as const;

const INTRO_PAINS = [
  { key: "scattered", label: "여러 통장·카드에 돈이 흩어져 있어 잔액이 한눈에 안 보여요" },
  { key: "blind", label: "물어보기 전에는 오늘 회사 자금 상황을 알 수 없어요" },
  { key: "hr", label: "직원 출퇴근·연차·급여 챙기는 일이 번거로워요" },
  { key: "sign", label: "계약서에 서명 받으러 다니는 게 일이에요" },
  { key: "tax", label: "세금계산서 발행이랑 증빙 정리가 늘 밀려요" },
] as const;

const INTRO_SOLUTIONS: Record<string, { title: string; badge: string; desc: string }> = {
  scattered: { title: "통합 계좌 · 카드 조회", badge: "실시간", desc: "흩어진 통장 잔액과 법인카드 승인 내역을 자동으로 모아 한 화면에서 바로 확인해요." },
  blind: { title: "경영 대시보드 · 생존지표", badge: "매일 자동", desc: "잔고·고정비·생존개월 같은 핵심 지표를 매일 자동으로 정리해 먼저 보여드려요." },
  hr: { title: "근태 · 연차 · 급여 자동화", badge: "자동", desc: "출퇴근 기록부터 연차 관리, 급여명세서 발송까지 한 곳에서 자동으로 처리해요." },
  sign: { title: "전자계약 · 전자서명", badge: "무제한", desc: "계약서를 링크로 보내고 법적 효력 있는 전자서명을 그 자리에서 바로 받아요." },
  tax: { title: "세금계산서 국세청 발행", badge: "자동 수집", desc: "세금계산서를 앱에서 바로 발행하고 매입·매출 증빙을 자동으로 모아드려요." },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ── Types ──

type StepNumber = 1 | 2 | 3;

interface CompanyForm {
  name: string;
  businessNumber: string;
  industry: string;
  address: string;
  representative: string;
  phone: string;
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

  // 인트로(역할→페인포인트→가치제안) — null 이면 기존 위저드 표시
  const [intro, setIntro] = useState<IntroStep | null>(null);
  const [introRole, setIntroRole] = useState("");
  const [introPain, setIntroPain] = useState("");
  const automationSettingsRef = useRef<Record<string, unknown>>({});

  const companyId = user?.company_id ?? null;

  const [companyDone, setCompanyDone] = useState(false);

  // Step 1: Company
  const [company, setCompany] = useState<CompanyForm>({
    name: "",
    businessNumber: "",
    industry: "",
    address: "",
    representative: "",
    phone: "",
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

  // 온보딩을 마치면(또는 건너뛰면) 대시보드로 — 첫 가입자라 탭 투어를 함께 시작한다.
  const goDashboard = useCallback(() => {
    router.replace("/dashboard?tour=1");
  }, [router]);

  // ── Initialize: check existing data ──

  useEffect(() => {
    if (userLoading || !companyId) return;

    // 직원/파트너 역할은 온보딩 불필요 → 대시보드로
    if (user && !(user as any).is_master) { // (P3) 회사 온보딩은 마스터만 — 멤버·파트너는 스킵
      router.replace("/dashboard");
      return;
    }

    async function checkStatus() {
      try {
        const comp = logRead('onboarding/page:comp', await db
          .from("companies")
          .select("name, business_number, representative, industry, address, phone, automation_settings")
          .eq("id", companyId ?? "")
          .maybeSingle());

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
        setCompanyDone(hasCompany);

        // 이미 금융 연결까지 끝난 회사가 다시 들어오면 온보딩은 볼 게 없다 → 대시보드
        const { data: cs } = await db
          .from("company_settings")
          .select("codef_connected_id")
          .eq("company_id", companyId ?? "")
          .maybeSingle();
        if (hasCompany && cs?.codef_connected_id) {
          router.replace("/dashboard");
          return;
        }

        // 인트로는 아직 안 본 신규에게만 — onboarding_profile 저장 이후엔 다시 안 보임
        const aset = (comp?.automation_settings as Record<string, unknown> | null) || {};
        automationSettingsRef.current = aset;
        if (!aset.onboarding_profile && !hasCompany) {
          setIntro("role");
        }

        if (hasCompany) setStep(2);
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
      }).eq("id", companyId ?? "");

      if (e) throw e;
      setCompanyDone(true);
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

  function handleBack() {
    setError("");
    if (step > 1) setStep((step - 1) as StepNumber);
  }

  // 인트로 완료 — 선택 결과 저장(실패해도 진행은 막지 않음) 후 위저드 진입
  async function finishIntro() {
    setIntro(null);
    try {
      await db.from("companies").update({
        automation_settings: {
          ...automationSettingsRef.current,
          onboarding_profile: { role: introRole, pain: introPain, at: new Date().toISOString() },
        },
      }).eq("id", companyId ?? "");
    } catch {
      // 프로필 저장은 부가 정보 — 실패 시 조용히 진행
    }
  }

  // ── Keyboard: Enter to submit (1단계만 — 2단계는 인증서 폼이 자체 입력을 갖는다) ──

  function handleKeyDown(e: React.KeyboardEvent) {
    if (step === 1 && e.key === "Enter" && !e.shiftKey) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault();
      saveCompanyInfo();
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

  // ── 인트로 3화면 (역할 → 페인포인트 → 맞춤 가치제안) ──
  if (intro === "role") {
    return (
      <div className="onboarding-page">
        <div className="onboarding-intro-panel">
          <h1 className="onboarding-intro-heading">오너뷰에 오신 것을 환영해요!</h1>
          <p className="onboarding-intro-sub">몇 가지만 여쭤보고 딱 맞게 시작해 드릴게요. 어떤 역할로 오셨나요?</p>
          <div className="onboarding-intro-options">
            {INTRO_ROLES.map((r) => (
              <button
                key={r.key}
                onClick={() => setIntroRole(r.key)}
                className={introRole === r.key ? "onboarding-intro-option onboarding-intro-option-active" : "onboarding-intro-option"}
              >
                <span className="onboarding-intro-option-label">{r.label}</span>
                <span className="onboarding-intro-option-desc">{r.desc}</span>
              </button>
            ))}
          </div>
          <div className="onboarding-intro-actions">
            <button className="onboarding-intro-skip" onClick={finishIntro}>건너뛰기</button>
            <button className="btn-primary" disabled={!introRole} onClick={() => setIntro("pain")}>다음</button>
          </div>
        </div>
      </div>
    );
  }
  if (intro === "pain") {
    return (
      <div className="onboarding-page">
        <div className="onboarding-intro-panel">
          <h1 className="onboarding-intro-heading">요즘 가장 골치 아픈 일이 무엇인가요?</h1>
          <p className="onboarding-intro-sub">가장 가까운 하나를 골라주세요. 맞는 해결책부터 보여드릴게요.</p>
          <div className="onboarding-intro-options">
            {INTRO_PAINS.map((p) => (
              <button
                key={p.key}
                onClick={() => setIntroPain(p.key)}
                className={introPain === p.key ? "onboarding-intro-option onboarding-intro-option-active" : "onboarding-intro-option"}
              >
                <span className="onboarding-intro-option-label">{p.label}</span>
              </button>
            ))}
          </div>
          <div className="onboarding-intro-actions">
            <button className="onboarding-intro-back" onClick={() => setIntro("role")}>이전</button>
            <button className="btn-primary" disabled={!introPain} onClick={() => setIntro("value")}>다음</button>
          </div>
        </div>
      </div>
    );
  }
  if (intro === "value") {
    const sol = INTRO_SOLUTIONS[introPain] || INTRO_SOLUTIONS.blind;
    return (
      <div className="onboarding-page">
        <div className="onboarding-intro-panel">
          <h1 className="onboarding-intro-heading">그 고민, 오너뷰가 이렇게 해결해요</h1>
          <div className="onboarding-intro-solution">
            <span className="onboarding-intro-solution-badge">{sol.badge}</span>
            <div className="onboarding-intro-solution-title">{sol.title}</div>
            <p className="onboarding-intro-solution-desc">{sol.desc}</p>
          </div>
          <p className="onboarding-intro-sub">회사 정보와 인증서만 등록하면 바로 시작됩니다.</p>
          <div className="onboarding-intro-actions">
            <button className="onboarding-intro-back" onClick={() => setIntro("pain")}>이전</button>
            <button className="btn-primary" onClick={finishIntro}>지금 시작하기 →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-page" onKeyDown={handleKeyDown}>
      <div className="w-full max-w-[680px] mx-auto">
        {/* Progress bar */}
        <div className="onboarding-progress-bar">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => {
              const isActive = step === s.num;
              const isDone = step > s.num || (s.num === 1 && companyDone);
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
          <div className="onboarding-error-banner" role="alert">
            <svg className="w-4 h-4 text-[var(--danger)] mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span className="text-[var(--danger)]">{error}</span>
          </div>
        )}

        {/* Step content */}
        <div className="onboarding-wizard-step-card glass-card">
          <div className="p-6 sm:p-8 min-h-[380px] sm:min-h-[360px]">
            {step === 1 && (
              <Step1Company data={company} onChange={setCompany} isCompleted={companyDone} companyId={companyId} />
            )}
            {step === 2 && (
              <Step2Finance companyId={companyId} onConnected={() => setStep(3)} />
            )}
            {step === 3 && <Step3Tour />}
          </div>

          {/* Footer */}
          <div
            className="onboarding-footer"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}
          >
            <div>
              {step > 1 && (
                <button
                  onClick={handleBack}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-card)] transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  이전
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step === 1 && (
                <button onClick={saveCompanyInfo} disabled={saving} className="btn-primary">
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      저장 중...
                    </span>
                  ) : (
                    "저장하고 다음"
                  )}
                </button>
              )}
              {step === 2 && (
                <button
                  onClick={() => setStep(3)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  나중에 연결하기
                </button>
              )}
              {step === 3 && (
                <>
                  <button
                    onClick={() => router.replace("/dashboard")}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  >
                    나중에 볼게요
                  </button>
                  <button onClick={goDashboard} className="btn-primary">
                    둘러보기 시작 →
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Skip all link */}
        <div className="onboarding-skip-all">
          <button
            onClick={goDashboard}
            className="text-xs text-[var(--text-dim)] hover:text-[var(--text-muted)] transition underline underline-offset-2"
          >
            나중에 설정하기
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 3: 화면 둘러보기 — 탭 투어(AppTour) 안내 (2026-08-10)
// ═══════════════════════════════════════════

const TOUR_PREVIEW_ITEMS = [
  {
    title: "자금 현황을 한눈에",
    desc: "대시보드·통장·카드 — 회사 돈이 어디서 들어오고 나가는지 매일 자동으로 정리되는 곳을 안내해요.",
  },
  {
    title: "손대지 않아도 채워지는 장부",
    desc: "세금계산서 발행부터 거래 장부 자동 분류까지, 증빙 업무가 스스로 돌아가는 흐름을 보여드려요.",
  },
  {
    title: "종이 없는 회사 운영",
    desc: "직원 초대, 전자결재, 전자계약, 급여명세서 발송까지 — 어디서 처리하는지 짚어드려요.",
  },
];

function Step3Tour() {
  return (
    <div className="onboarding-tour-step">
      <StepHeader
        icon="compass"
        title="이제 오너뷰를 둘러볼 차례예요"
        description="마지막 단계예요! 사이드바의 핵심 메뉴를 하나씩 짚어가며 어디서 무엇을 하는지 1분 만에 안내해 드릴게요."
      />
      <div className="onboarding-tour-list">
        {TOUR_PREVIEW_ITEMS.map((it, i) => (
          <div key={i} className="onboarding-tour-item">
            <span className="onboarding-tour-item-num">{i + 1}</span>
            <div>
              <div className="onboarding-tour-item-title">{it.title}</div>
              <p className="onboarding-tour-item-desc">{it.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="onboarding-tour-footnote">
        둘러보기 중에도 메뉴를 자유롭게 눌러볼 수 있고, 나중에 대시보드 주소 뒤에 <code>?tour=1</code> 을 붙이면 언제든 다시 볼 수 있어요.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 1: Company Info (회사 정보 + 사업자등록증 첨부)
// ═══════════════════════════════════════════

function Step1Company({
  data,
  onChange,
  isCompleted,
  companyId,
}: {
  data: CompanyForm;
  onChange: (d: CompanyForm) => void;
  isCompleted: boolean;
  companyId: string | null;
}) {
  function formatBusinessNumber(value: string) {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  return (
    <div className="onboarding-company-step">
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

        {/* 사업자등록증 첨부 (2026-08-10 사장님) — 설정 > 회사 정보의 회사 문서와 같은 저장 경로를 쓴다.
            여기서 올리면 설정 화면에도 그대로 보이고, 계약서 발송·증명서 발급이 같은 파일을 참조한다. */}
        <BizRegUpload companyId={companyId} />
      </div>
    </div>
  );
}

// 사업자등록증 업로드 — documents 버킷 company-docs/{companyId}/business_reg_{ts}.{ext}
function BizRegUpload({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: files = [] } = useQuery({
    queryKey: ["company-docs", companyId],
    queryFn: async () => {
      if (!companyId) return [] as { name: string }[];
      const { data } = await supabase.storage.from("documents").list(`company-docs/${companyId}`, {
        limit: 100, sortBy: { column: "created_at", order: "desc" },
      });
      return (data || []) as { name: string }[];
    },
    enabled: !!companyId,
  });
  const bizFiles = files.filter((f) => f.name.startsWith("business_reg_"));
  const current = bizFiles[0];
  const pathOf = (name: string) => `company-docs/${companyId}/${name}`;

  const doUpload = async (file: File) => {
    if (!companyId) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `company-docs/${companyId}/business_reg_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
      if (error) throw error;
      // 업로드 성공 후 기존 파일 정리 → 교체
      const old = bizFiles.map((f) => pathOf(f.name));
      if (old.length) await supabase.storage.from("documents").remove(old);
      toast("사업자등록증이 업로드되었습니다", "success");
      qc.invalidateQueries({ queryKey: ["company-docs", companyId] });
    } catch (err: any) {
      toast("업로드 실패: " + (err?.message || ""), "error");
    } finally {
      setBusy(false);
    }
  };

  const doView = async () => {
    if (!current) return;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(pathOf(current.name), 3600);
    if (error || !data?.signedUrl) { toast("파일을 열 수 없습니다", "error"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div>
      <label className="field-label">사업자등록증 첨부 <span className="caption">(사진·PDF, 선택)</span></label>
      <div className="onboarding-bizreg-row">
        {current ? (
          <div className="onboarding-bizreg-done">
            <svg className="w-4 h-4 shrink-0" style={{ color: "var(--success)" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="onboarding-bizreg-filename">등록됨 — 사업자등록증</span>
            <button type="button" onClick={doView} className="onboarding-bizreg-view">보기</button>
          </div>
        ) : (
          <p className="onboarding-bizreg-empty">아직 첨부된 파일이 없습니다.</p>
        )}
        <label className={`onboarding-bizreg-upload-btn ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy ? "업로드 중..." : current ? "다시 올리기" : "사진 첨부"}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ""; }}
          />
        </label>
      </div>
      <p className="text-[10px] text-[var(--text-dim)] mt-1">
        올려두면 설정 &gt; 회사 정보의 회사 문서에도 함께 보이며, 계약서 발송·증명서 발급에 활용됩니다.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 2: 인증서 등록 (금융 연결)
// ═══════════════════════════════════════════

function Step2Finance({ companyId, onConnected }: { companyId: string | null; onConnected: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  //   인증서 등록 전에 샘플 회사로 먼저 둘러보기 — 빈 화면 대신 차 있는 대시보드를 보여 준다.
  //   샘플은 실제 통장을 연결하는 순간 자동으로 지워진다. 넣기에 실패해도 온보딩은 그대로 진행된다.
  const { data: sample } = useSampleStatus(companyId);
  const [seeding, setSeeding] = useState(false);
  const trySample = async () => {
    if (!companyId || seeding) return;
    setSeeding(true);
    try {
      const { error } = await (supabase as any).rpc("sample_company_seed", { p_company: companyId });
      if (error) throw error;
      await qc.invalidateQueries();
      toast("샘플 회사 자료를 넣었어요. 대시보드에서 둘러보세요.", "success");
      router.replace("/dashboard?tour=1");
    } catch (e: any) {
      toast(sampleErrorText(e?.message), "error");
    } finally { setSeeding(false); }
  };
  return (
    <div className="onboarding-bank-step">
      <StepHeader
        icon="bank"
        title="인증서 등록"
        description="인증서를 등록하여 통장, 카드, 홈택스를 불러오세요."
      />
      {sample?.allowed && (
        <div className="onb-sample-card">
          <div className="onb-sample-text">
            <b>인증서가 아직 없으신가요?</b> 샘플 회사 자료로 대시보드·수집·근태 화면을 먼저 둘러볼 수 있어요.
            내 통장을 연결하는 순간 샘플은 자동으로 지워집니다.
          </div>
          <button type="button" className="btn-secondary btn-sm" disabled={seeding} onClick={() => void trySample()}>
            {seeding ? "샘플 준비 중…" : "샘플로 먼저 둘러보기"}
          </button>
        </div>
      )}
      <div className="p-4 rounded-xl bg-[var(--bg)]/50 border border-[var(--border)] mb-4">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-[var(--primary)] mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            공동인증서 한 번 등록으로 <b>통장 거래내역·카드 승인내역·홈택스 세금계산서</b>가 자동으로
            모입니다. 등록을 마치면 대시보드로 이동해요. 나중에 <b>설정 &gt; 연동·인증</b>에서도 언제든 등록할 수 있습니다.
          </p>
        </div>
      </div>

      <CodefAccountRegister
        companyId={companyId}
        onRegistered={() => {
          toast("금융기관 연결 완료! 대시보드로 이동합니다", "success");
          setTimeout(onConnected, 800);
        }}
      />
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
    <div className="onboarding-step-header">
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
    <div className="onboarding-completed-badge">
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
      <label className="field-label">
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
      <label className="field-label">
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
      case "compass":
        return (
          <svg {...props}>
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
        );
      default:
        return null;
    }
  })();

  return (
    <div className={`${s} rounded-xl flex items-center justify-center shrink-0 bg-[var(--primary)]/10`}>
      {iconElement}
    </div>
  );
}
