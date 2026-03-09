"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { uploadEmployeeFile } from "@/lib/file-storage";

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
  { value: "kakao", label: "카카오뱅크" },
  { value: "toss", label: "토스뱅크" },
  { value: "kbank", label: "케이뱅크" },
];

const FILE_CATEGORIES = [
  { key: "resume", label: "이력서", required: true, desc: "PDF, Word 형식 권장" },
  { key: "id_copy", label: "신분증 사본", required: false, desc: "주민등록증 또는 운전면허증" },
  { key: "bank_copy", label: "통장 사본", required: false, desc: "급여 입금 계좌 통장 앞면" },
  { key: "resident_reg", label: "주민등록등본", required: false, desc: "최근 3개월 이내 발급본" },
  { key: "portfolio", label: "포트폴리오", required: false, desc: "PDF, 이미지, 링크 등" },
];

type Step = 1 | 2 | 3 | 4 | 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const [step, setStep] = useState<Step>(1);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Personal info
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  // Step 2: Bank info
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankHolder, setBankHolder] = useState("");

  // Step 3: Files
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, { id: string; name: string }>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  // Step 4: Signature
  const [signMode, setSignMode] = useState<"draw" | "type" | null>(null);
  const [typedName, setTypedName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Load employee data
  useEffect(() => {
    if (userLoading || !user) return;
    const cid = user.company_id;
    setCompanyId(cid);
    setEmail(user.email || "");
    setCompanyName((user as any).companies?.name || "");

    // Find employee record for this user
    (async () => {
      const { data: emp } = await db
        .from("employees")
        .select("*")
        .eq("company_id", cid)
        .eq("user_id", user.id)
        .single();

      if (!emp) {
        // Try matching by email
        const { data: empByEmail } = await db
          .from("employees")
          .select("*")
          .eq("company_id", cid)
          .eq("email", user.email)
          .single();

        if (empByEmail) {
          setEmployeeId(empByEmail.id);
          prefillFromEmployee(empByEmail);
        }
        return;
      }

      setEmployeeId(emp.id);
      prefillFromEmployee(emp);

      // If already completed onboarding, redirect
      if (emp.onboarding_completed_at) {
        router.replace("/dashboard");
      }
    })();
  }, [user, userLoading, router]);

  function prefillFromEmployee(emp: any) {
    setName(emp.name || "");
    setPhone(emp.phone || "");
    setBirthDate(emp.birth_date || "");
    setAddress(emp.address || "");
    setEmergencyContact(emp.emergency_contact || "");
    setEmergencyPhone(emp.emergency_phone || "");
    setBankName(emp.bank_name || "");
    setBankAccount(emp.bank_account || "");
    setBankHolder(emp.bank_holder || "");
    if (emp.email) setEmail(emp.email);
  }

  // Canvas drawing handlers
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (step === 4 && signMode === "draw") {
      setTimeout(initCanvas, 100);
    }
  }, [step, signMode, initCanvas]);

  function getCanvasPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isDrawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function endDraw() {
    isDrawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function getSignatureData(): { type: "draw" | "type"; data: string } | null {
    if (signMode === "draw" && hasDrawn && canvasRef.current) {
      return { type: "draw", data: canvasRef.current.toDataURL("image/png") };
    }
    if (signMode === "type" && typedName.trim()) {
      return { type: "type", data: typedName.trim() };
    }
    return null;
  }

  // File upload
  async function handleFileUpload(category: string, file: File) {
    if (!companyId || !employeeId) return;
    setUploading(category);
    setError("");
    try {
      const result = await uploadEmployeeFile({
        companyId,
        employeeId,
        category,
        file,
      });
      setUploadedFiles((prev) => ({ ...prev, [category]: { id: result.id, name: file.name } }));
    } catch (err: any) {
      setError(err.message || "파일 업로드 실패");
    } finally {
      setUploading(null);
    }
  }

  // Save step data
  async function saveStep1() {
    if (!employeeId) return;
    setSaving(true);
    setError("");
    try {
      const { error: e } = await db.from("employees").update({
        name: name || undefined,
        phone: phone || null,
        birth_date: birthDate || null,
        address: address || null,
        emergency_contact: emergencyContact || null,
        emergency_phone: emergencyPhone || null,
      }).eq("id", employeeId);
      if (e) throw e;

      // Update checklist
      await upsertChecklist("personal_info", "기본 정보 입력", true);
      setStep(2);
    } catch (err: any) {
      setError(err.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep2() {
    if (!employeeId) return;
    setSaving(true);
    setError("");
    try {
      const { error: e } = await db.from("employees").update({
        bank_name: bankName || null,
        bank_account: bankAccount || null,
        bank_holder: bankHolder || null,
      }).eq("id", employeeId);
      if (e) throw e;

      await upsertChecklist("bank_info", "급여 계좌 등록", !!(bankName && bankAccount));
      setStep(3);
    } catch (err: any) {
      setError(err.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function saveStep3() {
    // Just mark checklist for uploaded files
    const hasResume = !!uploadedFiles["resume"];
    await upsertChecklist("resume", "이력서 제출", hasResume);
    if (uploadedFiles["id_copy"]) await upsertChecklist("id_copy", "신분증 사본 제출", true);
    if (uploadedFiles["bank_copy"]) await upsertChecklist("bank_copy", "통장 사본 제출", true);
    setStep(4);
  }

  async function saveStep4() {
    if (!employeeId) return;
    setSaving(true);
    setError("");
    try {
      const sig = getSignatureData();
      if (sig) {
        await db.from("employees").update({
          saved_signature: sig,
        }).eq("id", employeeId);
        await upsertChecklist("signature", "전자서명 등록", true);
      }
      setStep(5);
    } catch (err: any) {
      setError(err.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function completeOnboarding() {
    if (!employeeId) return;
    setSaving(true);
    try {
      await db.from("employees").update({
        onboarding_completed_at: new Date().toISOString(),
      }).eq("id", employeeId);

      router.replace("/dashboard");
    } catch (err: any) {
      setError(err.message || "완료 처리 실패");
    } finally {
      setSaving(false);
    }
  }

  async function upsertChecklist(key: string, label: string, completed: boolean) {
    if (!companyId || !employeeId) return;
    await db.from("onboarding_checklist_items").upsert({
      company_id: companyId,
      employee_id: employeeId,
      item_key: key,
      label,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    }, { onConflict: "employee_id,item_key" });
  }

  // Loading state
  if (userLoading || !employeeId) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stepLabels = ["기본 정보", "급여 계좌", "입사 서류", "전자서명", "완료"];

  return (
    <div className="max-w-[640px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold">입사 온보딩</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {companyName}에 오신 것을 환영합니다. 아래 정보를 입력해주세요.
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-1 mb-8">
        {stepLabels.map((label, i) => {
          const stepNum = (i + 1) as Step;
          const isActive = step === stepNum;
          const isDone = step > stepNum;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div className={`w-full h-1.5 rounded-full transition ${isDone ? "bg-[var(--primary)]" : isActive ? "bg-[var(--primary)]/50" : "bg-[var(--border)]"}`} />
              <span className={`text-[10px] font-medium ${isActive ? "text-[var(--primary)]" : isDone ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Step 1: Personal Info */}
      {step === 1 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold mb-1">기본 정보</h2>
            <p className="text-xs text-[var(--text-muted)]">인사 관리에 필요한 기본 정보를 입력해주세요.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">이름 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                placeholder="홍길동" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">이메일</label>
              <input value={email} readOnly
                className="w-full px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-dim)] cursor-not-allowed" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">전화번호</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                placeholder="010-1234-5678" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">생년월일</label>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">주소</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              placeholder="서울특별시 강남구..." />
          </div>

          <div className="pt-2 border-t border-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">비상 연락처</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1 block">연락처 이름</label>
                <input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  placeholder="배우자, 부모님 등" />
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1 block">연락처 번호</label>
                <input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  placeholder="010-0000-0000" />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={saveStep1} disabled={saving || !name.trim()}
              className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
              {saving ? "저장 중..." : "다음"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Bank Info */}
      {step === 2 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold mb-1">급여 계좌</h2>
            <p className="text-xs text-[var(--text-muted)]">급여 입금을 위한 계좌 정보를 등록해주세요.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">은행 선택</label>
            <select value={bankName} onChange={(e) => setBankName(e.target.value)}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
              <option value="">은행을 선택하세요</option>
              {BANK_LIST.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">계좌번호</label>
              <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                placeholder="- 없이 숫자만 입력" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1 block">예금주</label>
              <input value={bankHolder} onChange={(e) => setBankHolder(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                placeholder="본인 이름과 동일" />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)}
              className="px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition">
              이전
            </button>
            <div className="flex gap-2">
              <button onClick={() => { saveStep2(); }}
                className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition">
                건너뛰기
              </button>
              <button onClick={saveStep2} disabled={saving}
                className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                {saving ? "저장 중..." : "다음"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Document Upload */}
      {step === 3 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold mb-1">입사 서류</h2>
            <p className="text-xs text-[var(--text-muted)]">필요한 서류를 업로드해주세요. 필수 항목만 제출하셔도 됩니다.</p>
          </div>

          <div className="space-y-3">
            {FILE_CATEGORIES.map((cat) => {
              const uploaded = uploadedFiles[cat.key];
              const isUploading = uploading === cat.key;

              return (
                <div key={cat.key} className="p-4 bg-[var(--bg)] rounded-xl border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{cat.label}</span>
                      {cat.required && <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded-full font-medium">필수</span>}
                    </div>
                    {uploaded && (
                      <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full font-medium flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                        업로드 완료
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-dim)] mb-2">{cat.desc}</p>

                  {uploaded ? (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="truncate">{uploaded.name}</span>
                      <button onClick={() => setUploadedFiles((p) => { const n = { ...p }; delete n[cat.key]; return n; })}
                        className="ml-auto text-[10px] text-red-400 hover:text-red-300">변경</button>
                    </div>
                  ) : (
                    <label className={`flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[var(--border)] rounded-lg cursor-pointer hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5 transition ${isUploading ? "opacity-50 pointer-events-none" : ""}`}>
                      <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(cat.key, f); }} />
                      {isUploading ? (
                        <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      )}
                      <span className="text-xs text-[var(--text-dim)]">{isUploading ? "업로드 중..." : "파일 선택"}</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(2)}
              className="px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition">
              이전
            </button>
            <div className="flex gap-2">
              <button onClick={saveStep3}
                className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition">
                건너뛰기
              </button>
              <button onClick={saveStep3} disabled={saving}
                className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                다음
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Signature */}
      {step === 4 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold mb-1">전자서명 등록</h2>
            <p className="text-xs text-[var(--text-muted)]">계약서 서명 시 사용할 전자서명을 미리 등록해두면 편리합니다.</p>
          </div>

          {/* Signature mode selection */}
          {!signMode && (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setSignMode("draw")}
                className="p-6 bg-[var(--bg)] rounded-xl border border-[var(--border)] hover:border-[var(--primary)]/40 transition text-center">
                <svg className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <div className="text-sm font-semibold">직접 그리기</div>
                <div className="text-[11px] text-[var(--text-dim)] mt-1">손으로 서명을 그립니다</div>
              </button>
              <button onClick={() => setSignMode("type")}
                className="p-6 bg-[var(--bg)] rounded-xl border border-[var(--border)] hover:border-[var(--primary)]/40 transition text-center">
                <svg className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M4 7V4h16v3M9 20h6M12 4v16" />
                </svg>
                <div className="text-sm font-semibold">이름 타이핑</div>
                <div className="text-[11px] text-[var(--text-dim)] mt-1">이름을 입력하여 서명합니다</div>
              </button>
            </div>
          )}

          {/* Draw mode */}
          {signMode === "draw" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--text-muted)]">아래 영역에 서명해주세요</span>
                <div className="flex gap-2">
                  <button onClick={clearCanvas} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">지우기</button>
                  <button onClick={() => { setSignMode(null); clearCanvas(); setHasDrawn(false); }} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">방식 변경</button>
                </div>
              </div>
              <canvas
                ref={canvasRef}
                className="w-full h-40 bg-white rounded-xl border-2 border-dashed border-[var(--border)] cursor-crosshair touch-none"
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
              />
            </div>
          )}

          {/* Type mode */}
          {signMode === "type" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--text-muted)]">서명할 이름을 입력하세요</span>
                <button onClick={() => { setSignMode(null); setTypedName(""); }} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">방식 변경</button>
              </div>
              <input value={typedName} onChange={(e) => setTypedName(e.target.value)}
                className="w-full px-4 py-4 bg-white border-2 border-dashed border-[var(--border)] rounded-xl text-2xl text-center font-serif focus:outline-none focus:border-[var(--primary)]"
                placeholder={name || "이름 입력"} />
              {typedName && (
                <div className="mt-3 p-4 bg-white rounded-xl border border-[var(--border)] text-center">
                  <p className="text-[10px] text-[var(--text-dim)] mb-1">미리보기</p>
                  <p className="text-3xl font-serif text-gray-800 italic">{typedName}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(3)}
              className="px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition">
              이전
            </button>
            <div className="flex gap-2">
              <button onClick={() => setStep(5)}
                className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition">
                건너뛰기
              </button>
              <button onClick={saveStep4} disabled={saving || (!hasDrawn && !typedName.trim())}
                className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                {saving ? "저장 중..." : "다음"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 5 && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-green-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <div>
            <h2 className="text-xl font-bold mb-2">온보딩 완료!</h2>
            <p className="text-sm text-[var(--text-muted)]">
              모든 정보가 등록되었습니다. 관리자가 계약서를 발송하면 이메일로 알려드립니다.
            </p>
          </div>

          {/* Summary checklist */}
          <div className="text-left bg-[var(--bg)] rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">등록 현황</p>
            {[
              { label: "기본 정보", done: !!name },
              { label: "급여 계좌", done: !!(bankName && bankAccount) },
              { label: "이력서", done: !!uploadedFiles["resume"] },
              { label: "전자서명", done: !!(hasDrawn || typedName.trim()) },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg className="w-4 h-4 text-[var(--text-dim)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                )}
                <span className={item.done ? "text-[var(--text)]" : "text-[var(--text-dim)]"}>{item.label}</span>
              </div>
            ))}
          </div>

          <button onClick={completeOnboarding} disabled={saving}
            className="px-8 py-3 bg-[var(--primary)] text-white rounded-xl text-sm font-bold hover:brightness-110 disabled:opacity-50 transition">
            {saving ? "처리 중..." : "대시보드로 이동"}
          </button>
        </div>
      )}
    </div>
  );
}
