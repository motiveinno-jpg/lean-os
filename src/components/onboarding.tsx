"use client";

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

const ONBOARDING_KEY = "leanos-onboarding-done";

export function shouldShowOnboarding(dealCount: number): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(ONBOARDING_KEY)) return false;
  return dealCount === 0;
}

// ── Step Definitions ──
const STEPS = [
  { num: 1, label: "AI 빠른설정" },
  { num: 2, label: "회사 정보" },
  { num: 3, label: "법인통장" },
  { num: 4, label: "법인카드" },
  { num: 5, label: "홈택스 연동" },
  { num: 6, label: "직원 등록" },
  { num: 7, label: "완료" },
];

interface OnboardingWizardProps {
  companyId: string;
  companyName: string;
  onComplete: () => void;
}

// ═══════════════════════════════════════════
// OnboardingWizard — 6-step Setup
// ═══════════════════════════════════════════
export function OnboardingWizard({ companyId, companyName, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

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

  // Step 3: Card accounts
  const [cards, setCards] = useState<Array<{
    card_company: string; card_number: string; card_holder: string; card_alias: string;
  }>>([]);
  const [cardForm, setCardForm] = useState({
    card_company: "", card_number: "", card_holder: "", card_alias: "",
  });

  // Step 4: Hometax
  const [hometax, setHometax] = useState({
    hometax_id: "",
    hometax_pw: "",
    cert_type: "none" as "none" | "joint" | "financial",
    cert_dn: "",
  });

  // Step 5: Employees
  const [employees, setEmployees] = useState<Array<{
    name: string; position: string; department: string; email: string;
  }>>([]);
  const [empForm, setEmpForm] = useState({
    name: "", position: "", department: "", email: "",
  });

  // ── Save all data ──
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleComplete = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const db = supabase as any;
    try {
      // 1. Company info
      await db.from("companies").update({
        name: company.companyName || companyName,
        industry: company.industry || undefined,
      }).eq("id", companyId);

      // 2. Bank accounts
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

      // 3. Card accounts
      for (const card of cards) {
        await db.from("card_accounts").insert({
          company_id: companyId,
          card_company: card.card_company,
          card_number: card.card_number,
          card_holder: card.card_holder,
          alias: card.card_alias,
          is_active: true,
        });
      }

      // 4. Hometax integration
      if (hometax.hometax_id) {
        await db.from("company_integrations").insert({
          company_id: companyId,
          service_type: "hometax",
          service_name: "홈택스",
          login_id: hometax.hometax_id,
          login_pw_encrypted: hometax.hometax_pw,
          cert_dn: hometax.cert_dn || null,
          status: hometax.hometax_id ? "pending" : "disconnected",
          metadata: { cert_type: hometax.cert_type },
        });
      }

      // 5. Employees
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

      localStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    } catch (err) {
      console.error("Onboarding save error:", err);
      setSaveError("저장 중 오류가 발생했습니다. 다시 시도해주세요.");
    }
    setSaving(false);
  }, [company, banks, cards, hometax, employees, companyId, companyName, onComplete]);

  const handleNext = () => { if (step < 7) setStep(step + 1); };
  const handleBack = () => { if (step > 1) setStep(step - 1); };
  const handleSkip = () => { if (step < 7) setStep(step + 1); };

  // AI File Upload — parse Excel and auto-fill forms
  const aiFileRef = useRef<HTMLInputElement>(null);
  const [aiUploading, setAiUploading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const handleAIUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiUploading(true);
    setAiResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      let employeesFound: typeof employees = [];
      let banksFound: typeof banks = [];
      let companyFound: Partial<typeof company> = {};
      let matched = 0;

      for (const sheetName of wb.SheetNames) {
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim());

        // Detect employee list (name + salary or department or position)
        const hasName = headers.some(h => h.includes("이름") || h.includes("name") || h.includes("성명"));
        const hasSalary = headers.some(h => h.includes("급여") || h.includes("salary") || h.includes("월급") || h.includes("연봉"));
        const hasDept = headers.some(h => h.includes("부서") || h.includes("dept") || h.includes("department"));
        const hasPos = headers.some(h => h.includes("직위") || h.includes("직책") || h.includes("position"));

        if (hasName && (hasSalary || hasDept || hasPos)) {
          for (const row of rows) {
            const vals = Object.entries(row);
            const findVal = (keywords: string[]) => {
              const entry = vals.find(([k]) => keywords.some(kw => k.toLowerCase().includes(kw)));
              return entry ? String(entry[1]).trim() : "";
            };
            const name = findVal(["이름", "name", "성명"]);
            if (!name) continue;
            employeesFound.push({
              name,
              position: findVal(["직위", "직책", "position"]),
              department: findVal(["부서", "dept", "department"]),
              email: findVal(["이메일", "email"]),
            });
          }
          matched++;
        }

        // Detect bank accounts (bank_name + account_number)
        const hasBank = headers.some(h => h.includes("은행") || h.includes("bank"));
        const hasAcct = headers.some(h => h.includes("계좌") || h.includes("account"));
        if (hasBank && hasAcct) {
          for (const row of rows) {
            const vals = Object.entries(row);
            const findVal = (keywords: string[]) => {
              const entry = vals.find(([k]) => keywords.some(kw => k.toLowerCase().includes(kw)));
              return entry ? String(entry[1]).trim() : "";
            };
            const bankName = findVal(["은행", "bank"]);
            const acctNum = findVal(["계좌", "account"]);
            if (!bankName || !acctNum) continue;
            banksFound.push({
              bank_name: bankName,
              account_number: acctNum,
              alias: findVal(["별칭", "alias", "용도"]) || bankName,
              balance: findVal(["잔고", "잔액", "balance"]) || "0",
              role: "OPERATING",
            });
          }
          matched++;
        }

        // Detect company info (company name, business number, representative)
        const hasCompany = headers.some(h => h.includes("회사") || h.includes("company") || h.includes("상호"));
        const hasBizNum = headers.some(h => h.includes("사업자") || h.includes("business"));
        if (hasCompany || hasBizNum) {
          const row = rows[0];
          const vals = Object.entries(row);
          const findVal = (keywords: string[]) => {
            const entry = vals.find(([k]) => keywords.some(kw => k.toLowerCase().includes(kw)));
            return entry ? String(entry[1]).trim() : "";
          };
          const cn = findVal(["회사", "company", "상호", "법인"]);
          if (cn) companyFound.companyName = cn;
          const bn = findVal(["사업자", "business"]);
          if (bn) companyFound.businessNumber = bn;
          const rep = findVal(["대표", "representative"]);
          if (rep) companyFound.representative = rep;
          const addr = findVal(["주소", "address"]);
          if (addr) companyFound.address = addr;
          matched++;
        }
      }

      // Apply parsed data
      if (employeesFound.length > 0) setEmployees(employeesFound);
      if (banksFound.length > 0) setBanks(banksFound);
      if (Object.keys(companyFound).length > 0) setCompany(prev => ({ ...prev, ...companyFound }));

      const parts = [];
      if (employeesFound.length) parts.push(`직원 ${employeesFound.length}명`);
      if (banksFound.length) parts.push(`통장 ${banksFound.length}개`);
      if (companyFound.companyName) parts.push("회사 정보");
      setAiResult(parts.length > 0
        ? `자동 인식 완료: ${parts.join(", ")}. 다음 단계에서 확인하세요!`
        : "파일에서 인식 가능한 데이터를 찾지 못했습니다. 수동으로 입력해주세요."
      );
    } catch {
      setAiResult("파일 파싱 중 오류가 발생했습니다. 다른 파일을 시도해주세요.");
    }
    setAiUploading(false);
  }, []);

  // Add helpers
  const addBank = () => {
    if (!bankForm.bank_name || !bankForm.account_number) return;
    setBanks([...banks, { ...bankForm }]);
    setBankForm({ bank_name: "", account_number: "", alias: "", balance: "", role: "OPERATING" });
  };
  const removeBank = (i: number) => setBanks(banks.filter((_, idx) => idx !== i));

  const addCard = () => {
    if (!cardForm.card_company || !cardForm.card_number) return;
    setCards([...cards, { ...cardForm }]);
    setCardForm({ card_company: "", card_number: "", card_holder: "", card_alias: "" });
  };
  const removeCard = (i: number) => setCards(cards.filter((_, idx) => idx !== i));

  const addEmployee = () => {
    if (!empForm.name) return;
    setEmployees([...employees, { ...empForm }]);
    setEmpForm({ name: "", position: "", department: "", email: "" });
  };
  const removeEmployee = (i: number) => setEmployees(employees.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-[600px] mx-4 rounded-2xl shadow-lg overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        {/* ── Progress ── */}
        <div className="px-6 pt-5 pb-3">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.num} className="flex items-center flex-1">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all shrink-0"
                  style={{
                    background: s.num <= step ? "var(--primary)" : "var(--bg-surface)",
                    color: s.num <= step ? "#fff" : "var(--text-dim)",
                    border: s.num <= step ? "2px solid var(--primary)" : "2px solid var(--border)",
                  }}
                >
                  {s.num < step ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : s.num}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-[2px] mx-1 rounded-full transition-all" style={{ background: s.num < step ? "var(--primary)" : "var(--border)" }} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-[var(--text-dim)] font-medium mt-1.5 px-0.5">
            {STEPS.map(s => <span key={s.num} className="text-center" style={{ width: `${100/STEPS.length}%` }}>{s.label}</span>)}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="px-6 py-4 min-h-[360px] max-h-[60vh] overflow-y-auto flex flex-col">
          {step === 1 && (
            <div className="flex-1">
              <StepHeader title="AI 빠른 설정" desc="기존 관리파일(엑셀)을 업로드하면 AI가 직원, 통장, 회사정보를 자동으로 인식합니다." icon="sparkles" />
              <div
                onClick={() => aiFileRef.current?.click()}
                className="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer hover:border-[var(--primary)] transition"
                style={{ borderColor: "var(--border)" }}
              >
                <input ref={aiFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleAIUpload} />
                <div className="text-4xl mb-3">📁</div>
                {aiUploading ? (
                  <div className="text-sm text-[var(--primary)] font-medium">파일 분석 중...</div>
                ) : (
                  <>
                    <div className="text-sm font-semibold mb-1">엑셀/CSV 파일을 드래그하거나 클릭하세요</div>
                    <div className="text-xs text-[var(--text-dim)]">직원 명단, 통장 목록, 회사 정보 등을 자동 인식합니다</div>
                  </>
                )}
              </div>
              {aiResult && (
                <div className="mt-4 px-4 py-3 rounded-xl text-sm" style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
                  {aiResult}
                </div>
              )}
              <div className="mt-6 text-center">
                <button onClick={() => setStep(2)} className="text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition">
                  파일 없이 수동으로 입력하기 →
                </button>
              </div>
            </div>
          )}
          {step === 2 && <StepCompany data={company} set={setCompany} />}
          {step === 3 && <StepBank banks={banks} form={bankForm} setForm={setBankForm} add={addBank} remove={removeBank} />}
          {step === 4 && <StepCard cards={cards} form={cardForm} setForm={setCardForm} add={addCard} remove={removeCard} />}
          {step === 5 && <StepHometax data={hometax} set={setHometax} />}
          {step === 6 && <StepEmployees employees={employees} form={empForm} setForm={setEmpForm} add={addEmployee} remove={removeEmployee} />}
          {step === 7 && <StepSummary company={company} banks={banks} cards={cards} hometax={hometax} employees={employees} />}
          {saveError && (
            <div className="mt-3 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
              {saveError}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <div>
            {step > 1 && step < 7 && (
              <button onClick={handleBack} className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition">
                이전
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step >= 2 && step <= 6 && (
              <button onClick={handleSkip} className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] transition">
                건너뛰기
              </button>
            )}
            {step < 7 && (
              <button onClick={handleNext} className="px-5 py-2 rounded-xl text-sm font-bold text-white transition" style={{ background: "var(--primary)" }}>
                다음
              </button>
            )}
            {step === 7 && (
              <>
                {saveError && (
                  <button
                    onClick={() => { localStorage.setItem(ONBOARDING_KEY, "true"); onComplete(); }}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] transition"
                  >
                    건너뛰고 시작
                  </button>
                )}
                <button
                  onClick={handleComplete}
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition disabled:opacity-60"
                  style={{ background: "var(--primary)" }}
                >
                  {saving ? "저장 중..." : saveError ? "다시 시도" : "설정 완료 — 시작하기"}
                </button>
              </>
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
function StepCompany({ data, set }: { data: any; set: (d: any) => void }) {
  return (
    <div className="flex-1">
      <StepHeader title="회사 기본 정보" desc="사업자 정보를 입력하세요. 세금계산서, 문서 생성에 사용됩니다." icon="building" />
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
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 2: Bank Accounts
// ═══════════════════════════════════════════
function StepBank({ banks, form, setForm, add, remove }: {
  banks: any[]; form: any; setForm: (f: any) => void; add: () => void; remove: (i: number) => void;
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
      <StepHeader title="법인통장 등록" desc="회사 통장을 등록하면 잔고 현황과 거래 내역을 관리할 수 있습니다." icon="bank" />

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
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 3: Card Accounts
// ═══════════════════════════════════════════
function StepCard({ cards, form, setForm, add, remove }: {
  cards: any[]; form: any; setForm: (f: any) => void; add: () => void; remove: (i: number) => void;
}) {
  const CARD_COMPANIES = ["삼성", "현대", "KB국민", "신한", "롯데", "BC", "하나", "우리", "NH농협", "기타"];

  return (
    <div className="flex-1">
      <StepHeader title="법인카드 등록" desc="법인카드를 등록하면 카드 사용내역을 자동 분류하고 세액공제를 관리합니다." icon="card" />

      {cards.length > 0 && (
        <div className="space-y-2 mb-4">
          {cards.map((c, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <div>
                <div className="text-sm font-medium text-[var(--text)]">{c.card_alias || `${c.card_company}카드`}</div>
                <div className="text-xs text-[var(--text-dim)]">{c.card_company} •••• {c.card_number.slice(-4)}</div>
              </div>
              <button onClick={() => remove(i)} className="text-xs text-red-400 hover:text-red-500">삭제</button>
            </div>
          ))}
        </div>
      )}

      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-[var(--text-dim)] mb-1">카드사 *</label>
            <select
              value={form.card_company}
              onChange={(e) => setForm({ ...form, card_company: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-card)] border border-[var(--border)] outline-none focus:border-[var(--primary)]"
            >
              <option value="">선택</option>
              {CARD_COMPANIES.map(c => <option key={c} value={c}>{c}카드</option>)}
            </select>
          </div>
          <Field label="카드번호 *" value={form.card_number} onChange={(v) => setForm({ ...form, card_number: v })} placeholder="1234-5678-9012-3456" small />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="카드 소지자" value={form.card_holder} onChange={(v) => setForm({ ...form, card_holder: v })} placeholder="홍길동" small />
          <Field label="카드 별칭" value={form.card_alias} onChange={(v) => setForm({ ...form, card_alias: v })} placeholder="업무용 카드 1" small />
        </div>
        <button
          onClick={add}
          disabled={!form.card_company || !form.card_number}
          className="w-full py-2 rounded-lg text-xs font-semibold text-[var(--primary)] bg-[var(--primary-light)] hover:bg-[var(--primary)]/20 transition disabled:opacity-40"
        >
          + 카드 추가
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 4: HomeTax Integration
// ═══════════════════════════════════════════
function StepHometax({ data, set }: { data: any; set: (d: any) => void }) {
  return (
    <div className="flex-1">
      <StepHeader title="홈택스 연동 설정" desc="홈택스를 연동하면 세금계산서를 자동으로 가져올 수 있습니다." icon="tax" />

      <div className="space-y-3">
        <Field label="홈택스 아이디" value={data.hometax_id} onChange={(v) => set({ ...data, hometax_id: v })} placeholder="홈택스 로그인 ID" />
        <div>
          <label className="block text-[10px] font-semibold text-[var(--text-dim)] mb-1">홈택스 비밀번호</label>
          <input
            type="password"
            value={data.hometax_pw}
            onChange={(e) => set({ ...data, hometax_pw: e.target.value })}
            placeholder="••••••••"
            className="w-full px-3 py-2.5 rounded-xl text-sm bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-[var(--text-dim)] mb-2">공인인증서 유형</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "none", label: "미등록", desc: "추후 등록" },
              { value: "joint", label: "공동인증서", desc: "구 공인인증서" },
              { value: "financial", label: "금융인증서", desc: "간편인증" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => set({ ...data, cert_type: opt.value })}
                className="p-3 rounded-xl text-center transition border"
                style={{
                  background: data.cert_type === opt.value ? "var(--primary)" : "var(--bg-surface)",
                  color: data.cert_type === opt.value ? "#fff" : "var(--text)",
                  borderColor: data.cert_type === opt.value ? "var(--primary)" : "var(--border)",
                }}
              >
                <div className="text-xs font-bold">{opt.label}</div>
                <div className="text-[10px] mt-0.5" style={{ color: data.cert_type === opt.value ? "rgba(255,255,255,0.8)" : "var(--text-dim)" }}>
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {data.cert_type !== "none" && (
          <Field label="인증서 DN (선택)" value={data.cert_dn} onChange={(v) => set({ ...data, cert_dn: v })} placeholder="cn=홍길동,ou=..." />
        )}

        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div className="text-xs text-blue-700 leading-relaxed">
              <strong>자동 연동은 추후 지원 예정입니다.</strong><br />
              현재는 홈택스에서 엑셀로 다운로드한 세금계산서를 업로드하여 사용할 수 있습니다. 계정 정보를 미리 등록해두면 자동 연동 시 바로 활성화됩니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 5: Employees
// ═══════════════════════════════════════════
function StepEmployees({ employees, form, setForm, add, remove }: {
  employees: any[]; form: any; setForm: (f: any) => void; add: () => void; remove: (i: number) => void;
}) {
  return (
    <div className="flex-1">
      <StepHeader title="직원 등록" desc="팀원을 등록하면 근태, 급여, 경비 관리를 바로 시작할 수 있습니다." icon="people" />

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
    </div>
  );
}

// ═══════════════════════════════════════════
// Step 6: Summary
// ═══════════════════════════════════════════
function StepSummary({ company, banks, cards, hometax, employees }: {
  company: any; banks: any[]; cards: any[]; hometax: any; employees: any[];
}) {
  const sections = [
    {
      icon: "building",
      title: "회사 정보",
      items: company.companyName ? [
        company.companyName,
        company.businessNumber ? `사업자번호: ${company.businessNumber}` : null,
        company.representative ? `대표: ${company.representative}` : null,
      ].filter(Boolean) : ["미입력"],
    },
    {
      icon: "bank",
      title: "법인통장",
      items: banks.length > 0
        ? banks.map(b => `${b.alias || b.bank_name} (${b.bank_name} ${b.account_number})`)
        : ["건너뜀"],
    },
    {
      icon: "card",
      title: "법인카드",
      items: cards.length > 0
        ? cards.map(c => `${c.card_alias || c.card_company} (•••• ${c.card_number.slice(-4)})`)
        : ["건너뜀"],
    },
    {
      icon: "tax",
      title: "홈택스",
      items: hometax.hometax_id
        ? [`아이디: ${hometax.hometax_id}`, `인증서: ${hometax.cert_type === "none" ? "미등록" : hometax.cert_type === "joint" ? "공동인증서" : "금융인증서"}`]
        : ["건너뜀"],
    },
    {
      icon: "people",
      title: "직원",
      items: employees.length > 0
        ? employees.map(e => `${e.name}${e.position ? ` (${e.position})` : ""}`)
        : ["건너뜀"],
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: "var(--primary)" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 className="text-lg font-bold text-[var(--text)] mb-1">초기 설정 완료!</h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">등록한 정보로 OwnerView가 바로 동작합니다.</p>

      <div className="w-full space-y-2">
        {sections.map((sec) => (
          <div key={sec.title} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <SectionIcon type={sec.icon} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[var(--text)] mb-0.5">{sec.title}</div>
              {sec.items.map((item, i) => (
                <div key={i} className="text-[11px] text-[var(--text-muted)] truncate">{item}</div>
              ))}
            </div>
            <div className="shrink-0 mt-0.5">
              {sec.items[0] !== "건너뜀" && sec.items[0] !== "미입력" ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 font-semibold">완료</span>
              ) : (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-semibold">스킵</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════
function StepHeader({ title, desc, icon }: { title: string; desc: string; icon: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <SectionIcon type={icon} size="lg" />
      <div>
        <h2 className="text-base font-bold text-[var(--text)]">{title}</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>
      </div>
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
