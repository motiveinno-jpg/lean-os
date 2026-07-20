"use client";
import { logRead } from "@/lib/log-read";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useEffect, useState, useRef, useCallback } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

export function CompanyInfoTab({ companyId }: { companyId: string | null }) {
  const db = supabase;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: "",
    business_number: "",
    representative: "",
    address: "",
    phone: "",
    business_type: "",
    business_category: "",
    capital: "",
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
      const data = logRead('_components/CompanyInfoTab:data', await db
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle());
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
        business_type: company.business_type || "",
        business_category: company.business_category || "",
        capital: (company.tax_settings as any)?.capital != null ? String((company.tax_settings as any).capital) : "",
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
          business_type: form.business_type || null,
          business_category: form.business_category || null,
          // 자본금 — 전용 컬럼이 없어 tax_settings(jsonb)에 저장. 재무상태표(자본금)가 읽음.
          tax_settings: { ...((company?.tax_settings as Record<string, unknown> | null) || {}), capital: form.capital ? Number(String(form.capital).replace(/[^0-9]/g, "")) : null },
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
        .update({ [updateField]: publicUrl } as never)
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
      .update({ [updateField]: null } as never)
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
      <div className="glass-card p-6">
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="glass-card p-6">
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
        <div className="company-info-onboarding-banner">
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
      <div className="company-info-basic-form glass-card">
        <h2 className="section-title">기본 정보</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">회사명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="(주)모티브이노베이션"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">사업자번호</label>
              <input
                value={form.business_number}
                onChange={(e) => setForm({ ...form, business_number: formatBusinessNumber(e.target.value) })}
                placeholder="000-00-00000"
                maxLength={12}
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">대표자명</label>
              <input
                value={form.representative}
                onChange={(e) => setForm({ ...form, representative: e.target.value })}
                placeholder="홍길동"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">전화번호</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="02-1234-5678"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">업태</label>
              <input
                value={form.business_type}
                onChange={(e) => setForm({ ...form, business_type: e.target.value })}
                placeholder="서비스업"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">업종</label>
              <input
                value={form.business_category}
                onChange={(e) => setForm({ ...form, business_category: e.target.value })}
                placeholder="소프트웨어 개발"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">자본금 (원)</label>
              <input
                inputMode="numeric"
                value={form.capital ? Number(String(form.capital).replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : ""}
                onChange={(e) => setForm({ ...form, capital: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="예: 10,000,000"
                className="field-input text-right mono-number"
              />
              <p className="text-[10px] text-[var(--text-dim)] mt-1">재무상태표 자본 항목에 사용됩니다. (등기부상 자본금)</p>
            </div>
          </div>
          <div>
            <label className="field-label">주소</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="서울특별시 강남구 테헤란로 123"
              className="field-input"
            />
          </div>
          <button
            onClick={() => form.name && saveMut.mutate()}
            disabled={!form.name || saveMut.isPending}
            className="btn-primary w-full"
          >
            {saveMut.isPending ? "저장 중..." : saved ? "저장 완료" : "회사 정보 저장"}
          </button>
        </div>
      </div>

      {/* Seal & Logo Upload */}
      <div className="company-seal-logo-panel glass-card">
        <h2 className="section-title">직인 및 로고</h2>
        {uploadError && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 text-xs mb-4">{uploadError}</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Seal Upload */}
          <div className="company-seal-upload">
            <label className="field-label mb-2">직인 (회사 도장)</label>
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
                      className="text-xs text-[var(--success)] hover:underline disabled:opacity-50"
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
                      className="text-xs text-[var(--success)] font-semibold hover:underline disabled:opacity-50"
                      title={!form.name?.trim() ? "회사명을 먼저 입력하세요" : ""}
                    >
                      🪄 자동 생성
                    </button>
                  </div>
                  <p className="caption">PNG, JPG (최대 5MB) · 또는 회사명으로 법인인감 자동 생성</p>
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
              <div className="company-seal-preview-panel">
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
                              ? "bg-[var(--primary)] text-white"
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
                        className="btn-primary !text-xs !px-3 !py-1.5"
                      >
                        {generatingSeal ? "저장 중..." : "이 직인 사용"}
                      </button>
                      <button
                        onClick={() => setSealPreview(null)}
                        className="btn-secondary !text-xs !px-3 !py-1.5"
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
          <div className="company-logo-upload">
            <label className="field-label mb-2">회사 로고</label>
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
                  <p className="caption">PNG, JPG (최대 5MB)</p>
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
